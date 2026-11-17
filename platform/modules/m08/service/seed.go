package service

import (
	"context"
	"fmt"
	"log"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// SeedOptions carries the defaults written on first boot (FR-01, FR-10).
type SeedOptions struct {
	KeepHistory int
}

// Seed guarantees a current configuration snapshot and the built-in templates.
// Seeding is idempotent and never fails boot: a failure is logged and retried on
// the next start.
func Seed(ctx context.Context, snapshots repository.SnapshotRepository, templates repository.TemplateRepository, rules repository.InhibitionRepository, config *ConfigService, opts SeedOptions) error {
	if _, err := snapshots.Current(ctx); err == nil {
		return nil
	} else if _, ok := err.(*domain.NotFoundError); !ok {
		return err
	}
	// Built-in templates first so the default configuration's receivers resolve.
	if err := seedBuiltinTemplates(ctx, templates); err != nil {
		log.Printf("[m08] seed builtin templates failed: %v", err)
	}
	if err := seedBuiltinInhibition(ctx, rules); err != nil {
		log.Printf("[m08] seed builtin inhibition failed: %v", err)
	}
	tree := []domain.RouteNode{{
		ID: "root", Name: "根路由", Receiver: "default", Enabled: true,
		GroupBy:     []string{"alertname", "network_domain_id"},
		GroupWait:   "30s", GroupInterval: "5m", RepeatInterval: "4h",
	}}
	outcome, err := config.saveInitial(ctx, tree)
	if err != nil {
		return err
	}
	log.Printf("[m08] seeded default alertmanager configuration version=%s", outcome.Version)
	return nil
}

// saveInitial persists the very first snapshot without requiring a reload
// target: on a fresh install Alertmanager may not be running yet.
func (s *ConfigService) saveInitial(ctx context.Context, tree []domain.RouteNode) (*SaveOutcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	channels, err := s.channels.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{"default": true}
	for _, channel := range channels {
		allowed[channel.ReceiverName()] = true
	}
	if issues := domain.ValidateRouteTree(tree, allowed); len(issues) > 0 {
		return nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	generated, err := generateDefault(s.bridgeBase, tree)
	if err != nil {
		return nil, err
	}
	snapshot := &domain.Snapshot{
		Version: generatedVersion(s.now(), domain.ReloadTriggerManual), Checksum: generated.Checksum,
		Content: generated.Content, RouteTree: tree, GeneratedBy: "system", GeneratedAt: s.now(),
	}
	if err := s.snapshots.CreateCurrent(ctx, snapshot, s.keepHistory); err != nil {
		return nil, err
	}
	return &SaveOutcome{Checksum: snapshot.Checksum, Version: snapshot.Version}, nil
}

// seedBuiltinInhibition writes the platform preset rule (FR-19): when a network
// domain goes offline, suppress its secondary alerts (those labelled
// inhibitable=true in the same domain).
func seedBuiltinInhibition(ctx context.Context, rules repository.InhibitionRepository) error {
	if rules == nil {
		return nil
	}
	existing, _, err := rules.List(ctx, repository.InhibitionFilter{Page: 1, PageSize: 100})
	if err != nil {
		return err
	}
	for _, rule := range existing {
		if rule.Builtin {
			return nil
		}
	}
	return rules.Create(ctx, &domain.InhibitionRule{
		Name: "网域离线时抑制域内次生告警", Builtin: true, Enabled: true,
		SourceMatchers: []domain.Matcher{{Name: "alertname", Value: "NetworkDomainDown"}},
		TargetMatchers: []domain.Matcher{{Name: "inhibitable", Value: "true"}},
		Equal:          []string{"network_domain_id"},
	})
}

// seedBuiltinTemplates writes one read-only template per IM channel type.
func seedBuiltinTemplates(ctx context.Context, templates repository.TemplateRepository) error {
	existing, err := templates.ListAll(ctx)
	if err != nil {
		return err
	}
	builtin := make(map[domain.ChannelType]bool, 3)
	for _, template := range existing {
		if template.Builtin {
			builtin[template.ChannelType] = true
		}
	}
	defaults := map[domain.ChannelType]string{
		domain.ChannelTypeFeishu:   "{{ define \"msg\" }}{{ .Status }}: {{ .CommonLabels.alertname }}{{ end }}",
		domain.ChannelTypeDingtalk: "{{ define \"msg\" }}{{ .Status }}: {{ .CommonLabels.alertname }}{{ end }}",
		domain.ChannelTypeWecom:    "{{ define \"msg\" }}{{ .Status }}: {{ .CommonLabels.alertname }}{{ end }}",
	}
	for channelType, content := range defaults {
		if builtin[channelType] {
			continue
		}
		template := &domain.Template{
			Name: fmt.Sprintf("%s 默认模板", channelType), ChannelType: channelType,
			Content: content, Builtin: true,
		}
		if err := templates.Create(ctx, template); err != nil {
			return err
		}
	}
	return nil
}
