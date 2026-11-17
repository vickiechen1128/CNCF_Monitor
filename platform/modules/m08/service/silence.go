package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/references"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// SilenceClient is the Alertmanager silence surface M08 depends on.
type SilenceClient interface {
	ListSilences(ctx context.Context) ([]domain.Silence, error)
	CreateSilence(ctx context.Context, silence domain.Silence) (string, error)
	DeleteSilence(ctx context.Context, id string) error
}

// SilenceInput is the parsed create payload (FR-16).
type SilenceInput struct {
	Matchers  []domain.Matcher
	StartsAt  time.Time
	EndsAt    time.Time
	CreatedBy string
	Comment   string
}

// LabelOption is one matcher autocomplete entry.
type LabelOption struct {
	Name   string
	Values []string
}

// SilenceService proxies Alertmanager silences, enforces network-domain scope
// and writes the audit trail (FR-16/17, D50).
type SilenceService struct {
	client SilenceClient
	authz  references.DomainAuthorizer
	audits repository.AuditRepository
	events repository.EventRepository
	now    func() time.Time
}

// NewSilenceService constructs the service.
func NewSilenceService(client SilenceClient, authz references.DomainAuthorizer, audits repository.AuditRepository, events repository.EventRepository) *SilenceService {
	return &SilenceService{client: client, authz: authz, audits: audits, events: events,
		now: func() time.Time { return time.Now().UTC() }}
}

// List returns silences visible to the caller.
func (s *SilenceService) List(ctx context.Context, actor domain.Actor) ([]domain.Silence, error) {
	silences, err := s.client.ListSilences(ctx)
	if err != nil {
		return nil, err
	}
	allowed, err := s.authorizedSet(ctx, actor)
	if err != nil {
		return nil, err
	}
	if allowed == nil {
		return silences, nil
	}
	out := make([]domain.Silence, 0, len(silences))
	for _, silence := range silences {
		if silenceInScope(silence, allowed) {
			out = append(out, silence)
		}
	}
	return out, nil
}

// Create validates scope, creates the silence and audits the attempt.
func (s *SilenceService) Create(ctx context.Context, actor domain.Actor, input SilenceInput) (domain.Silence, error) {
	silence := domain.Silence{
		Matchers: input.Matchers, StartsAt: input.StartsAt, EndsAt: input.EndsAt,
		CreatedBy: input.CreatedBy, Comment: input.Comment,
	}
	if silence.CreatedBy == "" {
		silence.CreatedBy = actor.Username
	}
	allowed, err := s.authorizedSet(ctx, actor)
	if err != nil {
		return domain.Silence{}, err
	}
	if !silenceInScope(silence, allowed) {
		reason := "matcher 中的 network_domain_id 不在当前用户授权网域集合内"
		s.audit(ctx, actor, domain.AuditActionCreate, domain.AuditResultRejected, "", silence.Matchers, silence.Comment, reason)
		return domain.Silence{}, &domain.ForbiddenError{Message: "静默范围越权：" + reason}
	}
	id, err := s.client.CreateSilence(ctx, silence)
	if err != nil {
		s.audit(ctx, actor, domain.AuditActionCreate, domain.AuditResultRejected, "", silence.Matchers, silence.Comment, err.Error())
		return domain.Silence{}, err
	}
	silence.ID = id
	silence.Status = "active"
	s.audit(ctx, actor, domain.AuditActionCreate, domain.AuditResultSuccess, id, silence.Matchers, silence.Comment, "")
	return silence, nil
}

// Delete removes a silence, refusing out-of-scope targets and auditing both
// outcomes.
func (s *SilenceService) Delete(ctx context.Context, actor domain.Actor, id string) error {
	matchers, found, err := s.findMatchers(ctx, id)
	if err != nil {
		return err
	}
	allowed, err := s.authorizedSet(ctx, actor)
	if err != nil {
		return err
	}
	if found && !silenceInScope(domain.Silence{Matchers: matchers}, allowed) {
		reason := "静默 matcher 中的 network_domain_id 不在当前用户授权网域集合内"
		s.audit(ctx, actor, domain.AuditActionDelete, domain.AuditResultRejected, id, matchers, "", reason)
		return &domain.ForbiddenError{Message: "静默范围越权：" + reason}
	}
	if err := s.client.DeleteSilence(ctx, id); err != nil {
		s.audit(ctx, actor, domain.AuditActionDelete, domain.AuditResultRejected, id, matchers, "", err.Error())
		return err
	}
	s.audit(ctx, actor, domain.AuditActionDelete, domain.AuditResultSuccess, id, matchers, "", "")
	return nil
}

// Audits returns the read-only audit trail (D50).
func (s *SilenceService) Audits(ctx context.Context, filter repository.AuditFilter) ([]*repository.AuditEntry, int64, error) {
	return s.audits.List(ctx, filter)
}

// LabelOptions builds matcher autocomplete from stored event labels.
func (s *SilenceService) LabelOptions(ctx context.Context) ([]LabelOption, error) {
	columns := []string{"network_domain", "alert_name", "severity"}
	out := make([]LabelOption, 0, len(columns))
	for _, column := range columns {
		values, err := s.events.DistinctValues(ctx, column)
		if err != nil {
			return nil, err
		}
		out = append(out, LabelOption{Name: column, Values: values})
	}
	return out, nil
}

func (s *SilenceService) findMatchers(ctx context.Context, id string) ([]domain.Matcher, bool, error) {
	silences, err := s.client.ListSilences(ctx)
	if err != nil {
		return nil, false, err
	}
	for _, silence := range silences {
		if silence.ID == id {
			return silence.Matchers, true, nil
		}
	}
	return nil, false, nil
}

// authorizedSet returns nil for platform admins (all domains allowed).
func (s *SilenceService) authorizedSet(ctx context.Context, actor domain.Actor) (map[string]bool, error) {
	if s.authz == nil {
		return nil, nil
	}
	domains, err := s.authz.AuthorizedDomains(ctx, actor)
	if err != nil {
		return nil, err
	}
	set := make(map[string]bool, len(domains))
	for _, domainID := range domains {
		set[domainID] = true
	}
	return set, nil
}

func silenceInScope(silence domain.Silence, allowed map[string]bool) bool {
	if allowed == nil {
		return true
	}
	for _, matcher := range silence.Matchers {
		if matcher.Name != "network_domain_id" || matcher.IsRegex {
			continue
		}
		if !allowed[strings.TrimSpace(matcher.Value)] {
			return false
		}
	}
	return true
}

func (s *SilenceService) audit(ctx context.Context, actor domain.Actor, action domain.AuditAction, result domain.AuditResult, silenceID string, matchers []domain.Matcher, reason, failure string) {
	if s.audits == nil {
		return
	}
	entry := &repository.AuditEntry{
		Action: action, Result: result, Operator: actor.Username, SilenceID: silenceID,
		Matchers: matchers, Reason: reason, FailureReason: failure, At: s.now(),
	}
	if err := s.audits.Insert(ctx, entry); err != nil {
		// Auditing must not block the operation; the failure is surfaced in logs
		// by the handler layer's own logging.
		_ = fmt.Sprintf("audit insert failed: %v", err)
	}
}
