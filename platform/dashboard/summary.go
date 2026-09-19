// Package dashboard 实现 MVP 首页聚合接口 GET /api/v2/platform/dashboard/summary：
// 一次性聚合监控资源数、已监控资源数、采集 Job 数、待确认配置草稿数、最近下发记录
// 与已纳管网域数，避免前端多次调用。数据访问复用既有 models / GORM 查询模式（参考
// platform/config/resource、platform/configcenter/draft、platform/configcenter/deployment），
// 不重复造轮子。
package dashboard

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// recentDeploymentLimit 最近下发记录条数上限。
const recentDeploymentLimit = 5

// scrapeJobDraftReady 采集 Job 可生效的 draft_status 取值（models.ScrapeJob.DraftStatus）。
// 与 platform/query/coverage.go 的「未监控 = 未被任何 ready+enabled Job 选中」判定保持同源。
const scrapeJobDraftReady = "ready"

// resourceModels 返回 M07 五类资源表模型（口径与 platform/query、config/resource 一致）。
func resourceModels() []interface{} {
	return []interface{}{
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	}
}

// DeploymentItem 是 recent_deployments 单条下发记录摘要。
type DeploymentItem struct {
	ID                string     `json:"id"`
	ChangeNo          string     `json:"change_no"`
	NetworkDomainName string     `json:"network_domain_name"`
	Status            string     `json:"status"`
	TriggeredAt       *time.Time `json:"triggered_at"`
}

// ProbeTargetItem 是首页拨测态势面板单条拨测目标明细（决策 93 / M05 PRD v1.8），
// JSON 与原型 mockProbeTargets 对齐：url/status/biz_name/app_name/last_probe_at。
// 遵循「可空不臆造」：异常需实时拨测结果（Prometheus/Alertmanager）判定，本接口当前
// 无法实时拨测，status 只来自真实状态——MVP 阶段无该数据源，故恒为空串（前端显示
// 「未知」）；biz_name/app_name 需推断自 ScrapeJob/挂载维度，BlackboxTarget 无此字段、
// 推断不出则空串（前端显示 '-'）；last_probe_at 取现有最近拨测时间，拿不到则 nil。
// 不硬编 up/down、不编造归属，接口只落确凿数据。
type ProbeTargetItem struct {
	URL         string     `json:"url"`          // 拨测目标展示地址（优先 URL，否则 protocol+target 拼接）
	Status      string     `json:"status"`       // up/down/''（MV0 无实时拨测，恒为 ''）
	BizName     string     `json:"biz_name"`     // 拨测目标归属业务域（无来源时空串）
	AppName     string     `json:"app_name"`     // 归属应用（无来源时空串）
	LastProbeAt *time.Time `json:"last_probe_at"` // 最近一次拨测时间（拿不到时 nil）
}

// probeTargetURL 构造拨测目标展示地址：优先取 BlackboxTarget.URL，否则 protocol+target 拼接；
// 两端均为空则返回空串。
func probeTargetURL(t models.BlackboxTarget) string {
	if u := strings.TrimSpace(t.URL); u != "" {
		return u
	}
	proto := strings.TrimSpace(string(t.Protocol))
	target := strings.TrimSpace(t.Target)
	if proto == "" || target == "" {
		return ""
	}
	return proto + "://" + target
}

