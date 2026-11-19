package service

import (
	"context"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	m09domain "github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// TriggerScope selects what an immediate config-sync request recalculates.
type TriggerScope string

const (
	// TriggerScopeDomain regenerates the requested network domains.
	TriggerScopeDomain TriggerScope = "domain"
	// TriggerScopeCenter regenerates the platform-global center rules artifact.
	TriggerScopeCenter TriggerScope = "center"
	// TriggerScopeAll regenerates every enabled edge domain and the center rules.
	TriggerScopeAll TriggerScope = "all"
)

const (
	// DefaultTriggerDebounce coalesces rapid saves (for example a bulk edit)
	// into one generation pass.
	DefaultTriggerDebounce = 500 * time.Millisecond
	// DefaultTriggerWorkers bounds concurrent domain generation.
	DefaultTriggerWorkers = 4
	// DefaultTriggerWait bounds a wait=true request; callers should fall back
	// to polling when Completed=false.
	DefaultTriggerWait = 5 * time.Second
	// maxTriggerDomains bounds an explicit network_domain_ids request.
	maxTriggerDomains = 200
)

// TriggerRequest is one immediate config-sync request.
type TriggerRequest struct {
	Scope            TriggerScope
	NetworkDomainIDs []string
	// Wait runs the sync inline and returns its result. The frontend normally
	// uses Wait=false and polls source sync_status; scripts may use Wait=true.
	Wait bool
}

// DomainTriggerResult reports the outcome for one network domain.
type DomainTriggerResult struct {
	NetworkDomainID   string `json:"network_domain_id"`
	Version           string `json:"version"`
	ValidationStatus  string `json:"validation_status"`
	ValidationCause   string `json:"validation_cause"`
	ValidationDetails string `json:"validation_details,omitempty"`
	Error             string `json:"error,omitempty"`
}

// CenterTriggerResult reports the outcome of the center rules sync.
type CenterTriggerResult struct {
	Version           string `json:"version"`
	ValidationStatus  string `json:"validation_status"`
	ValidationCause   string `json:"validation_cause"`
	ValidationDetails string `json:"validation_details,omitempty"`
	Error             string `json:"error,omitempty"`
}

// TriggerResult is the immediate-sync response. Completed=false means the
// request was accepted/queued but did not finish within the wait budget.
type TriggerResult struct {
	Accepted  bool                  `json:"accepted"`
	Completed bool                  `json:"completed"`
	Domains   []DomainTriggerResult `json:"domains,omitempty"`
	Center    *CenterTriggerResult  `json:"center,omitempty"`
}

// ConfigTriggerService turns source-save events into immediate M09 syncs while
// keeping the 30s watcher as the fallback. Rapid requests are coalesced in a
// debounced worker so bulk edits do not run promtool once per row.
type ConfigTriggerService struct {
	domains    *ConfigSyncService
	center     *CenterRulesService
	onboarding *OnboardingService

	debounce    time.Duration
	workers     int
	waitTimeout time.Duration

	kick chan struct{}

	mu             sync.Mutex
	pendingDomains map[string]struct{}
	pendingCenter  bool
}

// NewConfigTriggerService constructs the trigger service.
func NewConfigTriggerService(
	domains *ConfigSyncService,
	center *CenterRulesService,
	onboarding *OnboardingService,
) *ConfigTriggerService {
	return &ConfigTriggerService{
		domains:        domains,
		center:         center,
		onboarding:     onboarding,
		debounce:       DefaultTriggerDebounce,
		workers:        DefaultTriggerWorkers,
		waitTimeout:    DefaultTriggerWait,
		kick:           make(chan struct{}, 1),
		pendingDomains: map[string]struct{}{},
	}
}

// Trigger validates and dispatches one immediate sync request.
//
// Wait=false returns as soon as the request is queued. Wait=true runs the sync
// inline with a bounded timeout; if the timeout fires, the work is queued for
// the background worker and Completed=false tells the caller to poll.
func (s *ConfigTriggerService) Trigger(ctx context.Context, actor Actor, req TriggerRequest) (*TriggerResult, error) {
	scope, err := normalizeTriggerScope(req.Scope)
	if err != nil {
		return nil, err
	}
	domains, includeCenter, err := s.resolveScope(ctx, actor, scope, req.NetworkDomainIDs)
	if err != nil {
		return nil, err
	}

	if !req.Wait {
		s.enqueue(domains, includeCenter)
		return &TriggerResult{Accepted: true}, nil
	}

	waitCtx, cancel := context.WithTimeout(ctx, s.waitTimeout)
	defer cancel()
	result := s.runNow(waitCtx, domains, includeCenter)
	if waitCtx.Err() != nil {
		result.Completed = false
		s.enqueue(domains, includeCenter)
	}
	return result, nil
}

// NotifyDomains enqueues a best-effort sync for affected domains without user
// authorization checks. It is used by M07's post-commit notifier: the caller is
// the control plane itself, not an HTTP actor.
func (s *ConfigTriggerService) NotifyDomains(_ context.Context, domainIDs []string) {
	ids := normalizeDomainIDs(domainIDs)
	if len(ids) == 0 {
		return
	}
	s.enqueue(ids, false)
}

// NotifyAllDomains enqueues a sync for every enabled edge domain. Used after
// bulk/import/label-template changes that may affect all domains.
func (s *ConfigTriggerService) NotifyAllDomains(ctx context.Context) {
	ids, err := s.domains.EdgeDomainIDs(ctx)
	if err != nil {
		log.Printf("m09 config trigger: list domains: %v", err)
		return
	}
	s.enqueue(normalizeDomainIDs(ids), false)
}

// Run drains the debounced trigger queue until ctx is cancelled. It is started
// by Module.StartBackground alongside the watchers.
func (s *ConfigTriggerService) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.kick:
		}

		timer := time.NewTimer(s.debounce)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}

		s.drain(ctx)
	}
}

