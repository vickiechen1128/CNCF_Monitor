package history

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/query"
	"gorm.io/gorm"
)

// Service 是历史告警模块的依赖容器：handler 只依赖 Service，不直接持有 *gorm.DB
// （后端架构红线 R1）。
type Service struct {
	db *gorm.DB
}

// NewService 创建历史告警服务。
func NewService(db *gorm.DB) *Service { return &Service{db: db} }

// RegisterWebhookRoutes 挂载 Alertmanager 历史留痕入口（全局用户认证已对
// /api/v1/webhooks/ 前缀豁免，调用方为中心 Alertmanager，访问控制由部署层承担）。
func RegisterWebhookRoutes(v1 *gin.RouterGroup, db *gorm.DB) {
	v1.POST("/webhooks/alerts", WebhookHandler(NewService(db)))
}

// WebhookHandler 处理 POST /api/v1/webhooks/alerts。
//
// 对 Alertmanager **永远 2xx**：解码失败 / 落库失败只记日志并返回 200，
// 避免 AM 对毒消息无限重试（参考实现 §6 / §8）。
func WebhookHandler(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxWebhookBodyBytes+1))
		if err != nil {
			log.Printf("[alert-history] webhook read body failed: %v", err)
			c.Status(http.StatusOK)
			return
		}
		if len(body) > maxWebhookBodyBytes {
			log.Printf("[alert-history] webhook body too large (%d bytes), dropped", len(body))
			c.Status(http.StatusOK)
			return
		}
		var p Payload
		if err := json.Unmarshal(body, &p); err != nil {
			log.Printf("[alert-history] webhook decode failed: %v", err)
			c.Status(http.StatusOK)
			return
		}
		if svc == nil || svc.db == nil {
			log.Printf("[alert-history] webhook ignored: db is nil")
			c.Status(http.StatusOK)
			return
		}
		res := Ingest(svc.db, p, time.Now().UTC())
		log.Printf("[alert-history] webhook group_key=%q receiver=%q received=%d inserted=%d updated=%d skipped=%d failed=%d",
			p.GroupKey, p.Receiver, res.Received, res.Inserted, res.Updated, res.Skipped, res.Failed)
		c.Status(http.StatusOK)
	}
}

// Config 是查询 / 统计的运行时配置。
type Config struct {
	// Location 是「当日 / 近 7 天」的日界计算时区；nil 时使用东八区固定偏移。
	Location *time.Location
}

// RegisterManagementRoutes 挂载历史告警查询接口到 /api/v2/platform/alertmanager/*。
//   - GET /alert-events        服务端分页查询
//   - GET /alert-events/stats  首页统计（当日 / 近 7 天 / 通知中 / 静默 · 抑制）
func RegisterManagementRoutes(platform *gin.RouterGroup, db *gorm.DB, cfg Config) {
	svc := NewService(db)
	am := platform.Group("/alertmanager")
	am.GET("/alert-events", ListEventsHandler(svc))
	am.GET("/alert-events/stats", StatsHandler(svc, cfg))
}

// ListEventsHandler 处理 GET /api/v2/platform/alertmanager/alert-events。
func ListEventsHandler(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		q, err := parseListQuery(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		views, total, err := ListEvents(svc.db, q)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{
			"list":      views,
			"total":     total,
			"page":      q.Page,
			"page_size": q.PageSize,
		})
	}
}

// StatsHandler 处理 GET /api/v2/platform/alertmanager/alert-events/stats。
func StatsHandler(svc *Service, cfg Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		loc := cfg.Location
		if loc == nil {
			loc = defaultStatsLocation()
		}
		stats, err := ComputeStats(svc.db, time.Now().In(loc), loc)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, stats)
	}
}

// ListQuery 是历史告警查询参数。
type ListQuery struct {
	Page          int
	PageSize      int
	Status        models.AlertEventStatus
	Severity      string
	AlertName     string
	Summary       string
	Description   string
	NetworkDomain string
	StartsFrom    *time.Time
	StartsTo      *time.Time
	EndsFrom      *time.Time
	EndsTo        *time.Time
	Sort          string // starts_at asc / starts_at desc
}