// Summary 是首页聚合接口的返回结构。
type Summary struct {
	ResourceCount         int              `json:"resource_count"`           // 监控资源总数（M07 resource）
	MonitoredCount        int              `json:"monitored_count"`          // 已监控资源数（口径见 §3.5：ready+enabled 标准 Job 覆盖去重）
	ScrapeJobCount        int              `json:"scrape_job_count"`         // 采集 Job 总数（M01，未软删）
	ScrapeJobEnabledCount int              `json:"scrape_job_enabled_count"` // 采集 Job 中 enabled=true 数
	PendingDraftCount     int              `json:"pending_draft_count"`      // 待确认配置草稿数（M09，status=pending）
	RecentDeployments     []DeploymentItem `json:"recent_deployments"`       // 最近下发记录（最多 5 条）
	DomainCount           int              `json:"domain_count"`             // 已纳管网域数（is_monitored=true）

	// —— 决策 91（M05 PRD v1.7）：首页分组聚合字段（不变量见各测试）——
	ByCategory                 []CategorySummary `json:"by_category"`                  // 按资源类型分组，5 类固定齐全（缺则补 0 值条目）
	ByApp                      []AppSummary      `json:"by_app"`                       // 按应用分组（app_code 非空的资源）
	UnclassifiedResourceCount  int               `json:"unclassified_resource_count"`  // app_code 为空的资源数
	UnclassifiedMonitoredCount int               `json:"unclassified_monitored_count"` // 其中已被监控数
	ProbeTargetCount           int               `json:"probe_target_count"`           // 拨测目标数（blackbox）
	ProbeTargetAbnormalCount   int               `json:"probe_target_abnormal_count"`  // 拨测异常目标数
	ProbeTargets               []ProbeTargetItem `json:"probe_targets"`                // 拨测目标明细（异常排前由前端按 status 排序，后端不排序）
}

// CategorySummary 单个资源类型（L1 卡）的聚合。不含告警字段——首页未恢复数字由
// 前端按 /api/v1/alerts 分组得到，后端零改动。
type CategorySummary struct {
	ResourceCategory string           `json:"resource_category"` // host/database/middleware/application/generic_target
	ResourceCount    int              `json:"resource_count"`
	MonitoredCount   int              `json:"monitored_count"`
	BySubtype        []SubtypeSummary `json:"by_subtype"` // 采集类型子类明细（application 恒为空数组）
}

// SubtypeSummary 单个采集类型子类的聚合。
type SubtypeSummary struct {
	Subtype        string `json:"subtype"`
	ResourceCount  int    `json:"resource_count"`
	MonitoredCount int    `json:"monitored_count"`
}

// AppSummary 单个应用（L2 行）的资源聚合。
type AppSummary struct {
	AppCode        string `json:"app_code"`
	AppName        string `json:"app_name"` // 应用字典展示名；字典无条目时回落为 app_code
	ResourceCount  int    `json:"resource_count"`
	MonitoredCount int    `json:"monitored_count"`
}

