// Package service implements the M09 config-artifact read model: one unified
// history over domain scrape configs, center rules and M08 alertmanager history
// (0016 config_snapshots), plus preview and operator-facing exports.
package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

// ArtifactView is the list/detail DTO of one config artifact.
type ArtifactView struct {
	ID                int64
	ArtifactType      repository.ArtifactType
	NetworkDomainID   string
	Version           string
	Checksum          string
	ValidationStatus  string
	ValidationCause   string
	ValidationDetails string
	IsCurrent         bool
	GeneratedBy       string
	GeneratedAt       *time.Time
	CreatedAt         time.Time
	ContentAvailable  bool
}

// ArtifactFile is one previewable file inside an artifact.
type ArtifactFile struct {
	Name    string
	Content string
}

// ArtifactPreview is the read-only content view of an artifact.
type ArtifactPreview struct {
	Artifact ArtifactView
	Files    []ArtifactFile
}

// ArtifactExport is a downloadable artifact or bundle.
type ArtifactExport struct {
	FileName    string
	ContentType string
	Data        []byte
}

// ArtifactService serves the unified config-artifact history.
type ArtifactService struct {
	repo  ArtifactRepository
	store *storage.ContentStore
}

// ArtifactRepository is the read port used by ArtifactService.
type ArtifactRepository interface {
	ListArtifacts(ctx context.Context, filter repository.ArtifactFilter) ([]repository.Artifact, error)
	GetArtifact(ctx context.Context, id int64) (*repository.Artifact, error)
	CurrentArtifact(ctx context.Context, typ repository.ArtifactType, onlyPassed bool) (*repository.Artifact, error)
}

// NewArtifactService constructs the read model.
func NewArtifactService(repo ArtifactRepository, store *storage.ContentStore) *ArtifactService {
	return &ArtifactService{repo: repo, store: store}
}

// List returns the unified artifact history newest first.
func (s *ArtifactService) List(ctx context.Context, filter repository.ArtifactFilter) ([]ArtifactView, error) {
	rows, err := s.repo.ListArtifacts(ctx, filter)
	if err != nil {
		return nil, err
	}
	out := make([]ArtifactView, 0, len(rows))
	for i := range rows {
		out = append(out, s.toView(&rows[i]))
	}
	return out, nil
}

