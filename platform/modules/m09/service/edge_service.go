package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// DefaultOfflineThreshold is the heartbeat age after which a node is shown as
// offline. Heartbeats are expected every ~30s; 90s tolerates two misses.
const DefaultOfflineThreshold = 90 * time.Second

// DefaultHeartbeatRetention is the heartbeat history retention (NFR-06).
const DefaultHeartbeatRetention = 7 * 24 * time.Hour

// EdgeService implements the machine-to-machine edge protocol and the
// edge-agent read/command surface.
type EdgeService struct {
	repo             repository.EdgeRepository
	tenants          repository.TenantReader
	now              func() time.Time
	offlineThreshold time.Duration
	retention        time.Duration
}

// NewEdgeService constructs the edge service.
func NewEdgeService(repo repository.EdgeRepository, tenants repository.TenantReader) *EdgeService {
	return &EdgeService{
		repo:             repo,
		tenants:          tenants,
		now:              func() time.Time { return time.Now().UTC() },
		offlineThreshold: DefaultOfflineThreshold,
		retention:        DefaultHeartbeatRetention,
	}
}

// HandleHeartbeat processes one agent heartbeat: auto-registers the agent,
// refreshes its runtime state, appends history and (when the agent reports
// targets successfully) replaces the domain's target snapshots.
func (s *EdgeService) HandleHeartbeat(ctx context.Context, domainID string, req domain.HeartbeatRequest) (*domain.HeartbeatResponse, error) {
	if err := domain.ValidateProtocol(req.ProtocolVersion); err != nil {
		return nil, err
	}
	hostname := strings.TrimSpace(req.Hostname)
	if hostname == "" {
		return nil, &domain.ValidationError{Field: "hostname", Message: "is required"}
	}
	access, err := s.repo.FindAccess(ctx, domainID)
	if err != nil {
		return nil, err
	}
	if access == nil || !access.IsMonitored() {
		return nil, &domain.ConflictError{Message: fmt.Sprintf(
			"network domain %q is not monitored; re-onboard the domain to issue a token", domainID)}
	}

	now := s.now()
	syncStatus, cause := domain.SyncStatus(req.ConfigVersion, access.LastConfigVersion, req.ConfigApplyError)

	runtime, err := s.repo.UpsertAgentHeartbeat(ctx, repository.AgentHeartbeatInput{
		NetworkDomainID:            domainID,
		Hostname:                   hostname,
		IP:                         strings.TrimSpace(req.IP),
		AgentType:                  strings.TrimSpace(req.AgentType),
		Version:                    strings.TrimSpace(req.Version),
		ConfigVersion:              strings.TrimSpace(req.ConfigVersion),
		ConfigSyncStatus:           syncStatus,
		OutOfSyncCause:             cause,
		ConfigApplyError:           strings.TrimSpace(req.ConfigApplyError),
		ConfigApplyFailedVersion:   strings.TrimSpace(req.ConfigApplyFailedVersion),
		QueueBacklogBytes:          req.QueueBacklogBytes,
		RemoteWriteQueueSize:       req.RemoteWriteQueueSize,
		RemoteWriteDroppedTotal:    req.RemoteWriteDroppedTotal,
		RemoteWriteRetriesTotal:    req.RemoteWriteRetriesTotal,
		RemoteWriteLastError:       req.RemoteWriteLastError,
		MetadataRemoteWriteURL:     req.MetadataRemoteWriteURL,
		MetadataMaxDiskUsagePerURL: req.MetadataMaxDiskUsagePerURL,
		Components:                 req.Components,
		Now:                        now,
	})
	if err != nil {
		return nil, err
	}

	if err := s.repo.InsertHeartbeat(ctx, repository.HeartbeatRecord{
		NetworkDomainID:         domainID,
		EdgeAgentID:             runtime.ID,
		AgentType:               strings.TrimSpace(req.AgentType),
		Version:                 strings.TrimSpace(req.Version),
		ConfigVersion:           strings.TrimSpace(req.ConfigVersion),
		QueueBacklogBytes:       req.QueueBacklogBytes,
		RemoteWriteQueueSize:    req.RemoteWriteQueueSize,
		RemoteWriteDroppedTotal: req.RemoteWriteDroppedTotal,
		RemoteWriteRetriesTotal: req.RemoteWriteRetriesTotal,
		RemoteWriteLastError:    req.RemoteWriteLastError,
		Hostname:                hostname,
		IP:                      strings.TrimSpace(req.IP),
		Components:              req.Components,
		Timestamp:               now,
	}); err != nil {
		return nil, err
	}

	if req.TargetsCollected {
		if err := s.repo.ReplaceTargetSnapshots(ctx, domainID, runtime.ID, req.Targets, now); err != nil {
			return nil, err
		}
	}
	if err := s.repo.TouchAccessHeartbeat(ctx, domainID, now); err != nil {
		return nil, err
	}

	// Config delivery: report the current published snapshot so the agent can
	// pull when its reported version differs (or it has none yet).
	currentVersion, currentChecksum, err := s.repo.CurrentConfigMeta(ctx, domainID)
	if err != nil {
		return nil, err
	}
	configChanged := currentVersion != "" && strings.TrimSpace(req.ConfigVersion) != currentVersion
	downloadURL := ""
	if currentVersion != "" {
		downloadURL = "/api/v3/edge/config?network_domain=" + url.QueryEscape(domainID)
	}
	return &domain.HeartbeatResponse{
		ConfigChanged:     configChanged,
		ConfigVersion:     currentVersion,
		ConfigChecksum:    currentChecksum,
		ConfigDownloadURL: downloadURL,
		VMAgentRestartSeq: runtime.RestartSeq,
		FlushBacklogSeq:   runtime.FlushSeq,
		ServerTime:        now,
	}, nil
}