// Build 聚合各模块已有数据生成首页统计概览。
// 复用 models 五类资源表 / ScrapeJob / ConfigDraft / ConfigDeployment / NetworkDomain 的
// GORM 查询（Count/Find/Pluck），软删由 GORM 自动排除；错误沿用 fmt.Errorf("...: %w")。
func Build(db *gorm.DB) (*Summary, error) {
	s := &Summary{
		RecentDeployments: []DeploymentItem{},
		ByCategory:        []CategorySummary{},
		ByApp:             []AppSummary{},
		ProbeTargets:      []ProbeTargetItem{},
	}

	// 0. 被 ready+enabled 标准 Job 选中的 resource_id 集合（复用于 monitored 判定，
	//    不另造口径）。blackbox 拨测目标不在其中（见 loadSelectedResourceIDs 注释）。
	selected, err := loadSelectedResourceIDs(db)
	if err != nil {
		return nil, err
	}

	// 1. 逐类加载五类资源，累计 resource_count / 现存 resource_id 集合，并就地聚合
	//    by_category / by_app。软删由 GORM 自动排除。
	//    resourceIDs 供下面与 selected 求交集（资源软删后不应计入 monitored_count）。
	resourceIDs := make(map[string]bool)
	cats := make(map[models.ResourceCategory]*categoryAgg)
	apps := make(map[string]*appAgg)
	var unclassifiedResourceCount, unclassifiedMonitoredCount int

	for i, m := range resourceModels() {
		cat := models.ValidResourceCategories()[i]
		rows, err := loadResourceRows(db, m)
		if err != nil {
			return nil, err
		}
		// application 不设子类（不按语言/框架拆），subtypeField 返回 ""。
		subtypeField := subtypeFieldForCategory(cat)
		for _, res := range rows {
			id := res.GetResourceID()
			if id == "" {
				continue
			}
			resourceIDs[id] = true
			s.ResourceCount++

			monitored := selected[id]
			accumulateResource(cats, apps, cat, subtypeField, res, monitored,
				&unclassifiedResourceCount, &unclassifiedMonitoredCount)
		}
	}

	// 2. monitored_count：selected ∩ 现存资源（resourceIDs）。
	//    口径见 docs/05-execution-records/module-05/design-proposals/
	//    homepage-mvp-content-restructure.md §3.5；与 platform/query/coverage.go 的
	//    「未监控」补集同源，故 monitored_count ≤ resource_count。
	for id := range selected {
		if resourceIDs[id] {
			s.MonitoredCount++
		}
	}

	// 3. scrape_job_count / scrape_job_enabled_count：未软删采集 Job 总数与其中启用数。
	var jobCount int64
	if err := db.Model(&models.ScrapeJob{}).Count(&jobCount).Error; err != nil {
		return nil, fmt.Errorf("count scrape jobs: %w", err)
	}
	s.ScrapeJobCount = int(jobCount)

	var enabledJobCount int64
	if err := db.Model(&models.ScrapeJob{}).Where("enabled = ?", true).Count(&enabledJobCount).Error; err != nil {
		return nil, fmt.Errorf("count enabled scrape jobs: %w", err)
	}
	s.ScrapeJobEnabledCount = int(enabledJobCount)

	// 4. pending_draft_count：status=pending 的配置草稿数。
	var pendingDrafts int64
	if err := db.Model(&models.ConfigDraft{}).
		Where("status = ?", models.DraftStatusPending).
		Count(&pendingDrafts).Error; err != nil {
		return nil, fmt.Errorf("count pending config drafts: %w", err)
	}
	s.PendingDraftCount = int(pendingDrafts)

	// 5. recent_deployments：最近 5 条下发记录，LEFT JOIN 网域表取网域名。
	var rows []struct {
		models.ConfigDeployment
		NetworkDomainName string `gorm:"column:network_domain_name"`
	}
	if err := db.Model(&models.ConfigDeployment{}).
		Select("config_deployments.*, network_domains.name AS network_domain_name").
		Joins("LEFT JOIN network_domains ON network_domains.id = config_deployments.network_domain_id").
		Order("config_deployments.created_at DESC").
		Limit(recentDeploymentLimit).
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list recent deployments: %w", err)
	}
	for _, r := range rows {
		s.RecentDeployments = append(s.RecentDeployments, DeploymentItem{
			ID:                r.DeploymentID,
			ChangeNo:          r.SourceChangeNo,
			NetworkDomainName: r.NetworkDomainName,
			Status:            string(r.Status),
			TriggeredAt:       r.TriggeredAt,
		})
	}

	// 6. domain_count：已纳管网域数（is_monitored=true）。
	var domainCount int64
	if err := db.Model(&models.NetworkDomain{}).
		Where("is_monitored = ?", true).
		Count(&domainCount).Error; err != nil {
		return nil, fmt.Errorf("count monitored network domains: %w", err)
	}
	s.DomainCount = int(domainCount)

	// 7. 拨测（blackbox）目标：落在 ScrapeJob.blackbox_targets JSON 列
	//    （models.BlackboxTarget），不属 M07 五类资源，永不进 resource_count /
	//    monitored_count / 覆盖率（不变量 6）。
	var bjobs []models.ScrapeJob
	if err := db.Where("job_type = ?", models.JobTypeBlackbox).Find(&bjobs).Error; err != nil {
		return nil, fmt.Errorf("list blackbox jobs: %w", err)
	}
	for _, j := range bjobs {
		s.ProbeTargetCount += len(j.BlackboxTargets)
		for _, t := range j.BlackboxTargets {
			s.ProbeTargets = append(s.ProbeTargets, ProbeTargetItem{
				URL:    probeTargetURL(t),
				Status: "", // 实时拨测结果当前不可得：不臆造 up/down，前端据此显示「未知」
				// biz_name / app_name：BlackboxTarget 无归属字段，ScrapeJob 仅有
				// NetworkDomainID 不代表业务域，推断不出则留空（前端显示 '-'）。
				LastProbeAt: nil, // 无最近拨测时间数据源，nil（前端显示 '-'）
			})
		}
	}
	// probe_target_abnormal_count：models.BlackboxTarget 仅有 Target/Protocol/URL，
	// 无任何「异常/不健康」状态字段；异常需实时拨测结果（Prometheus/Alertmanager）判定，
	// 本接口不臆造字段，故恒为 0（歧义见交付说明）。
	s.ProbeTargetAbnormalCount = 0

	// 8. 组装 by_category：五类固定齐全（缺则补 0 值条目）。
	for _, cat := range models.ValidResourceCategories() {
		cs := CategorySummary{ResourceCategory: string(cat), BySubtype: []SubtypeSummary{}}
		if ca := cats[cat]; ca != nil {
			cs.ResourceCount = ca.resourceCount
			cs.MonitoredCount = ca.monitoredCount
			for sub, sa := range ca.subtypes {
				cs.BySubtype = append(cs.BySubtype, SubtypeSummary{
					Subtype:        sub,
					ResourceCount:  sa.resourceCount,
					MonitoredCount: sa.monitoredCount,
				})
			}
		}
		s.ByCategory = append(s.ByCategory, cs)
	}

	// 9. 组装 by_app（app_code 非空资源），并回填未归类计数。
	// 应用字典（M07 §5.19 / 决策 92）：app_code → app_name 展示名。字典缺条目时回落为
	// app_code（不编造名称，也不隐藏该应用行）。
	var appDicts []models.ApplicationDict
	if err := db.Find(&appDicts).Error; err != nil {
		return nil, fmt.Errorf("list application dict: %w", err)
	}
	appNames := make(map[string]string, len(appDicts))
	for _, d := range appDicts {
		appNames[d.AppCode] = d.AppName
	}
	for code, aa := range apps {
		name := appNames[code]
		if name == "" {
			name = code // 字典无该条目：回落编码，避免 L2 出现空白名称
		}
		s.ByApp = append(s.ByApp, AppSummary{
			AppCode:        code,
			AppName:        name,
			ResourceCount:  aa.resourceCount,
			MonitoredCount: aa.monitoredCount,
		})
	}
	s.UnclassifiedResourceCount = unclassifiedResourceCount
	s.UnclassifiedMonitoredCount = unclassifiedMonitoredCount

	return s, nil
}

