package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
)

// edgeAgentRecord maps edge_agents (v3 schema from 00005).
type edgeAgentRecord struct {
	ID                         int64      `gorm:"column:id;primaryKey"`
	NetworkDomainID            string     `gorm:"column:network_domain_id"`
	Hostname                   string     `gorm:"column:hostname"`
	AgentType                  string     `gorm:"column:agent_type"`
	Version                    string     `gorm:"column:version"`
	IP                         string     `gorm:"column:ip"`
	Status                     string     `gorm:"column:status"`
	LastHeartbeatAt            *time.Time `gorm:"column:last_heartbeat_at"`
	HeartbeatRTTMs             int64      `gorm:"column:heartbeat_rtt_ms"`
	LastConfigPullAt           *time.Time `gorm:"column:last_config_pull_at"`
	ConfigVersion              string     `gorm:"column:config_version"`
	ConfigSyncStatus           string     `gorm:"column:config_sync_status"`
	OutOfSyncCause             string     `gorm:"column:out_of_sync_cause"`
	ConfigApplyError           string     `gorm:"column:config_apply_error"`
	ConfigApplyFailedVersion   string     `gorm:"column:config_apply_failed_version"`
	CollectorStatus            string     `gorm:"column:collector_status"`
	CollectorVersion           string     `gorm:"column:collector_version"`
	QueueBacklogBytes          int64      `gorm:"column:queue_backlog_bytes"`
	RemoteWriteDroppedTotal    int64      `gorm:"column:remote_write_dropped_total"`
	RemoteWriteRetriesTotal    int64      `gorm:"column:remote_write_retries_total"`
	RemoteWriteLastError       string     `gorm:"column:remote_write_last_error"`
	MetadataRemoteWriteURL     string     `gorm:"column:metadata_remote_write_url"`
	MetadataMaxDiskUsagePerURL string     `gorm:"column:metadata_max_disk_usage_per_url"`
	VMAgentRestartSeq          int64      `gorm:"column:vm_agent_restart_seq"`
	RestartRequestedBy         string     `gorm:"column:restart_requested_by"`
	RestartRequestedAt         *time.Time `gorm:"column:restart_requested_at"`
	FlushBacklogSeq            int64      `gorm:"column:flush_backlog_seq"`
	FlushRequestedBy           string     `gorm:"column:flush_requested_by"`
	FlushRequestedAt           *time.Time `gorm:"column:flush_requested_at"`
	Components                 string     `gorm:"column:components"`
	LastError                  string     `gorm:"column:last_error"`
	CreatedAt                  time.Time  `gorm:"column:created_at"`
	UpdatedAt                  time.Time  `gorm:"column:updated_at"`
	DeletedAt                  *time.Time `gorm:"column:deleted_at"`
}

// TableName returns the edge-agent table.
func (edgeAgentRecord) TableName() string { return "edge_agents" }

// heartbeatRecord maps edge_heartbeats (append-only history).
type heartbeatRecord struct {
	ID                      int64     `gorm:"column:id;primaryKey"`
	NetworkDomainID         string    `gorm:"column:network_domain_id"`
	EdgeAgentID             int64     `gorm:"column:edge_agent_id"`
	AgentType               string    `gorm:"column:agent_type"`
	Version                 string    `gorm:"column:version"`
	ConfigVersion           string    `gorm:"column:config_version"`
	QueueBacklogBytes       int64     `gorm:"column:queue_backlog_bytes"`
	RemoteWriteQueueSize    int64     `gorm:"column:remote_write_queue_size"`
	RemoteWriteDroppedTotal int64     `gorm:"column:remote_write_dropped_total"`
	RemoteWriteRetriesTotal int64     `gorm:"column:remote_write_retries_total"`
	RemoteWriteLastError    string    `gorm:"column:remote_write_last_error"`
	Hostname                string    `gorm:"column:hostname"`
	IP                      string    `gorm:"column:ip"`
	Components              string    `gorm:"column:components"`
	Timestamp               time.Time `gorm:"column:timestamp"`
	CreatedAt               time.Time `gorm:"column:created_at"`
}

// TableName returns the heartbeat history table.
func (heartbeatRecord) TableName() string { return "edge_heartbeats" }

