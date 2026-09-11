// Package query — Module_02 查询中心当前触发告警代理（T08-06，决策 55/60 批次）：
// 代理中心 Prometheus GET /api/v1/alerts，返回 firing/pending 告警实例字段子集
// （labels/annotations/state/activeAt/value），并支持 network_domain 服务端本地过滤
// （缺失标签回落 default，与 targets.go 同构）。后端承担过滤，前端不重复过滤；
// 网域解析统一走 models.ResolveNetworkDomain（network_domain → network_domain_id
// → default），并把结果回写进响应 labels.network_domain，供前端「网域」列展示；
// 租户/网域注入骨架 MVP 恒通过、机制保留（Module_02 §11.2#5）；
// 按告警标签 resource_id 批量回连 M01 五类资源表，回填「实例名」等展示字段
// （M08 v1.15 决策 70，见 resource_identity.go）；
// 不代理 Alertmanager 通知状态（Module_02 §11.2#14 边界，归 M08 /api/v2/platform/alertmanager/alerts）。
// 参见 docs/05-execution-records/module-08/api-contract-snapshot.md §10.1。
package query

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// Prometheus 告警实例状态枚举（契约快照 §10.1 / §6）。
const (
	AlertStateFiring  = "firing"
	AlertStatePending = "pending"
)

// promAlert 对齐 Prometheus GET /api/v1/alerts 的单条告警字段子集（camelCase 透传，
// 契约 §10.1 PromAlertItem：labels/annotations/state/activeAt/value）。
type promAlert struct {
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	State       string            `json:"state"`
	ActiveAt    time.Time         `json:"activeAt"`
	Value       string            `json:"value"`
	// InstanceFields 是实例展示字段组（v1.15 决策 70）：采集地址 + 回连 M01 得到的
	// 实例名 / 类别 / IP / 端口。匿名字段在 JSON 中平铺（instance_address /
	// instance_display / resource_id / resource_name / resource_category /
	// resource_ip / resource_port），语义见契约快照 §10.1。
	InstanceFields
}

// AlertsHandler 是 GET /api/v1/alerts 的 handler：
//  1. 透传调用上游 Prometheus GET /api/v1/alerts；
//  2. network_domain Query 可选：服务端按 labels.network_domain 本地过滤（缺失回落 default）；
//  3. 租户/网域注入骨架（alertDomainAllowed）：MVP 单租户恒通过，机制保留；
//  4. 按告警标签 resource_id 批量回连 M01 五类资源表（v1.15 决策 70），回填实例名字段；
//  5. 上游不可达 / 非 success → internal 可观测错误；空结果返回 [] 而非 null。
//
// 响应 envelope 为控制面统一响应：{status, data:{alerts: [...]}}（契约快照 §10.1）。
func AlertsHandler(db *gorm.DB, promURL *url.URL, client *http.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		netDomain := c.Query("network_domain")

		alerts, err := fetchAlerts(c.Request.Context(), client, promURL)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		// 决策 70：一次性收集 resource_id 批量回连 M01（每类表一条 IN 查询，禁 N+1）。
		// 回连失败降级为空 map，实例字段走标签回落链，不阻塞告警主链路。
		ids := make([]string, 0, len(alerts))
		for i := range alerts {
			ids = append(ids, alerts[i].Labels["resource_id"])
		}
		identities := ResolveResourceIdentitiesSafe(db, ids)

		out := make([]promAlert, 0, len(alerts))
		for _, a := range alerts {
			domain := models.ResolveNetworkDomain(a.Labels)
			// 租户/网域授权骨架：MVP 授权集合为 nil（全部通过），机制保留。
			if !alertDomainAllowed(tenantAuthorizedDomains(c), domain) {
				continue
			}
			// 本地过滤：后端承担 network_domain，前端不重复过滤。
			if netDomain != "" && domain != netDomain {
				continue
			}
			// 回写 labels.network_domain（契约快照 §10.1 的 UI 展示字段）：上游
			// Prometheus GET /api/v1/alerts 返回的是规则求值标签，**不含**
			// external_labels（Prometheus 仅在 remote write / federation / 发往
			// Alertmanager 时附加），因此告警标签里通常没有网域键；必须在此把
			// 「解析 + 回落 default」的结果回写进响应，否则前端「网域」列恒为空。
			// 与 targets.go 回写 t["network_domain"] 的代理语义同构。
			a.Labels = models.EnsureNetworkDomain(a.Labels, domain)
			a.InstanceFields = InstanceFieldsOf(a.Labels, identities)
			out = append(out, a)
		}

		response.OK(c, gin.H{"alerts": out})
	}
}

// fetchAlerts 调用上游 Prometheus GET /api/v1/alerts 并解码 data.alerts。
// 上游不可达或非 success 时返回错误（调用方转 internal 响应）。
func fetchAlerts(ctx context.Context, client *http.Client, promURL *url.URL) ([]promAlert, error) {
	u := *promURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/alerts"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build prometheus alerts request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch prometheus alerts: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch prometheus alerts: unexpected status %d", resp.StatusCode)
	}

	var envelope struct {
		Status string `json:"status"`
		Error  string `json:"error"`
		Data   struct {
			Alerts []promAlert `json:"alerts"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode prometheus alerts: %w", err)
	}
	if envelope.Status != "success" {
		return nil, fmt.Errorf("prometheus alerts status: %q: %s", envelope.Status, envelope.Error)
	}
	if envelope.Data.Alerts == nil {
		envelope.Data.Alerts = []promAlert{}
	}
	return envelope.Data.Alerts, nil
}

// tenantAuthorizedDomains 返回当前租户可见的网域集合（租户/网域注入骨架，
// Module_02 §11.2#5）。MVP 单租户恒返回 nil（=全部网域可见，不过滤）；
// 未来多租户时从认证上下文解析授权网域集合，机制保留于此。
func tenantAuthorizedDomains(_ *gin.Context) []string {
	return nil
}

// alertDomainAllowed 判定告警所属网域是否在授权集合内：授权集合为 nil 或空时
// 恒通过（MVP 单租户语义）；非空集合按网域收敛（未来多租户启用）。
func alertDomainAllowed(authorized []string, domain string) bool {
	if len(authorized) == 0 {
		return true
	}
	for _, d := range authorized {
		if d == domain {
			return true
		}
	}
	return false
}
