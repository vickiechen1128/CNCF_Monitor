package domain

// ChannelType is a notification channel type (FR-09).
type ChannelType string

// Channel types.
const (
	ChannelTypeFeishu   ChannelType = "feishu"
	ChannelTypeDingtalk ChannelType = "dingtalk"
	ChannelTypeWecom    ChannelType = "wecom"
	ChannelTypeWebhook  ChannelType = "webhook"
)

// ValidChannelTypes returns every accepted channel type.
func ValidChannelTypes() []string {
	return []string{
		string(ChannelTypeFeishu), string(ChannelTypeDingtalk),
		string(ChannelTypeWecom), string(ChannelTypeWebhook),
	}
}

// IsIM reports whether the type renders templates (everything but webhook).
func IsIM(t ChannelType) bool {
	return t == ChannelTypeFeishu || t == ChannelTypeDingtalk || t == ChannelTypeWecom
}

// IsValidChannelType validates a channel type.
func IsValidChannelType(t ChannelType) bool {
	switch t {
	case ChannelTypeFeishu, ChannelTypeDingtalk, ChannelTypeWecom, ChannelTypeWebhook:
		return true
	default:
		return false
	}
}

// EventStatus is one of the seven alert-event states (FR-23/24).
type EventStatus string

// Alert event states: three open states plus four terminal states.
const (
	EventStatusFiring          EventStatus = "firing"
	EventStatusSilenced        EventStatus = "silenced"
	EventStatusInhibited       EventStatus = "inhibited"
	EventStatusResolved        EventStatus = "resolved"
	EventStatusSilencedClosed  EventStatus = "silenced_closed"
	EventStatusInhibitedClosed EventStatus = "inhibited_closed"
	EventStatusResolvedUnknown EventStatus = "resolved_unknown"
)

// OpenEventStatuses lists the unresolved states.
func OpenEventStatuses() []string {
	return []string{
		string(EventStatusFiring), string(EventStatusSilenced), string(EventStatusInhibited),
	}
}

// IsOpenStatus reports whether the state is unresolved.
func IsOpenStatus(s EventStatus) bool {
	return s == EventStatusFiring || s == EventStatusSilenced || s == EventStatusInhibited
}

// IsValidEventStatus validates an event state.
func IsValidEventStatus(s EventStatus) bool {
	switch s {
	case EventStatusFiring, EventStatusSilenced, EventStatusInhibited,
		EventStatusResolved, EventStatusSilencedClosed, EventStatusInhibitedClosed,
		EventStatusResolvedUnknown:
		return true
	default:
		return false
	}
}

// ReloadTrigger identifies what caused a reload attempt.
type ReloadTrigger string

// Reload triggers (contract §4).
const (
	ReloadTriggerRouteSave      ReloadTrigger = "route_save"
	ReloadTriggerInhibitionSave ReloadTrigger = "inhibition_save"
	ReloadTriggerManual         ReloadTrigger = "manual"
	ReloadTriggerM09Sync        ReloadTrigger = "m09_sync"
)

// IsValidReloadTrigger validates a trigger.
func IsValidReloadTrigger(t ReloadTrigger) bool {
	switch t {
	case ReloadTriggerRouteSave, ReloadTriggerInhibitionSave,
		ReloadTriggerManual, ReloadTriggerM09Sync:
		return true
	default:
		return false
	}
}

// ReloadStatus is the outcome of a reload attempt.
type ReloadStatus string

// Reload statuses.
const (
	ReloadStatusSucceeded  ReloadStatus = "succeeded"
	ReloadStatusFailed     ReloadStatus = "failed"
	ReloadStatusRolledBack ReloadStatus = "rolled_back"
)

// PendingSection names a config section that a save did not cover (FR-20).
type PendingSection string

// Pending sections reported by a save response.
const (
	PendingRouteChanged         PendingSection = "route_changed"
	PendingInhibitRulesChanged  PendingSection = "inhibit_rules_changed"
)

// AuditAction is a silence operation kind (D50).
type AuditAction string

// Silence audit actions.
const (
	AuditActionCreate AuditAction = "create"
	AuditActionDelete AuditAction = "delete"
)

// AuditResult records whether the audited operation was accepted.
type AuditResult string

// Silence audit results.
const (
	AuditResultSuccess  AuditResult = "success"
	AuditResultRejected AuditResult = "rejected"
)