// EventView 是历史告警列表项（含 M01 实例字段回连）。
type EventView struct {
	ID            uint                    `json:"id"`
	AlertName     string                  `json:"alert_name"`
	Status        models.AlertEventStatus `json:"status"`
	Severity      string                  `json:"severity,omitempty"`
	Summary       string                  `json:"summary,omitempty"`
	Description   string                  `json:"description,omitempty"`
	NetworkDomain string                  `json:"network_domain,omitempty"`
	StartsAt      *time.Time              `json:"starts_at,omitempty"`
	EndsAt        *time.Time              `json:"ends_at,omitempty"`
	ClosedAt      *time.Time              `json:"closed_at,omitempty"`
	UpdatedAt     time.Time               `json:"updated_at"`
	// DurationSeconds 仅终态已恢复有值（真实时长）；未恢复 / 恢复时间未知保持 null。
	DurationSeconds *int64            `json:"duration_seconds,omitempty"`
	Fingerprint     string            `json:"fingerprint,omitempty"`
	Labels          map[string]string `json:"labels,omitempty"`
	Annotations     map[string]string `json:"annotations,omitempty"`
	// InstanceFields 是实例展示字段组（M01 资源回连，与告警列表同口径）。
	query.InstanceFields
}

// ListEvents 服务端分页查询历史告警，并按 resource_id 回连 M01 补实例字段。
func ListEvents(db *gorm.DB, q ListQuery) ([]EventView, int64, error) {
	base := db.Model(&models.AlertEvent{})

	if q.Status != "" {
		if !models.IsValidAlertEventStatus(q.Status) {
			return nil, 0, fmt.Errorf("invalid status %q", q.Status)
		}
		base = base.Where("status = ?", q.Status)
	}
	if q.Severity != "" {
		base = base.Where("severity = ?", q.Severity)
	}
	if q.AlertName != "" {
		base = base.Where("alert_name LIKE ?", "%"+q.AlertName+"%")
	}
	if q.Summary != "" {
		base = base.Where("summary LIKE ?", "%"+q.Summary+"%")
	}
	if q.Description != "" {
		base = base.Where("description LIKE ?", "%"+q.Description+"%")
	}
	if q.NetworkDomain != "" {
		base = base.Where("network_domain = ?", q.NetworkDomain)
	}
	// 时间筛选边界统一转 UTC+8：表内存的是带偏移文本，边界偏移不同会让 SQLite
	// 按字符串比较时错位（前端 DatePicker 通常传 Z / UTC）。
	if q.StartsFrom != nil {
		base = base.Where("starts_at >= ?", models.NormalizeAlertEventTime(*q.StartsFrom))
	}
	if q.StartsTo != nil {
		base = base.Where("starts_at <= ?", models.NormalizeAlertEventTime(*q.StartsTo))
	}
	if q.EndsFrom != nil {
		base = base.Where("ends_at >= ?", models.NormalizeAlertEventTime(*q.EndsFrom))
	}
	if q.EndsTo != nil {
		base = base.Where("ends_at <= ?", models.NormalizeAlertEventTime(*q.EndsTo))
	}

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count alert events: %w", err)
	}

	order := "starts_at DESC, id DESC"
	if q.Sort == "starts_at asc" {
		order = "starts_at ASC, id ASC"
	}
	var rows []models.AlertEvent
	if err := base.Order(order).
		Offset((q.Page - 1) * q.PageSize).Limit(q.PageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list alert events: %w", err)
	}
	if len(rows) == 0 {
		return []EventView{}, total, nil
	}

	views := make([]EventView, 0, len(rows))
	ids := make([]string, 0, len(rows))
	labelsByID := make([]map[string]string, len(rows))
	for i := range rows {
		labels := decodeStringMap(rows[i].Labels)
		labelsByID[i] = labels
		ids = append(ids, labels["resource_id"])
	}
	identities := query.ResolveResourceIdentitiesSafe(db, ids)

	for i := range rows {
		labels := labelsByID[i]
		view := EventView{
			ID:            rows[i].ID,
			AlertName:     rows[i].AlertName,
			Status:        rows[i].Status,
			Severity:      rows[i].Severity,
			Summary:       rows[i].Summary,
			Description:   rows[i].Description,
			NetworkDomain: rows[i].NetworkDomain,
			StartsAt:      rows[i].StartsAt,
			EndsAt:        rows[i].EndsAt,
			ClosedAt:      rows[i].ClosedAt,
			UpdatedAt:     rows[i].UpdatedAt,
			Fingerprint:   rows[i].Fingerprint,
			Labels:        labels,
			Annotations:   decodeStringMap(rows[i].Annotations),
		}
		if rows[i].StartsAt != nil && rows[i].EndsAt != nil {
			d := int64(rows[i].EndsAt.Sub(*rows[i].StartsAt).Seconds())
			if d < 0 {
				d = 0
			}
			view.DurationSeconds = &d
		}
		view.InstanceFields = query.InstanceFieldsOf(labels, identities)
		views = append(views, view)
	}
	return views, total, nil
}

