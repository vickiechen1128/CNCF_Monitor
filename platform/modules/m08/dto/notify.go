package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// ChannelRequest is the create/update payload for a notification channel.
type ChannelRequest struct {
	Name        string  `json:"name"`
	ChannelType string  `json:"channel_type"`
	WebhookURL  string  `json:"webhook_url"`
	Secret      string  `json:"secret"`
	SignEnabled bool    `json:"sign_enabled"`
	TemplateID  *string `json:"template_id"`
}

// ToDomain converts the request into a domain channel.
func (r ChannelRequest) ToDomain() *domain.Channel {
	return &domain.Channel{
		Name: r.Name, Type: domain.ChannelType(r.ChannelType), WebhookURL: r.WebhookURL,
		Secret: r.Secret, SignEnabled: r.SignEnabled, TemplateID: r.TemplateID,
	}
}

// ChannelResponse is the channel projection. `secret` is never serialized:
// only `secret_set` is exposed (D45 / NFR-08).
type ChannelResponse struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	ChannelType        string  `json:"channel_type"`
	WebhookURL         string  `json:"webhook_url"`
	SignEnabled        bool    `json:"sign_enabled"`
	SecretSet          bool    `json:"secret_set"`
	TemplateID         *string `json:"template_id"`
	ReceiverName       string  `json:"receiver_name"`
	ReferencedByRoutes int     `json:"referenced_by_routes"`
}

// FromChannel projects a channel with its route reference count.
func FromChannel(channel *domain.Channel, referencedByRoutes int) ChannelResponse {
	return ChannelResponse{
		ID: channel.ID, Name: channel.Name, ChannelType: string(channel.Type),
		WebhookURL: MaskURL(channel.WebhookURL), SignEnabled: channel.SignEnabled,
		SecretSet: channel.Secret != "", TemplateID: channel.TemplateID,
		ReceiverName: channel.ReceiverName(), ReferencedByRoutes: referencedByRoutes,
	}
}

// TemplateRequest is the create/update payload for a notification template.
type TemplateRequest struct {
	Name        string `json:"name"`
	ChannelType string `json:"channel_type"`
	Content     string `json:"content"`
}

// ToDomain converts the request into a domain template.
func (r TemplateRequest) ToDomain() *domain.Template {
	return &domain.Template{
		Name: r.Name, ChannelType: domain.ChannelType(r.ChannelType), Content: r.Content,
	}
}

// TemplateResponse is the template projection.
type TemplateResponse struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	ChannelType   string    `json:"channel_type"`
	Content       string    `json:"content"`
	Builtin       bool      `json:"builtin"`
	BoundChannels int64     `json:"bound_channels"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// FromTemplate projects a template with its binding count.
func FromTemplate(t *domain.Template, boundChannels int64) TemplateResponse {
	return TemplateResponse{
		ID: t.ID, Name: t.Name, ChannelType: string(t.ChannelType), Content: t.Content,
		Builtin: t.Builtin, BoundChannels: boundChannels, CreatedAt: t.CreatedAt, UpdatedAt: t.UpdatedAt,
	}
}