// targetSnapshotRecord maps edge_target_snapshots (latest per domain/job/instance).
type targetSnapshotRecord struct {
	ID                    int64      `gorm:"column:id;primaryKey"`
	NetworkDomainID       string     `gorm:"column:network_domain_id"`
	EdgeAgentID           int64      `gorm:"column:edge_agent_id"`
	Job                   string     `gorm:"column:job"`
	Instance              string     `gorm:"column:instance"`
	ResourceID            string     `gorm:"column:resource_id"`
	Health                string     `gorm:"column:health"`
	LastScrape            *time.Time `gorm:"column:last_scrape"`
	LastError             string     `gorm:"column:last_error"`
	ScrapeDurationSeconds float64    `gorm:"column:scrape_duration_seconds"`
	LastReportAt          time.Time  `gorm:"column:last_report_at"`
	CreatedAt             time.Time  `gorm:"column:created_at"`
	UpdatedAt             time.Time  `gorm:"column:updated_at"`
}

// TableName returns the target snapshot table.
func (targetSnapshotRecord) TableName() string { return "edge_target_snapshots" }

// AgentHeartbeatInput is the normalized heartbeat state to persist.
type AgentHeartbeatInput struct {
	NetworkDomainID string
	Hostname        string
	IP              string
	AgentType       string
	Version         string
	ConfigVersion   string

	ConfigSyncStatus         string
	OutOfSyncCause           string
	ConfigApplyError         string
	ConfigApplyFailedVersion string

	QueueBacklogBytes       int64
	RemoteWriteQueueSize    int64
	RemoteWriteDroppedTotal int64
	RemoteWriteRetriesTotal int64
	RemoteWriteLastError    string

	MetadataRemoteWriteURL     string
	MetadataMaxDiskUsagePerURL string

	Components []domain.Component
	Now        time.Time
}

// AgentRuntime is the mutable command state returned after a heartbeat upsert.
type AgentRuntime struct {
	ID         int64
	RestartSeq int64
	FlushSeq   int64
}

// HeartbeatRecord is one append-only heartbeat history row.
type HeartbeatRecord struct {
	NetworkDomainID         string
	EdgeAgentID             int64
	AgentType               string
	Version                 string
	ConfigVersion           string
	QueueBacklogBytes       int64
	RemoteWriteQueueSize    int64
	RemoteWriteDroppedTotal int64
	RemoteWriteRetriesTotal int64
	RemoteWriteLastError    string
	Hostname                string
	IP                      string
	Components              []domain.Component
	Timestamp               time.Time
}

// EdgeAgentFilter carries edge-agent list filters (contract §3.2).
type EdgeAgentFilter struct {
	NetworkDomainID string
	Status          string
	Keyword         string
	Page            int
	PageSize        int
}

// EdgeAgentView is the service-facing edge-agent read model.
type EdgeAgentView struct {
	ID                         int64
	NetworkDomainID            string
	Hostname                   string
	IP                         string
	AgentType                  string
	Version                    string
	Status                     string
	LastHeartbeatAt            *time.Time
	HeartbeatRTTMs             int64
	ConfigVersion              string
	ConfigSyncStatus           string
	OutOfSyncCause             string
	ConfigApplyError           string
	CollectorStatus            string
	CollectorVersion           string
	Components                 []domain.Component
	QueueBacklogBytes          int64
	RemoteWriteDroppedTotal    int64
	RemoteWriteRetriesTotal    int64
	RemoteWriteLastError       string
	MetadataRemoteWriteURL     string
	MetadataMaxDiskUsagePerURL string
	VMAgentRestartSeq          int64
	RestartRequestedBy         string
	RestartRequestedAt         *time.Time
	FlushBacklogSeq            int64
	FlushRequestedBy           string
	FlushRequestedAt           *time.Time
	LastError                  string
	CreatedAt                  time.Time
	UpdatedAt                  time.Time
}