func (s *ConfigTriggerService) resolveScope(
	ctx context.Context,
	actor Actor,
	scope TriggerScope,
	rawIDs []string,
) ([]string, bool, error) {
	ids := normalizeDomainIDs(rawIDs)
	switch scope {
	case TriggerScopeDomain:
		if len(ids) == 0 {
			return nil, false, apierror.New(apierror.BadRequest,
				"network_domain_ids: at least one domain is required for scope=domain")
		}
		if len(ids) > maxTriggerDomains {
			return nil, false, apierror.Newf(apierror.BadRequest,
				"network_domain_ids: at most %d domains are allowed", maxTriggerDomains)
		}
		for _, id := range ids {
			item, err := s.onboarding.Get(ctx, actor, id)
			if err != nil {
				return nil, false, err
			}
			if item.AdminStatus != m09domain.MonitorableStatusEnabled {
				return nil, false, apierror.Newf(apierror.BadRequest,
					"network domain %q is disabled; enable it before syncing", id)
			}
		}
		return ids, false, nil

	case TriggerScopeCenter:
		if len(ids) > 0 {
			return nil, false, apierror.New(apierror.BadRequest,
				"network_domain_ids is only valid for scope=domain")
		}
		if !actor.IsPlatformAdmin {
			return nil, false, apierror.New(apierror.Forbidden,
				"center rules sync requires administrator role")
		}
		return nil, true, nil

	case TriggerScopeAll:
		if len(ids) > 0 {
			return nil, false, apierror.New(apierror.BadRequest,
				"network_domain_ids is only valid for scope=domain")
		}
		if !actor.IsPlatformAdmin {
			return nil, false, apierror.New(apierror.Forbidden,
				"all-domain config sync requires administrator role")
		}
		all, err := s.domains.EdgeDomainIDs(ctx)
		if err != nil {
			return nil, false, err
		}
		return normalizeDomainIDs(all), true, nil
	}
	return nil, false, apierror.Newf(apierror.BadRequest, "scope: unsupported value %q", scope)
}