// categoryAgg / subAgg / appAgg 是 Build 聚合过程中的内部累加器。
type categoryAgg struct {
	resourceCount  int
	monitoredCount int
	subtypes       map[string]*subAgg
}
type subAgg struct {
	resourceCount  int
	monitoredCount int
}
type appAgg struct {
	resourceCount  int
	monitoredCount int
}

// accumulateResource 把单条资源累加进 by_category / by_app 聚合器。
//   - monitored：该资源是否被 ready+enabled 标准 Job 覆盖（selected[id]）。
//   - subtypeField：该类的子类分组字段；application 传 ""（不拆子类）。
//   - app_code 取值经 models.Resource 接口收敛（host 走 AppCode 物理列，其他走各自
//     AppName 物理列，统一由 GetAppCode() 暴露，见 M07 决策 92）。空串记为「未归类」。
func accumulateResource(cats map[models.ResourceCategory]*categoryAgg, apps map[string]*appAgg,
	cat models.ResourceCategory, subtypeField string, res models.Resource, monitored bool,
	unclassifiedResource, unclassifiedMonitored *int) {
	ca := cats[cat]
	if ca == nil {
		ca = &categoryAgg{subtypes: make(map[string]*subAgg)}
		cats[cat] = ca
	}
	ca.resourceCount++
	if monitored {
		ca.monitoredCount++
	}
	if subtypeField != "" {
		sub, _ := models.GetResourceField(res, subtypeField)
		sa := ca.subtypes[sub]
		if sa == nil {
			sa = &subAgg{}
			ca.subtypes[sub] = sa
		}
		sa.resourceCount++
		if monitored {
			sa.monitoredCount++
		}
	}

	app := res.GetAppCode()
	if app == "" {
		*unclassifiedResource++
		if monitored {
			*unclassifiedMonitored++
		}
		return
	}
	aa := apps[app]
	if aa == nil {
		aa = &appAgg{}
		apps[app] = aa
	}
	aa.resourceCount++
	if monitored {
		aa.monitoredCount++
	}
}