// EdgeRepository persists the edge protocol state.
type EdgeRepository interface {
	FindAccess(ctx context.Context, domainID string) (*domain.Access, error)
	FindMonitoredDomainByTokenHash(ctx context.Context, hash string) (string, error)
	CurrentConfigMeta(ctx context.Context, domainID string) (version, checksum string, err error)
	UpsertAgentHeartbeat(ctx context.Context, in AgentHeartbeatInput) (AgentRuntime, error)
	InsertHeartbeat(ctx context.Context, rec HeartbeatRecord) error
	ReplaceTargetSnapshots(ctx context.Context, domainID string, agentID int64, targets []domain.TargetSnapshot, reportedAt time.Time) error
	TouchAccessHeartbeat(ctx context.Context, domainID string, at time.Time) error

	ListAgents(ctx context.Context, filter EdgeAgentFilter, allowed []string) ([]EdgeAgentView, int64, error)
	GetAgent(ctx context.Context, id int64, allowed []string) (*EdgeAgentView, error)
	IncrementRestartSeq(ctx context.Context, id int64, requestedBy string, at time.Time) error
	IncrementFlushSeq(ctx context.Context, id int64, requestedBy string, at time.Time) error
	MarkAgentsOffline(ctx context.Context, cutoff, now time.Time) (int64, error)
	DeleteHeartbeatsBefore(ctx context.Context, cutoff time.Time) (int64, error)
}

// FindMonitoredDomainByTokenHash resolves a token hash to its monitored domain.
// Returns "" when no monitored domain matches (invalid/expired token).
func (r *GORMRepository) FindMonitoredDomainByTokenHash(ctx context.Context, hash string) (string, error) {
	if strings.TrimSpace(hash) == "" {
		return "", nil
	}
	var row struct {
		DomainID string `gorm:"column:domain_id"`
	}
	err := r.db.WithContext(ctx).Table("network_domain_access").
		Select("domain_id").
		Where("token_hash = ? AND registration_status = ?", hash, string(domain.RegistrationStatusMonitored)).
		Limit(1).Scan(&row).Error
	if err != nil {
		return "", fmt.Errorf("resolve edge token: %w", err)
	}
	return row.DomainID, nil
}

// CurrentConfigMeta returns the current passed snapshot version and checksum
// (empty when the domain has no published config yet).
func (r *GORMRepository) CurrentConfigMeta(ctx context.Context, domainID string) (string, string, error) {
	var row struct {
		Version  string `gorm:"column:version"`
		Checksum string `gorm:"column:checksum"`
	}
	err := r.db.WithContext(ctx).Table("domain_config_snapshots").
		Select("version, checksum").
		Where("network_domain_id = ? AND is_current = ? AND validation_status = ?", domainID, true, "passed").
		Limit(1).Scan(&row).Error
	if err != nil {
		return "", "", fmt.Errorf("load current config snapshot for %q: %w", domainID, err)
	}
	return row.Version, row.Checksum, nil
}

