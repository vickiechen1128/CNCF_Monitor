// Package query — Module_02 /api/v1/alerts/history 历史告警代理（M02 v1.13 + M08 v1.13）。
// 基于 Prometheus ALERTS{alertstate="firing"} 时间序列 query_range 重建规则级触发/恢复区间，
// 不依赖 Alertmanager 是否配置，与「Prometheus 当前触发告警」同规则求值视角。
// 参见 docs/02-product-requirements/Modules/Module_02_Query_Center.md §5.4/§6.1
//   与 Module_08_Alertmanager_Notification_Management.md §3.1/§5.4。
package query

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 历史告警时间序列常量。
const (
	// alertsHistoryMetric 是 Prometheus 内置的告警状态序列名。
	alertsHistoryMetric = "ALERTS"
	// alertsHistoryStateLabel 是 ALERTS 序列中表示状态（firing/pending）的标签键。
	alertsHistoryStateLabel = "alertstate"
	// alertsHistoryStateFiring 是 ALERTS 序列中触发态取值。
	alertsHistoryStateFiring = "firing"

	// defaultHistoryStep 默认 query_range 步长（PRD：默认 30s）。
	defaultHistoryStep = 30 * time.Second
	// minHistoryStep 最小 query_range 步长（PRD：最小 15s）。
	minHistoryStep = 15 * time.Second
	// defaultHistoryWindow 默认查询时间窗（PRD：默认 24h）。
	defaultHistoryWindow = 24 * time.Hour
	// maxHistoryWindow 最大查询时间窗（PRD：最大 7d）。
	maxHistoryWindow = 7 * 24 * time.Hour

	// defaultHistoryPageSize 默认分页大小。
	defaultHistoryPageSize = 50
	// maxHistoryPageSize 分页上限。
	maxHistoryPageSize = 200
)

// AlertHistoryItem 是单条历史告警记录（M02 §5.4）。
type AlertHistoryItem struct {
	Alertname       string  `json:"alertname"`
	Instance        string  `json:"instance"`
	NetworkDomain   string  `json:"network_domain"`
	State           string  `json:"state"`
	FiredAt         string  `json:"fired_at"`
	ResolvedAt      *string `json:"resolved_at,omitempty"`
	DurationSeconds float64 `json:"duration_seconds"`
	Summary         string  `json:"summary"`
	Value           string  `json:"value"`
	// InstanceFields 是实例展示字段组（v1.15 决策 70，与 PromAlertItem 同构、平铺）。
	InstanceFields
}

// alertHistoryQuery 解析后的历史告警查询参数。
type alertHistoryQuery struct {
	NetworkDomain string
	Alertname     string
	Instance      string
	State         string // all / firing / resolved
	Start         time.Time
	End           time.Time
	Step          time.Duration
	Page          int
	PageSize      int
}

// AlertsHistoryHandler 是 GET /api/v1/alerts/history 的 handler。
//   1. 解析并校验查询参数（默认 24h、最大 7d、step 默认 30s/最小 15s、page_size 上限 200）；
//   2. 调用 Prometheus query_range 查询 ALERTS{alertstate="firing"}；
//   3. 按 alertname + instance + 其余 labels 分组，连续 firing 样本合成触发区间；
//   4. 中断超过 2×step 视为区间结束；查询窗口末尾仍有样本则 state=firing；
//   5. 从 Prometheus /api/v1/rules 获取告警注解 summary 回填；
//   6. 按告警标签 resource_id 批量回连 M01 五类资源表，回填实例名字段（v1.15 决策 70）；
//   7. 本地过滤 network_domain/alertname/instance/state，内存分页后返回。
//
// 响应 envelope：{status, data:{list:[...], total, page, page_size}}，空结果 list=[] 非 null。
func AlertsHistoryHandler(db *gorm.DB, promURL *url.URL, client *http.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		q, err := parseAlertHistoryQuery(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}

		items, err := fetchAlertHistory(c.Request.Context(), db, client, promURL, q)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		list, total := paginateHistory(items, q.Page, q.PageSize)
		response.OK(c, gin.H{
			"list":       list,
			"total":      total,
			"page":       q.Page,
			"page_size":  q.PageSize,
		})
	}
}

