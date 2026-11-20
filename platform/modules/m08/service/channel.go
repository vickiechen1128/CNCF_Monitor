package service

import (
	"context"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// ChannelService manages notification channels (FR-09).
type ChannelService struct {
	channels     repository.ChannelRepository
	templates    repository.TemplateRepository
	snapshots    repository.SnapshotRepository
	allowPrivate bool
}

// NewChannelService constructs the service. allowPrivate relaxes the SSRF guard
// for explicitly whitelisted internal targets (NFR-07).
func NewChannelService(channels repository.ChannelRepository, templates repository.TemplateRepository, snapshots repository.SnapshotRepository, allowPrivate bool) *ChannelService {
	return &ChannelService{channels: channels, templates: templates, snapshots: snapshots, allowPrivate: allowPrivate}
}

// List returns a page of channels with their route reference counts.
func (s *ChannelService) List(ctx context.Context, filter repository.ChannelFilter) ([]*domain.Channel, int64, map[string]int, error) {
	channels, total, err := s.channels.List(ctx, filter)
	if err != nil {
		return nil, 0, nil, err
	}
	refs, err := s.RouteReferences(ctx)
	if err != nil {
		return nil, 0, nil, err
	}
	counts := make(map[string]int, len(channels))
	for _, channel := range channels {
		count, _ := refs[channel.ID]
		counts[channel.ID] = count
	}
	return channels, total, counts, nil
}

// Get loads one channel plus its route reference count.
func (s *ChannelService) Get(ctx context.Context, id string) (*domain.Channel, int, error) {
	channel, err := s.channels.Get(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	refs, err := s.RouteReferences(ctx)
	if err != nil {
		return nil, 0, err
	}
	return channel, refs[id], nil
}

// Create validates and stores a channel.
func (s *ChannelService) Create(ctx context.Context, channel *domain.Channel) (*domain.Channel, error) {
	if issues := domain.ValidateChannel(channel, s.allowPrivate); len(issues) > 0 {
		return nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	if err := s.resolveTemplate(ctx, channel); err != nil {
		return nil, err
	}
	if err := s.channels.Create(ctx, channel); err != nil {
		return nil, err
	}
	return channel, nil
}

// Update replaces mutable channel fields; an empty secret keeps the stored one
// (the list view never echoes secrets, so clients cannot resend them).
func (s *ChannelService) Update(ctx context.Context, id string, patch *domain.Channel) (*domain.Channel, error) {
	existing, err := s.channels.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	patch.ID = id
	// An empty secret means "unchanged" while signing stays enabled (the list
	// never echoes secrets). Turning signing off is an explicit intent to clear
	// the stored secret, so it is dropped even when the field is empty.
	if patch.Secret == "" && patch.SignEnabled {
		patch.Secret = existing.Secret
	}
	if !patch.SignEnabled && patch.Secret == "" {
		patch.Secret = ""
	}
	if patch.TemplateID == nil {
		patch.TemplateID = existing.TemplateID
	}
	if issues := domain.ValidateChannel(patch, s.allowPrivate); len(issues) > 0 {
		return nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	if err := s.resolveTemplate(ctx, patch); err != nil {
		return nil, err
	}
	if err := s.channels.Update(ctx, patch); err != nil {
		return nil, err
	}
	return patch, nil
}

// Delete refuses to remove a channel referenced by the current routing tree.
func (s *ChannelService) Delete(ctx context.Context, id string) error {
	refs, err := s.RouteReferences(ctx)
	if err != nil {
		return err
	}
	if count, ok := refs[id]; ok && count > 0 {
		return &domain.ConflictError{Message: fmt.Sprintf(
			"通知渠道仍被 %d 个路由节点引用，请先在「路由规则」页移除引用后再删除", count)}
	}
	return s.channels.SoftDelete(ctx, id)
}

// RouteReferences returns channel id → referencing route-node count for the
// current snapshot's tree.
func (s *ChannelService) RouteReferences(ctx context.Context) (map[string]int, error) {
	out := make(map[string]int)
	snapshot, err := s.snapshots.Current(ctx)
	if err != nil {
		if _, ok := err.(*domain.NotFoundError); ok {
			return out, nil
		}
		return nil, err
	}
	var walk func([]domain.RouteNode)
	walk = func(nodes []domain.RouteNode) {
		for _, node := range nodes {
			if node.Enabled && node.Receiver != "" {
				if id, ok := receiverChannelID(node.Receiver); ok {
					out[id]++
				}
			}
			walk(node.Children)
		}
	}
	walk(snapshot.RouteTree)
	return out, nil
}

// receiverChannelID extracts the channel id from `notify-<id>`.
func receiverChannelID(receiver string) (string, bool) {
	const prefix = "notify-"
	if len(receiver) <= len(prefix) || receiver[:len(prefix)] != prefix {
		return "", false
	}
	return receiver[len(prefix):], true
}

func (s *ChannelService) resolveTemplate(ctx context.Context, channel *domain.Channel) error {
	if channel.Type == domain.ChannelTypeWebhook || channel.TemplateID == nil || *channel.TemplateID == "" {
		channel.TemplateID = nil
		return nil
	}
	template, err := s.templates.Get(ctx, *channel.TemplateID)
	if err != nil {
		return err
	}
	if template.ChannelType != channel.Type {
		return &domain.ValidationError{
			Field:   "template_id",
			Message: fmt.Sprintf("模板类型 %q 与渠道类型 %q 不一致", template.ChannelType, channel.Type),
		}
	}
	return nil
}
