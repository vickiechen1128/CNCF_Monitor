// Package query — Module_02 查询中心当前触发告警代理（T08-06，决策 55/60 批次）：
// 代理中心 Prometheus GET /api/v1/alerts，返回 firing/pending 告警实例字段子集
// （labels/annotations/state/activeAt/value），并支持 network_domain 服务端本地过滤
// （缺失标签回落 default，与 targets.go 同构）。后端承担过滤，前端不重复过滤；
// 租户/网域注入骨架 MVP 恒通过、机制保留（Module_02 §11.2#5）；
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
	// InstanceDisplay 是面向 UI 的实例展示字段：依次尝试 instance/instance_ip/hostname/
	// nodename/device 标签，均缺失时返回空串（前端据此显示「全局/聚合」）。
	InstanceDisplay string `json:"instance_display"`
}

// AlertsHandler 是 GET /api/v1/alerts 的 handler：
//  1. 透传调用上游 Prometheus GET /api/v1/alerts；
//  2. network_domain Query 可选：服务端按 labels.network_domain 本地过滤（缺失回落 default）；
//  3. 租户/网域注入骨架（alertDomainAllowed）：MVP 单租户恒通过，机制保留；
//  4. 上游不可达 / 非 success → internal 可观测错误；空结果返回 [] 而非 null。
//
// 响应 envelope 为控制面统一响应：{status, data:{alerts: [...]}}（契约快照 §10.1）。
func AlertsHandler(promURL *url.URL, client *http.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		netDomain := c.Query("network_domain")

		alerts, err := fetchAlerts(c.Request.Context(), client, promURL)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		out := make([]promAlert, 0, len(alerts))
		for _, a := range alerts {
			domain := a.Labels["network_domain"]
			if domain == "" {
				domain = DefaultNetworkDomain
			}
			// 租户/网域授权骨架：MVP 授权集合为 nil（全部通过），机制保留。
			if !alertDomainAllowed(tenantAuthorizedDomains(c), domain) {
				continue
			}
			// 本地过滤：后端承担 network_domain，前端不重复过滤。
			if netDomain != "" && domain != netDomain {
				continue
			}
			a.InstanceDisplay = instanceDisplayOf(a.Labels)
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

// instanceDisplayOf 从告警标签中提取面向 UI 的实例展示值。
// 聚合告警（如 HostTargetsMissing）无 instance 标签，返回空串由前端展示为「全局/聚合」。
func instanceDisplayOf(labels map[string]string) string {
	keys := []string{"instance", "instance_ip", "hostname", "nodename", "device"}
	for _, k := range keys {
		if v := labels[k]; v != "" {
			return v
		}
	}
	return ""
}
