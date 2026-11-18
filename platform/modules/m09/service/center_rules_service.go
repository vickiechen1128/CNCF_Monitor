package service

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

// DefaultCenterSnapshotRetention keeps the newest N center artifacts plus the
// current one (SRS v1.5 FR-13).
const DefaultCenterSnapshotRetention = 5

// CenterRulesService renders the platform-global rules.yml evaluated by the
// center Prometheus (D35) and reports per-rule outcomes back to M01.
type CenterRulesService struct {
	repo      repository.CenterSnapshotRepository
	source    references.CenterRuleSource
	sink      references.SyncResultSink
	outputDir string
	store     *storage.ContentStore
	// alertmanagerAddr is the center Alertmanager host:port embedded into the
	// generated prometheus.yml alerting section for the recovery bundle.
	alertmanagerAddr string
	promURL          *url.URL
	client           *http.Client
	now              func() time.Time
	validator        Validator
}

// NewCenterRulesService constructs the service.
func NewCenterRulesService(
	repo repository.CenterSnapshotRepository,
	source references.CenterRuleSource,
	sink references.SyncResultSink,
	outputDir string,
	promURL *url.URL,
) *CenterRulesService {
	return &CenterRulesService{
		repo:      repo,
		source:    source,
		sink:      sink,
		outputDir: outputDir,
		store:     storage.NewContentStore(outputDir),
		promURL:   promURL,
		client:    &http.Client{Timeout: 5 * time.Second},
		now:       func() time.Time { return time.Now().UTC() },
		validator: defaultValidator{},
	}
}

// SetValidator overrides the artifact validator (tests inject a stub).
// SetAlertmanagerAddr wires the center Alertmanager target into the generated
// prometheus.yml (center recovery bundle). Empty keeps the alerting section out.
func (s *CenterRulesService) SetAlertmanagerAddr(addr string) {
	s.alertmanagerAddr = addr
}

func (s *CenterRulesService) SetValidator(validator Validator) {
	if validator != nil {
		s.validator = validator
	}
}

