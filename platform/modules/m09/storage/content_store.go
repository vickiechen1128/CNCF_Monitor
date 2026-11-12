// Package storage persists M09 config snapshot content on the local filesystem.
// Metadata lives in domain_config_snapshots; the artifact payload is written as
// a JSON document keyed by domain/version.
package storage

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
)

// ContentStore reads and writes snapshot payloads under a root directory.
type ContentStore struct {
	root string
}

// NewContentStore constructs a store. An empty root falls back to a stable
// directory under the OS temp dir (dev/test); production passes ConfigOutputDir.
func NewContentStore(root string) *ContentStore {
	if strings.TrimSpace(root) == "" {
		root = filepath.Join(os.TempDir(), "metric-center-m09-snapshots")
	}
	return &ContentStore{root: filepath.Join(root, "snapshots")}
}

// payload is the on-disk representation of a snapshot.
type payload struct {
	Version       string            `json:"version"`
	Checksum      string            `json:"checksum"`
	PrometheusYML string            `json:"prometheus_yml"`
	RulesYML      string            `json:"rules_yml"`
	BlackboxYML   string            `json:"blackbox_yml"`
	TargetsFiles  map[string]string `json:"targets_files"`
	Metadata      string            `json:"metadata"`
}

// WriteArtifacts stores the artifact payload and returns the file path.
func (s *ContentStore) WriteArtifacts(domainID, version string, artifacts *configgen.Artifacts) (string, error) {
	if artifacts == nil {
		return "", fmt.Errorf("storage: artifacts are required")
	}
	path, err := s.path(domainID, version)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return "", fmt.Errorf("storage: create snapshot dir: %w", err)
	}
	raw, err := json.Marshal(payload{
		Version:       artifacts.Version,
		Checksum:      artifacts.Checksum,
		PrometheusYML: artifacts.PrometheusYML,
		RulesYML:      artifacts.RulesYML,
		BlackboxYML:   artifacts.BlackboxYML,
		TargetsFiles:  artifacts.TargetsFiles,
		Metadata:      artifacts.Metadata,
	})
	if err != nil {
		return "", fmt.Errorf("storage: marshal snapshot: %w", err)
	}
	if err := os.WriteFile(path, raw, 0o640); err != nil {
		return "", fmt.Errorf("storage: write snapshot: %w", err)
	}
	return path, nil
}

// Read returns the raw snapshot payload.
func (s *ContentStore) Read(domainID, version string) ([]byte, error) {
	path, err := s.path(domainID, version)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("storage: read snapshot: %w", err)
	}
	return raw, nil
}

// WriteRaw stores an arbitrary payload (e.g. the M08 alertmanager.yml snapshot).
func (s *ContentStore) WriteRaw(domainID, version string, payload []byte) (string, error) {
	path, err := s.path(domainID, version)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return "", fmt.Errorf("storage: create snapshot dir: %w", err)
	}
	if err := os.WriteFile(path, payload, 0o640); err != nil {
		return "", fmt.Errorf("storage: write snapshot: %w", err)
	}
	return path, nil
}

// BuildZip packages a stored snapshot as the edge agent config zip:
// prometheus.yml / rules.yml / blackbox.yml / targets/<job>.json / metadata.json.
func (s *ContentStore) BuildZip(domainID, version string) ([]byte, error) {
	raw, err := s.Read(domainID, version)
	if err != nil {
		return nil, err
	}
	var stored payload
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, fmt.Errorf("storage: decode snapshot payload: %w", err)
	}
	buf := &bytes.Buffer{}
	writer := zip.NewWriter(buf)
	add := func(name, content string) error {
		if content == "" {
			return nil
		}
		entry, err := writer.Create(name)
		if err != nil {
			return fmt.Errorf("storage: create zip entry %s: %w", name, err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			return fmt.Errorf("storage: write zip entry %s: %w", name, err)
		}
		return nil
	}
	if err := add("prometheus.yml", stored.PrometheusYML); err != nil {
		return nil, err
	}
	if err := add("rules.yml", stored.RulesYML); err != nil {
		return nil, err
	}
	if err := add("blackbox.yml", stored.BlackboxYML); err != nil {
		return nil, err
	}
	for name, content := range stored.TargetsFiles {
		if err := add("targets/"+name, content); err != nil {
			return nil, err
		}
	}
	if err := add("metadata.json", stored.Metadata); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("storage: close zip: %w", err)
	}
	return buf.Bytes(), nil
}

// Delete removes a snapshot payload; a missing file is not an error.
func (s *ContentStore) Delete(domainID, version string) error {
	path, err := s.path(domainID, version)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("storage: delete snapshot: %w", err)
	}
	return nil
}

func (s *ContentStore) path(domainID, version string) (string, error) {
	domain, err := safeSegment(domainID)
	if err != nil {
		return "", err
	}
	ver, err := safeSegment(version)
	if err != nil {
		return "", err
	}
	return filepath.Join(s.root, domain, ver+".json"), nil
}

func safeSegment(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("storage: empty path segment")
	}
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
		default:
			return "", fmt.Errorf("storage: unsafe path segment %q", value)
		}
	}
	if value == "." || value == ".." {
		return "", fmt.Errorf("storage: unsafe path segment %q", value)
	}
	return value, nil
}