// UpsertAgentHeartbeat registers or updates the agent identified by
// (network_domain_id, hostname) and marks it online.
func (r *GORMRepository) UpsertAgentHeartbeat(ctx context.Context, in AgentHeartbeatInput) (AgentRuntime, error) {
	componentsJSON, err := marshalComponents(in.Components)
	if err != nil {
		return AgentRuntime{}, err
	}
	collectorStatus, collectorVersion := collectorComponent(in.Components)

	var row edgeAgentRecord
	err = r.db.WithContext(ctx).
		Where("network_domain_id = ? AND hostname = ? AND deleted_at IS NULL", in.NetworkDomainID, in.Hostname).
		First(&row).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		row = edgeAgentRecord{
			NetworkDomainID:            in.NetworkDomainID,
			Hostname:                   in.Hostname,
			AgentType:                  in.AgentType,
			Version:                    in.Version,
			IP:                         in.IP,
			Status:                     domain.EdgeAgentStatusOnline,
			LastHeartbeatAt:            &in.Now,
			ConfigVersion:              in.ConfigVersion,
			ConfigSyncStatus:           in.ConfigSyncStatus,
			OutOfSyncCause:             in.OutOfSyncCause,
			ConfigApplyError:           in.ConfigApplyError,
			ConfigApplyFailedVersion:   in.ConfigApplyFailedVersion,
			CollectorStatus:            collectorStatus,
			CollectorVersion:           collectorVersion,
			QueueBacklogBytes:          in.QueueBacklogBytes,
			RemoteWriteDroppedTotal:    in.RemoteWriteDroppedTotal,
			RemoteWriteRetriesTotal:    in.RemoteWriteRetriesTotal,
			RemoteWriteLastError:       in.RemoteWriteLastError,
			MetadataRemoteWriteURL:     in.MetadataRemoteWriteURL,
			MetadataMaxDiskUsagePerURL: in.MetadataMaxDiskUsagePerURL,
			Components:                 componentsJSON,
			CreatedAt:                  in.Now,
			UpdatedAt:                  in.Now,
		}
		if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
			return AgentRuntime{}, fmt.Errorf("register edge agent %q: %w", in.Hostname, err)
		}
	case err != nil:
		return AgentRuntime{}, fmt.Errorf("load edge agent %q: %w", in.Hostname, err)
	default:
		updates := map[string]any{
			"agent_type":                      in.AgentType,
			"version":                         in.Version,
			"ip":                              in.IP,
			"status":                          domain.EdgeAgentStatusOnline,
			"last_heartbeat_at":               in.Now,
			"config_version":                  in.ConfigVersion,
			"config_sync_status":              in.ConfigSyncStatus,
			"out_of_sync_cause":               in.OutOfSyncCause,
			"config_apply_error":              in.ConfigApplyError,
			"config_apply_failed_version":     in.ConfigApplyFailedVersion,
			"collector_status":                collectorStatus,
			"collector_version":               collectorVersion,
			"queue_backlog_bytes":             in.QueueBacklogBytes,
			"remote_write_dropped_total":      in.RemoteWriteDroppedTotal,
			"remote_write_retries_total":      in.RemoteWriteRetriesTotal,
			"remote_write_last_error":         in.RemoteWriteLastError,
			"metadata_remote_write_url":       in.MetadataRemoteWriteURL,
			"metadata_max_disk_usage_per_url": in.MetadataMaxDiskUsagePerURL,
			"components":                      componentsJSON,
			"updated_at":                      in.Now,
		}
		if err := r.db.WithContext(ctx).Model(&edgeAgentRecord{}).
			Where("id = ?", row.ID).Updates(updates).Error; err != nil {
			return AgentRuntime{}, fmt.Errorf("update edge agent %q: %w", in.Hostname, err)
		}
	}
	return AgentRuntime{ID: row.ID, RestartSeq: row.VMAgentRestartSeq, FlushSeq: row.FlushBacklogSeq}, nil
}

// InsertHeartbeat appends one heartbeat history row.
func (r *GORMRepository) InsertHeartbeat(ctx context.Context, rec HeartbeatRecord) error {
	componentsJSON, err := marshalComponents(rec.Components)
	if err != nil {
		return err
	}
	row := heartbeatRecord{
		NetworkDomainID:         rec.NetworkDomainID,
		EdgeAgentID:             rec.EdgeAgentID,
		AgentType:               rec.AgentType,
		Version:                 rec.Version,
		ConfigVersion:           rec.ConfigVersion,
		QueueBacklogBytes:       rec.QueueBacklogBytes,
		RemoteWriteQueueSize:    rec.RemoteWriteQueueSize,
		RemoteWriteDroppedTotal: rec.RemoteWriteDroppedTotal,
		RemoteWriteRetriesTotal: rec.RemoteWriteRetriesTotal,
		RemoteWriteLastError:    rec.RemoteWriteLastError,
		Hostname:                rec.Hostname,
		IP:                      rec.IP,
		Components:              componentsJSON,
		Timestamp:               rec.Timestamp,
		CreatedAt:               time.Now().UTC(),
	}
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		return fmt.Errorf("insert edge heartbeat for %q: %w", rec.Hostname, err)
	}
	return nil
}

// ReplaceTargetSnapshots clear-then-inserts the domain's target snapshots
// (F-11): callers only invoke this when targets_collected=true.
func (r *GORMRepository) ReplaceTargetSnapshots(ctx context.Context, domainID string, agentID int64, targets []domain.TargetSnapshot, reportedAt time.Time) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`DELETE FROM edge_target_snapshots WHERE network_domain_id = ?`, domainID).Error; err != nil {
			return fmt.Errorf("clear target snapshots for %q: %w", domainID, err)
		}
		for _, target := range targets {
			if strings.TrimSpace(target.Job) == "" || strings.TrimSpace(target.Instance) == "" {
				continue
			}
			row := targetSnapshotRecord{
				NetworkDomainID:       domainID,
				EdgeAgentID:           agentID,
				Job:                   target.Job,
				Instance:              target.Instance,
				ResourceID:            target.ResourceID,
				Health:                target.Health,
				LastScrape:            parseRFC3339(target.LastScrape),
				LastError:             target.LastError,
				ScrapeDurationSeconds: target.ScrapeDurationSeconds,
				LastReportAt:          reportedAt,
				CreatedAt:             reportedAt,
				UpdatedAt:             reportedAt,
			}
			if err := tx.Create(&row).Error; err != nil {
				return fmt.Errorf("insert target snapshot %q/%q: %w", target.Job, target.Instance, err)
			}
		}
		return nil
	})
}

