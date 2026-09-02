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

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 三态 monitor_state 枚举（决策 47-3 / 契约快照 §2.2.1）。
const (
	StateCollecting   = "collecting"    // 采集中：被选中且 target up
	StatePendingDown  = "pending_down"  // 已下发未采到：被选中但 down/unknown/无 up 样本
	StateNotMonitored = "not_monitored" // 未监控：未被任何 ready+enabled Job 选中
)

// 分页常量（契约快照 §2.2）：默认 1/500，上限 1000。
const (
	defaultCoveragePage     = 1
	defaultCoveragePageSize = 500
	maxCoveragePageSize     = 1000
)

// CoverageItem 是 /api/v1/health/coverage 的单个 item（契约快照 §2.2.1）。
type CoverageItem struct {
	ResourceID       string  `json:"resource_id"`
	ResourceCategory string  `json:"resource_category"`
	InstanceName     string  `json:"instance_name"`
	MonitorState     string  `json:"monitor_state"`
	Health           *string `json:"health"` // up/down/unknown；未监控时为 null
	LastError        string  `json:"last_error"`
}

// CoverageSummary 是覆盖率汇总（契约快照 §2.2.2）。
type CoverageSummary struct {
	Total        int     `json:"total"`
	Collecting   int     `json:"collecting"`
	PendingDown  int     `json:"pending_down"`
	NotMonitored int     `json:"not_monitored"`
	CoverageRate float64 `json:"coverage_rate"`
}

// coverageResource 是跨五类资源表统一归一化的最小行视图（供三态聚合）。
type coverageResource struct {
	ResourceID       string
	Category         models.ResourceCategory
	InstanceName     string
}

// upAggregation 汇总 Prometheus `up` 聚合结果：any == 存在任意 up 样本；up ==
// 存在值恰为 1 的样本。均按 resource_id 稳定标签 key。
type upAggregation struct {
	any map[string]bool
	up  map[string]bool
}

// CoverageHandler 是 GET /api/v1/health/coverage 的 handler（决策 47-3 提前 MVP）。
//
// 三态判定（不感知 M09 下发时序，Plan A）：
//   - resource_id ∈ 任一 ready+enabled Job 的 selected_instance_ids 且 up == 1 → collecting；
//   - ∈ 且 down / unknown / 无 up 样本（待首抓）→ pending_down；
//   - ∉ 任何 Job → not_monitored；
//
// 数据源（一次拉取聚合，禁止 per-resource N+1）：
//   - DB：五类资源表（network_domain / resource_category 过滤）+ ScrapeJob 选中关系；
//   - Prometheus：`up` 按 resource_id 聚合 + targets 的 lastError（尽力而为）。
//
// 支持 state 过滤 + page/page_size（默认 1/500，上限 1000）。summary 与 total 在
// 过滤后、分页前统计。
func CoverageHandler(db *gorm.DB, promURL *url.URL, client *http.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		netDomain := strings.TrimSpace(c.Query("network_domain"))
		category := strings.TrimSpace(c.Query("resource_category"))
		state := strings.TrimSpace(c.Query("state"))

		if category != "" && !validCategory(models.ResourceCategory(category)) {
			response.BadRequest(c, fmt.Errorf("resource_category 非法：%q，可选 %s",
				category, strings.Join(categoryList(), "/")))
			return
		}

		resources, err := loadResources(db, netDomain, category)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		// 一次性拉取：选中关系（DB）+ up 聚合（Prometheus）+ lastError（尽力而为）。
		selected := loadSelectedInstances(db)
		upState, err := fetchUpAgg(c.Request.Context(), client, promURL)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		lastErrors := fetchLastErrors(c.Request.Context(), client, promURL)

		items := buildCoverageItems(resources, selected, upState, lastErrors)

		if state != "" {
			filtered := items[:0]
			for _, it := range items {
				if it.MonitorState == state {
					filtered = append(filtered, it)
				}
			}
			items = filtered
		}

		sort.Slice(items, func(i, j int) bool { return items[i].ResourceID < items[j].ResourceID })

		summary := summarize(items)
		total := len(items)

		page, pageSize := parseCoveragePage(c)
		start := (page - 1) * pageSize
		if start > len(items) {
			start = len(items)
		}
		end := start + pageSize
		if end > len(items) {
			end = len(items)
		}
		pageItems := items[start:end]

		response.OK(c, gin.H{
			"items":   pageItems,
			"total":   total,
			"summary": summary,
		})
	}
}

// loadResources 枚举五类资源表（可按 network_domain / resource_category 过滤），
// 返回归一化的资源行。network_domain 与 resource_category 均在 DB 层筛选。
func loadResources(db *gorm.DB, netDomain, category string) ([]coverageResource, error) {
	cats := validCategories()
	if category != "" {
		cats = []models.ResourceCategory{models.ResourceCategory(category)}
	}

	var out []coverageResource
	for _, cat := range cats {
		rows, err := queryCategoryResources(db, cat, netDomain)
		if err != nil {
			return nil, err
		}
		out = append(out, rows...)
	}
	return out, nil
}