// Stats 是首页告警卡统计口径（全部来自同一张事件表，避免多数据源打架）。
//
// 四指标（2026-10-26 用户确认，对齐 MonitorStack 历史告警口径）：
//   - 今日告警：starts_at 落在今天自然日内的发生数（严格按开始时间，不含昨天开始今天仍在持续的）；
//   - 今日恢复：starts_at 与 closed_at 均落在今天的终态数（真实恢复 + 恢复时间未知）；
//   - 历史遗留告警：当前仍未结束、且 starts_at 早于今天 0 点的积压快照；
//   - 历史遗留今日恢复：starts_at 早于今天 0 点、closed_at 落在今天的终态数。
//
// 所有时间边界先转 UTC+8（与表内存储时区一致）再进 SQL，
// 避免 SQLite 文本比较因偏移量不同而错位。
type Stats struct {
	TodayTotal int64 `json:"today_total"`

	TodayResolvedTotal    int64 `json:"today_resolved_total"`
	TodayResolvedReal     int64 `json:"today_resolved_real"`
	TodayResolvedInferred int64 `json:"today_resolved_inferred"`

	LegacyOpenTotal     int64 `json:"legacy_open_total"`
	LegacyOpenFiring    int64 `json:"legacy_open_firing"`
	LegacyOpenSilenced  int64 `json:"legacy_open_silenced"`
	LegacyOpenInhibited int64 `json:"legacy_open_inhibited"`

	LegacyResolvedTodayTotal    int64 `json:"legacy_resolved_today_total"`
	LegacyResolvedTodayReal     int64 `json:"legacy_resolved_today_real"`
	LegacyResolvedTodayInferred int64 `json:"legacy_resolved_today_inferred"`
}

