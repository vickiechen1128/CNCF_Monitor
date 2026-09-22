// Package query 实现 Module_02 查询中心的采集状态回显 API：
//
//   - GET /api/v1/targets          代理中心 Prometheus /api/v1/targets，本地做
//     job / network_domain / health 过滤，并逐 target 补全 resource_id 目标标签
//     与 network_domain（缺失回落 default）（决策 47-4，契约快照 §2.1）；
//     F-11 起融合边缘 vmagent target 快照（edge_target_snapshots 表），见
//     TargetsHandler 注释与 docs/05-execution-records/module-11/dev-feedback.md；
//   - GET /api/v1/health/coverage 按 resource_id 稳定标签做过三态聚合（决策 47-3，
//     契约快照 §2.2，见 coverage.go）。
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
	"gorm.io/gorm"
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

// EdgeSnapshotStaleAfter 是边缘 target 快照的过期阈值（F-11 子项③）：last_report_at
// 距今超过该值时 health 降级 unknown，避免 agent 离线后陈旧 up/down 常驻。取 90s =
// 3×agent 心跳间隔（30s），比任务建议的 2 倍更保守，容忍一次心跳抖动。
const EdgeSnapshotStaleAfter = 90 * time.Second

// promTargetsData 对齐 Prometheus GET /api/v1/targets 的 data 结构。
// ActiveTargets 用 map 透传原始字段，便于逐项补全 network_domain / resource_id。
type promTargetsData struct {
	ActiveTargets  []map[string]interface{} `json:"activeTargets"`
	DroppedTargets []interface{}            `json:"droppedTargets"`
	TargetsByJob   map[string]interface{}   `json:"targetsByJob"`
}

// TargetsHandler 是 GET /api/v1/targets 的 handler：
//  1. 透传调用上游 GET /api/v1/targets?state=active；上游不可达时降级不整链失败
//     （local targets 置空，边缘快照仍返回，F-11 排障价值）；
//  2. health 参数三枚举校验（非法 → bad_request；其余参数缺失透传不报错）；
//  3. 逐 activeTarget 补全 job / network_domain（缺失回落 default）/ resource_id /
//     instance，按 job / network_domain / health 本地过滤；
//  4. F-11 融合：追加 edge_target_snapshots 表中该 network_domain（未指定不过滤）
//     的边缘快照，统一合成为 Prometheus target 结构；归并键 (network_domain, job,
//     instance)，local 优先、边缘补缺；快照 last_report_at 距今超过
//     EdgeSnapshotStaleAfter 时 health 降级 unknown（fresh 优先，job / health 过滤
//     对边缘快照同样生效）。
//
// 响应 envelope 对齐 Prometheus（§2.1.2）：{activeTargets, droppedTargets, targetsByJob}。
func TargetsHandler(db *gorm.DB, promURL *url.URL, client *http.Client) gin.HandlerFunc {
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

		// 上游不可达/故障时降级：local targets 置空，继续融合边缘快照，不整链 500。
		data, err := fetchTargets(c.Request.Context(), client, promURL, state)
		if err != nil {
			data = &promTargetsData{
				ActiveTargets:  []map[string]interface{}{},
				DroppedTargets: []interface{}{},
				TargetsByJob:   map[string]interface{}{},
			}
		}

		active := make([]map[string]interface{}, 0, len(data.ActiveTargets))
		// 归并去重键集合：(network_domain, job, instance)（F-11 子项②，resource_id
		// 为注入标签可能缺失，不作去重键）。local 优先：已占键的边缘快照跳过。
		seen := make(map[string]struct{}, len(data.ActiveTargets))
		for _, t := range data.ActiveTargets {
			resJob := resolveJob(t)
			resDomain := resolveLabel(t, "network_domain")
			if resDomain == "" {
				resDomain = DefaultNetworkDomain
			}
			resID := resolveLabel(t, "resource_id")
			instance := resolveInstance(t)

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
			// 实例地址透传：Prometheus targets 将 instance 放在 labels 内，此处提升为顶层字段
			// 供前端直接消费；缺失时按 __address__ / scrapeUrl 兜底解析。
			t["instance"] = instance
			seen[dedupKey(resDomain, resJob, instance)] = struct{}{}
			active = append(active, t)
		}

		// F-11：融合边缘 vmagent target 快照（同一 network_domain 下与 local 并存时
		// local 优先，边缘补缺；实际一个 job 仅被一个通道抓取，冲突罕见）。
		edgeSnapshots, err := fetchEdgeTargetSnapshots(db, netDomain)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		now := time.Now()
		for _, s := range edgeSnapshots {
			if job != "" && s.Job != job {
				continue
			}
			effHealth := edgeTargetHealth(s.Health, s.LastReportAt, now)
			if health != "" && effHealth != health {
				continue
			}
			key := dedupKey(s.NetworkDomainID, s.Job, s.Instance)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			active = append(active, edgeSnapshotToTarget(s, effHealth))
		}
		data.ActiveTargets = active

		response.OK(c, data)
	}
}

