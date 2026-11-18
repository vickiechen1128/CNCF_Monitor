package service_test

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

func newArtifactStack(t *testing.T) (*service.ArtifactService, *gorm.DB, *storage.ContentStore) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m09-artifacts.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	store := storage.NewContentStore(t.TempDir())
	return service.NewArtifactService(repository.NewGORMRepository(gormDB), store), gormDB, store
}

func insertArtifactRow(t *testing.T, gormDB *gorm.DB, scope, scopeKey, version, checksum, content string, current bool) {
	t.Helper()
	require.NoError(t, gormDB.Exec(`INSERT INTO config_snapshots
		(scope, scope_key, version, checksum, content, validation_status, validation_cause, is_current, generated_by, created_at)
		VALUES (?, ?, ?, ?, ?, 'passed', 'none', ?, 'tester', ?)`,
		scope, scopeKey, version, checksum, content, current, time.Now().UTC()).Error)
}

func TestArtifactServiceUnifiedHistoryPreviewAndExport(t *testing.T) {
	svc, gormDB, store := newArtifactStack(t)
	ctx := context.Background()

	domainArtifacts := &configgen.Artifacts{
		Version:       "20261117-aaaa",
		Checksum:      "sum-domain",
		PrometheusYML: "global:\n  external_labels:\n    network_domain_id: mc-a\n",
		BlackboxYML:   "modules:\n  icmp: {}\n",
		TargetsFiles:  map[string]string{"node.json": `[{"targets":["10.0.0.1:9100"]}]`},
		Metadata:      `{"config_version":"20261117-aaaa"}`,
	}
	_, err := store.WriteArtifacts("mc-a", domainArtifacts.Version, domainArtifacts)
	require.NoError(t, err)
	insertArtifactRow(t, gormDB, "domain", "mc-a", domainArtifacts.Version, domainArtifacts.Checksum, "", true)

	centerArtifacts := &configgen.Artifacts{
		Version:       "20261117-bbbb",
		Checksum:      "sum-center",
		PrometheusYML: "global: {}\nrule_files:\n  - rules.yml\n",
		RulesYML:      "groups:\n  - name: test\n",
	}
	_, err = store.WriteArtifacts(repository.ArtifactTypeCenterKey, centerArtifacts.Version, centerArtifacts)
	require.NoError(t, err)
	insertArtifactRow(t, gormDB, "center", "center", centerArtifacts.Version, centerArtifacts.Checksum, "", true)

	insertArtifactRow(t, gormDB, "alertmanager", "alertmanager", "am-20261117-cccc", "sum-am", "route:\n  receiver: web\n", true)

	items, err := svc.List(ctx, repository.ArtifactFilter{Limit: 50})
	require.NoError(t, err)
	require.Len(t, items, 3)
	types := map[repository.ArtifactType]bool{}
	for _, item := range items {
		types[item.ArtifactType] = true
		assert.True(t, item.ContentAvailable, "content should be available for %s", item.ArtifactType)
	}
	assert.True(t, types[repository.ArtifactTypeDomain])
	assert.True(t, types[repository.ArtifactTypeCenter])
	assert.True(t, types[repository.ArtifactTypeAlertmanager])

	// Tenant scoping: no authorized domain => platform artifacts only.
	restricted, err := svc.List(ctx, repository.ArtifactFilter{
		Limit: 50, RestrictDomains: true, AllowedDomains: []string{},
	})
	require.NoError(t, err)
	require.Len(t, restricted, 2)
	for _, item := range restricted {
		assert.NotEqual(t, repository.ArtifactTypeDomain, item.ArtifactType)
	}

	var domainID int64
	for _, item := range items {
		if item.ArtifactType == repository.ArtifactTypeDomain {
			domainID = item.ID
		}
	}
	preview, err := svc.Preview(ctx, domainID)
	require.NoError(t, err)
	require.NotNil(t, preview)
	names := make([]string, 0, len(preview.Files))
	for _, file := range preview.Files {
		names = append(names, file.Name)
	}
	assert.Contains(t, names, "prometheus.yml")
	assert.Contains(t, names, "targets/node.json")
	assert.Contains(t, names, "blackbox.yml")
	assert.Contains(t, names, "metadata.json")

	export, err := svc.Export(ctx, domainID)
	require.NoError(t, err)
	assert.Equal(t, "application/zip", export.ContentType)
	reader, err := zip.NewReader(bytes.NewReader(export.Data), int64(len(export.Data)))
	require.NoError(t, err)
	entries := map[string]string{}
	for _, entry := range reader.File {
		handle, err := entry.Open()
		require.NoError(t, err)
		raw, err := io.ReadAll(handle)
		require.NoError(t, err)
		_ = handle.Close()
		entries[entry.Name] = string(raw)
	}
	assert.Contains(t, entries, "prometheus.yml")
	assert.Contains(t, entries, "targets/node.json")

	// Center export is rules.yml; alertmanager export is the raw YAML.
	for _, item := range items {
		if item.ArtifactType != repository.ArtifactTypeCenter {
			continue
		}
		centerExport, err := svc.Export(ctx, item.ID)
		require.NoError(t, err)
		assert.Contains(t, string(centerExport.Data), "groups:")
		assert.Contains(t, centerExport.FileName, "rules.yml")
	}
	for _, item := range items {
		if item.ArtifactType != repository.ArtifactTypeAlertmanager {
			continue
		}
		amExport, err := svc.Export(ctx, item.ID)
		require.NoError(t, err)
		assert.Contains(t, string(amExport.Data), "receiver: web")
		assert.Contains(t, amExport.FileName, "alertmanager.yml")
	}

	bundle, err := svc.RecoveryBundle(ctx)
	require.NoError(t, err)
	assert.Equal(t, "application/zip", bundle.ContentType)
	reader, err = zip.NewReader(bytes.NewReader(bundle.Data), int64(len(bundle.Data)))
	require.NoError(t, err)
	bundleEntries := map[string]bool{}
	for _, entry := range reader.File {
		bundleEntries[entry.Name] = true
	}
	assert.True(t, bundleEntries["prometheus.yml"])
	assert.True(t, bundleEntries["rules.yml"])
	assert.True(t, bundleEntries["alertmanager.yml"])
	assert.True(t, bundleEntries["manifest.json"])
}

func TestArtifactServiceReturnsNilForMissingAndRequiresCenterForBundle(t *testing.T) {
	svc, _, _ := newArtifactStack(t)
	ctx := context.Background()

	item, err := svc.Get(ctx, 99999)
	require.NoError(t, err)
	assert.Nil(t, item)

	_, err = svc.RecoveryBundle(ctx)
	assert.Error(t, err)
}