// loadResourceRows 加载某一类资源的全量行（GORM 自动排除软删），统一为 []models.Resource
// 以便经接口方法 GetAppCode()/GetResourceField 收敛取值。
func loadResourceRows(db *gorm.DB, m interface{}) ([]models.Resource, error) {
	switch m.(type) {
	case *models.Host:
		var xs []models.Host
		if err := db.Find(&xs).Error; err != nil {
			return nil, fmt.Errorf("list hosts: %w", err)
		}
		out := make([]models.Resource, len(xs))
		for i := range xs {
			out[i] = &xs[i]
		}
		return out, nil
	case *models.Database:
		var xs []models.Database
		if err := db.Find(&xs).Error; err != nil {
			return nil, fmt.Errorf("list databases: %w", err)
		}
		out := make([]models.Resource, len(xs))
		for i := range xs {
			out[i] = &xs[i]
		}
		return out, nil
	case *models.Middleware:
		var xs []models.Middleware
		if err := db.Find(&xs).Error; err != nil {
			return nil, fmt.Errorf("list middlewares: %w", err)
		}
		out := make([]models.Resource, len(xs))
		for i := range xs {
			out[i] = &xs[i]
		}
		return out, nil
	case *models.Application:
		var xs []models.Application
		if err := db.Find(&xs).Error; err != nil {
			return nil, fmt.Errorf("list applications: %w", err)
		}
		out := make([]models.Resource, len(xs))
		for i := range xs {
			out[i] = &xs[i]
		}
		return out, nil
	case *models.GenericTarget:
		var xs []models.GenericTarget
		if err := db.Find(&xs).Error; err != nil {
			return nil, fmt.Errorf("list generic targets: %w", err)
		}
		out := make([]models.Resource, len(xs))
		for i := range xs {
			out[i] = &xs[i]
		}
		return out, nil
	}
	return nil, nil
}

// subtypeFieldForCategory 返回某资源类型用于 by_subtype 分组的 PRD 字段名（经
// models.GetResourceField 收敛到具体列）：
//   - host → os_type（Image 列；mock 的 linux/windows 为展示层标签）
//   - database → database_type
//   - middleware → middleware_type
//   - generic_target → exporter_type（端点类型；mock 的 snmp/k8s/custom_http 为展示层标签）
//   - application → ""（不设子类）
func subtypeFieldForCategory(cat models.ResourceCategory) string {
	switch cat {
	case models.ResourceCategoryHost:
		return "os_type"
	case models.ResourceCategoryDatabase:
		return "database_type"
	case models.ResourceCategoryMiddleware:
		return "middleware_type"
	case models.ResourceCategoryGenericTarget:
		return "exporter_type"
	default:
		return "" // application 不按子类拆
	}
}

// loadSelectedResourceIDs 聚合 job_type=standard 且 ready+enabled 的采集 Job 的
// selected_instance_ids 并集（去重，元素为 M07 resource_id）。
//
// 仅统计 standard Job：blackbox 拨测目标的 resource_id 落在 blackbox_targets 内、
// 不属 M07 资源（models.BlackboxTarget），故不计入「已监控」。
// 判定条件与 platform/query/coverage.go 的 loadSelectedInstances 一致，读侧只消费
// M01 选中关系、不反向修改 M01。
func loadSelectedResourceIDs(db *gorm.DB) (map[string]bool, error) {
	selected := make(map[string]bool)

	var jobs []models.ScrapeJob
	if err := db.Model(&models.ScrapeJob{}).
		Select("selected_instance_ids").
		Where("job_type = ? AND draft_status = ? AND enabled = ?",
			models.JobTypeStandard, scrapeJobDraftReady, true).
		Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("list enabled scrape jobs: %w", err)
	}
	for _, j := range jobs {
		for _, id := range j.SelectedInstanceIDs {
			if id != "" {
				selected[id] = true
			}
		}
	}
	return selected, nil
}

// SummaryHandler 处理 GET /api/v2/platform/dashboard/summary。
func SummaryHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, err := Build(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, s)
	}
}
