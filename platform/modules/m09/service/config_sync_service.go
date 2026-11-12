package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

// DefaultSnapshotRetention keeps the newest N snapshots per domain plus the
// current one (contract §4: 3–5 read-only history).
const DefaultSnapshotRetention = 5

// Validator checks generated artifacts before they are published.
type Validator interface {
	Validate(ctx context.Context, artifacts *configgen.Artifacts) configgen.ValidationResult
}

type defaultValidator struct{}

func (defaultValidator) Validate(_ context.Context, artifacts *configgen.Artifacts) configgen.ValidationResult {
	return configgen.Validate(artifacts)
}

// ConfigSyncService generates, validates and atomically publishes per-domain
// config snapshots. It never overwrites the current version on failure (D25).
type ConfigSyncService struct {
	repo      repository.SnapshotRepository
	sources   references.SourceReader
	store     *storage.ContentStore
	validator Validator

	now       func() time.Time
	retention int

	mu          sync.Mutex
	domainLocks map[string]*sync.Mutex
}

var _ references.AlertmanagerSnapshotSink = (*ConfigSyncService)(nil)

// NewConfigSyncService constructs the service. A nil validator falls back to
// the shared promtool/blackbox checks.
func NewConfigSyncService(
	repo repository.SnapshotRepository,
	sources references.SourceReader,
	store *storage.ContentStore,
	validator Validator,
) *ConfigSyncService {
	if validator == nil {
		validator = defaultValidator{}
	}
	return &ConfigSyncService{
		repo:        repo,
		sources:     sources,
		store:       store,
		validator:   validator,
		now:         func() time.Time { return time.Now().UTC() },
		retention:   DefaultSnapshotRetention,
		domainLocks: map[string]*sync.Mutex{},
	}
}

// SyncDomain regenerates the domain config and publishes it when valid. On
// success it atomically switches is_current and prunes old snapshots; on
// failure it records a failed snapshot without touching the current version.
func (s *ConfigSyncService) SyncDomain(ctx context.Context, domainID string) (*repository.ConfigSnapshot, error) {
	lock := s.domainLock(domainID)
	lock.Lock()
	defer lock.Unlock()

	now := s.now()
	source, err := s.sources.BuildSource(ctx, domainID)
	if err != nil {
		return nil, err
	}
	version := newSnapshotVersion(now)
	artifacts, err := configgen.Generate(source, version, now)
	if err != nil {
		return nil, err
	}

	current, err := s.repo.CurrentPassed(ctx, domainID)
	if err != nil {
		return nil, err
	}
	if current != nil && current.Checksum == artifacts.Checksum {
		return current, nil // no substantive change
	}

	outcome := s.validator.Validate(ctx, artifacts)
	record := repository.ConfigSnapshot{
		NetworkDomainID:   domainID,
		Version:           version,
		Checksum:          artifacts.Checksum,
		ContentType:       "full",
		ValidationStatus:  outcome.Status,
		ValidationCause:   outcome.Cause,
		ValidationDetails: outcome.Details,
		GeneratedBy:       "system",
		CreatedAt:         now,
	}
	if outcome.Status == "passed" {
		if _, err := s.store.WriteArtifacts(domainID, version, artifacts); err != nil {
			record.ValidationStatus = "failed"
			record.ValidationCause = "platform_fault"
			record.ValidationDetails = mustJSON(map[string]any{"message": err.Error()})
		}
	}

	if record.ValidationStatus != "passed" {
		id, err := s.repo.InsertSnapshot(ctx, record)
		if err != nil {
			return nil, err
		}
		record.ID = id
		return &record, nil
	}

	id, err := s.repo.InsertAndActivate(ctx, record)
	if err != nil {
		return nil, err
	}
	record.ID = id
	record.IsCurrent = true

	if removed, err := s.repo.PruneSnapshots(ctx, domainID, s.retention); err == nil {
		for _, oldVersion := range removed {
			_ = s.store.Delete(domainID, oldVersion)
		}
	}
	return &record, nil
}

// CurrentContent returns the current passed snapshot checksum and content.
// (\"\", nil, nil) means the domain has no published snapshot yet.
func (s *ConfigSyncService) CurrentContent(ctx context.Context, domainID string) (string, []byte, error) {
	current, err := s.repo.CurrentPassed(ctx, domainID)
	if err != nil {
		return "", nil, err
	}
	if current == nil {
		return "", nil, nil
	}
	raw, err := s.store.Read(domainID, current.Version)
	if err != nil {
		return "", nil, err
	}
	return current.Checksum, raw, nil
}