// Sync regenerates the center rules artifact and publishes it when valid.
func (s *CenterRulesService) Sync(ctx context.Context) (*repository.CenterConfigSnapshot, error) {
	rules, err := s.source.ListEnabledReady(ctx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	version := newSnapshotVersion(now)
	modelsRules := make([]models.MonitoringRule, 0, len(rules))
	for _, rule := range rules {
		modelsRules = append(modelsRules, models.MonitoringRule{
			ContentMode: models.RuleContentModeYAMLPassthrough,
			RuleContent: rule.RuleContent,
			Enabled:     true,
			DraftStatus: "ready",
			Scope:       models.ScopeTypeCentral,
		})
	}
	artifacts, err := configgen.GenerateCenterRules(modelsRules, version, now, s.alertmanagerAddr)
	if err != nil {
		return nil, err
	}

	current, err := s.repo.CurrentPassed(ctx)
	if err != nil {
		return nil, err
	}
	if current != nil && current.Checksum == artifacts.Checksum {
		// Upgrade path: rows created before content persistence have no payload.
		// Backfill the current version so preview/export/recovery work without a
		// spurious new snapshot.
		_, _ = s.store.WriteArtifacts(repository.ArtifactTypeCenterKey, current.Version, artifacts)
		return current, nil
	}

	outcome := s.validator.Validate(ctx, artifacts)
	record := repository.CenterConfigSnapshot{
		Version:           version,
		Checksum:          artifacts.Checksum,
		ValidationStatus:  outcome.Status,
		ValidationCause:   outcome.Cause,
		ValidationDetails: outcome.Details,
		CreatedAt:         now,
	}
	if record.ValidationStatus == "passed" {
		// Persist the full center artifact (prometheus.yml + rules.yml + targets)
		// before publishing, so history preview/export and the recovery bundle can
		// rebuild the exact version. A persistence failure must not publish a
		// version that has no durable history.
		if _, err := s.store.WriteArtifacts(repository.ArtifactTypeCenterKey, version, artifacts); err != nil {
			record.ValidationStatus = "failed"
			record.ValidationCause = "platform_fault"
			record.ValidationDetails = mustJSON(map[string]any{"message": err.Error()})
		} else if err := s.publish(ctx, artifacts.RulesYML); err != nil {
			record.ValidationStatus = "failed"
			record.ValidationCause = "platform_fault"
			record.ValidationDetails = mustJSON(map[string]any{"message": err.Error()})
		}
	}

	if record.ValidationStatus != "passed" {
		id, err := s.repo.Insert(ctx, record)
		if err != nil {
			return nil, err
		}
		record.ID = id
		s.recordOutcomes(ctx, rules, record, now)
		s.prune(ctx)
		return &record, nil
	}

	id, err := s.repo.InsertAndActivate(ctx, record)
	if err != nil {
		return nil, err
	}
	record.ID = id
	record.IsCurrent = true
	s.recordOutcomes(ctx, rules, record, now)
	s.prune(ctx)
	return &record, nil
}

// prune trims center history and removes the corresponding content files.
// Pruning is best-effort: a failure never fails an already-published snapshot.
func (s *CenterRulesService) prune(ctx context.Context) {
	removed, err := s.repo.Prune(ctx, DefaultCenterSnapshotRetention)
	if err != nil {
		log.Printf("m09 center rules: prune: %v", err)
		return
	}
	for _, version := range removed {
		_ = s.store.Delete(repository.ArtifactTypeCenterKey, version)
	}
}

// RunWatcher polls the M01 rule fingerprint and syncs when it changes. It runs
// one immediate pass so startup does not wait for the first tick.
func (s *CenterRulesService) RunWatcher(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	var last time.Time
	run := func() {
		fingerprint, err := s.source.Fingerprint(ctx)
		if err != nil {
			log.Printf("m09 center rules: fingerprint: %v", err)
			return
		}
		if !fingerprint.IsZero() && !fingerprint.After(last) {
			return
		}
		if _, err := s.Sync(ctx); err != nil {
			log.Printf("m09 center rules: sync: %v", err)
			return
		}
		last = fingerprint
	}
	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}

func (s *CenterRulesService) publish(ctx context.Context, rulesYML string) error {
	if strings.TrimSpace(s.outputDir) == "" {
		return nil
	}
	path := filepath.Join(s.outputDir, "rules.yml")
	tmp, err := os.CreateTemp(s.outputDir, "rules-*.yml")
	if err != nil {
		return fmt.Errorf("create temp rules file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.WriteString(rulesYML); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp rules file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp rules file: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("replace %s: %w", path, err)
	}
	return s.reload(ctx)
}

func (s *CenterRulesService) reload(ctx context.Context) error {
	if s.promURL == nil {
		return nil
	}
	target := s.promURL.ResolveReference(&url.URL{Path: "/-/reload"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), nil)
	if err != nil {
		return fmt.Errorf("build reload request: %w", err)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("center prometheus reload: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("center prometheus reload: status %d", resp.StatusCode)
	}
	return nil
}

func (s *CenterRulesService) recordOutcomes(ctx context.Context, rules []references.CenterRule, record repository.CenterConfigSnapshot, generatedAt time.Time) {
	if s.sink == nil || len(rules) == 0 {
		return
	}
	outcomes := make(map[string]string, len(rules))
	for _, rule := range rules {
		if record.ValidationStatus == "passed" {
			outcomes[rule.ID] = ""
			continue
		}
		message := "center rules validation failed"
		if record.ValidationCause == "user_config" {
			message = "center rules validation failed (user_config)"
		}
		outcomes[rule.ID] = message
	}
	if err := s.sink.RecordRuleSync(ctx, record.Version, generatedAt, outcomes); err != nil {
		log.Printf("m09 center rules: record sync results: %v", err)
	}
}