// Get returns one artifact's metadata.
func (s *ArtifactService) Get(ctx context.Context, id int64) (*ArtifactView, error) {
	row, err := s.repo.GetArtifact(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	view := s.toView(row)
	return &view, nil
}

// Preview returns the artifact metadata plus its file list for the detail drawer.
func (s *ArtifactService) Preview(ctx context.Context, id int64) (*ArtifactPreview, error) {
	row, err := s.repo.GetArtifact(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	files, err := s.files(row)
	if err != nil {
		return nil, err
	}
	return &ArtifactPreview{Artifact: s.toView(row), Files: files}, nil
}

// Export returns the operator-facing, directly usable file for one artifact:
// a domain config zip, a center rules.yml, or an alertmanager.yml.
func (s *ArtifactService) Export(ctx context.Context, id int64) (*ArtifactExport, error) {
	row, err := s.repo.GetArtifact(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	switch row.Scope {
	case repository.ArtifactTypeDomain:
		raw, err := s.store.BuildZip(row.ScopeKey, row.Version)
		if err != nil {
			return nil, apierror.Wrap(apierror.NotFound,
				"artifact content is not available for this version", err)
		}
		return &ArtifactExport{
			FileName:    fmt.Sprintf("%s-%s.zip", row.ScopeKey, row.Version),
			ContentType: "application/zip",
			Data:        raw,
		}, nil
	case repository.ArtifactTypeCenter:
		payload, err := s.store.ReadPayload(repository.ArtifactTypeCenterKey, row.Version)
		if err != nil {
			return nil, apierror.Wrap(apierror.NotFound,
				"artifact content is not available for this version", err)
		}
		return &ArtifactExport{
			FileName:    fmt.Sprintf("%s-rules.yml", row.Version),
			ContentType: "text/yaml; charset=utf-8",
			Data:        []byte(payload.RulesYML),
		}, nil
	case repository.ArtifactTypeAlertmanager:
		if strings.TrimSpace(row.Content) == "" {
			return nil, apierror.New(apierror.NotFound, "artifact content is empty")
		}
		return &ArtifactExport{
			FileName:    fmt.Sprintf("%s-alertmanager.yml", row.Version),
			ContentType: "text/yaml; charset=utf-8",
			Data:        []byte(row.Content),
		}, nil
	default:
		return nil, apierror.Newf(apierror.BadRequest, "unsupported artifact type %q", row.Scope)
	}
}

// ExportRaw returns the original stored payload for troubleshooting. It is a
// secondary download; the operator-facing export is Export.
func (s *ArtifactService) ExportRaw(ctx context.Context, id int64) (*ArtifactExport, error) {
	row, err := s.repo.GetArtifact(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, nil
	}
	switch row.Scope {
	case repository.ArtifactTypeDomain, repository.ArtifactTypeCenter:
		raw, err := s.store.Read(row.ScopeKey, row.Version)
		if err != nil {
			return nil, apierror.Wrap(apierror.NotFound,
				"artifact content is not available for this version", err)
		}
		return &ArtifactExport{
			FileName:    fmt.Sprintf("%s-%s.json", row.ScopeKey, row.Version),
			ContentType: "application/json; charset=utf-8",
			Data:        raw,
		}, nil
	case repository.ArtifactTypeAlertmanager:
		if strings.TrimSpace(row.Content) == "" {
			return nil, apierror.New(apierror.NotFound, "artifact content is empty")
		}
		return &ArtifactExport{
			FileName:    fmt.Sprintf("%s-alertmanager.yml", row.Version),
			ContentType: "text/yaml; charset=utf-8",
			Data:        []byte(row.Content),
		}, nil
	default:
		return nil, apierror.Newf(apierror.BadRequest, "unsupported artifact type %q", row.Scope)
	}
}

// RecoveryBundle renders the center-side one-shot recovery zip: center
// prometheus.yml + rules.yml + current alertmanager.yml + targets + manifest.
func (s *ArtifactService) RecoveryBundle(ctx context.Context) (*ArtifactExport, error) {
	center, err := s.repo.CurrentArtifact(ctx, repository.ArtifactTypeCenter, true)
	if err != nil {
		return nil, err
	}
	if center == nil {
		return nil, apierror.New(apierror.NotFound,
			"no current center rules artifact; wait for the center sync or generate one first")
	}
	payload, err := s.store.ReadPayload(repository.ArtifactTypeCenterKey, center.Version)
	if err != nil {
		return nil, apierror.Wrap(apierror.NotFound,
			"center artifact content is not available for this version", err)
	}

	manifest := bundleManifest{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Files: []bundleFile{
			{Name: "prometheus.yml", Version: center.Version, Checksum: center.Checksum},
		},
	}
	buf := &bytes.Buffer{}
	zw := zip.NewWriter(buf)
	add := func(name, content string) error {
		if strings.TrimSpace(content) == "" {
			return nil
		}
		entry, err := zw.Create(name)
		if err != nil {
			return fmt.Errorf("create bundle entry %s: %w", name, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			return fmt.Errorf("write bundle entry %s: %w", name, err)
		}
		return nil
	}
	if err := add("prometheus.yml", payload.PrometheusYML); err != nil {
		return nil, err
	}
	if strings.TrimSpace(payload.RulesYML) != "" {
		manifest.Files = append(manifest.Files,
			bundleFile{Name: "rules.yml", Version: center.Version, Checksum: center.Checksum})
	}
	if err := add("rules.yml", payload.RulesYML); err != nil {
		return nil, err
	}
	targetNames := make([]string, 0, len(payload.TargetsFiles))
	for name := range payload.TargetsFiles {
		targetNames = append(targetNames, name)
	}
	sort.Strings(targetNames)
	for _, name := range targetNames {
		if err := add("targets/"+name, payload.TargetsFiles[name]); err != nil {
			return nil, err
		}
		manifest.Files = append(manifest.Files,
			bundleFile{Name: "targets/" + name, Version: center.Version, Checksum: center.Checksum})
	}

	am, err := s.repo.CurrentArtifact(ctx, repository.ArtifactTypeAlertmanager, true)
	if err != nil {
		return nil, err
	}
	if am != nil && strings.TrimSpace(am.Content) != "" {
		if err := add("alertmanager.yml", am.Content); err != nil {
			return nil, err
		}
		manifest.Files = append(manifest.Files,
			bundleFile{Name: "alertmanager.yml", Version: am.Version, Checksum: am.Checksum})
	} else {
		manifest.Notes = append(manifest.Notes,
			"alertmanager.yml unavailable: no current M08 alertmanager snapshot")
	}

	rawManifest, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshal recovery manifest: %w", err)
	}
	entry, err := zw.Create("manifest.json")
	if err != nil {
		return nil, fmt.Errorf("create bundle manifest: %w", err)
	}
	if _, err := entry.Write(rawManifest); err != nil {
		return nil, fmt.Errorf("write bundle manifest: %w", err)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("close recovery bundle: %w", err)
	}
	return &ArtifactExport{
		FileName:    fmt.Sprintf("center-recovery-%s.zip", center.Version),
		ContentType: "application/zip",
		Data:        buf.Bytes(),
	}, nil
}

func (s *ArtifactService) files(row *repository.Artifact) ([]ArtifactFile, error) {
	switch row.Scope {
	case repository.ArtifactTypeAlertmanager:
		if strings.TrimSpace(row.Content) == "" {
			return nil, apierror.New(apierror.NotFound, "artifact content is empty")
		}
		return []ArtifactFile{{Name: "alertmanager.yml", Content: row.Content}}, nil
	case repository.ArtifactTypeDomain, repository.ArtifactTypeCenter:
		payload, err := s.store.ReadPayload(row.ScopeKey, row.Version)
		if err != nil {
			return nil, apierror.Wrap(apierror.NotFound,
				"artifact content is not available for this version", err)
		}
		files := make([]ArtifactFile, 0, 6)
		appendFile := func(name, content string) {
			if strings.TrimSpace(content) == "" {
				return
			}
			files = append(files, ArtifactFile{Name: name, Content: content})
		}
		appendFile("prometheus.yml", payload.PrometheusYML)
		appendFile("rules.yml", payload.RulesYML)
		if row.Scope == repository.ArtifactTypeDomain {
			appendFile("blackbox.yml", payload.BlackboxYML)
		}
		names := make([]string, 0, len(payload.TargetsFiles))
		for name := range payload.TargetsFiles {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			appendFile("targets/"+name, payload.TargetsFiles[name])
		}
		appendFile("metadata.json", payload.Metadata)
		return files, nil
	default:
		return nil, apierror.Newf(apierror.BadRequest, "unsupported artifact type %q", row.Scope)
	}
}

func (s *ArtifactService) toView(row *repository.Artifact) ArtifactView {
	view := ArtifactView{
		ID:                row.ID,
		ArtifactType:      row.Scope,
		Version:           row.Version,
		Checksum:          row.Checksum,
		ValidationStatus:  row.ValidationStatus,
		ValidationCause:   row.ValidationCause,
		ValidationDetails: row.ValidationDetails,
		IsCurrent:         row.IsCurrent,
		GeneratedBy:       row.GeneratedBy,
		GeneratedAt:       row.GeneratedAt,
		CreatedAt:         row.CreatedAt,
	}
	switch row.Scope {
	case repository.ArtifactTypeDomain:
		view.NetworkDomainID = row.ScopeKey
		view.ContentAvailable = s.store.Exists(row.ScopeKey, row.Version)
	case repository.ArtifactTypeCenter:
		view.ContentAvailable = s.store.Exists(repository.ArtifactTypeCenterKey, row.Version)
	case repository.ArtifactTypeAlertmanager:
		view.ContentAvailable = strings.TrimSpace(row.Content) != ""
	}
	return view
}

type bundleManifest struct {
	GeneratedAt string       `json:"generated_at"`
	Files       []bundleFile `json:"files"`
	Notes       []string     `json:"notes,omitempty"`
}

type bundleFile struct {
	Name     string `json:"name"`
	Version  string `json:"version"`
	Checksum string `json:"checksum"`
}