// queryCategoryResources 查询某类资源表，归一化为 coverageResource。
func queryCategoryResources(db *gorm.DB, cat models.ResourceCategory, netDomain string) ([]coverageResource, error) {
	applyDomain := func(q *gorm.DB) *gorm.DB {
		if netDomain != "" {
			return q.Where("network_domain_id = ?", netDomain)
		}
		return q
	}

	switch cat {
	case models.ResourceCategoryHost:
		var rows []models.Host
		if err := applyDomain(db.Model(&models.Host{})).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list host resources: %w", err)
		}
		out := make([]coverageResource, 0, len(rows))
		for i := range rows {
			out = append(out, coverageResource{rows[i].ResourceID, cat, rows[i].InstanceName})
		}
		return out, nil
	case models.ResourceCategoryDatabase:
		var rows []models.Database
		if err := applyDomain(db.Model(&models.Database{})).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list database resources: %w", err)
		}
		out := make([]coverageResource, 0, len(rows))
		for i := range rows {
			out = append(out, coverageResource{rows[i].ResourceID, cat, instanceIPPort(rows[i].InstanceIP, rows[i].Port)})
		}
		return out, nil
	case models.ResourceCategoryMiddleware:
		var rows []models.Middleware
		if err := applyDomain(db.Model(&models.Middleware{})).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list middleware resources: %w", err)
		}
		out := make([]coverageResource, 0, len(rows))
		for i := range rows {
			out = append(out, coverageResource{rows[i].ResourceID, cat, instanceIPPort(rows[i].InstanceIP, rows[i].Port)})
		}
		return out, nil
	case models.ResourceCategoryApplication:
		var rows []models.Application
		if err := applyDomain(db.Model(&models.Application{})).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list application resources: %w", err)
		}
		out := make([]coverageResource, 0, len(rows))
		for i := range rows {
			out = append(out, coverageResource{rows[i].ResourceID, cat, rows[i].ServiceName})
		}
		return out, nil
	case models.ResourceCategoryGenericTarget:
		var rows []models.GenericTarget
		if err := applyDomain(db.Model(&models.GenericTarget{})).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list generic_target resources: %w", err)
		}
		out := make([]coverageResource, 0, len(rows))
		for i := range rows {
			out = append(out, coverageResource{rows[i].ResourceID, cat, rows[i].TargetName})
		}
		return out, nil
	}
	return nil, fmt.Errorf("unsupported resource_category: %s", cat)
}

// loadSelectedInstances 只读消费 M01 选中关系：聚合所有 ready+enabled Job 的
// selected_instance_ids，不反向修改 M01（契约快照 §2.2.1）。
func loadSelectedInstances(db *gorm.DB) map[string]bool {
	sel := map[string]bool{}
	var jobs []models.ScrapeJob
	if err := db.Where("draft_status = ? AND enabled = ?", "ready", true).Find(&jobs).Error; err != nil {
		return sel
	}
	for _, j := range jobs {
		for _, id := range j.SelectedInstanceIDs {
			if id != "" {
				sel[id] = true
			}
		}
	}
	return sel
}

// fetchUpAgg 拉取 Prometheus `up` 并按 resource_id 稳定标签聚合三态依据。
// 一次查询返回全量 series，O(1) 查表，不逐资源查询（TQ-6 反 N+1）。
func fetchUpAgg(ctx context.Context, client *http.Client, promURL *url.URL) (*upAggregation, error) {
	agg := &upAggregation{any: map[string]bool{}, up: map[string]bool{}}

	series, err := queryInstantVector(ctx, client, promURL, "up")
	if err != nil {
		return nil, err
	}
	for _, s := range series {
		rid := s.Metric["resource_id"]
		if rid == "" {
			continue
		}
		agg.any[rid] = true
		if s.Value == 1 {
			agg.up[rid] = true
		}
	}
	return agg, nil
}

// fetchLastErrors 拉取 targets 的 lastError 按 resource_id 建索引（rem_probe 优先级
// 概念：同资源多 target 取首个非空）。此数据为尽力而为——上游不可达时忽略（返回空
// map），不阻断 coverage 主链路。
func fetchLastErrors(ctx context.Context, client *http.Client, promURL *url.URL) map[string]string {
	last := map[string]string{}
	data, err := fetchTargets(ctx, client, promURL, "active")
	if err != nil {
		return last
	}
	for _, t := range data.ActiveTargets {
		rid := resolveLabel(t, "resource_id")
		if rid == "" {
			continue
		}
		le := asString(t["lastError"])
		if le == "" {
			continue
		}
		if _, ok := last[rid]; !ok {
			last[rid] = le
		}
	}
	return last
}

