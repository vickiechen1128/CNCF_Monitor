package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/apply"
	"github.com/metriccenter/metriccenter/platform/modules/m08/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// SaveOutcome is the result of one successful save-and-apply cycle.
type SaveOutcome struct {
	Checksum        string
	Version         string
	PendingSections []string
	Reload          apply.Result
}

// ConfigService owns the generated alertmanager.yml lifecycle: generate →
// validate → apply → persist. The snapshot is the single authoritative history;
// M09 reads it for the unified config-artifact view (no second copy).
type ConfigService struct {
	snapshots   repository.SnapshotRepository
	channels    repository.ChannelRepository
	inhibitions repository.InhibitionRepository
	checker     ConfigChecker
	applier     *apply.Applier
	reloadLogs  repository.ReloadLogRepository
	bridgeBase  string
	keepHistory int
	now         func() time.Time
	mu          sync.Mutex
}

// ConfigOptions carries the generation / apply wiring.
type ConfigOptions struct {
	Checker       ConfigChecker
	Applier       *apply.Applier
	BridgeBaseURL string
	KeepHistory   int
	ReloadLogs    repository.ReloadLogRepository
}

// NewConfigService constructs the service.
func NewConfigService(
	snapshots repository.SnapshotRepository,
	channels repository.ChannelRepository,
	inhibitions repository.InhibitionRepository,
	opts ConfigOptions,
) *ConfigService {
	keep := opts.KeepHistory
	if keep <= 0 {
		keep = 20
	}
	return &ConfigService{
		snapshots: snapshots, channels: channels, inhibitions: inhibitions,
		checker: opts.Checker, applier: opts.Applier,
		reloadLogs: opts.ReloadLogs,
		bridgeBase: opts.BridgeBaseURL, keepHistory: keep,
		now: func() time.Time { return time.Now().UTC() },
	}
}

// SetClock overrides the clock (tests).
func (s *ConfigService) SetClock(now func() time.Time) { s.now = now }

// Current returns the current snapshot.
func (s *ConfigService) Current(ctx context.Context) (*domain.Snapshot, error) {
	return s.snapshots.Current(ctx)
}

// ListVersions returns the read-only snapshot history.
func (s *ConfigService) ListVersions(ctx context.Context, page, pageSize int) ([]*domain.Snapshot, int64, error) {
	return s.snapshots.List(ctx, page, pageSize)
}

// GetVersion loads one historical snapshot.
func (s *ConfigService) GetVersion(ctx context.Context, id int64) (*domain.Snapshot, error) {
	return s.snapshots.Get(ctx, id)
}

// ReloadLogs returns the read-only reload history (FR-07).
func (s *ConfigService) ReloadLogs(ctx context.Context, page, pageSize int) ([]*domain.ReloadLog, int64, error) {
	if s.reloadLogs == nil {
		return []*domain.ReloadLog{}, 0, nil
	}
	return s.reloadLogs.List(ctx, repository.ReloadLogFilter{Page: page, PageSize: pageSize})
}

// LatestReload returns the newest reload attempt, if any.
func (s *ConfigService) LatestReload(ctx context.Context) (*domain.ReloadLog, bool, error) {
	if s.reloadLogs == nil {
		return nil, false, nil
	}
	logs, total, err := s.reloadLogs.List(ctx, repository.ReloadLogFilter{Page: 1, PageSize: 1})
	if err != nil || total == 0 || len(logs) == 0 {
		return nil, false, err
	}
	return logs[0], true, nil
}

// EnabledRules returns the rules rendered into the current configuration.
func (s *ConfigService) EnabledRules(ctx context.Context) ([]*domain.InhibitionRule, error) {
	return s.inhibitions.ListEnabled(ctx)
}

// SaveRoutes validates and applies a new routing tree (FR-13/FR-14).
func (s *ConfigService) SaveRoutes(ctx context.Context, baseChecksum string, tree []domain.RouteNode, operator string) (*SaveOutcome, error) {
	return s.save(ctx, baseChecksum, tree, domain.ReloadTriggerRouteSave, operator, []string{string(domain.PendingRouteChanged)})
}