// parseAlertHistoryQuery 解析并校验 URL 查询参数。
func parseAlertHistoryQuery(c *gin.Context) (alertHistoryQuery, error) {
	q := alertHistoryQuery{
		NetworkDomain: strings.TrimSpace(c.Query("network_domain")),
		Alertname:     strings.TrimSpace(c.Query("alertname")),
		Instance:      strings.TrimSpace(c.Query("instance")),
		State:         strings.ToLower(strings.TrimSpace(c.Query("state"))),
		Page:          1,
		PageSize:      defaultHistoryPageSize,
	}
	if q.State == "" {
		q.State = "all"
	}
	if q.State != "all" && q.State != "firing" && q.State != "resolved" {
		return q, fmt.Errorf("invalid state %q, must be all/firing/resolved", q.State)
	}

	now := time.Now()
	q.End = now
	if v := c.Query("end"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.End = t
		} else {
			return q, fmt.Errorf("invalid end time %q", v)
		}
	}

	q.Start = q.End.Add(-defaultHistoryWindow)
	if v := c.Query("start"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			q.Start = t
		} else {
			return q, fmt.Errorf("invalid start time %q", v)
		}
	}

	if q.Start.After(q.End) {
		q.Start, q.End = q.End, q.Start
	}
	if q.End.Sub(q.Start) > maxHistoryWindow {
		q.Start = q.End.Add(-maxHistoryWindow)
	}

	q.Step = defaultHistoryStep
	if v := c.Query("step"); v != "" {
		if sec, err := strconv.Atoi(v); err == nil && sec > 0 {
			q.Step = time.Duration(sec) * time.Second
		} else {
			return q, fmt.Errorf("invalid step %q", v)
		}
	}
	if q.Step < minHistoryStep {
		q.Step = minHistoryStep
	}

	if v := c.Query("page"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			q.Page = p
		}
	}
	if v := c.Query("page_size"); v != "" {
		if ps, err := strconv.Atoi(v); err == nil && ps > 0 {
			q.PageSize = ps
			if q.PageSize > maxHistoryPageSize {
				q.PageSize = maxHistoryPageSize
			}
		}
	}

	return q, nil
}

// fetchAlertHistory 拉取 ALERTS 时间序列、重建区间并过滤。
func fetchAlertHistory(ctx context.Context, db *gorm.DB, client *http.Client, promURL *url.URL, q alertHistoryQuery) ([]AlertHistoryItem, error) {
	matrix, err := queryRangeAlerts(ctx, client, promURL, q)
	if err != nil {
		return nil, err
	}

	summaryMap, err := fetchRulesAnnotations(ctx, client, promURL)
	if err != nil {
		// summary 获取失败降级为空，不阻塞历史列表。
		summaryMap = map[string]string{}
	}

	// 决策 70：一次性收集 resource_id 批量回连 M01（每类资源表一条 IN 查询，禁 N+1）。
	// 回连失败降级为空 map，实例字段走标签回落链，不阻塞历史列表。
	ids := make([]string, 0, len(matrix))
	for i := range matrix {
		ids = append(ids, matrix[i].Metric["resource_id"])
	}
	identities := ResolveResourceIdentitiesSafe(db, ids)

	items := rebuildIntervals(matrix, q, summaryMap, identities)

	// 本地过滤（MVP 单租户语义；未来可改为 PromQL matcher 注入）。
	filtered := make([]AlertHistoryItem, 0, len(items))
	for _, it := range items {
		if q.NetworkDomain != "" && it.NetworkDomain != q.NetworkDomain {
			continue
		}
		if q.Alertname != "" && !strings.Contains(it.Alertname, q.Alertname) {
			continue
		}
		if q.Instance != "" && !historyInstanceMatch(it, q.Instance) {
			continue
		}
		if q.State != "all" && it.State != q.State {
			continue
		}
		filtered = append(filtered, it)
	}

	// 按触发时间倒序，稳定排序。
	sort.SliceStable(filtered, func(i, j int) bool {
		return filtered[i].FiredAt > filtered[j].FiredAt
	})
	return filtered, nil
}

