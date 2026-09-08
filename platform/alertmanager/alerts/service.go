package alerts

import (
	"context"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
)

// 通知状态四态枚举（契约快照 §10.2 / §6：服务端归一，AM 原始 suppressed 不外露）。
const (
	// NotifyStatusActive 通知中（AM state=active）。
	NotifyStatusActive = "active"
	// NotifyStatusSilenced 静默（AM state=suppressed 且 silencedBy 非空）。
	NotifyStatusSilenced = "silenced"
	// NotifyStatusInhibited 抑制（AM state=suppressed 且 inhibitedBy 非空）。
	NotifyStatusInhibited = "inhibited"
	// NotifyStatusUnprocessed 待处理（AM state=unprocessed）。
	NotifyStatusUnprocessed = "unprocessed"
)

// AlertStatus 是契约 §10.2 的 AM 原始状态子集（state/silenced_by/inhibited_by，
// snake_case；作为输入保留，UI 以 notify_status 为准）。
type AlertStatus struct {
	State       string   `json:"state"`
	SilencedBy  []string `json:"silenced_by"`
	InhibitedBy []string `json:"inhibited_by"`
}

// AlertItem 是契约 §10.2 的 AmAlertItem 视图：AM GettableAlert 字段子集 +
// 服务端归一 notify_status。字段 snake_case。
type AlertItem struct {
	Labels       map[string]string `json:"labels"`
	Annotations  map[string]string `json:"annotations"`
	StartsAt     time.Time         `json:"starts_at"`
	EndsAt       time.Time         `json:"ends_at"`
	Status       AlertStatus       `json:"status"`
	NotifyStatus string            `json:"notify_status"`
}

// Service 编排通知状态读取：拉取 AM 告警 → 决策 56 授权过滤 → UX 筛选 → 四态映射。
type Service struct {
	proxy *Proxy
}

// NewService 创建通知状态服务，绑定 Alertmanager 代理。
func NewService(proxy *Proxy) *Service {
	return &Service{proxy: proxy}
}

// List 拉取并映射 Alertmanager 告警列表（契约 §10.2）：
//  1. 决策 56 读路径授权过滤骨架：服务端强制注入授权网域集合 filter——
//     scope 非全量（AllDomains=false）时按 labels.network_domain（缺失回落 default）
//     收敛；AllDomains / nil（MVP 单租户）恒通过、不附加；
//  2. networkDomain 为前端 UX 筛选透传（在授权过滤之后本地过滤，不构成权限依据）。
//
// 空结果返回空切片（[] 而非 null）。
func (s *Service) List(ctx context.Context, scope *models.AuthorizedMatcherScope, networkDomain string) ([]AlertItem, error) {
	list, err := s.proxy.ListAlerts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AlertItem, 0, len(list))
	for _, am := range list {
		domain := am.Labels["network_domain"]
		if domain == "" {
			domain = models.DefaultDomainID
		}
		// 决策 56：授权过滤由服务端强制执行，不信任前端传参。
		if !domainInScope(scope, domain) {
			continue
		}
		if networkDomain != "" && domain != networkDomain {
			continue
		}
		out = append(out, toAlertItem(am))
	}
	return out, nil
}

// domainInScope 判定告警所属网域是否收敛于授权网域集合（决策 56 骨架）：
// scope 为 nil 或 AllDomains（MVP 单租户）时恒通过；否则网域必须命中 Domains 集合。
func domainInScope(scope *models.AuthorizedMatcherScope, domain string) bool {
	if scope == nil || scope.AllDomains {
		return true
	}
	for _, d := range scope.Domains {
		if d == domain {
			return true
		}
	}
	return false
}

// toAlertItem 将 Alertmanager 原生载体映射为契约视图（含 notify_status 归一）。
func toAlertItem(am amAlert) AlertItem {
	return AlertItem{
		Labels:      am.Labels,
		Annotations: am.Annotations,
		StartsAt:    am.StartsAt,
		EndsAt:      am.EndsAt,
		Status: AlertStatus{
			State:       am.Status.State,
			SilencedBy:  am.Status.SilencedBy,
			InhibitedBy: am.Status.InhibitedBy,
		},
		NotifyStatus: normalizeNotifyStatus(am.Status),
	}
}

// normalizeNotifyStatus 将 AM 原始 status 归一为四态（契约 §10.2）：
//   - state=unprocessed → unprocessed；
//   - state=suppressed 且 silencedBy 非空 → silenced（优先级最高）；
//   - state=suppressed 且 inhibitedBy 非空 → inhibited；
//   - state=suppressed 且两者均空（理论不出现，防御兜底）→ inhibited；
//   - 其余（state=active 或未知值）→ active。
func normalizeNotifyStatus(st amAlertStatus) string {
	switch st.State {
	case "unprocessed":
		return NotifyStatusUnprocessed
	case "suppressed":
		if len(st.SilencedBy) > 0 {
			return NotifyStatusSilenced
		}
		return NotifyStatusInhibited
	default:
		return NotifyStatusActive
	}
}