// TouchAccessHeartbeat records the domain-level last heartbeat timestamp.
func (r *GORMRepository) TouchAccessHeartbeat(ctx context.Context, domainID string, at time.Time) error {
	err := r.db.WithContext(ctx).Model(&accessRecord{}).Where("domain_id = ?", domainID).
		Updates(map[string]any{"last_heartbeat_at": at, "updated_at": at}).Error
	if err != nil {
		return fmt.Errorf("touch network domain access %q heartbeat: %w", domainID, err)
	}
	return nil
}

// ListAgents returns edge agents; retired agents are hidden unless explicitly
// filtered for.
func (r *GORMRepository) ListAgents(ctx context.Context, filter EdgeAgentFilter, allowed []string) ([]EdgeAgentView, int64, error) {
	query := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&edgeAgentRecord{}).Where("deleted_at IS NULL")
		if filter.Status != "" {
			q = q.Where("status = ?", filter.Status)
		} else {
			q = q.Where("status <> ?", domain.EdgeAgentStatusRetired)
		}
		if filter.NetworkDomainID != "" {
			q = q.Where("network_domain_id = ?", filter.NetworkDomainID)
		}
		if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
			like := "%" + keyword + "%"
			q = q.Where("(hostname LIKE ? OR ip LIKE ?)", like, like)
		}
		return applyAgentAllowed(q, allowed)
	}

	var total int64
	if err := query().Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count edge agents: %w", err)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	var rows []edgeAgentRecord
	if err := query().Order("last_heartbeat_at DESC, id ASC").
		Offset((page - 1) * pageSize).Limit(pageSize).Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list edge agents: %w", err)
	}
	items := make([]EdgeAgentView, 0, len(rows))
	for i := range rows {
		items = append(items, toEdgeAgentView(&rows[i]))
	}
	return items, total, nil
}

// GetAgent returns one agent or domain.AgentNotFoundError.
func (r *GORMRepository) GetAgent(ctx context.Context, id int64, allowed []string) (*EdgeAgentView, error) {
	var row edgeAgentRecord
	err := applyAgentAllowed(r.db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id), allowed).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &domain.AgentNotFoundError{AgentID: id}
	}
	if err != nil {
		return nil, fmt.Errorf("get edge agent %d: %w", id, err)
	}
	view := toEdgeAgentView(&row)
	return &view, nil
}