// ComputeStats 计算首页统计。now 应已按 loc 表示。
func ComputeStats(db *gorm.DB, now time.Time, loc *time.Location) (Stats, error) {
	var st Stats
	if loc == nil {
		loc = defaultStatsLocation()
	}
	local := now.In(loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	tomorrowStart := dayStart.AddDate(0, 0, 1)

	// SQLite 存的是带偏移量的文本，边界与存量必须同为 UTC+8 才能正确比较。
	d0 := models.NormalizeAlertEventTime(dayStart)
	d1 := models.NormalizeAlertEventTime(tomorrowStart)

	open := models.AlertEventOpenStatuses
	terminal := models.AlertEventTerminalStatuses
	inferred := models.AlertEventInferredTerminalStatuses

	base := func() *gorm.DB { return db.Model(&models.AlertEvent{}) }
	count := func(dest *int64, q *gorm.DB) error {
		return q.Count(dest).Error
	}

	queries := []struct {
		dest *int64
		q    *gorm.DB
	}{
		// 今日告警：严格按开始时间落在今天自然日内。
		{&st.TodayTotal, base().Where("starts_at >= ? AND starts_at < ?", d0, d1)},
		// 今日恢复：开始时间和关闭时间都落在今天，历史告警今天恢复只计入历史遗留指标。
		{&st.TodayResolvedTotal, base().Where("status IN ? AND starts_at >= ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?", terminal, d0, d1, d0, d1)},
		{&st.TodayResolvedReal, base().Where("status = ? AND starts_at >= ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?", models.AlertEventStatusResolved, d0, d1, d0, d1)},
		{&st.TodayResolvedInferred, base().Where("status IN ? AND starts_at >= ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?", inferred, d0, d1, d0, d1)},
		// 历史遗留告警：当前未结、开始时间早于今天 0 点。
		{&st.LegacyOpenTotal, base().Where("status IN ? AND starts_at < ?", open, d0)},
		{&st.LegacyOpenFiring, base().Where("status = ? AND starts_at < ?", models.AlertEventStatusFiring, d0)},
		{&st.LegacyOpenSilenced, base().Where("status = ? AND starts_at < ?", models.AlertEventStatusSilenced, d0)},
		{&st.LegacyOpenInhibited, base().Where("status = ? AND starts_at < ?", models.AlertEventStatusInhibited, d0)},
		// 历史遗留今日恢复：开始时间早于今天 0 点、关闭时间落在今天。
		{&st.LegacyResolvedTodayTotal, base().Where("status IN ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?", terminal, d0, d0, d1)},
		{&st.LegacyResolvedTodayReal, base().Where("status = ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?", models.AlertEventStatusResolved, d0, d0, d1)},
		{&st.LegacyResolvedTodayInferred, base().Where("status IN ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?", inferred, d0, d0, d1)},
	}
	for _, item := range queries {
		if err := count(item.dest, item.q); err != nil {
			return Stats{}, fmt.Errorf("alert event stats: %w", err)
		}
	}
	return st, nil
}

// parseListQuery 解析并校验列表查询参数。
func parseListQuery(c *gin.Context) (ListQuery, error) {
	q := ListQuery{Page: 1, PageSize: 20, Sort: "starts_at desc"}
	if v := c.Query("page"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			q.Page = p
		}
	}
	if v := c.Query("page_size"); v != "" {
		if ps, err := strconv.Atoi(v); err == nil && ps > 0 {
			if ps > 100 {
				ps = 100
			}
			q.PageSize = ps
		}
	}
	q.Status = models.AlertEventStatus(strings.TrimSpace(c.Query("status")))
	if q.Status != "" && !models.IsValidAlertEventStatus(q.Status) {
		return q, fmt.Errorf("invalid status %q", q.Status)
	}
	q.Severity = strings.TrimSpace(c.Query("severity"))
	q.AlertName = strings.TrimSpace(c.Query("alert_name"))
	q.Summary = strings.TrimSpace(c.Query("summary"))
	q.Description = strings.TrimSpace(c.Query("description"))
	q.NetworkDomain = strings.TrimSpace(c.Query("network_domain"))
	if v := strings.TrimSpace(c.Query("sort")); v != "" {
		low := strings.ToLower(v)
		if low != "starts_at asc" && low != "starts_at desc" {
			return q, fmt.Errorf("invalid sort %q (only starts_at asc/desc)", v)
		}
		q.Sort = low
	}

	var err error
	if q.StartsFrom, err = parseTimeQuery(c, "starts_from"); err != nil {
		return q, err
	}
	if q.StartsTo, err = parseTimeQuery(c, "starts_to"); err != nil {
		return q, err
	}
	if q.EndsFrom, err = parseTimeQuery(c, "ends_from"); err != nil {
		return q, err
	}
	if q.EndsTo, err = parseTimeQuery(c, "ends_to"); err != nil {
		return q, err
	}
	return q, nil
}

// parseTimeQuery 解析 RFC3339 时间参数；空值返回 nil。
func parseTimeQuery(c *gin.Context, key string) (*time.Time, error) {
	v := strings.TrimSpace(c.Query(key))
	if v == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return nil, fmt.Errorf("invalid %s %q", key, v)
	}
	return &t, nil
}

// decodeStringMap 解析 JSON 文本为 map；失败返回空 map（不阻塞列表）。
func decodeStringMap(raw string) map[string]string {
	if strings.TrimSpace(raw) == "" {
		return map[string]string{}
	}
	out := map[string]string{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return map[string]string{}
	}
	return out
}

// defaultStatsLocation 是未注入配置时的日界时区（东八区固定偏移，与通知渲染同口径）。
func defaultStatsLocation() *time.Location {
	return time.FixedZone("UTC+8", 8*60*60)
}
