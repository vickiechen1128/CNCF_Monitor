package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// ChannelFilter filters notification channel listings.
type ChannelFilter struct {
	Keyword     string
	ChannelType string
	Page        int
	PageSize    int
}

// ChannelRepository persists notification channels.
type ChannelRepository interface {
	Create(ctx context.Context, channel *domain.Channel) error
	Get(ctx context.Context, id string) (*domain.Channel, error)
	List(ctx context.Context, filter ChannelFilter) ([]*domain.Channel, int64, error)
	Update(ctx context.Context, channel *domain.Channel) error
	SoftDelete(ctx context.Context, id string) error
	CountByTemplate(ctx context.Context, templateID string) (int64, error)
	ListAll(ctx context.Context) ([]*domain.Channel, error)
}

// GORMChannelRepository is the GORM-backed implementation.
type GORMChannelRepository struct{ db *gorm.DB }

// NewChannelRepository constructs the repository.
func NewChannelRepository(db *gorm.DB) *GORMChannelRepository { return &GORMChannelRepository{db: db} }

// Create inserts a channel.
func (r *GORMChannelRepository) Create(ctx context.Context, channel *domain.Channel) error {
	if channel.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		channel.ID = id
	}
	rec := channelFromDomain(channel)
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return mapWriteError(err, "notify_channel", "name", channel.Name)
	}
	channel.CreatedAt = rec.CreatedAt.UTC().Format(time.RFC3339)
	channel.UpdatedAt = channel.CreatedAt
	return nil
}

// Get loads one channel.
func (r *GORMChannelRepository) Get(ctx context.Context, id string) (*domain.Channel, error) {
	var rec channelRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("notify channel", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of channels.
func (r *GORMChannelRepository) List(ctx context.Context, filter ChannelFilter) ([]*domain.Channel, int64, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&channelRecord{})
		if filter.ChannelType != "" {
			q = q.Where("channel_type = ?", filter.ChannelType)
		}
		return keywordLike(q, filter.Keyword, "name", "webhook_url")
	}
	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []channelRecord
	if err := paginate(build().Order("updated_at DESC, id ASC"), page, pageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Channel, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, total, nil
}

// Update replaces mutable channel fields.
func (r *GORMChannelRepository) Update(ctx context.Context, channel *domain.Channel) error {
	rec := channelFromDomain(channel)
	res := r.db.WithContext(ctx).Model(&channelRecord{}).
		Where("id = ?", channel.ID).
		Updates(map[string]any{
			"name": rec.Name, "channel_type": rec.ChannelType, "webhook_url": rec.WebhookURL,
			"secret": rec.Secret, "sign_enabled": rec.SignEnabled,
			"template_id": rec.TemplateID, "updated_at": time.Now().UTC(),
		})
	if res.Error != nil {
		return mapWriteError(res.Error, "notify_channel", "name", channel.Name)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, channel.ID); err != nil {
			return err
		}
	}
	return nil
}

// SoftDelete marks a channel as deleted.
func (r *GORMChannelRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&channelRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("notify channel", id)
	}
	return nil
}

// ListAll returns every live channel (used by the config generator).
func (r *GORMChannelRepository) ListAll(ctx context.Context) ([]*domain.Channel, error) {
	var recs []channelRecord
	if err := r.db.WithContext(ctx).Order("name ASC").Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Channel, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, nil
}

// CountByTemplate counts live channels bound to a template.
func (r *GORMChannelRepository) CountByTemplate(ctx context.Context, templateID string) (int64, error) {
	var total int64
	err := r.db.WithContext(ctx).Model(&channelRecord{}).
		Where("template_id = ?", templateID).Count(&total).Error
	return total, err
}