// ListAgents returns the edge-agent list with effective (time-derived) status.
func (s *EdgeService) ListAgents(ctx context.Context, actor Actor, filter repository.EdgeAgentFilter) ([]repository.EdgeAgentView, int64, error) {
	allowed, err := s.allowed(ctx, actor)
	if err != nil {
		return nil, 0, err
	}
	items, total, err := s.repo.ListAgents(ctx, filter, allowed)
	if err != nil {
		return nil, 0, err
	}
	now := s.now()
	for i := range items {
		items[i].Status = domain.EffectiveAgentStatus(items[i].Status, items[i].LastHeartbeatAt, now, s.offlineThreshold)
	}
	return items, total, nil
}

// GetAgent returns one agent with effective status (404 when missing/unauthorized).
func (s *EdgeService) GetAgent(ctx context.Context, actor Actor, id int64) (*repository.EdgeAgentView, error) {
	allowed, err := s.allowed(ctx, actor)
	if err != nil {
		return nil, err
	}
	agent, err := s.repo.GetAgent(ctx, id, allowed)
	if err != nil {
		return nil, err
	}
	agent.Status = domain.EffectiveAgentStatus(agent.Status, agent.LastHeartbeatAt, s.now(), s.offlineThreshold)
	return agent, nil
}

// RestartAgent increments the restart command sequence. Offline/retired nodes
// reject the command with an actionable 400.
func (s *EdgeService) RestartAgent(ctx context.Context, actor Actor, id int64, requestedBy string) (*repository.EdgeAgentView, error) {
	if _, err := s.requireCommandable(ctx, actor, id); err != nil {
		return nil, err
	}
	if err := s.repo.IncrementRestartSeq(ctx, id, requestedBy, s.now()); err != nil {
		return nil, err
	}
	return s.GetAgent(ctx, actor, id)
}

// FlushBacklogAgent increments the flush-backlog command sequence.
func (s *EdgeService) FlushBacklogAgent(ctx context.Context, actor Actor, id int64, requestedBy string) (*repository.EdgeAgentView, error) {
	if _, err := s.requireCommandable(ctx, actor, id); err != nil {
		return nil, err
	}
	if err := s.repo.IncrementFlushSeq(ctx, id, requestedBy, s.now()); err != nil {
		return nil, err
	}
	return s.GetAgent(ctx, actor, id)
}

// DetectOffline flips stale online agents to offline. Intended for a periodic
// maintenance loop; also safe to call manually.
func (s *EdgeService) DetectOffline(ctx context.Context) (int64, error) {
	now := s.now()
	return s.repo.MarkAgentsOffline(ctx, now.Add(-s.offlineThreshold), now)
}

// CleanupHeartbeats drops heartbeat history older than the retention window.
func (s *EdgeService) CleanupHeartbeats(ctx context.Context) (int64, error) {
	return s.repo.DeleteHeartbeatsBefore(context.WithoutCancel(ctx), s.now().Add(-s.retention))
}

// RunMaintenance runs the offline detector and retention cleanup on a ticker
// until ctx is cancelled. Wiring is done by the bootstrap in a later step.
func (s *EdgeService) RunMaintenance(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, _ = s.DetectOffline(ctx)
			_, _ = s.CleanupHeartbeats(ctx)
		}
	}
}

func (s *EdgeService) requireCommandable(ctx context.Context, actor Actor, id int64) (*repository.EdgeAgentView, error) {
	agent, err := s.GetAgent(ctx, actor, id)
	if err != nil {
		return nil, err
	}
	switch agent.Status {
	case domain.EdgeAgentStatusOffline:
		return nil, &domain.ValidationError{Field: "status", Message: fmt.Sprintf(
			"edge agent %d is offline; wait for it to reconnect before sending commands", id)}
	case domain.EdgeAgentStatusRetired:
		return nil, &domain.ValidationError{Field: "status", Message: fmt.Sprintf(
			"edge agent %d is retired and cannot receive commands", id)}
	}
	return agent, nil
}

func (s *EdgeService) allowed(ctx context.Context, actor Actor) ([]string, error) {
	if actor.IsPlatformAdmin {
		return nil, nil
	}
	return s.tenants.AllowedDomainIDs(ctx, actor.TenantID)
}
