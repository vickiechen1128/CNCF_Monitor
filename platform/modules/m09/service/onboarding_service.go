package service

import (
	"context"
	"fmt"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// Onboarding list views (contract §2.2, D34).
const (
	ViewOnboarding = "onboarding"
	ViewAdmin      = "admin"
)

// Actor is the authenticated caller's authorization scope. IsPlatformAdmin
// mirrors auth.RequireAdmin (Role == admin); non-admins are restricted to the
// network domains authorized for their tenant (D17).
type Actor struct {
	TenantID        string
	IsPlatformAdmin bool
}

// Endpoint carries the center addresses advertised to the edge agent on
// onboarding. Empty values leave whatever is already stored untouched.
type Endpoint struct {
	CenterEndpoint string
	RemoteWriteURL string
}

// InstallGuide is the standard edge-agent installation walkthrough (FR-03).
type InstallGuide struct {
	Steps              []string
	PackageDownloadURL string
}

// MonitorResult is the onboarding success payload; TokenPlain is returned
// exactly once (never persisted).
type MonitorResult struct {
	DomainID          string
	RegistrationState string
	TokenPlain        string
	TokenMasked       string
	CenterEndpoint    string
	RemoteWriteURL    string
	InstallGuide      InstallGuide
}

// ResetTokenResult carries the newly issued token; the old token is revoked.
type ResetTokenResult struct {
	TokenPlain  string
	TokenMasked string
	ResetAt     time.Time
}

// OnboardingService implements the M09 onboarding rules and the M06
// monitoring-retirement port.
type OnboardingService struct {
	repo    repository.OnboardingRepository
	tenants repository.TenantReader
	now     func() time.Time
}

// NewOnboardingService constructs the service.
func NewOnboardingService(repo repository.OnboardingRepository, tenants repository.TenantReader) *OnboardingService {
	return &OnboardingService{
		repo:    repo,
		tenants: tenants,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// List returns the onboarding view restricted to the caller's authorized
// domains. The default view is the monitorable scope (enabled edge domains);
// administrators may request ViewAdmin to see every edge/collection domain,
// including disabled ones (D34). A non-admin cannot widen the scope through
// the tenant_id/status/view filters.
func (s *OnboardingService) List(ctx context.Context, actor Actor, filter repository.ListFilter) ([]repository.DomainOnboarding, int64, error) {
	if filter.View == "" {
		if filter.Status != "" {
			filter.View = ViewAdmin
		} else {
			filter.View = ViewOnboarding
		}
	}
	switch filter.View {
	case ViewOnboarding:
		filter.Status = ""
	case ViewAdmin:
		if !actor.IsPlatformAdmin {
			return nil, 0, apierror.New(apierror.Forbidden, "admin network-domain view requires administrator role")
		}
		filter.View = repository.ListViewAdmin
	default:
		return nil, 0, apierror.Newf(apierror.BadRequest,
			"view: invalid value %q: must be onboarding or admin", filter.View)
	}
	allowed, err := s.resolveAllowed(ctx, actor)
	if err != nil {
		return nil, 0, err
	}
	filter.AllowedDomainIDs = allowed
	if !actor.IsPlatformAdmin {
		filter.TenantID = ""
	}
	return s.repo.List(ctx, filter)
}

// Get returns one onboarding row (404 when missing or unauthorized).
func (s *OnboardingService) Get(ctx context.Context, actor Actor, domainID string) (*repository.DomainOnboarding, error) {
	allowed, err := s.resolveAllowed(ctx, actor)
	if err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, domainID, allowed)
}

// Monitor onboards a domain: validates the M06 preconditions, issues and
// persists a token, and returns the plaintext once.
func (s *OnboardingService) Monitor(ctx context.Context, actor Actor, domainID string, ep Endpoint) (*MonitorResult, error) {
	item, err := s.Get(ctx, actor, domainID)
	if err != nil {
		return nil, err
	}
	if err := domain.ValidateMonitorable(item.DomainID, item.AdminStatus, item.AdminDomainType); err != nil {
		return nil, err
	}
	access, err := s.repo.FindAccess(ctx, domainID)
	if err != nil {
		return nil, err
	}
	if access == nil {
		access = &domain.Access{DomainID: domainID, RegistrationStatus: domain.RegistrationStatusCreated}
	}
	token, err := access.Monitor(s.now())
	if err != nil {
		return nil, err
	}
	if access.CenterEndpoint == "" {
		access.CenterEndpoint = ep.CenterEndpoint
	}
	if access.RemoteWriteURL == "" {
		access.RemoteWriteURL = ep.RemoteWriteURL
	}
	if err := s.repo.UpsertAccess(ctx, access); err != nil {
		return nil, err
	}
	return &MonitorResult{
		DomainID:          domainID,
		RegistrationState: string(access.RegistrationStatus),
		TokenPlain:        token.Plain,
		TokenMasked:       token.Masked,
		CenterEndpoint:    access.CenterEndpoint,
		RemoteWriteURL:    access.RemoteWriteURL,
		InstallGuide:      defaultInstallGuide(),
	}, nil
}

// ResetToken replaces the token of a monitored domain; the old token stops
// working immediately.
func (s *OnboardingService) ResetToken(ctx context.Context, actor Actor, domainID string) (*ResetTokenResult, error) {
	if _, err := s.Get(ctx, actor, domainID); err != nil {
		return nil, err
	}
	access, err := s.repo.FindAccess(ctx, domainID)
	if err != nil {
		return nil, err
	}
	if access == nil {
		return nil, &domain.ConflictError{Message: fmt.Sprintf(
			"network domain %q is not monitored; monitor it before resetting the token", domainID)}
	}
	now := s.now()
	token, err := access.ResetToken(now)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpsertAccess(ctx, access); err != nil {
		return nil, err
	}
	return &ResetTokenResult{TokenPlain: token.Plain, TokenMasked: token.Masked, ResetAt: now}, nil
}

// Unmonitor revokes the token and returns the domain to created (idempotent).
func (s *OnboardingService) Unmonitor(ctx context.Context, actor Actor, domainID string) error {
	if _, err := s.Get(ctx, actor, domainID); err != nil {
		return err
	}
	access, err := s.repo.FindAccess(ctx, domainID)
	if err != nil {
		return err
	}
	if access == nil {
		return nil
	}
	if err := access.Unmonitor(); err != nil {
		return err
	}
	return s.repo.UpsertAccess(ctx, access)
}

// Available reports true: the real retirement port is wired (D19).
func (s *OnboardingService) Available() bool { return true }

// Impact reports the edge-agent impact of deleting a domain (M06 impact view).
func (s *OnboardingService) Impact(ctx context.Context, domainID string) (references.MonitoringImpact, error) {
	total, online, err := s.repo.AgentImpact(ctx, domainID)
	if err != nil {
		return references.MonitoringImpact{}, err
	}
	return references.MonitoringImpact{ManagedEdgeAgentCount: total, HasOnlineAgents: online > 0}, nil
}

// RetireDomain cascades monitoring retirement when M06 deletes a domain:
// revoke the token, retire agents and drop snapshots. Idempotent.
func (s *OnboardingService) RetireDomain(ctx context.Context, domainID string) error {
	return s.repo.RetireDomainState(ctx, domainID)
}

func (s *OnboardingService) resolveAllowed(ctx context.Context, actor Actor) ([]string, error) {
	if actor.IsPlatformAdmin {
		return nil, nil
	}
	return s.tenants.AllowedDomainIDs(ctx, actor.TenantID)
}

func defaultInstallGuide() InstallGuide {
	return InstallGuide{
		Steps: []string{
			"下载离线安装包",
			"解压部署到 /opt/apps/edge-sync-agent",
			"配置 CENTER_ENDPOINT 与接入 Token",
			"启动 Agent 并验证心跳回连",
		},
		PackageDownloadURL: "/api/v3/platform/edge-packages/latest",
	}
}