func (s *ConfigTriggerService) enqueue(domainIDs []string, center bool) {
	if len(domainIDs) == 0 && !center {
		return
	}
	s.mu.Lock()
	for _, id := range domainIDs {
		s.pendingDomains[id] = struct{}{}
	}
	if center {
		s.pendingCenter = true
	}
	s.mu.Unlock()

	select {
	case s.kick <- struct{}{}:
	default:
	}
}

func (s *ConfigTriggerService) drain(ctx context.Context) {
	s.mu.Lock()
	domains := make([]string, 0, len(s.pendingDomains))
	for id := range s.pendingDomains {
		domains = append(domains, id)
	}
	center := s.pendingCenter
	s.pendingDomains = map[string]struct{}{}
	s.pendingCenter = false
	s.mu.Unlock()

	if len(domains) == 0 && !center {
		return
	}
	sort.Strings(domains)

	result := s.runNow(ctx, domains, center)
	for _, item := range result.Domains {
		if item.Error != "" {
			log.Printf("m09 config trigger: domain %s: %s", item.NetworkDomainID, item.Error)
		}
	}
	if result.Center != nil && result.Center.Error != "" {
		log.Printf("m09 config trigger: center: %s", result.Center.Error)
	}
}

func (s *ConfigTriggerService) runNow(
	ctx context.Context,
	domainIDs []string,
	includeCenter bool,
) *TriggerResult {
	result := &TriggerResult{Accepted: true, Completed: true}

	var centerResult *CenterTriggerResult
	var centerWG sync.WaitGroup
	if includeCenter {
		centerWG.Add(1)
		go func() {
			defer centerWG.Done()
			snapshot, err := s.center.Sync(ctx)
			centerResult = centerTriggerResult(snapshot, err)
		}()
	}

	if len(domainIDs) > 0 {
		results := make([]DomainTriggerResult, len(domainIDs))
		sem := make(chan struct{}, s.workers)
		var wg sync.WaitGroup
		for i, id := range domainIDs {
			wg.Add(1)
			go func(i int, id string) {
				defer wg.Done()
				select {
				case sem <- struct{}{}:
					defer func() { <-sem }()
				case <-ctx.Done():
					results[i] = DomainTriggerResult{NetworkDomainID: id, Error: ctx.Err().Error()}
					return
				}
				snapshot, err := s.domains.SyncDomain(ctx, id)
				results[i] = domainTriggerResult(id, snapshot, err)
			}(i, id)
		}
		wg.Wait()
		result.Domains = results
	}

	centerWG.Wait()
	result.Center = centerResult
	if ctx.Err() != nil {
		result.Completed = false
	}
	return result
}

func normalizeTriggerScope(raw TriggerScope) (TriggerScope, error) {
	switch TriggerScope(strings.ToLower(strings.TrimSpace(string(raw)))) {
	case TriggerScopeDomain, TriggerScopeCenter, TriggerScopeAll:
		return TriggerScope(strings.ToLower(strings.TrimSpace(string(raw)))), nil
	default:
		return "", apierror.Newf(apierror.BadRequest,
			"scope: invalid value %q: must be domain, center or all", raw)
	}
}

func normalizeDomainIDs(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, value := range raw {
		id := strings.TrimSpace(value)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func domainTriggerResult(id string, snapshot *repository.ConfigSnapshot, err error) DomainTriggerResult {
	result := DomainTriggerResult{NetworkDomainID: id}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if snapshot == nil {
		result.Error = "no snapshot returned"
		return result
	}
	result.Version = snapshot.Version
	result.ValidationStatus = snapshot.ValidationStatus
	result.ValidationCause = snapshot.ValidationCause
	result.ValidationDetails = snapshot.ValidationDetails
	return result
}

func centerTriggerResult(snapshot *repository.CenterConfigSnapshot, err error) *CenterTriggerResult {
	result := &CenterTriggerResult{}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if snapshot == nil {
		result.Error = "no snapshot returned"
		return result
	}
	result.Version = snapshot.Version
	result.ValidationStatus = snapshot.ValidationStatus
	result.ValidationCause = snapshot.ValidationCause
	result.ValidationDetails = snapshot.ValidationDetails
	return result
}