// SaveAfterInhibitionChange regenerates the configuration after an inhibition
// rule change, keeping the current routing tree untouched (FR-20).
func (s *ConfigService) SaveAfterInhibitionChange(ctx context.Context, baseChecksum, operator string) (*SaveOutcome, error) {
	current, err := s.snapshots.Current(ctx)
	if err != nil {
		return nil, err
	}
	return s.save(ctx, baseChecksum, current.RouteTree, domain.ReloadTriggerInhibitionSave, operator,
		[]string{string(domain.PendingInhibitRulesChanged)})
}

// ReloadCurrent re-applies the current snapshot without creating a new version
// (D-M08-06, manual replay).
func (s *ConfigService) ReloadCurrent(ctx context.Context, operator string) (apply.Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, err := s.snapshots.Current(ctx)
	if err != nil {
		return apply.Result{}, err
	}
	return s.applier.Apply(ctx, apply.Request{
		SnapshotID: &current.ID, ConfigVersion: current.Version, Checksum: current.Checksum,
		Content: current.Content, Operator: operator, Trigger: domain.ReloadTriggerManual,
		PreviousContent: current.Content, Force: true,
	})
}

// save is the shared route/inhibition write path. Order matters: validate and
// apply BEFORE persisting, so history only ever contains versions that passed
// both gates (NFR-05) and the DB never points at a file that failed to load.
func (s *ConfigService) save(
	ctx context.Context,
	baseChecksum string,
	tree []domain.RouteNode,
	trigger domain.ReloadTrigger,
	operator string,
	pending []string,
) (*SaveOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current, err := s.snapshots.Current(ctx)
	if err != nil {
		if _, ok := err.(*domain.NotFoundError); !ok {
			return nil, err
		}
		current = nil
	}
	if current != nil && baseChecksum != "" && baseChecksum != current.Checksum {
		return nil, &domain.ConflictError{Message: "配置已被他人更新，请刷新后重试（base_checksum 不匹配）"}
	}

	channels, err := s.channels.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{configgen.DefaultReceiver: true}
	for _, channel := range channels {
		allowed[channel.ReceiverName()] = true
	}
	if issues := domain.ValidateRouteTree(tree, allowed); len(issues) > 0 {
		return nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	rules, err := s.inhibitions.ListEnabled(ctx)
	if err != nil {
		return nil, err
	}
	generated, err := configgen.Generate(configgen.Input{
		RouteTree: tree, InhibitRules: rules, Channels: channels, BridgeBaseURL: s.bridgeBase,
	})
	if err != nil {
		return nil, &domain.ValidationError{Field: "route_tree", Message: err.Error()}
	}
	if s.checker != nil {
		if err := s.checker.Check(ctx, generated.Content); err != nil {
			return nil, err
		}
	}

	version := generatedVersion(s.now(), trigger)
	request := apply.Request{
		ConfigVersion: version, Checksum: generated.Checksum,
		Content: generated.Content, Operator: operator, Trigger: trigger,
	}
	if current != nil {
		request.PreviousContent = current.Content
	}
	reloaded, err := s.applier.Apply(ctx, request)
	if err != nil {
		return nil, err
	}

	snapshot := &domain.Snapshot{
		Version: version, Checksum: generated.Checksum,
		Content: generated.Content, RouteTree: tree, GeneratedBy: operator, GeneratedAt: s.now(),
	}
	if err := s.snapshots.CreateCurrent(ctx, snapshot, s.keepHistory); err != nil {
		return nil, err
	}
	return &SaveOutcome{
		Checksum: snapshot.Checksum, Version: snapshot.Version,
		PendingSections: pending, Reload: reloaded,
	}, nil
}

// generateDefault renders the seed configuration (no channels, no rules).
func generateDefault(base string, tree []domain.RouteNode) (*configgen.Output, error) {
	return configgen.Generate(configgen.Input{RouteTree: tree, BridgeBaseURL: base})
}

// generatedVersion returns `<yyyymmdd>-<4 hex>` in UTC.
func generatedVersion(now time.Time, trigger domain.ReloadTrigger) string {
	buf := make([]byte, 2)
	if _, err := rand.Read(buf); err != nil {
		return now.UTC().Format("20060102-150405")
	}
	return configgen.NewVersion(now, hex.EncodeToString(buf))
}
