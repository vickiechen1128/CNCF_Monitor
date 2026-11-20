package repository

import (
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// channelRecord is the m08_notify_channels row.
type channelRecord struct {
	ID          string         `gorm:"column:id;primaryKey"`
	Name        string         `gorm:"column:name;not null"`
	ChannelType string         `gorm:"column:channel_type;not null"`
	WebhookURL  string         `gorm:"column:webhook_url;not null"`
	Secret      string         `gorm:"column:secret;not null;default:''"`
	SignEnabled bool           `gorm:"column:sign_enabled;not null;default:false"`
	TemplateID  *string        `gorm:"column:template_id"`
	CreatedAt   time.Time      `gorm:"column:created_at"`
	UpdatedAt   time.Time      `gorm:"column:updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at"`
}

// TableName pins the v3 table name.
func (channelRecord) TableName() string { return "m08_notify_channels" }

func channelFromDomain(c *domain.Channel) *channelRecord {
	return &channelRecord{
		ID: c.ID, Name: c.Name, ChannelType: string(c.Type), WebhookURL: c.WebhookURL,
		Secret: c.Secret, SignEnabled: c.SignEnabled, TemplateID: c.TemplateID,
	}
}

func (r *channelRecord) toDomain() *domain.Channel {
	return &domain.Channel{
		ID: r.ID, Name: r.Name, Type: domain.ChannelType(r.ChannelType),
		WebhookURL: r.WebhookURL, Secret: r.Secret, SignEnabled: r.SignEnabled,
		TemplateID: r.TemplateID, CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: r.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// templateRecord is the m08_notify_templates row.
type templateRecord struct {
	ID          string         `gorm:"column:id;primaryKey"`
	Name        string         `gorm:"column:name;not null"`
	ChannelType string         `gorm:"column:channel_type;not null"`
	Content     string         `gorm:"column:content;not null"`
	Builtin     bool           `gorm:"column:builtin;not null;default:false"`
	CreatedAt   time.Time      `gorm:"column:created_at"`
	UpdatedAt   time.Time      `gorm:"column:updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at"`
}

// TableName pins the v3 table name.
func (templateRecord) TableName() string { return "m08_notify_templates" }

func templateFromDomain(t *domain.Template) *templateRecord {
	return &templateRecord{
		ID: t.ID, Name: t.Name, ChannelType: string(t.ChannelType),
		Content: t.Content, Builtin: t.Builtin,
	}
}

func (r *templateRecord) toDomain() *domain.Template {
	return &domain.Template{
		ID: r.ID, Name: r.Name, ChannelType: domain.ChannelType(r.ChannelType),
		Content: r.Content, Builtin: r.Builtin, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

// Alertmanager snapshots live in the 'alertmanager' scope of the unified
// config_snapshots table (0016).
const (
	alertmanagerSnapshotScope    = "alertmanager"
	alertmanagerSnapshotScopeKey = "alertmanager"
)

// snapshotRecord is the alertmanager-scoped row of config_snapshots.
type snapshotRecord struct {
	ID          int64              `gorm:"column:id;primaryKey"`
	Scope       string             `gorm:"column:scope"`
	ScopeKey    string             `gorm:"column:scope_key"`
	Version     string             `gorm:"column:version;not null"`
	Checksum    string             `gorm:"column:checksum;not null"`
	Content     string             `gorm:"column:content;not null"`
	RouteTree   []domain.RouteNode `gorm:"column:route_tree;serializer:json;not null"`
	IsCurrent   bool               `gorm:"column:is_current;not null;default:false"`
	GeneratedBy string             `gorm:"column:generated_by;not null;default:''"`
	GeneratedAt time.Time          `gorm:"column:generated_at"`
	CreatedAt   time.Time          `gorm:"column:created_at"`
}

// TableName pins the unified v3 table name.
func (snapshotRecord) TableName() string { return "config_snapshots" }

// reloadLogRecord is the m08_reload_logs row.
type reloadLogRecord struct {
	ID            int64      `gorm:"column:id;primaryKey"`
	SnapshotID    *int64     `gorm:"column:snapshot_id"`
	ConfigVersion string     `gorm:"column:config_version;not null;default:''"`
	Checksum      string     `gorm:"column:checksum;not null;default:''"`
	Trigger       string     `gorm:"column:trigger;not null"`
	Status        string     `gorm:"column:status;not null"`
	Operator      string     `gorm:"column:operator;not null;default:''"`
	Error         string     `gorm:"column:error;not null;default:''"`
	DurationMS    int64      `gorm:"column:duration_ms;not null;default:0"`
	StartedAt     time.Time  `gorm:"column:started_at"`
	FinishedAt    *time.Time `gorm:"column:finished_at"`
	CreatedAt     time.Time  `gorm:"column:created_at"`
}

// TableName pins the v3 table name.
func (reloadLogRecord) TableName() string { return "m08_reload_logs" }

// eventRecord is the m08_alert_events row.
type eventRecord struct {
	ID               int64             `gorm:"column:id;primaryKey"`
	OccurrenceKey    string            `gorm:"column:occurrence_key;not null"`
	Fingerprint      string            `gorm:"column:fingerprint;not null;default:''"`
	AlertName        string            `gorm:"column:alert_name;not null"`
	Status           string            `gorm:"column:status;not null"`
	Severity         string            `gorm:"column:severity;not null;default:''"`
	Summary          string            `gorm:"column:summary;not null;default:''"`
	Description      string            `gorm:"column:description;not null;default:''"`
	NetworkDomain    string            `gorm:"column:network_domain;not null;default:''"`
	ResourceID       string            `gorm:"column:resource_id;not null;default:''"`
	ResourceCategory string            `gorm:"column:resource_category;not null;default:''"`
	Instance         string            `gorm:"column:instance;not null;default:''"`
	Labels           map[string]string `gorm:"column:labels;serializer:json;not null"`
	Annotations      map[string]string `gorm:"column:annotations;serializer:json;not null"`
	StartsAt         time.Time         `gorm:"column:starts_at"`
	EndsAt           *time.Time        `gorm:"column:ends_at"`
	ClosedAt         *time.Time        `gorm:"column:closed_at"`
	CreatedAt        time.Time         `gorm:"column:created_at"`
	UpdatedAt        time.Time         `gorm:"column:updated_at"`
}

// TableName pins the v3 table name.
func (eventRecord) TableName() string { return "m08_alert_events" }

func eventFromDomain(e *domain.Event) *eventRecord {
	return &eventRecord{
		ID: e.ID, OccurrenceKey: e.OccurrenceKey, Fingerprint: e.Fingerprint,
		AlertName: e.AlertName, Status: string(e.Status), Severity: e.Severity,
		Summary: e.Summary, Description: e.Description, NetworkDomain: e.NetworkDomain,
		ResourceID: e.ResourceID, ResourceCategory: e.ResourceCategory, Instance: e.Instance,
		Labels: e.Labels, Annotations: e.Annotations, StartsAt: e.StartsAt,
		EndsAt: e.EndsAt, ClosedAt: e.ClosedAt, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt,
	}
}

func (r *eventRecord) toDomain() *domain.Event {
	return &domain.Event{
		ID: r.ID, OccurrenceKey: r.OccurrenceKey, Fingerprint: r.Fingerprint,
		AlertName: r.AlertName, Status: domain.EventStatus(r.Status), Severity: r.Severity,
		Summary: r.Summary, Description: r.Description, NetworkDomain: r.NetworkDomain,
		ResourceID: r.ResourceID, ResourceCategory: r.ResourceCategory, Instance: r.Instance,
		Labels: r.Labels, Annotations: r.Annotations, StartsAt: r.StartsAt,
		EndsAt: r.EndsAt, ClosedAt: r.ClosedAt, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}

// inhibitionRecord is the m08_inhibition_rules row.
type inhibitionRecord struct {
	ID             string           `gorm:"column:id;primaryKey"`
	Name           string           `gorm:"column:name;not null"`
	SourceMatchers []domain.Matcher `gorm:"column:source_matchers;serializer:json;not null"`
	TargetMatchers []domain.Matcher `gorm:"column:target_matchers;serializer:json;not null"`
	Equal          []string         `gorm:"column:equal;serializer:json;not null"`
	Enabled        bool             `gorm:"column:enabled;not null;default:true"`
	Builtin        bool             `gorm:"column:builtin;not null;default:false"`
	CreatedAt      time.Time        `gorm:"column:created_at"`
	UpdatedAt      time.Time        `gorm:"column:updated_at"`
	DeletedAt      gorm.DeletedAt   `gorm:"column:deleted_at"`
}

// TableName pins the v3 table name.
func (inhibitionRecord) TableName() string { return "m08_inhibition_rules" }

func inhibitionFromDomain(r *domain.InhibitionRule) *inhibitionRecord {
	return &inhibitionRecord{
		ID: r.ID, Name: r.Name, SourceMatchers: r.SourceMatchers,
		TargetMatchers: r.TargetMatchers, Equal: r.Equal, Enabled: r.Enabled, Builtin: r.Builtin,
	}
}

func (r *inhibitionRecord) toDomain() *domain.InhibitionRule {
	return &domain.InhibitionRule{
		ID: r.ID, Name: r.Name, SourceMatchers: r.SourceMatchers,
		TargetMatchers: r.TargetMatchers, Equal: r.Equal, Enabled: r.Enabled, Builtin: r.Builtin,
	}
}

// auditRecord is the m08_silence_audits row.
type auditRecord struct {
	ID            int64            `gorm:"column:id;primaryKey"`
	Action        string           `gorm:"column:action;not null"`
	Result        string           `gorm:"column:result;not null"`
	Operator      string           `gorm:"column:operator;not null;default:''"`
	SilenceID     string           `gorm:"column:silence_id;not null;default:''"`
	Matchers      []domain.Matcher `gorm:"column:matchers;serializer:json;not null"`
	Reason        string           `gorm:"column:reason;not null;default:''"`
	FailureReason string           `gorm:"column:failure_reason;not null;default:''"`
	At            time.Time        `gorm:"column:at"`
}

// TableName pins the v3 table name.
func (auditRecord) TableName() string { return "m08_silence_audits" }