// IncrementRestartSeq bumps the restart command sequence and records the actor.
func (r *GORMRepository) IncrementRestartSeq(ctx context.Context, id int64, requestedBy string, at time.Time) error {
	result := r.db.WithContext(ctx).Model(&edgeAgentRecord{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(map[string]any{
			"vm_agent_restart_seq": gorm.Expr("vm_agent_restart_seq + 1"),
			"restart_requested_by": requestedBy,
			"restart_requested_at": at,
			"updated_at":           at,
		})
	if result.Error != nil {
		return fmt.Errorf("increment restart seq for agent %d: %w", id, result.Error)
	}
	if result.RowsAffected == 0 {
		return &domain.AgentNotFoundError{AgentID: id}
	}
	return nil
}

// IncrementFlushSeq bumps the flush-backlog command sequence and records the actor.
func (r *GORMRepository) IncrementFlushSeq(ctx context.Context, id int64, requestedBy string, at time.Time) error {
	result := r.db.WithContext(ctx).Model(&edgeAgentRecord{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(map[string]any{
			"flush_backlog_seq":  gorm.Expr("flush_backlog_seq + 1"),
			"flush_requested_by": requestedBy,
			"flush_requested_at": at,
			"updated_at":         at,
		})
	if result.Error != nil {
		return fmt.Errorf("increment flush seq for agent %d: %w", id, result.Error)
	}
	if result.RowsAffected == 0 {
		return &domain.AgentNotFoundError{AgentID: id}
	}
	return nil
}

// MarkAgentsOffline flips online agents whose heartbeat predates cutoff.
func (r *GORMRepository) MarkAgentsOffline(ctx context.Context, cutoff, now time.Time) (int64, error) {
	result := r.db.WithContext(ctx).Model(&edgeAgentRecord{}).
		Where("deleted_at IS NULL AND status = ? AND last_heartbeat_at IS NOT NULL AND last_heartbeat_at < ?",
			domain.EdgeAgentStatusOnline, cutoff).
		Updates(map[string]any{"status": domain.EdgeAgentStatusOffline, "updated_at": now})
	if result.Error != nil {
		return 0, fmt.Errorf("mark stale edge agents offline: %w", result.Error)
	}
	return result.RowsAffected, nil
}

// DeleteHeartbeatsBefore deletes heartbeat history older than cutoff (NFR-06).
func (r *GORMRepository) DeleteHeartbeatsBefore(ctx context.Context, cutoff time.Time) (int64, error) {
	result := r.db.WithContext(ctx).Exec(`DELETE FROM edge_heartbeats WHERE timestamp < ?`, cutoff)
	if result.Error != nil {
		return 0, fmt.Errorf("cleanup edge heartbeats: %w", result.Error)
	}
	return result.RowsAffected, nil
}

func applyAgentAllowed(query *gorm.DB, allowed []string) *gorm.DB {
	if allowed == nil {
		return query
	}
	if len(allowed) == 0 {
		return query.Where("1 = 0")
	}
	return query.Where("network_domain_id IN ?", allowed)
}

func toEdgeAgentView(row *edgeAgentRecord) EdgeAgentView {
	return EdgeAgentView{
		ID:                         row.ID,
		NetworkDomainID:            row.NetworkDomainID,
		Hostname:                   row.Hostname,
		IP:                         row.IP,
		AgentType:                  row.AgentType,
		Version:                    row.Version,
		Status:                     row.Status,
		LastHeartbeatAt:            row.LastHeartbeatAt,
		HeartbeatRTTMs:             row.HeartbeatRTTMs,
		ConfigVersion:              row.ConfigVersion,
		ConfigSyncStatus:           row.ConfigSyncStatus,
		OutOfSyncCause:             row.OutOfSyncCause,
		ConfigApplyError:           row.ConfigApplyError,
		CollectorStatus:            row.CollectorStatus,
		CollectorVersion:           row.CollectorVersion,
		Components:                 decodeComponents(row.Components),
		QueueBacklogBytes:          row.QueueBacklogBytes,
		RemoteWriteDroppedTotal:    row.RemoteWriteDroppedTotal,
		RemoteWriteRetriesTotal:    row.RemoteWriteRetriesTotal,
		RemoteWriteLastError:       row.RemoteWriteLastError,
		MetadataRemoteWriteURL:     row.MetadataRemoteWriteURL,
		MetadataMaxDiskUsagePerURL: row.MetadataMaxDiskUsagePerURL,
		VMAgentRestartSeq:          row.VMAgentRestartSeq,
		RestartRequestedBy:         row.RestartRequestedBy,
		RestartRequestedAt:         row.RestartRequestedAt,
		FlushBacklogSeq:            row.FlushBacklogSeq,
		FlushRequestedBy:           row.FlushRequestedBy,
		FlushRequestedAt:           row.FlushRequestedAt,
		LastError:                  row.LastError,
		CreatedAt:                  row.CreatedAt,
		UpdatedAt:                  row.UpdatedAt,
	}
}

func marshalComponents(components []domain.Component) (string, error) {
	if components == nil {
		return "[]", nil
	}
	raw, err := json.Marshal(components)
	if err != nil {
		return "", fmt.Errorf("marshal edge components: %w", err)
	}
	return string(raw), nil
}

func decodeComponents(raw string) []domain.Component {
	if strings.TrimSpace(raw) == "" {
		return []domain.Component{}
	}
	var components []domain.Component
	if err := json.Unmarshal([]byte(raw), &components); err != nil {
		return []domain.Component{}
	}
	if components == nil {
		return []domain.Component{}
	}
	return components
}

func collectorComponent(components []domain.Component) (status, version string) {
	for _, component := range components {
		if component.Type == "collector" {
			return component.Status, component.Version
		}
	}
	return "", ""
}

func parseRFC3339(raw string) *time.Time {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil
	}
	return &parsed
}