// buildCoverageItems 按三态判定规则构造 item 列表。
func buildCoverageItems(resources []coverageResource, selected map[string]bool, upState *upAggregation, lastErrors map[string]string) []CoverageItem {
	items := make([]CoverageItem, 0, len(resources))
	for _, r := range resources {
		item := CoverageItem{
			ResourceID:       r.ResourceID,
			ResourceCategory: string(r.Category),
			InstanceName:     r.InstanceName,
		}
		if selected[r.ResourceID] {
			if upState.up[r.ResourceID] {
				item.MonitorState = StateCollecting
				h := HealthUp
				item.Health = &h
			} else {
				item.MonitorState = StatePendingDown
				h := HealthDown
				if !upState.any[r.ResourceID] {
					h = HealthUnknown // 无 up 样本：待首抓 / 未生效
				}
				item.Health = &h
				item.LastError = lastErrors[r.ResourceID]
			}
		} else {
			item.MonitorState = StateNotMonitored
			item.Health = nil
		}
		items = append(items, item)
	}
	return items
}

// summarize 统计 filtered 资源的覆盖率汇总（coverage_rate 保留 2 位小数，无资源时 0）。
func summarize(items []CoverageItem) CoverageSummary {
	s := CoverageSummary{}
	for _, it := range items {
		s.Total++
		switch it.MonitorState {
		case StateCollecting:
			s.Collecting++
		case StatePendingDown:
			s.PendingDown++
		default:
			s.NotMonitored++
		}
	}
	if s.Total > 0 {
		s.CoverageRate = math.Round(float64(s.Collecting)/float64(s.Total)*100) / 100
	}
	return s
}

// parseCoveragePage 解析分页参数：page 默认 1、page_size 默认 500（上限 1000 钳制）。
func parseCoveragePage(c *gin.Context) (int, int) {
	page := parseIntQuery(c.Query("page"), defaultCoveragePage)
	pageSize := parseIntQuery(c.Query("page_size"), defaultCoveragePageSize)
	if pageSize > maxCoveragePageSize {
		pageSize = maxCoveragePageSize
	}
	return page, pageSize
}

// promSeries 是 instant vector 查询的单条 series。
type promSeries struct {
	Metric map[string]string
	Value  float64
}

// queryInstantVector 执行 PromQL instant query 并解析 result（resultType=vector）。
func queryInstantVector(ctx context.Context, client *http.Client, promURL *url.URL, expr string) ([]promSeries, error) {
	u := *promURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/query"
	q := u.Query()
	q.Set("query", expr)
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build prometheus query request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch prometheus query %q: %w", expr, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch prometheus query %q: unexpected status %d", expr, resp.StatusCode)
	}

	var envelope struct {
		Status string `json:"status"`
		Data   struct {
			ResultType string `json:"resultType"`
			Result     []struct {
				Metric map[string]string `json:"metric"`
				Value  []interface{}     `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("decode prometheus query %q: %w", expr, err)
	}
	if envelope.Status != "success" {
		return nil, fmt.Errorf("prometheus query %q status: %q", expr, envelope.Status)
	}
	if envelope.Data.ResultType != "vector" {
		return nil, fmt.Errorf("prometheus query %q resultType: %q (want vector)", expr, envelope.Data.ResultType)
	}

	out := make([]promSeries, 0, len(envelope.Data.Result))
	for _, r := range envelope.Data.Result {
		if len(r.Value) < 2 {
			continue
		}
		f, err := strconv.ParseFloat(fmt.Sprintf("%v", r.Value[1]), 64)
		if err != nil {
			continue
		}
		out = append(out, promSeries{Metric: r.Metric, Value: f})
	}
	return out, nil
}

// parseIntQuery 解析整型 query 参数：空/非法/<min 回退默认。
func parseIntQuery(raw string, def int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return def
	}
	return v
}

// validCategories 返回五类资源权威枚举（与 models.ValidResourceCategories 对齐）。
func validCategories() []models.ResourceCategory {
	return models.ValidResourceCategories()
}

// categoryList 返回五类字符串列表（用于错误提示）。
func categoryList() []string {
	cs := validCategories()
	out := make([]string, 0, len(cs))
	for _, c := range cs {
		out = append(out, string(c))
	}
	return out
}

// validCategory 判断是否为五类权威枚举之一。
func validCategory(c models.ResourceCategory) bool {
	for _, v := range validCategories() {
		if v == c {
			return true
		}
	}
	return false
}

// instanceIPPort 生成「ip:port」显示，port 为 0 时仅返回 ip。
func instanceIPPort(ip string, port int) string {
	if port == 0 {
		return ip
	}
	return fmt.Sprintf("%s:%d", ip, port)
}