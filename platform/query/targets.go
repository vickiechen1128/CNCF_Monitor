// Package query 实现 Module_02 查询中心的采集状态回显 API：
//
//   - GET /api/v1/targets          代理中心 Prometheus /api/v1/targets，本地做
//   	job / network_domain / health 过滤，并逐 target 补全 resource_id 目标标签
//   	与 network_domain（缺失回落 default）（决策 47-4，契约快照 §2.1）；
//   - GET /api/v1/health/coverage 按 resource_id 稳定标签做过三态聚合（决策 47-3，
//   	契约快照 §2.2，见 coverage.go）。
//
// 后端承担本地过滤，前端不重复过滤；租户/网域注入 MVP 恒 platform_admin + default。
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
)

// 采集目标 health 三枚举（PRD Module_02 §5.3 / 契约快照 §2.1）。
const (
	HealthUp      = "up"
	HealthDown    = "down"
	HealthUnknown = "unknown"
)

// DefaultNetworkDomain 是 target / 资源缺失 network_domain 注入标签时的回落值
// （契约快照 §2.1.1：缺失时 default）。
const DefaultNetworkDomain = models.DefaultDomainID // "default"

// PrometheusTargetsTimeout 是请求上游 Prometheus targets / query 的超时。
const PrometheusTargetsTimeout = 15 * time.Second

// promTargetsData 对齐 Prometheus GET /api/v1/targets 的 data 结构。
// ActiveTargets 用 map 透传原始字段，便于逐项补全 network_domain / resource_id。
type promTargetsData struct {
	ActiveTargets  []map[string]interface{} `json:"activeTargets"`
	DroppedTargets []interface{}            `json:"droppedTargets"`
	TargetsByJob   map[string]interface{}   `json:"targetsByJob"`
}

// TargetsHandler 是 GET /api/v1/targets 的 handler：
//  1. 透传调用上游 GET /api/v1/targets?state=active；
//  2. health 参数三枚举校验（非法 → bad_request；其余参数缺失透传不报错）；
//  3. 逐 activeTarget 补全 job / network_domain（缺失回落 default）/ resource_id；
//  4. 本地按 job / network_domain / health 过滤后返回增强的 data.activeTargets。
//
// 响应 envelope 对齐 Prometheus（§2.1.2）：{activeTargets, droppedTargets, targetsByJob}。
func TargetsHandler(promURL *url.URL, client *http.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		job := c.Query("job")
		netDomain := c.Query("network_domain")
		health := c.Query("health")
		state := c.Query("state")
		if state == "" {
			state = "active"
		}

		if health != "" && health != HealthUp && health != HealthDown && health != HealthUnknown {
			response.BadRequest(c, fmt.Errorf("health 非法：%q，可选 up/down/unknown", health))
			return
		}

		data, err := fetchTargets(c.Request.Context(), client, promURL, state)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		active := make([]map[string]interface{}, 0, len(data.ActiveTargets))
		for _, t := range data.ActiveTargets {
			resJob := resolveJob(t)
			resDomain := resolveLabel(t, "network_domain")
			if resDomain == "" {
				resDomain = DefaultNetworkDomain
			}
			resID := resolveLabel(t, "resource_id")

			// 本地过滤：后端承担 job / network_domain / health，前端不重复过滤。
			if job != "" && resJob != job {
				continue
			}
			if netDomain != "" && resDomain != netDomain {
				continue
			}
			if health != "" && asString(t["health"]) != health {
				continue
			}

			t["job"] = resJob
			t["network_domain"] = resDomain
			t["resource_id"] = resID // 可选，无 resource_id 标签时为空串
			active = append(active, t)
		}
		data.ActiveTargets = active

		response.OK(c, data)
	}
}

// fetchTargets 调用上游 Prometheus GET /api/v1/targets 并解码 data。上游不可达或
// 返回非 success 时返回错误（调用方转 internal 响应）。
func fetchTargets(ctx context.Context, client *http.Client, promURL *url.URL, state string) (*promTargetsData, error) {
	u := *promURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/targets"
	q := u.Query()
	q.Set("state", state)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build prometheus targets request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch prometheus targets: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch prometheus targets: unexpected status %d", resp.StatusCode)
	}

	var envelope struct {
		Status string          `json:"status"`
		Data   promTargetsData `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode prometheus targets: %w", err)
	}
	if envelope.Status != "success" {
		return nil, fmt.Errorf("prometheus targets status: %q", envelope.Status)
	}
	if envelope.Data.ActiveTargets == nil {
		envelope.Data.ActiveTargets = []map[string]interface{}{}
	}
	return &envelope.Data, nil
}

// resolveJob 解析 target 的 job 名：优先取 labels["job"]，缺失回退 scrapePool。
func resolveJob(t map[string]interface{}) string {
	if s := resolveLabel(t, "job"); s != "" {
		return s
	}
	return asString(t["scrapePool"])
}

// resolveLabel 从 target 的 labels 映射读取指定 key（如 network_domain / resource_id）。
func resolveLabel(t map[string]interface{}, key string) string {
	labels, ok := t["labels"].(map[string]interface{})
	if !ok {
		return ""
	}
	return asString(labels[key])
}

// asString 安全将任意值转字符串（非 string 返回空串）。
func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}