// fetchTargets 调用上游 Prometheus GET /api/v1/targets 并解码 data。上游不可达或
// 返回非 success 时返回错误（调用方降级为空 activeTargets，继续融合边缘快照）。
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

// fetchEdgeTargetSnapshots 查询边缘 vmagent target 快照（F-11 融合数据源）。
// netDomain 非空时按 network_domain_id 过滤，空则返回全部域（与 local 不过滤语义
// 一致，含 default 域）。
func fetchEdgeTargetSnapshots(db *gorm.DB, netDomain string) ([]models.EdgeTargetSnapshot, error) {
	q := db.Model(&models.EdgeTargetSnapshot{})
	if netDomain != "" {
		q = q.Where("network_domain_id = ?", netDomain)
	}
	var rows []models.EdgeTargetSnapshot
	if err := q.Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("query edge target snapshots: %w", err)
	}
	return rows, nil
}

// dedupKey 构造 target 归并去重键 (network_domain, job, instance)。
func dedupKey(domain, job, instance string) string {
	return domain + "\x00" + job + "\x00" + instance
}

// edgeTargetHealth 计算边缘快照对外暴露的 health：last_report_at 距今超过
// EdgeSnapshotStaleAfter（agent 离线）时降级 unknown；上报值为空时同样置 unknown
// （无法判断）；否则透传上报值。
func edgeTargetHealth(reported string, lastReportAt, now time.Time) string {
	if reported == "" || now.Sub(lastReportAt) > EdgeSnapshotStaleAfter {
		return HealthUnknown
	}
	return reported
}

// edgeSnapshotToTarget 将边缘快照合成为 Prometheus target 结构（envelope 兼容）：
// labels 合成 {job, instance, network_domain, resource_id}，抓取详情 lastScrape /
// lastError / scrapeDuration 直取快照，顶层补全 job / network_domain / resource_id /
// instance 对齐 local 增强语义（resource_id 缺失置空）。
func edgeSnapshotToTarget(s models.EdgeTargetSnapshot, health string) map[string]interface{} {
	return map[string]interface{}{
		"scrapePool": s.Job,
		"labels": map[string]interface{}{
			"job":            s.Job,
			"instance":       s.Instance,
			"network_domain": s.NetworkDomainID,
			"resource_id":    s.ResourceID,
		},
		"health":         health,
		"lastScrape":     s.LastScrape,
		"lastError":      s.LastError,
		"scrapeDuration": s.ScrapeDurationSeconds,
		"job":            s.Job,
		"network_domain": s.NetworkDomainID,
		"resource_id":    s.ResourceID,
		"instance":       s.Instance,
	}
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

// resolveInstance 提取 target 的实例地址：优先 labels.instance，缺失回退 __address__，
// 再缺失从 scrapeUrl / globalUrl 解析 host:port。均不可得返回空串（前端显示 '-'）。
func resolveInstance(t map[string]interface{}) string {
	if s := resolveLabel(t, "instance"); s != "" {
		return s
	}
	if s := resolveLabel(t, "__address__"); s != "" {
		return s
	}
	if s := asString(t["scrapeUrl"]); s != "" {
		return hostPortFromURL(s)
	}
	if s := asString(t["globalUrl"]); s != "" {
		return hostPortFromURL(s)
	}
	return ""
}

// hostPortFromURL 从 URL 中提取 host:port（如 "http://1.2.3.4:9100/metrics" → "1.2.3.4:9100"）。
func hostPortFromURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Host
}

// asString 安全将任意值转字符串（非 string 返回空串）。
func asString(v interface{}) string {
	s, _ := v.(string)
	return s
}
