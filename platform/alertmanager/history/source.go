package history

import (
	"context"
	"time"

	"github.com/metriccenter/metriccenter/platform/alertmanager/alerts"
)

// AMSource 把 M08 的 Alertmanager 告警代理适配为对账数据源。
type AMSource struct {
	Proxy *alerts.Proxy
}

// ListActiveAlerts 拉取 AM 活跃告警全集（含静默/抑制）。
func (s AMSource) ListActiveAlerts(ctx context.Context) ([]ActiveAlert, error) {
	list, err := s.Proxy.ListActiveAlerts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ActiveAlert, 0, len(list))
	for _, a := range list {
		out = append(out, ActiveAlert{
			Fingerprint: a.Fingerprint,
			Labels:      a.Labels,
			Annotations: a.Annotations,
			StartsAt:    a.StartsAt,
			EndsAt:      a.EndsAt,
			State:       a.State,
			SilencedBy:  a.SilencedBy,
			InhibitedBy: a.InhibitedBy,
			MutedBy:     a.MutedBy,
		})
	}
	return out, nil
}

// AlertmanagerStartedAt 返回 AM 进程启动时刻（uptime）。
func (s AMSource) AlertmanagerStartedAt(ctx context.Context) (time.Time, error) {
	return s.Proxy.AlertmanagerStartedAt(ctx)
}
