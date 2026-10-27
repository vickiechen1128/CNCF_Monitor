// Package dashboard 实现 MVP 首页聚合接口 GET /api/v2/platform/dashboard/summary：
// 一次性聚合监控资源数、已监控资源数、采集 Job 数、待确认配置草稿数、最近下发记录
// 与已纳管网域数，避免前端多次调用。数据访问复用既有 models / GORM 查询模式（参考
// platform/config/resource、platform/configcenter/draft、platform/configcenter/deployment），
// 不重复造轮子。
package dashboard

import (
	"context"
	"fmt"
	"sort"
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

// —— 反馈 11：「平台 × 应用 · 主机数」矩阵的收敛与兜底约定 ——

// platformAppTopPlatforms 平台收敛阈值：按各平台主机台数降序取前 N 个单独成行，
// 其余平台全部合并进「其他」聚合行（只改呈现粒度，不改合计）。
const platformAppTopPlatforms = 4

// platformAppOtherCode 「其他」聚合行的 platform_code 约定值。
// 取下划线包裹的 "__other__"：models.ValidPlatformCode 的正则 ^[a-z0-9-]{1,64}$ 不含下划线，
// 故该值不可能与任何真实平台编码碰撞，前端亦可据此判断「该行不可点击下钻」。
const platformAppOtherCode = "__other__"

// 矩阵中三处「非真实字典条目」的固定展示名。字典回落原则是「回落编码、不臆造」，
// 但这三行的编码分别是「其他」聚合值与空串，直接回落会得到无语义的展示，故给固定名。
const (
	platformAppOtherName    = "其他"    // platformAppOtherCode 行的 platform_name
	platformAppUnsetName    = "未指定平台" // platform_code 为空行的 platform_name
	platformAppUnsetAppName = "未指定应用" // app_code 为空单元格的 app_name
)

// —— 按云主机数（by_cloud）的「未指定云」兜底行 ——
//
// 与 platformAppUnsetName 同理：字典回落原则是「回落编码、不臆造」，但空编码回落
// 回自己就是空串，前端卡片主视觉（cloud_name）会出现无名卡片，故给固定展示名。
const cloudUnsetName = "未指定云"

// resourceModels 返回 M07 资源表模型（口径与 platform/query、config/resource 一致）。
//
// ⚠️ 顺序即契约（H1）：本切片**必须与 models.ValidResourceCategories() 同序**，
// 因为 Build 中按下标对齐取值（cat := models.ValidResourceCategories()[i]）。
// 新增类别一律追加到末尾，summary_test.go 有等长 + 逐项一致的护栏断言。
func resourceModels() []interface{} {
	return []interface{}{
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.InterfaceService{},
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

// ProbeTargetItem 是首页拨测态势面板单条拨测目标明细（决策 93 / M05 PRD v1.8）。
// JSON 与前端 ProbeTargetItem 对齐：
// url/service_name/platform_names/resource_category/status/network_domain_id/network_domain_name/last_probe_at。
//
// 拨测目标改走资源选择后，目标来自所选拨测资源，按类别取地址与服务名（资源不存在时留空，
// 不臆造）：接口服务取 api_url / api_name，应用服务取 health_check_url / **应用字典中文名**
// （app_code → app_name，字典缺条目回落 app_code；地址字段与 models.BlackboxTargetField 一致）。
// ResourceCategory 供前端分区展示。应用服务额外给出 platform_names：应用↔平台为 M:N
// （models.AppPlatformRel），同一应用可部署在多个平台，故以「、」连接全部关联平台展示名。
// 归属仍以「归属网域」承载（ScrapeJob.NetworkDomainID 为 not null）。遵循「可空不臆造」：
// status 只来自真实 probe_success 样本，无样本留空（前端显示「未知」），不硬编 up/down；
// last_probe_at 取样本采样时间，拿不到则 nil。
type ProbeTargetItem struct {
	URL               string     `json:"url"`                 // 拨测目标展示地址（接口服务 api_url / 应用服务 health_check_url）
	ServiceName       string     `json:"service_name"`        // 服务名（接口服务 api_name / 应用服务应用字典中文名，缺失时空串）
	PlatformNames     string     `json:"platform_names"`      // 应用服务所属平台展示名（多平台「、」连接；接口服务恒为空串）
	ResourceCategory  string     `json:"resource_category"`   // 资源类别（interface_service / application），前端分区展示依据
	Status            string     `json:"status"`              // up/down/''（''=无 probe_success 样本，未知）
	NetworkDomainID   string     `json:"network_domain_id"`   // 归属网域 ID（ScrapeJob.NetworkDomainID，not null）
	NetworkDomainName string     `json:"network_domain_name"` // 归属网域展示名（字典缺条目回落为 ID）
	LastProbeAt       *time.Time `json:"last_probe_at"`       // 最近一次拨测时间（拿不到时 nil）
}

// lookupProbeSample 按 job 名 + 拨测目标地址匹配 probe_success 样本（F-13）。
// instance 标签即 blackbox 探测的目标地址：资源模式下即所选接口服务资源的 api_url。
func lookupProbeSample(
	index map[string]map[string]ProbeSample,
	jobName string,
	addr string,
) (ProbeSample, bool) {
	if index == nil || jobName == "" {
		return ProbeSample{}, false
	}
	byInstance := index[jobName]
	if byInstance == nil {
		return ProbeSample{}, false
	}
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ProbeSample{}, false
	}
	if s, ok := byInstance[addr]; ok {
		return s, true
	}
	return ProbeSample{}, false
}

// Summary 是首页聚合接口的返回结构。
type Summary struct {
	ResourceCount         int              `json:"resource_count"`           // 监控资源总数（M07 resource）
	MonitoredCount        int              `json:"monitored_count"`          // 已监控资源数（口径见 §3.5：ready+enabled Job——含拨测资源模式——覆盖去重）
	ScrapeJobCount        int              `json:"scrape_job_count"`         // 采集 Job 总数（M01，未软删）
	ScrapeJobEnabledCount int              `json:"scrape_job_enabled_count"` // 采集 Job 中 enabled=true 数
	PendingDraftCount     int              `json:"pending_draft_count"`      // 待确认配置草稿数（M09，status=pending）
	RecentDeployments     []DeploymentItem `json:"recent_deployments"`       // 最近下发记录（最多 5 条）
	DomainCount           int              `json:"domain_count"`             // 已纳管网域数（is_monitored=true）

	// —— 决策 91（M05 PRD v1.7）：首页分组聚合字段（不变量见各测试）——
	ByCategory                 []CategorySummary `json:"by_category"`                  // 按资源类型分组，6 类固定齐全（缺则补 0 值条目）
	ByApp                      []AppSummary      `json:"by_app"`                       // 按应用分组（app_code 非空的资源）
	UnclassifiedResourceCount  int               `json:"unclassified_resource_count"`  // app_code 为空的资源数
	UnclassifiedMonitoredCount int               `json:"unclassified_monitored_count"` // 其中已被监控数
	ProbeTargetCount           int               `json:"probe_target_count"`           // 拨测目标数（blackbox）
	ProbeTargetAbnormalCount   int               `json:"probe_target_abnormal_count"`  // 拨测异常目标数
	ProbeTargets               []ProbeTargetItem `json:"probe_targets"`                // 拨测目标明细（异常排前由前端按 status 排序，后端不排序）

	// —— 反馈 10（路线 B）：工程师视角采集健康聚合段 ——
	// 分母 = 已下发资源数（= MonitoredCount），不含未下发；拨测目标不参与。
	// 查询失败 / 未注入 querier 时为 nil（字段省略），前端按「不可用」呈现，绝不误报 0。
	CollectionHealth *CollectionHealth `json:"collection_health,omitempty"`

	// —— 反馈 11（首页首屏改版）：平台 × 应用 · 主机数矩阵 ——
	// 仅统计 resource_category=host；度量单位是**主机台数**（每台主机只有一个
	// platform_code + 一个 app_code），故行合计 === 列合计 === 主机总数。
	// 恒返回非 nil slice（空库为 []，绝不 null）；前端对 undefined / [] 一律按
	// 「不可用态」处理，不渲染全 0 矩阵。
	ByPlatformApp []PlatformAppSummary `json:"by_platform_app"`

	// —— by_cloud：按云 · 主机台数（M06 决策 103 scheme-B 派生链）——
	// 仅统计 resource_category=host；cloud_code 的**唯一权威来源**是网域派生链
	// Host.NetworkDomainID → NetworkDomain.CloudCode → CloudDict.CloudName，
	// 绝不使用已废弃的 Host.CloudCode 残留列（该列导入路径已不再写入）。
	// 网域记录缺失、或该网域 cloud_code 为空的主机，统一进 cloud_code="" 的
	// 「未指定云」兜底行（恒保留、不丢弃），否则行合计对不上主机总数。
	// 恒返回非 nil slice（空库为 []，绝不 null）。
	ByCloud []CloudSummary `json:"by_cloud"`
}

// PlatformAppSummary 是「平台 × 应用 · 主机数」矩阵的**单行**（反馈 11，
// 落档见 docs/05-execution-records/module-05/dev-feedback.md §11.4）。
//
// 度量单位是主机台数而非应用数：行合计（按平台加总）恒等于列合计（按应用加总）
// 恒等于主机总数，右下角单一合计格同时闭合两个方向。
type PlatformAppSummary struct {
	// PlatformCode 平台编码。约定值："" = 「未指定平台」兜底行（恒保留、不参与
	// Top N 竞争）；platformAppOtherCode = 「其他」聚合行（其下所有落选平台合并）。
	PlatformCode string `json:"platform_code"`
	// PlatformName 平台展示名：查平台字典，字典缺条目回落 PlatformCode 本身
	// （不臆造）；PlatformCode 为空时为固定兜底名「未指定平台」（回落编码会得到
	// 空串，故此处给固定展示名）；「其他」行为固定展示名。
	PlatformName string `json:"platform_name"`
	// Cells 该平台下各应用的主机台数（app_code 为空的进「未指定应用」列）。
	Cells []PlatformAppCell `json:"cells"`
	// HostCount 该平台主机合计（恒等于 Cells 之和，便于前端直接渲染行合计）。
	HostCount int `json:"host_count"`
}

// PlatformAppCell 是矩阵的**单个格子**：某平台 × 某应用的主机台数。
type PlatformAppCell struct {
	// AppCode 应用编码；空串 = 「未指定应用」列（不丢弃，否则合计对不上）。
	AppCode string `json:"app_code"`
	// AppName 应用展示名：查应用字典，字典缺条目回落 AppCode 本身（不臆造）；
	// AppCode 为空时为固定兜底名「未指定应用」。
	AppName string `json:"app_name"`
	// HostCount 该平台 × 该应用的主机台数。
	HostCount int `json:"host_count"`
}

// CloudSummary 是「按云 · 主机台数」的**单行**（M06 决策 103 scheme-B 派生链：
// Host.NetworkDomainID → NetworkDomain.CloudCode → CloudDict.CloudName）。
//
// 与 by_platform_app 同为**纯新增**聚合：by_category / by_app / collection_health /
// probe_targets 等既有字段语义一律未改动。
//
// ⚠️ 分组轴只有一个——cloud_code。CloudType（公有云/私有云/政务云）与 Carrier
// （运营商）是**描述性元数据，不是分类轴**，故本聚合既不按其分组、也不在响应里
// 暴露这两个维度（红线见 platform/config/resource/cloud_dict.go §口径）。
type CloudSummary struct {
	// CloudCode 云字典主键（如 PUB-TX / GM-CU）。约定值："" = 「未指定云」兜底行
	// （网域缺失或网域 cloud_code 为空，恒保留、恒排末位、不参与降序竞争）。
	CloudCode string `json:"cloud_code"`
	// CloudName 云展示名：查云字典，字典缺条目回落 CloudCode 本身（不臆造、
	// 不返回空串）；CloudCode 为空时为固定兜底名「未指定云」（回落编码会得到
	// 空串，前端卡片主视觉会是无名卡片）。
	CloudName string `json:"cloud_name"`
	// ResourceCount 该云下主机资源数（行合计恒等于 by_category 中 host 的
	// resource_count，含「未指定云」行）。
	ResourceCount int `json:"resource_count"`
	// MonitoredCount 该云下主机已被 ready+enabled 采集任务纳管的数量。口径与
	// 全局 MonitoredCount 同源（复用 loadSelectedResourceIDs 的 selected 集合），
	// 但**只统计 host 类**，故各行之和 ≤ 全局 monitored_count。
	MonitoredCount int `json:"monitored_count"`
	// CoverageRate 纳管率（整数百分比）= MonitoredCount * 100 / ResourceCount；
	// ResourceCount 为 0 时取 0（防除零）。
	CoverageRate int `json:"coverage_rate"`
}

// CategorySummary 单个资源类型（L1 卡）的聚合。不含告警字段——首页未恢复数字由
// 前端按 /api/v1/alerts 分组得到，后端零改动。
type CategorySummary struct {
	ResourceCategory string           `json:"resource_category"` // host/database/middleware/application/generic_target/interface_service
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
	BizCode        string `json:"biz_code"` // 多数归因业务域编码（决策 92/93/95）；无有效计数时为空串
	BizName        string `json:"biz_name"` // 业务字典展示名；字典无条目时回落为 biz_code
	ResourceCount  int    `json:"resource_count"`
	MonitoredCount int    `json:"monitored_count"`
}

// buildOptions Build 的可选依赖（F-13：拨测结果查询器）。
type buildOptions struct {
	probeQuerier    ProbeQuerier
	upHealthQuerier UpHealthQuerier
}

// Option 是 Build 的可选依赖注入项。
type Option func(*buildOptions)

// WithProbeQuerier 注入拨测结果查询器（F-13）。不注入时拨测 status / last_probe_at
// 保持「未知」（与历史行为一致，向后兼容）。
func WithProbeQuerier(q ProbeQuerier) Option {
	return func(o *buildOptions) { o.probeQuerier = q }
}

// WithUpHealthQuerier 注入采集健康 up 样本查询器（反馈 10，路线 B）。不注入 / 查询失败时
// CollectionHealth 留空（nil），前端按「不可用」呈现。
func WithUpHealthQuerier(q UpHealthQuerier) Option {
	return func(o *buildOptions) { o.upHealthQuerier = q }
}

// Build 聚合各模块已有数据生成首页统计概览。
// 复用 models 五类资源表 / ScrapeJob / ConfigDraft / ConfigDeployment / NetworkDomain 的
// GORM 查询（Count/Find/Pluck），软删由 GORM 自动排除；错误沿用 fmt.Errorf("...: %w")。
func Build(db *gorm.DB, opts ...Option) (*Summary, error) {
	cfg := buildOptions{}
	for _, opt := range opts {
		opt(&cfg)
	}
	s := &Summary{
		RecentDeployments: []DeploymentItem{},
		ByCategory:        []CategorySummary{},
		ByApp:             []AppSummary{},
		ProbeTargets:      []ProbeTargetItem{},
		ByPlatformApp:     []PlatformAppSummary{},
		ByCloud:           []CloudSummary{},
	}

	// 0. 被 ready+enabled Job（所有 job_type，含拨测资源模式选择）选中的
	//    resource_id 集合（复用于 monitored 判定，不另造口径；见 loadSelectedResourceIDs）。
	selected, err := loadSelectedResourceIDs(db)
	if err != nil {
		return nil, err
	}

	// 0.1 by_cloud 的两把派生 map（M06 决策 103 scheme-B）：
	//     - network_domain_id → 该网域的 cloud_code（权威来源；网域缺失时取零值空串，
	//       与 platform/config/resource/list.go 的派生实现同源）；
	//     - cloud_code → 云字典 cloud_name（仅用于展示名解析，缺条目时回落编码）。
	//     刻意**不读** Host.CloudCode：该列是历史残留，导入路径已不再写入。
	domainCloudCodes, err := loadDomainCloudCodes(db)
	if err != nil {
		return nil, err
	}
	cloudNames, err := loadCloudNames(db)
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
	// hostPlatformApps：反馈 11 矩阵的原始计数（platform_code → app_code → 主机台数）。
	// 在既有资源循环里顺带累计，避免为矩阵再扫一遍六张资源表。
	hostPlatformApps := make(map[string]map[string]int)
	// hostClouds：by_cloud 的原始计数（cloud_code → 主机台数 / 其中已下发数）。
	// cloud_code 经网域派生；网域缺失或网域 cloud_code 为空时入 "" 桶（组装阶段
	// 渲染成「未指定云」行），绝不丢弃，否则行合计对不上主机总数。
	hostClouds := make(map[string]*cloudAgg)

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

			// 反馈 11：矩阵只统计 host（每台主机恰有一个 platform_code + 一个 app_code，
			// 故行合计 === 列合计 === 主机总数）。空值不丢弃，统一进兜底行列。
			// by_cloud 同口径：只统计 host，monitored 直接复用同一份 selected 判定。
			if cat == models.ResourceCategoryHost {
				platformCode, _ := models.GetResourceField(res, "platform_code")
				accumulateHostCell(hostPlatformApps, platformCode, res.GetAppCode())
				domainID, _ := models.GetResourceField(res, "network_domain_id")
				accumulateCloudCell(hostClouds, domainCloudCodes[domainID], monitored)
			}
		}
	}

	// 2. monitored_count：selected ∩ 现存资源（resourceIDs）。
	//    口径见 docs/05-execution-records/module-05/design-proposals/
	//    homepage-mvp-content-restructure.md §3.5；与 platform/query/coverage.go 的
	//    「未监控」补集同源，故 monitored_count ≤ resource_count。
	dispatchedIDs := make([]string, 0, len(selected))
	for id := range selected {
		if resourceIDs[id] {
			s.MonitoredCount++
			dispatchedIDs = append(dispatchedIDs, id)
		}
	}

	// 2.1 采集健康两态（反馈 10 引入，反馈 12 统一为与监控对象页一致）：对已下发资源
	//     （= monitored_count 集合）按 up 样本分类（口径见 collection_health.go）。查询失败 /
	//     未注入 querier 时降级留空，不误报 0（决策 68-2）。
	if cfg.upHealthQuerier != nil {
		if idx, err := cfg.upHealthQuerier.UpHealth(context.Background()); err == nil {
			s.CollectionHealth = classifyCollectionHealth(dispatchedIDs, idx)
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

	// 7. 拨测（blackbox）目标：目标来自 ScrapeJob.selected_instance_ids 所选的拨测资源，
	//    按类别取展示名与地址（models.BlackboxProbeCategories 仅两类）：
	//      - interface_service（偏业务）：展示名 api_name，地址 api_url；
	//      - application（偏平台）：展示名取**应用字典 app_name**（app_code → 中文应用名，
	//        字典缺条目回落 app_code），地址 health_check_url。
	//    应用服务用应用中文名而非 service_name 实例名：多个模型服务实例（各自模型名）同属
	//    一个应用（如「大模型应用」）时，领导视角关心的是这个应用整体的拨测情况。
	//    拨测目标不进 resource_count / by_category（这两类资源本身已作为台账计入），
	//    但**资源模式的选择计入 monitored_count**（H9 统一口径，见 loadSelectedResourceIDs）。
	var bjobs []models.ScrapeJob
	if err := db.Where("job_type = ? AND draft_status = ? AND enabled = ?", models.JobTypeBlackbox, scrapeJobDraftReady, true).Find(&bjobs).Error; err != nil {
		return nil, fmt.Errorf("list blackbox jobs: %w", err)
	}
	// 应用字典（决策 92）：app_code → app_name 中文展示名。与第9 步 by_app 共用同一次查询结果。
	var appDicts []models.ApplicationDict
	if err := db.Find(&appDicts).Error; err != nil {
		return nil, fmt.Errorf("list application dict: %w", err)
	}
	appNames := make(map[string]string, len(appDicts))
	for _, d := range appDicts {
		appNames[d.AppCode] = d.AppName
	}
	// 平台字典 + 应用↔平台关系：应用服务拨测需体现所属平台（应用↔平台为 M:N，见
	// models.AppPlatformRel）。同一应用可部署在多个平台，故平台名以「、」连接全部关联平台；
	// 无关联时回落资源行的 platform_code，字典缺条目回落 platform_code（不编造）。
	var platformDicts []models.PlatformDict
	if err := db.Find(&platformDicts).Error; err != nil {
		return nil, fmt.Errorf("list platform dict: %w", err)
	}
	platformNames := make(map[string]string, len(platformDicts))
	for _, d := range platformDicts {
		platformNames[d.PlatformCode] = d.PlatformName
	}
	var appPlatformRels []models.AppPlatformRel
	if err := db.Find(&appPlatformRels).Error; err != nil {
		return nil, fmt.Errorf("list app platform rels: %w", err)
	}
	// app_code → 排序后的平台展示名列表（去重、跳过空关联）。
	appPlatformNames := make(map[string][]string, len(appPlatformRels))
	for _, rel := range appPlatformRels {
		name := platformNames[rel.PlatformCode]
		if name == "" {
			name = rel.PlatformCode
		}
		if name == "" {
			continue
		}
		appPlatformNames[rel.AppCode] = append(appPlatformNames[rel.AppCode], name)
	}
	for code, list := range appPlatformNames {
		sort.Strings(list)
		appPlatformNames[code] = list
	}
	// 批量取所有被选中拨测资源的地址 / 服务名 / 平台（每类一次 WHERE resource_id IN ?，避免 N+1）。
	probeIDs := make([]string, 0)
	for _, j := range bjobs {
		probeIDs = append(probeIDs, j.SelectedInstanceIDs...)
	}
	ifaceURLs := make(map[string]string, len(probeIDs))
	ifaceNames := make(map[string]string, len(probeIDs))
	appURLs := make(map[string]string, len(probeIDs))
	// appDisplayNames：应用服务拨测展示名 = 应用字典中文名（回落 app_code）。
	appDisplayNames := make(map[string]string, len(probeIDs))
	// appSvcCodes：应用资源 → 其 app_code（用于反查所属平台）。
	appSvcCodes := make(map[string]string, len(probeIDs))
	// appPlatformCodes：应用资源行的 platform_code 兜底（无 M:N 关联时用）。
	appPlatformCodes := make(map[string]string, len(probeIDs))
	if len(probeIDs) > 0 {
		var ifaces []models.InterfaceService
		if err := db.Where("resource_id IN ?", probeIDs).Find(&ifaces).Error; err != nil {
			return nil, fmt.Errorf("list interface services for probe: %w", err)
		}
		for _, it := range ifaces {
			ifaceURLs[it.ResourceID] = it.APIURL
			ifaceNames[it.ResourceID] = it.APIName
		}
		var appsForProbe []models.Application
		if err := db.Where("resource_id IN ?", probeIDs).Find(&appsForProbe).Error; err != nil {
			return nil, fmt.Errorf("list applications for probe: %w", err)
		}
		for _, a := range appsForProbe {
			appURLs[a.ResourceID] = a.HealthCheckURL
			appSvcCodes[a.ResourceID] = a.AppName
			appPlatformCodes[a.ResourceID] = a.PlatformCode
			name := appNames[a.AppName]
			if name == "" {
				name = a.AppName
			}
			appDisplayNames[a.ResourceID] = name
		}
	}
	// F-13：拨测实时结果取自中心 Prometheus 的 probe_success（1=通过 / 0=失败）。
	// 查询失败一律降级——status 留空（前端显示「未知」）、异常计数为 0，不阻断聚合接口。
	var probeIndex map[string]map[string]ProbeSample
	if cfg.probeQuerier != nil {
		probeIndex, _ = cfg.probeQuerier.ProbeSuccess(context.Background())
	}
	abnormalCount := 0
	// 归属网域展示名：ScrapeJob.NetworkDomainID（not null）→ network_domains.name。
	// 字典缺条目回落为网域 ID（与 by_app 的 app_name 回落 app_code 同源，不留空、不编造）。
	var probeDomains []models.NetworkDomain
	if err := db.Find(&probeDomains).Error; err != nil {
		return nil, fmt.Errorf("list network domains for probe: %w", err)
	}
	domainNames := make(map[string]string, len(probeDomains))
	for _, d := range probeDomains {
		domainNames[d.ID] = d.Name
	}
	for _, j := range bjobs {
		domainName := domainNames[j.NetworkDomainID]
		if domainName == "" {
			domainName = j.NetworkDomainID
		}
		for _, rid := range j.SelectedInstanceIDs {
			// 目标地址按类别取：接口服务 api_url、应用服务 health_check_url。
			// 两类都查是必要的——同一个 resource_id 只可能命中其中一张表，
			// 早前只查接口服务会让应用服务拨测目标整体缺失（不进面板）。
			addr, svcName, category := ifaceURLs[rid], ifaceNames[rid], models.ResourceCategoryInterfaceService
			platformName := ""
			if addr == "" {
				addr, svcName, category = appURLs[rid], appDisplayNames[rid], models.ResourceCategoryApplication
				// 平台：优先取应用↔平台 M:N 关联（同一应用可部署多个平台，全列出）；
				// 无关联时回落资源行 platform_code（字典缺条目则回落编码，不编造）。
				if list := appPlatformNames[appSvcCodes[rid]]; len(list) > 0 {
					platformName = strings.Join(list, "、")
				} else if code := appPlatformCodes[rid]; code != "" {
					if n := platformNames[code]; n != "" {
						platformName = n
					} else {
						platformName = code
					}
				}
			}
			if addr == "" {
				continue // 资源不存在 / 无地址：不计入（与生成侧 skip 同口径）
			}
			item := ProbeTargetItem{
				URL:               addr,
				ServiceName:       svcName,
				PlatformNames:     platformName,
				ResourceCategory:  string(category),
				NetworkDomainID:   j.NetworkDomainID,
				NetworkDomainName: domainName,
			}
			if sample, ok := lookupProbeSample(probeIndex, j.JobName, addr); ok {
				item.LastProbeAt = &sample.At
				if sample.Success {
					item.Status = "up"
				} else {
					item.Status = "down"
					abnormalCount++
				}
			}
			s.ProbeTargetCount++
			s.ProbeTargets = append(s.ProbeTargets, item)
		}
	}
	// probe_target_abnormal_count：口径 = probe_success=0 的拨测目标数（F-13）。
	// 无样本（未下发 / 指标未回传）不计入异常，避免把「未知」误报为「异常」。
	s.ProbeTargetAbnormalCount = abnormalCount

	// 8. 组装 by_category：六类固定齐全（缺则补 0 值条目）。
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
	// 应用字典（M07 §5.19 / 决策 92）：app_code → app_name 展示名，直接复用第 7 步的
	// appNames（第 7 步已查过一次，不重复查库）；字典缺条目时回落为 app_code。
	// 业务字典（决策 48 / 92/93/95）：biz_code → biz_name 展示名。字典缺条目时回落为
	// biz_code（不编造名称）。
	var bizDomains []models.BusinessDomain
	if err := db.Find(&bizDomains).Error; err != nil {
		return nil, fmt.Errorf("list business domains: %w", err)
	}
	bizNames := make(map[string]string, len(bizDomains))
	for _, d := range bizDomains {
		bizNames[d.Code] = d.Name
	}
	for code, aa := range apps {
		name := appNames[code]
		if name == "" {
			name = code // 字典无该条目：回落编码，避免 L2 出现空白名称
		}
		// 业务域多数归因：取 bizCounts 中资源数最多的 biz_code；空值不参与
		// （accumulateResource 已过滤），无有效计数时 BizCode/BizName 均为空串。
		// 计数并列时取编码字典序较小者，保证输出确定性。
		var bizCode string
		bestCnt := 0
		for b, cnt := range aa.bizCounts {
			if cnt > bestCnt || (cnt == bestCnt && b < bizCode) {
				bizCode, bestCnt = b, cnt
			}
		}
		bizName := ""
		if bizCode != "" {
			bizName = bizNames[bizCode]
			if bizName == "" {
				bizName = bizCode // 字典无该条目：回落编码
			}
		}
		s.ByApp = append(s.ByApp, AppSummary{
			AppCode:        code,
			AppName:        name,
			BizCode:        bizCode,
			BizName:        bizName,
			ResourceCount:  aa.resourceCount,
			MonitoredCount: aa.monitoredCount,
		})
	}
	s.UnclassifiedResourceCount = unclassifiedResourceCount
	s.UnclassifiedMonitoredCount = unclassifiedMonitoredCount

	// 10. 组装 by_platform_app（反馈 11）：平台 × 应用 · 主机数矩阵。
	//     复用第 7 步已查好的 appNames / platformNames，不重复查库。
	s.ByPlatformApp = buildPlatformAppSummary(hostPlatformApps, platformNames, appNames)

	// 11. 组装 by_cloud：按云 · 主机台数。cloud_code 权威来源为网域派生链
	//     （决策 103 scheme-B），cloud_name 查云字典、缺条目回落编码。
	s.ByCloud = buildCloudSummary(hostClouds, cloudNames)

	return s, nil
}

// accumulateHostCell 把一台主机的 (platform_code, app_code) 计数 +1。
// platform_code / app_code 为空是合法取值（资源台账允许未指定），统一按原值入桶，
// 由组装阶段渲染成「未指定平台」行 / 「未指定应用」列——绝不丢弃，否则合计对不上。
func accumulateHostCell(cells map[string]map[string]int, platformCode, appCode string) {
	row := cells[platformCode]
	if row == nil {
		row = make(map[string]int)
		cells[platformCode] = row
	}
	row[appCode]++
}

// buildPlatformAppSummary 由原始计数装配矩阵行（反馈 11）。
//
// 装配规则（全部服务于「行合计 === 列合计 === 主机总数」这一不变量）：
//  1. 「未指定平台」（platform_code 为空串）**恒单独成行、且不占用 Top N 名额**——
//     它是数据质量待补录信号，不该被「其他」吞掉，也不该挤掉一个真实平台。
//  2. 平台收敛：非空平台按各平台主机台数降序取前 platformAppTopPlatforms 个单独成行，
//     其余全部合并进 platformAppOtherCode（「其他」）行；「其他」行的每个格子是其下
//     所有落选平台 × 同一应用的计数之和。收敛只改呈现粒度，不改合计。
//     计数并列时按 platform_code 字典序升序，保证输出确定性。
//  3. app_code 为空串的格子归入「未指定应用」列，恒保留。
//
// 输出顺序固定为：Top N（台数降序）→「其他」→「未指定平台」。不按全局台数重排，
// 因为「其他」是落选平台的聚合、未指定平台是兜底行，二者语义不同台数可能交叉。
//
// 名称一律走「字典 → 回落编码、不臆造」：字典缺条目时给编码本身；仅
// platformAppOtherCode / 空串这三处因回落无意义而给固定展示名（见 const 块）。
// 无主机资源时返回空 slice（不返回 nil，避免 JSON null）。
func buildPlatformAppSummary(
	hostCells map[string]map[string]int,
	platformNames map[string]string,
	appNames map[string]string,
) []PlatformAppSummary {
	// 平台码 → 该平台主机合计（用于排序与 Top N 截断）。
	platformTotals := make(map[string]int, len(hostCells))
	for platformCode, row := range hostCells {
		total := 0
		for _, n := range row {
			total += n
		}
		platformTotals[platformCode] = total
	}

	// 排序：主机台数降序；并列时 platform_code 字典序升序，保证输出确定性。
	codes := make([]string, 0, len(platformTotals))
	for code := range platformTotals {
		if code != "" {
			codes = append(codes, code)
		}
	}
	sort.Slice(codes, func(i, j int) bool {
		if platformTotals[codes[i]] != platformTotals[codes[j]] {
			return platformTotals[codes[i]] > platformTotals[codes[j]]
		}
		return codes[i] < codes[j]
	})

	out := make([]PlatformAppSummary, 0, len(codes)+2)
	otherRow := map[string]int{}
	for rank, code := range codes {
		if rank >= platformAppTopPlatforms {
			for appCode, n := range hostCells[code] {
				otherRow[appCode] += n
			}
			continue
		}
		out = append(out, platformAppRow(code, hostCells[code], platformNames, appNames))
	}
	if len(otherRow) > 0 {
		out = append(out, platformAppRow(platformAppOtherCode, otherRow, platformNames, appNames))
	}
	// 未指定平台恒在最后一行（存在才输出）。
	if unsetRow := hostCells[""]; len(unsetRow) > 0 {
		out = append(out, platformAppRow("", unsetRow, platformNames, appNames))
	}
	return out
}

// platformAppRow 渲染单行：按应用主机台数降序排格子（并列按 app_code 字典序升序），
// 并回填该行主机合计（恒等于各格子之和）。
func platformAppRow(
	platformCode string,
	row map[string]int,
	platformNames map[string]string,
	appNames map[string]string,
) PlatformAppSummary {
	appCodes := make([]string, 0, len(row))
	total := 0
	for appCode, n := range row {
		appCodes = append(appCodes, appCode)
		total += n
	}
	sort.Slice(appCodes, func(i, j int) bool {
		if row[appCodes[i]] != row[appCodes[j]] {
			return row[appCodes[i]] > row[appCodes[j]]
		}
		return appCodes[i] < appCodes[j]
	})

	cells := make([]PlatformAppCell, 0, len(appCodes))
	for _, appCode := range appCodes {
		cells = append(cells, PlatformAppCell{
			AppCode:   appCode,
			AppName:   resolveAppName(appCode, appNames),
			HostCount: row[appCode],
		})
	}
	return PlatformAppSummary{
		PlatformCode: platformCode,
		PlatformName: resolvePlatformName(platformCode, platformNames),
		Cells:        cells,
		HostCount:    total,
	}
}

// resolvePlatformName 平台展示名：查平台字典；缺条目回落 platform_code 本身（不臆造、
// 不返回空串）；空串（未指定）与「其他」聚合值回落无意义，给固定展示名。
func resolvePlatformName(code string, platformNames map[string]string) string {
	switch code {
	case "":
		return platformAppUnsetName
	case platformAppOtherCode:
		return platformAppOtherName
	}
	if name := platformNames[code]; name != "" {
		return name
	}
	return code
}

// resolveAppName 应用展示名：查应用字典；缺条目回落 app_code 本身（不臆造、不返回空串）；
// 空串（未指定应用）回落无意义，给固定展示名。
func resolveAppName(code string, appNames map[string]string) string {
	if code == "" {
		return platformAppUnsetAppName
	}
	if name := appNames[code]; name != "" {
		return name
	}
	return code
}

// cloudAgg 是 by_cloud 的原始累加器：某个 cloud_code 下的主机台数与其中已下发数。
type cloudAgg struct {
	resourceCount  int
	monitoredCount int
}

// accumulateCloudCell 把一台主机的 (cloud_code, monitored) 计数 +1。
// cloud_code 为空串是合法取值（网域缺失或网域未登记 cloud_code），统一按原值入桶，
// 由组装阶段渲染成「未指定云」行——绝不丢弃，否则行合计对不上主机总数。
func accumulateCloudCell(aggs map[string]*cloudAgg, cloudCode string, monitored bool) {
	agg := aggs[cloudCode]
	if agg == nil {
		agg = &cloudAgg{}
		aggs[cloudCode] = agg
	}
	agg.resourceCount++
	if monitored {
		agg.monitoredCount++
	}
}

// buildCloudSummary 由原始计数装配 by_cloud 行（决策 103 scheme-B 派生链）。
//
// 装配规则：
//  1. 分组轴只有 cloud_code：CloudType / Carrier 是描述性元数据，不是分类轴，
//     既不参与分组也不在响应里暴露。
//  2. 排序：resource_count 降序；并列时 cloud_code 字典序升序，保证输出确定性。
//  3. 「未指定云」（cloud_code 为空串）恒排末位、不参与降序竞争——它是数据质量
//     待补录信号，不该被真实云挤出视野；存在才输出。
//
// 名称一律走「字典 → 回落编码、不臆造」：字典缺条目时给编码本身；仅空串这一处
// 因回落结果是空串而给固定展示名「未指定云」（见 const cloudUnsetName）。
// coverage_rate 为整数除法；resource_count 为 0 时取 0（防除零）。
// 无主机资源时返回空 slice（不返回 nil，避免 JSON null）。
func buildCloudSummary(aggs map[string]*cloudAgg, cloudNames map[string]string) []CloudSummary {
	codes := make([]string, 0, len(aggs))
	for code := range aggs {
		if code != "" {
			codes = append(codes, code)
		}
	}
	sort.Slice(codes, func(i, j int) bool {
		if aggs[codes[i]].resourceCount != aggs[codes[j]].resourceCount {
			return aggs[codes[i]].resourceCount > aggs[codes[j]].resourceCount
		}
		return codes[i] < codes[j]
	})

	out := make([]CloudSummary, 0, len(codes)+1)
	for _, code := range codes {
		out = append(out, cloudSummaryRow(code, aggs[code], cloudNames))
	}
	// 未指定云恒在最后一行（存在才输出）。
	if agg := aggs[""]; agg != nil {
		out = append(out, cloudSummaryRow("", agg, cloudNames))
	}
	return out
}

// cloudSummaryRow 渲染单行 by_cloud，并计算整数除法纳管率（分母为 0 时取 0）。
func cloudSummaryRow(code string, agg *cloudAgg, cloudNames map[string]string) CloudSummary {
	row := CloudSummary{
		CloudCode:      code,
		CloudName:      resolveCloudName(code, cloudNames),
		ResourceCount:  agg.resourceCount,
		MonitoredCount: agg.monitoredCount,
	}
	if row.ResourceCount > 0 {
		row.CoverageRate = row.MonitoredCount * 100 / row.ResourceCount
	}
	return row
}

// resolveCloudName 云展示名：查云字典；缺条目回落 cloud_code 本身（不臆造、不返回空串）；
// 空串（未指定云）回落无意义，给固定展示名。
func resolveCloudName(code string, cloudNames map[string]string) string {
	if code == "" {
		return cloudUnsetName
	}
	if name := cloudNames[code]; name != "" {
		return name
	}
	return code
}

// loadDomainCloudCodes 返回 network_domain_id → NetworkDomain.CloudCode 的派生 map
// （M06 决策 103 scheme-B 的权威来源，与 platform/config/resource/list.go 同源）。
//
// 只取 id / cloud_code 两列（网域表小，且本聚合只需要这两列）。这里刻意**不**读
// Host.CloudCode：那是历史残留列，导入路径已不再写入，用它会得到大面积空值。
func loadDomainCloudCodes(db *gorm.DB) (map[string]string, error) {
	var domains []models.NetworkDomain
	if err := db.Model(&models.NetworkDomain{}).
		Select("id", "cloud_code").
		Find(&domains).Error; err != nil {
		return nil, fmt.Errorf("list network domains for cloud aggregation: %w", err)
	}
	out := make(map[string]string, len(domains))
	for _, d := range domains {
		out[d.ID] = d.CloudCode
	}
	return out, nil
}

// loadCloudNames 返回 cloud_code → CloudDict.CloudName 的展示名 map（M06 云字典）。
//
// 仅用于把 by_cloud 的 cloud_code 渲染成展示名，不参与分组；字典缺条目时由调用方
// 回落编码。含 enabled=false 的条目：条目一旦被网域引用就仍需可解析出名字，停用
// 只阻断新建引用，不应让历史数据变成无名卡片。
func loadCloudNames(db *gorm.DB) (map[string]string, error) {
	var dicts []models.CloudDict
	if err := db.Find(&dicts).Error; err != nil {
		return nil, fmt.Errorf("list cloud dict: %w", err)
	}
	out := make(map[string]string, len(dicts))
	for _, d := range dicts {
		out[d.CloudCode] = d.CloudName
	}
	return out, nil
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
	bizCounts      map[string]int // biz_code → 资源数（多数归因，空值不参与）
}

// accumulateResource 把单条资源累加进 by_category / by_app 聚合器。
//   - monitored：该资源是否被 ready+enabled 标准 Job 覆盖（selected[id]）。
//   - subtypeField：该类的子类分组字段；application 传 ""（不拆子类）。
//   - app_code 取值经 models.Resource 接口收敛（host 走 AppCode 物理列，其他走各自
//     AppName 物理列，统一由 GetAppCode() 暴露，见 M07 决策 92）。空串记为「未归类」。
//   - 未归类口径（决策 93，M05 消费）：biz_code 空计为「未归类业务」、app_code 空计为
//     「未归类应用」，两者并存互不替代——本接口按 app_code 空聚合「未归类应用」计数，
//     biz_code 空侧的「未归类业务」由 M05 侧按资源 biz_code 空值消费，不再额外加字段。
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
		aa = &appAgg{bizCounts: make(map[string]int)}
		apps[app] = aa
	}
	aa.resourceCount++
	if monitored {
		aa.monitoredCount++
	}
	// 业务域多数归因（决策 92/93/95）：资源侧 biz_code 非空才参与计数（空值视为
	// 「未归类业务」，由 M05 侧按资源 biz_code 空值消费，不在此聚合）。
	if biz, ok := models.GetResourceField(res, "biz_code"); ok && biz != "" {
		aa.bizCounts[biz]++
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
	case *models.InterfaceService:
		var xs []models.InterfaceService
		if err := db.Find(&xs).Error; err != nil {
			return nil, fmt.Errorf("list interface services: %w", err)
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
	case models.ResourceCategoryInterfaceService:
		return "" // 接口服务不按子类拆
	default:
		return "" // application 不按子类拆
	}
}

// loadSelectedResourceIDs 聚合 ready+enabled 采集 Job（**所有 job_type**）的
// selected_instance_ids 并集（去重，元素为 M07 resource_id）。
//
// H9 统一口径：拨测（blackbox）目标改走资源选择后，其选中关系同样计入「已监控」——
// 判定条件与 platform/query/coverage.go 的 loadSelectedInstances（不按 job_type 过滤）
// 严格一致，避免同一资源在覆盖率里算已监控、在首页 monitored_count 里不算。读侧只
// 消费 M01 选中关系、不反向修改 M01。
func loadSelectedResourceIDs(db *gorm.DB) (map[string]bool, error) {
	selected := make(map[string]bool)

	var jobs []models.ScrapeJob
	if err := db.Model(&models.ScrapeJob{}).
		Select("selected_instance_ids").
		Where("draft_status = ? AND enabled = ?", scrapeJobDraftReady, true).
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
func SummaryHandler(db *gorm.DB, opts ...Option) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, err := Build(db, opts...)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, s)
	}
}
