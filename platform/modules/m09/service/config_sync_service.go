package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

// DefaultSyncWorkers bounds how many domains are regenerated concurrently.
// Each changed domain shells out to promtool / blackbox_exporter for validation,
// so the cap keeps CPU and file handles predictable while still removing the
// head-of-line blocking of a strictly sequential loop.
const DefaultSyncWorkers = 4

// Validator checks generated artifacts before they are published.
type Validator interface {
	Validate(ctx context.Context, artifacts *configgen.Artifacts, platformJobs []string) configgen.ValidationResult
}

type defaultValidator struct{}

func (defaultValidator) Validate(_ context.Context, artifacts *configgen.Artifacts, platformJobs []string) configgen.ValidationResult {
	return configgen.Validate(artifacts, platformJobs)
}

// ConfigSyncService generates, validates and atomically publishes per-domain
// config snapshots. It never overwrites the current version on failure (D25).
type ConfigSyncService struct {
	repo      repository.SnapshotRepository
	sources   references.SourceReader
	store     *storage.ContentStore
	validator Validator
	sink      references.SyncResultSink

	now           func() time.Time
	retentionDays int
	dayLocation   *time.Location
	workers       int

	mu          sync.Mutex
	domainLocks map[string]*sync.Mutex
}

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
		repo:          repo,
		sources:       sources,
		store:         store,
		validator:     validator,
		now:           func() time.Time { return time.Now().UTC() },
		retentionDays: snapshotRetentionDays(),
		dayLocation:   snapshotDayLocation(),
		workers:       DefaultSyncWorkers,
		domainLocks:   map[string]*sync.Mutex{},
	}
}

// SetSyncSink injects the M01 writeback port. A nil sink disables writeback
// (tests / standalone M09).
func (s *ConfigSyncService) SetSyncSink(sink references.SyncResultSink) {
	s.sink = sink
}

// SetRetention overrides the daily history window (tests / deployment tuning).
func (s *ConfigSyncService) SetRetention(days int, loc *time.Location) {
	s.retentionDays = normalizeSnapshotRetention(days)
	if loc != nil {
		s.dayLocation = loc
	}
}

// EdgeDomainIDs returns the enabled edge domains that participate in config
// sync. The immediate trigger uses it for scope=all (for example a label
// template change that affects every domain).
func (s *ConfigSyncService) EdgeDomainIDs(ctx context.Context) ([]string, error) {
	return s.sources.EdgeDomainIDs(ctx)
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
		// Even without a new version, reconcile M01's sync_status and prune any
		// legacy failed/intra-day rows. This heals a pending state left by an
		// older writeback or a previous platform fault.
		s.recordSyncResult(ctx, source, *current, now)
		s.prune(ctx, domainID)
		return current, nil // no substantive change
	}

	outcome := s.validator.Validate(ctx, artifacts, nil)
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
		// Failed attempts are not config versions (SRS v1.7 FR-13): keep the
		// current passed snapshot untouched and expose the failure only through
		// M01 sync_status / logs.
		s.recordSyncResult(ctx, source, record, now)
		s.prune(ctx, domainID)
		return &record, nil
	}

	id, err := s.repo.InsertAndActivate(ctx, record)
	if err != nil {
		return nil, err
	}
	record.ID = id
	record.IsCurrent = true

	s.prune(ctx, domainID)
	s.recordSyncResult(ctx, source, record, now)
	return &record, nil
}

// prune keeps the current snapshot plus one successful snapshot per natural
// day for the configured retention window, and deletes content for removed
// versions. Pruning is best-effort: a failure never fails an already-published
// snapshot.
func (s *ConfigSyncService) prune(ctx context.Context, domainID string) {
	removed, err := s.repo.PruneSnapshots(ctx, domainID, s.retentionDays, s.dayLocation)
	if err != nil {
		log.Printf("m09: prune config snapshots for domain %s: %v", domainID, err)
		return
	}
	for _, oldVersion := range removed {
		_ = s.store.Delete(domainID, oldVersion)
	}
}

// recordSyncResult writes per-job outcomes back to M01. Writeback failures are
// logged, not propagated: the snapshot is already published and M01 can retry
// on the next source change.
func (s *ConfigSyncService) recordSyncResult(ctx context.Context, source configgen.Source, record repository.ConfigSnapshot, generatedAt time.Time) {
	if s.sink == nil {
		return
	}
	outcomes := make(map[string]string, len(source.Jobs))
	for _, job := range source.Jobs {
		switch {
		case record.ValidationStatus != "passed":
			message := "config validation failed"
			if record.ValidationCause == "user_config" {
				message = "config validation failed (user_config)"
			}
			outcomes[job.Name] = message
		case len(job.Targets) == 0:
			outcomes[job.Name] = "no resolvable targets"
		default:
			outcomes[job.Name] = ""
		}
	}
	if err := s.sink.RecordDomainSync(ctx, record.NetworkDomainID, record.Version, generatedAt, outcomes); err != nil {
		log.Printf("m09: record sync result for domain %s: %v", record.NetworkDomainID, err)
	}
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
	workers := s.workers
	if workers < 1 {
		workers = 1
	}
	// 有界并发：一个全局变更（例如探测模块）会让所有域同时变脏，串行循环下
	// 队尾域要等前面每个域都跑完生成 + 校验；并发后总时长由「域数 / workers」决定。
	// last 由 mutex 保护，SyncDomain 自己按域加锁，跨域并发安全。
	sem := make(chan struct{}, workers)
	var (
		wg sync.WaitGroup
		mu sync.Mutex
	)
	for _, domainID := range domains {
		wg.Add(1)
		go func(domainID string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			fingerprint, err := s.sources.Fingerprint(ctx, domainID)
			if err != nil {
				return
			}
			mu.Lock()
			previous, ok := last[domainID]
			mu.Unlock()
			if ok && !fingerprint.After(previous) {
				return
			}
			if _, err := s.SyncDomain(ctx, domainID); err != nil {
				return
			}
			mu.Lock()
			last[domainID] = fingerprint
			mu.Unlock()
		}(domainID)
	}
	wg.Wait()
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