// CurrentConfigZip returns the current passed snapshot checksum and its edge
// config zip package (prometheus.yml / targets / metadata.json).
func (s *ConfigSyncService) CurrentConfigZip(ctx context.Context, domainID string) (string, []byte, error) {
	current, err := s.repo.CurrentPassed(ctx, domainID)
	if err != nil {
		return "", nil, err
	}
	if current == nil {
		return "", nil, nil
	}
	zipBytes, err := s.store.BuildZip(domainID, current.Version)
	if err != nil {
		return "", nil, err
	}
	return current.Checksum, zipBytes, nil
}

// ListSnapshots returns snapshot metadata newest first.
func (s *ConfigSyncService) ListSnapshots(ctx context.Context, domainID string, limit int) ([]repository.ConfigSnapshot, error) {
	return s.repo.ListSnapshots(ctx, domainID, limit)
}

// GetSnapshot returns one snapshot, or nil when it does not belong to the domain.
func (s *ConfigSyncService) GetSnapshot(ctx context.Context, domainID string, id int64) (*repository.ConfigSnapshot, error) {
	return s.repo.GetSnapshot(ctx, domainID, id)
}

// SnapshotContent returns the stored payload for a specific snapshot.
func (s *ConfigSyncService) SnapshotContent(ctx context.Context, domainID string, id int64) (*repository.ConfigSnapshot, []byte, error) {
	snapshot, err := s.repo.GetSnapshot(ctx, domainID, id)
	if err != nil || snapshot == nil {
		return snapshot, nil, err
	}
	raw, err := s.store.Read(domainID, snapshot.Version)
	if err != nil {
		return nil, nil, err
	}
	return snapshot, raw, nil
}

// RunWatcher polls each enabled edge domain's source fingerprint and re-syncs
// on change. The first pass runs immediately so a fresh start publishes the
// current config without waiting for the first tick.
func (s *ConfigSyncService) RunWatcher(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	last := map[string]time.Time{}
	s.watchOnce(ctx, last)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.watchOnce(ctx, last)
		}
	}
}

func (s *ConfigSyncService) watchOnce(ctx context.Context, last map[string]time.Time) {
	domains, err := s.sources.EdgeDomainIDs(ctx)
	if err != nil {
		return
	}
	for _, domainID := range domains {
		fingerprint, err := s.sources.Fingerprint(ctx, domainID)
		if err != nil {
			continue
		}
		if previous, ok := last[domainID]; ok && !fingerprint.After(previous) {
			continue
		}
		if _, err := s.SyncDomain(ctx, domainID); err != nil {
			continue
		}
		last[domainID] = fingerprint
	}
}

func (s *ConfigSyncService) domainLock(domainID string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	lock, ok := s.domainLocks[domainID]
	if !ok {
		lock = &sync.Mutex{}
		s.domainLocks[domainID] = lock
	}
	return lock
}

// newSnapshotVersion mirrors the contract example 20261111-0a1b: UTC date plus
// four random hex characters so concurrent syncs cannot collide.
func newSnapshotVersion(now time.Time) string {
	buf := make([]byte, 2)
	if _, err := rand.Read(buf); err != nil {
		return now.UTC().Format("20060102-150405")
	}
	return now.UTC().Format("20060102") + "-" + hex.EncodeToString(buf)
}

func mustJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(raw)
}

// SaveAlertmanagerSnapshot implements references.AlertmanagerSnapshotSink: it
// retains the M08-generated alertmanager.yml as read-only history. The snapshot
// is never activated, so it cannot replace the current scrape config (D31).
func (s *ConfigSyncService) SaveAlertmanagerSnapshot(ctx context.Context, domainID, content, checksum, generatedBy string) error {
	if strings.TrimSpace(content) == "" {
		return &domain.ValidationError{Field: "content", Message: "alertmanager.yml content is required"}
	}
	now := s.now()
	buf := make([]byte, 2)
	_, _ = rand.Read(buf)
	version := "am-" + now.UTC().Format("20060102") + "-" + hex.EncodeToString(buf)
	if _, err := s.store.WriteRaw(domainID, version, []byte(content)); err != nil {
		return err
	}
	_, err := s.repo.InsertSnapshot(ctx, repository.ConfigSnapshot{
		NetworkDomainID:   domainID,
		Version:           version,
		Checksum:          checksum,
		ContentType:       "full",
		ValidationStatus:  "passed",
		ValidationCause:   "none",
		ValidationDetails: "{}",
		GeneratedBy:       generatedBy,
		CreatedAt:         now,
	})
	return err
}