// promMatrixSample 是 query_range matrix 单条样本。
type promMatrixSample struct {
	Metric map[string]string `json:"metric"`
	Values [][2]interface{}  `json:"values"`
}

// queryRangeAlerts 调用 Prometheus query_range 获取 ALERTS{alertstate="firing"} matrix。
func queryRangeAlerts(ctx context.Context, client *http.Client, promURL *url.URL, q alertHistoryQuery) ([]promMatrixSample, error) {
	u := *promURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/query_range"

	query := fmt.Sprintf(`%s{%s="%s"}`, alertsHistoryMetric, alertsHistoryStateLabel, alertsHistoryStateFiring)
	params := url.Values{}
	params.Set("query", query)
	params.Set("start", strconv.FormatInt(q.Start.Unix(), 10))
	params.Set("end", strconv.FormatInt(q.End.Unix(), 10))
	params.Set("step", fmt.Sprintf("%d", int(q.Step.Seconds())))
	u.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build prometheus query_range request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch prometheus query_range: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch prometheus query_range: unexpected status %d", resp.StatusCode)
	}

	var envelope struct {
		Status string `json:"status"`
		Error  string `json:"error"`
		Data   struct {
			ResultType string             `json:"resultType"`
			Result     []promMatrixSample `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode prometheus query_range: %w", err)
	}
	if envelope.Status != "success" {
		return nil, fmt.Errorf("prometheus query_range status: %q: %s", envelope.Status, envelope.Error)
	}
	if envelope.Data.Result == nil {
		return []promMatrixSample{}, nil
	}
	return envelope.Data.Result, nil
}

// rebuildIntervals 将 matrix 样本按 series 重建为触发/恢复区间。
func rebuildIntervals(matrix []promMatrixSample, q alertHistoryQuery, summaryMap map[string]string, identities map[string]ResourceIdentity) []AlertHistoryItem {
	gapThreshold := int64(2 * q.Step.Seconds())
	endUnix := q.End.Unix()

	items := make([]AlertHistoryItem, 0)
	for _, series := range matrix {
		if len(series.Values) == 0 {
			continue
		}
		// 网域归属在 buildHistoryItem 内统一解析（models.ResolveNetworkDomain，
		// network_domain → network_domain_id → default）。
		labels := series.Metric

		// 连续样本合成区间：间隔超过 2×step 视为中断。
		var intervalStart int64
		var intervalEnd int64
		var hasInterval bool
		for i, v := range series.Values {
			ts, ok := v[0].(float64)
			if !ok {
				continue
			}
			if !hasInterval {
				intervalStart = int64(ts)
				intervalEnd = int64(ts)
				hasInterval = true
				continue
			}
			if int64(ts)-intervalEnd > gapThreshold {
				items = append(items, buildHistoryItem(labels, intervalStart, intervalEnd, endUnix, q.Step, summaryMap, identities))
				intervalStart = int64(ts)
				intervalEnd = int64(ts)
			} else {
				intervalEnd = int64(ts)
			}
			// 最后一条样本结束后闭合区间。
			if i == len(series.Values)-1 {
				items = append(items, buildHistoryItem(labels, intervalStart, intervalEnd, endUnix, q.Step, summaryMap, identities))
			}
		}
	}
	return items
}

// buildHistoryItem 将单个触发区间转换为 AlertHistoryItem。
func buildHistoryItem(labels map[string]string, startUnix, endUnix, queryEndUnix int64, step time.Duration, summaryMap map[string]string, identities map[string]ResourceIdentity) AlertHistoryItem {
	domain := models.ResolveNetworkDomain(labels)
	alertname := labels["alertname"]
	instance := labels["instance"]

	firedAt := time.Unix(startUnix, 0).UTC()
	lastSample := time.Unix(endUnix, 0).UTC()

	// 如果区间最后一个样本在查询窗口末尾附近（<= step），认为告警仍在触发；否则已恢复。
	// PRD：state=firing 当查询窗口结束时仍在触发；resolved_at 为最后一个 firing 样本 + step。
	state := "resolved"
	var resolvedAt *string
	duration := (endUnix - startUnix) + int64(step.Seconds())
	if queryEndUnix-endUnix <= int64(step.Seconds()) {
		state = "firing"
		duration = queryEndUnix - startUnix
	} else {
		rt := lastSample.Add(step).Format(time.RFC3339)
		resolvedAt = &rt
	}

	summary := summaryMap[alertname]
	if summary == "" {
		summary = labels["summary"]
	}

	return AlertHistoryItem{
		Alertname:       alertname,
		Instance:        instance,
		NetworkDomain:   domain,
		State:           state,
		FiredAt:         firedAt.Format(time.RFC3339),
		ResolvedAt:      resolvedAt,
		DurationSeconds: math.Max(0, float64(duration)),
		Summary:         summary,
		Value:           "1",
		InstanceFields:  InstanceFieldsOf(labels, identities),
	}
}

// historyInstanceMatch 判定历史告警是否命中「实例」筛选（v1.15 决策 70）：
// 同时匹配采集地址（instance_address，含原 instance 字段）与 M01 实例名
// （resource_name），任一命中即保留——否则「实例」列拆两列后，用户看到 `ceshi`
// 却按 `ceshi` 搜不到。
func historyInstanceMatch(it AlertHistoryItem, keyword string) bool {
	return strings.Contains(it.InstanceAddress, keyword) ||
		strings.Contains(it.Instance, keyword) ||
		strings.Contains(it.ResourceName, keyword)
}

// rulesAPIResponse 是 Prometheus /api/v1/rules 响应的精简结构。
type rulesAPIResponse struct {
	Status string `json:"status"`
	Data   struct {
		Groups []struct {
			Rules []struct {
				Name        string            `json:"name"`
				Annotations map[string]string `json:"annotations"`
			} `json:"rules"`
		} `json:"groups"`
	} `json:"data"`
}

// fetchRulesAnnotations 从 Prometheus /api/v1/rules 获取 alertname → summary 映射，
// 用于回填历史告警摘要（ALERTS 序列本身不含 annotations）。
func fetchRulesAnnotations(ctx context.Context, client *http.Client, promURL *url.URL) (map[string]string, error) {
	u := *promURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/rules"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build prometheus rules request: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch prometheus rules: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch prometheus rules: unexpected status %d", resp.StatusCode)
	}

	var envelope rulesAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode prometheus rules: %w", err)
	}
	if envelope.Status != "success" {
		return nil, fmt.Errorf("prometheus rules status: %s", envelope.Status)
	}

	m := make(map[string]string)
	for _, g := range envelope.Data.Groups {
		for _, r := range g.Rules {
			if r.Name != "" && r.Annotations["summary"] != "" {
				m[r.Name] = r.Annotations["summary"]
			}
		}
	}
	return m, nil
}

// paginateHistory 对历史告警做内存分页。
func paginateHistory(items []AlertHistoryItem, page, pageSize int) ([]AlertHistoryItem, int) {
	total := len(items)
	if total == 0 {
		return []AlertHistoryItem{}, 0
	}
	start := (page - 1) * pageSize
	if start >= total {
		return []AlertHistoryItem{}, total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return items[start:end], total
}
