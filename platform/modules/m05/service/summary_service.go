package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m05/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m05/repository"
)

// The six fixed resource categories, in contract order. The frontend
// `ResourceTypeGrid` renders by_category positionally, so the order is part of
// the payload contract (same order as v2 `models.ValidResourceCategories()`).
var resourceCategories = []string{
	"host",
	"database",
	"middleware",
	"application",
	"generic_target",
	"interface_service",
}

// subtypeCategories are the four categories that expose a by_subtype axis;
// application / interface_service always return an empty array.
var subtypeCategories = []string{"host", "database", "middleware", "generic_target"}

// —— 与 v2 `platform/dashboard/summary.go` 保持一致的呈现约定 ——
//
// 这些常量是前端契约的一部分（PlatformAppMatrixPanel 也硬编码了 "__other__"）。
// v2 中它们是未导出的包级常量，v3 复制一份并注明同口径，避免 m05 反向修改
// legacy dashboard 包。
const (
	// platformAppTopPlatforms 平台收敛阈值：按主机台数降序取前 N 个单独成行，
	// 其余平台合并进「其他」行（只改呈现粒度，不改合计）。
	platformAppTopPlatforms = 4
	// platformAppOtherCode 「其他」聚合行的 platform_code（真实平台编码正则不含下划线）。
	platformAppOtherCode = "__other__"
	// platformAppOtherName / platformAppUnsetName / platformAppUnsetAppName 固定展示名。
	platformAppOtherName    = "其他"
	platformAppUnsetName    = "未指定平台"
	platformAppUnsetAppName = "未指定应用"
	// cloudUnsetName 「未指定云」兜底行展示名。
	cloudUnsetName = "未指定云"
)

// blackbox job_type value (m01_scrape_jobs.job_type CHECK constraint).
const jobTypeBlackbox = "blackbox"

// SummaryService builds the v3 homepage aggregate.
//
// 所有 count 口径与 v2 首页一致，但数据源换成 v3 共享 schema：`resources` 一张表
// + 六类扩展表（by_subtype），`m01_scrape_jobs.selected_instance_ids` 是「已监控」
// 的唯一事实来源，`network_domains` 是云归属（cloud_code）的唯一权威来源。
type SummaryService struct {
	repo   repository.SummaryRepository
	health domain.UpHealthQuerier
}

// NewSummaryService constructs the summary service. A nil health querier means
// "Prometheus not injected": collection_health stays nil (omitted) and the
// frontend renders the panel as unavailable instead of a false zero.
func NewSummaryService(repo repository.SummaryRepository, health domain.UpHealthQuerier) *SummaryService {
	return &SummaryService{repo: repo, health: health}
}

// readyJob is one effective scrape job with its selected instance IDs decoded.
type readyJob struct {
	ID                  string
	JobType             string
	NetworkDomainID     string
	SelectedInstanceIDs []string
}

// summaryInput is the immutable read model the aggregate is built from.
type summaryInput struct {
	resources   []repository.ResourceRow
	subtypes    map[string]map[string]string // category → resource_id → subtype
	jobs        []readyJob
	jobCounts   repository.JobCounts
	domainCount int64
	domains     []repository.DomainRow

	appNames      map[string]string
	bizNames      map[string]string
	platformNames map[string]string
	cloudNames    map[string]string

	appPlatformRels   []repository.AppPlatformRelRow
	interfaceServices map[string]repository.ProbeEndpoint
	applications      map[string]repository.ProbeEndpoint
}

// Build returns the homepage summary. Slice fields are always non-nil (an empty
// database yields []), matching the frontend contract.
func (s *SummaryService) Build(ctx context.Context) (*dto.Summary, error) {
	input, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	summary, dispatched := assembleSummary(input)

	// collection_health：注入 PromURL 时按 up 样本分类已下发资源；查询失败降级为
	// nil（字段省略），绝不误报 0（决策 68-2 / 与 v2 同口径）。
	if s.health != nil {
		if idx, err := s.health.UpHealth(ctx); err == nil {
			if counts := domain.ClassifyUpHealth(dispatched, idx); counts != nil {
				summary.CollectionHealth = &dto.CollectionHealth{
					DispatchedCount:        counts.Total,
					CollectingCount:        counts.Collecting,
					PartialCollectingCount: counts.Partial,
					DownCount:              counts.Down,
				}
			}
		}
	}
	return summary, nil
}

// load reads every table the aggregate needs.
func (s *SummaryService) load(ctx context.Context) (*summaryInput, error) {
	resources, err := s.repo.Resources(ctx)
	if err != nil {
		return nil, err
	}

	subtypes := make(map[string]map[string]string, len(subtypeCategories))
	for _, category := range subtypeCategories {
		byResource, err := s.repo.ResourceSubtypes(ctx, category)
		if err != nil {
			return nil, err
		}
		subtypes[category] = byResource
	}

	jobRows, err := s.repo.ReadyJobs(ctx)
	if err != nil {
		return nil, err
	}
	jobs := make([]readyJob, 0, len(jobRows))
	for _, row := range jobRows {
		ids, err := decodeSelectedInstanceIDs(row)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, readyJob{
			ID:                  row.ID,
			JobType:             row.JobType,
			NetworkDomainID:     row.NetworkDomainID,
			SelectedInstanceIDs: ids,
		})
	}

	jobCounts, err := s.repo.ScrapeJobCounts(ctx)
	if err != nil {
		return nil, err
	}
	domainCount, err := s.repo.MonitoredDomainCount(ctx)
	if err != nil {
		return nil, err
	}
	domains, err := s.repo.Domains(ctx)
	if err != nil {
		return nil, err
	}
	appNames, err := s.repo.AppNames(ctx)
	if err != nil {
		return nil, err
	}
	bizNames, err := s.repo.BizNames(ctx)
	if err != nil {
		return nil, err
	}
	platformNames, err := s.repo.PlatformNames(ctx)
	if err != nil {
		return nil, err
	}
	cloudNames, err := s.repo.CloudNames(ctx)
	if err != nil {
		return nil, err
	}
	rels, err := s.repo.AppPlatformRels(ctx)
	if err != nil {
		return nil, err
	}

	probeIDs := probeResourceIDs(jobs)
	interfaceServices, err := s.repo.InterfaceServices(ctx, probeIDs)
	if err != nil {
		return nil, err
	}
	applications, err := s.repo.Applications(ctx, probeIDs)
	if err != nil {
		return nil, err
	}

	return &summaryInput{
		resources:         resources,
		subtypes:          subtypes,
		jobs:              jobs,
		jobCounts:         jobCounts,
		domainCount:       domainCount,
		domains:           domains,
		appNames:          appNames,
		bizNames:          bizNames,
		platformNames:     platformNames,
		cloudNames:        cloudNames,
		appPlatformRels:   rels,
		interfaceServices: interfaceServices,
		applications:      applications,
	}, nil
}

// decodeSelectedInstanceIDs parses m01_scrape_jobs.selected_instance_ids
// (JSON array; TEXT in SQLite, jsonb in PostgreSQL).
func decodeSelectedInstanceIDs(row repository.JobRow) ([]string, error) {
	if len(row.SelectedInstanceIDs) == 0 {
		return nil, nil
	}
	var ids []string
	if err := json.Unmarshal(row.SelectedInstanceIDs, &ids); err != nil {
		return nil, fmt.Errorf("decode selected_instance_ids of scrape job %q: %w", row.ID, err)
	}
	return ids, nil
}

// probeResourceIDs collects (deduplicated) selected IDs of blackbox jobs.
func probeResourceIDs(jobs []readyJob) []string {
	seen := make(map[string]struct{})
	ids := make([]string, 0)
	for _, job := range jobs {
		if job.JobType != jobTypeBlackbox {
			continue
		}
		for _, id := range job.SelectedInstanceIDs {
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	return ids
}

// categoryAgg accumulates one resource category.
type categoryAgg struct {
	resourceCount  int
	monitoredCount int
	subtypes       map[string]*subtypeAgg
}

// subtypeAgg accumulates one by_subtype bucket.
type subtypeAgg struct {
	resourceCount  int
	monitoredCount int
}

// appAgg accumulates one by_app row.
type appAgg struct {
	resourceCount  int
	monitoredCount int
	bizCounts      map[string]int
}

// cloudAgg accumulates one by_cloud row.
type cloudAgg struct {
	resourceCount  int
	monitoredCount int
}

// assembleSummary turns the read model into the response payload. It also
// returns the dispatched (monitored ∩ live) resource IDs, the denominator of
// collection_health.
func assembleSummary(in *summaryInput) (*dto.Summary, []string) {
	summary := &dto.Summary{
		ByCategory:    []dto.CategorySummary{},
		ByApp:         []dto.AppSummary{},
		ProbeTargets:  []dto.ProbeTargetItem{},
		ByPlatformApp: []dto.PlatformAppSummary{},
		ByCloud:       []dto.CloudSummary{},
	}

	// Live resource index: a selected ID only counts as monitored while its
	// resource row still exists (soft-deleted resources drop out).
	live := make(map[string]repository.ResourceRow, len(in.resources))
	for _, res := range in.resources {
		live[res.ResourceID] = res
	}
	selected := make(map[string]bool)
	for _, job := range in.jobs {
		for _, id := range job.SelectedInstanceIDs {
			if id != "" {
				selected[id] = true
			}
		}
	}

	summary.ResourceCount = len(in.resources)

	// network_domain_id → cloud_code（M06 决策 103 scheme-B 的权威派生源）。
	domainCloudCodes := make(map[string]string, len(in.domains))
	for _, domain := range in.domains {
		domainCloudCodes[domain.ID] = domain.CloudCode
	}

	cats := make(map[string]*categoryAgg, len(resourceCategories))
	apps := make(map[string]*appAgg)
	var unclassifiedResourceCount, unclassifiedMonitoredCount int
	hostPlatformApps := make(map[string]map[string]int)
	hostClouds := make(map[string]*cloudAgg)

	for _, res := range in.resources {
		monitored := selected[res.ResourceID]

		agg := cats[res.ResourceCategory]
		if agg == nil {
			agg = &categoryAgg{subtypes: make(map[string]*subtypeAgg)}
			cats[res.ResourceCategory] = agg
		}
		agg.resourceCount++
		if monitored {
			agg.monitoredCount++
		}
		if byResource, ok := in.subtypes[res.ResourceCategory]; ok {
			subtype := byResource[res.ResourceID]
			sub := agg.subtypes[subtype]
			if sub == nil {
				sub = &subtypeAgg{}
				agg.subtypes[subtype] = sub
			}
			sub.resourceCount++
			if monitored {
				sub.monitoredCount++
			}
		}

		if res.AppCode == "" {
			unclassifiedResourceCount++
			if monitored {
				unclassifiedMonitoredCount++
			}
		} else {
			app := apps[res.AppCode]
			if app == nil {
				app = &appAgg{bizCounts: make(map[string]int)}
				apps[res.AppCode] = app
			}
			app.resourceCount++
			if monitored {
				app.monitoredCount++
			}
			// 业务域多数归因：空 biz_code 不参与（记为「未归类业务」）。
			if res.BizCode != "" {
				app.bizCounts[res.BizCode]++
			}
		}

		// 平台矩阵 / 按云分布都只统计 host（每台主机恰有一个平台 + 一个应用 + 一个网域）。
		if res.ResourceCategory == "host" {
			accumulateHostCell(hostPlatformApps, res.PlatformCode, res.AppCode)
			accumulateCloudCell(hostClouds, domainCloudCodes[res.NetworkDomainID], monitored)
		}
	}

	// monitored_count = selected ∩ live；dispatched 同时作为采集健康的分母。
	dispatched := make([]string, 0, len(selected))
	for id := range selected {
		if _, ok := live[id]; !ok {
			continue
		}
		summary.MonitoredCount++
		dispatched = append(dispatched, id)
	}
	sort.Strings(dispatched)

	summary.ScrapeJobCount = int(in.jobCounts.Total)
	summary.ScrapeJobEnabledCount = int(in.jobCounts.Enabled)
	summary.DomainCount = int(in.domainCount)

	summary.ByCategory = buildCategorySummary(cats)
	summary.ByApp = buildAppSummary(apps, in.appNames, in.bizNames)
	summary.UnclassifiedResourceCount = unclassifiedResourceCount
	summary.UnclassifiedMonitoredCount = unclassifiedMonitoredCount

	summary.ByPlatformApp = buildPlatformAppSummary(hostPlatformApps, in.platformNames, in.appNames)
	summary.ByCloud = buildCloudSummary(hostClouds, in.cloudNames)

	summary.ProbeTargets = buildProbeTargets(in, live)
	summary.ProbeTargetCount = len(summary.ProbeTargets)
	// 拨测状态恒为「未知」口径（未接 probe_success 查询），故异常数恒 0。
	summary.ProbeTargetAbnormalCount = 0

	return summary, dispatched
}

// buildCategorySummary assembles the six fixed by_category rows. Missing
// categories still produce a zero-valued row (the frontend renders six cards).
func buildCategorySummary(cats map[string]*categoryAgg) []dto.CategorySummary {
	out := make([]dto.CategorySummary, 0, len(resourceCategories))
	for _, category := range resourceCategories {
		row := dto.CategorySummary{
			ResourceCategory: category,
			BySubtype:        []dto.SubtypeSummary{},
		}
		if agg := cats[category]; agg != nil {
			row.ResourceCount = agg.resourceCount
			row.MonitoredCount = agg.monitoredCount
			subtypes := make([]string, 0, len(agg.subtypes))
			for subtype := range agg.subtypes {
				subtypes = append(subtypes, subtype)
			}
			// v2 iterated the map (non-deterministic order); v3 sorts so the
			// payload is reproducible (frontend does not depend on the order).
			sort.Strings(subtypes)
			for _, subtype := range subtypes {
				sub := agg.subtypes[subtype]
				row.BySubtype = append(row.BySubtype, dto.SubtypeSummary{
					Subtype:        subtype,
					ResourceCount:  sub.resourceCount,
					MonitoredCount: sub.monitoredCount,
				})
			}
		}
		out = append(out, row)
	}
	return out
}

// buildAppSummary assembles by_app rows: app_name from the application
// dictionary (fallback app_code), biz attribution by majority with a
// deterministic tie-break (smaller biz code wins, as in v2).
func buildAppSummary(apps map[string]*appAgg, appNames, bizNames map[string]string) []dto.AppSummary {
	out := make([]dto.AppSummary, 0, len(apps))
	for code, agg := range apps {
		var bizCode string
		bestCount := 0
		for candidate, count := range agg.bizCounts {
			if count > bestCount || (count == bestCount && candidate < bizCode) {
				bizCode, bestCount = candidate, count
			}
		}
		bizName := ""
		if bizCode != "" {
			bizName = bizNames[bizCode]
			if bizName == "" {
				bizName = bizCode
			}
		}
		out = append(out, dto.AppSummary{
			AppCode:        code,
			AppName:        resolveAppName(code, appNames),
			BizCode:        bizCode,
			BizName:        bizName,
			ResourceCount:  agg.resourceCount,
			MonitoredCount: agg.monitoredCount,
		})
	}
	// v2 emitted map order; v3 sorts by size then code so the payload and the
	// eventual consumer tests are stable.
	sort.Slice(out, func(i, j int) bool {
		if out[i].ResourceCount != out[j].ResourceCount {
			return out[i].ResourceCount > out[j].ResourceCount
		}
		return out[i].AppCode < out[j].AppCode
	})
	return out
}

// accumulateHostCell bumps one (platform_code, app_code) host counter.
func accumulateHostCell(cells map[string]map[string]int, platformCode, appCode string) {
	row := cells[platformCode]
	if row == nil {
		row = make(map[string]int)
		cells[platformCode] = row
	}
	row[appCode]++
}

// buildPlatformAppSummary assembles the「平台 × 应用 · 主机数」matrix（与 v2 同规则）：
//  1. 「未指定平台」恒单独成行、不占 Top N 名额，且排末位；
//  2. 真实平台按主机台数降序取前 4 个，其余合并进「其他」行（不改合计）；
//  3. 空 app_code 归「未指定应用」列，恒保留。
//
// 名称一律「字典 → 回落编码」，仅空串 /「其他」两处给固定展示名。
func buildPlatformAppSummary(
	hostCells map[string]map[string]int,
	platformNames map[string]string,
	appNames map[string]string,
) []dto.PlatformAppSummary {
	platformTotals := make(map[string]int, len(hostCells))
	for platformCode, row := range hostCells {
		total := 0
		for _, count := range row {
			total += count
		}
		platformTotals[platformCode] = total
	}

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

	out := make([]dto.PlatformAppSummary, 0, len(codes)+2)
	otherRow := make(map[string]int)
	for rank, code := range codes {
		if rank >= platformAppTopPlatforms {
			for appCode, count := range hostCells[code] {
				otherRow[appCode] += count
			}
			continue
		}
		out = append(out, platformAppRow(code, hostCells[code], platformNames, appNames))
	}
	if len(otherRow) > 0 {
		out = append(out, platformAppRow(platformAppOtherCode, otherRow, platformNames, appNames))
	}
	if unsetRow := hostCells[""]; len(unsetRow) > 0 {
		out = append(out, platformAppRow("", unsetRow, platformNames, appNames))
	}
	return out
}

// platformAppRow renders one matrix row (cells sorted by host count then app code).
func platformAppRow(
	platformCode string,
	row map[string]int,
	platformNames map[string]string,
	appNames map[string]string,
) dto.PlatformAppSummary {
	appCodes := make([]string, 0, len(row))
	total := 0
	for appCode, count := range row {
		appCodes = append(appCodes, appCode)
		total += count
	}
	sort.Slice(appCodes, func(i, j int) bool {
		if row[appCodes[i]] != row[appCodes[j]] {
			return row[appCodes[i]] > row[appCodes[j]]
		}
		return appCodes[i] < appCodes[j]
	})

	cells := make([]dto.PlatformAppCell, 0, len(appCodes))
	for _, appCode := range appCodes {
		cells = append(cells, dto.PlatformAppCell{
			AppCode:   appCode,
			AppName:   resolveAppName(appCode, appNames),
			HostCount: row[appCode],
		})
	}
	return dto.PlatformAppSummary{
		PlatformCode: platformCode,
		PlatformName: resolvePlatformName(platformCode, platformNames),
		Cells:        cells,
		HostCount:    total,
	}
}

// resolvePlatformName 平台展示名：字典 → 回落编码；空串与「其他」给固定名。
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

// resolveAppName 应用展示名：字典 → 回落编码；空串给固定名「未指定应用」。
func resolveAppName(code string, appNames map[string]string) string {
	if code == "" {
		return platformAppUnsetAppName
	}
	if name := appNames[code]; name != "" {
		return name
	}
	return code
}

// accumulateCloudCell bumps one cloud_code host counter (monitored subset too).
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

// buildCloudSummary assembles by_cloud（与 v2 同规则）：分组轴只有 cloud_code，
// 按主机台数降序，「未指定云」恒排末位、存在才输出；coverage_rate 为整数除法。
func buildCloudSummary(aggs map[string]*cloudAgg, cloudNames map[string]string) []dto.CloudSummary {
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

	out := make([]dto.CloudSummary, 0, len(codes)+1)
	for _, code := range codes {
		out = append(out, cloudSummaryRow(code, aggs[code], cloudNames))
	}
	if agg := aggs[""]; agg != nil {
		out = append(out, cloudSummaryRow("", agg, cloudNames))
	}
	return out
}

// cloudSummaryRow renders one by_cloud row (coverage_rate guards division by 0).
func cloudSummaryRow(code string, agg *cloudAgg, cloudNames map[string]string) dto.CloudSummary {
	row := dto.CloudSummary{
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

// resolveCloudName 云展示名：字典 → 回落编码；空串给固定名「未指定云」。
func resolveCloudName(code string, cloudNames map[string]string) string {
	if code == "" {
		return cloudUnsetName
	}
	if name := cloudNames[code]; name != "" {
		return name
	}
	return code
}

// buildProbeTargets assembles the blackbox target rows.
//
// 目标来自 enabled+ready blackbox job 的 selected_instance_ids，仅保留仍是存活
// interface_service / application 资源的目标；地址取 api_url / health_check_url，
// 展示名取 api_name / 应用字典名。status 恒为空串（"unknown" 口径）、
// last_probe_at 恒 nil、异常数恒 0：v3 尚未接 probe_success 查询，宁缺不臆造。
func buildProbeTargets(in *summaryInput, live map[string]repository.ResourceRow) []dto.ProbeTargetItem {
	items := make([]dto.ProbeTargetItem, 0)

	domainNames := make(map[string]string, len(in.domains))
	for _, domain := range in.domains {
		domainNames[domain.ID] = domain.Name
	}
	appPlatformNames := appPlatformDisplayNames(in.appPlatformRels, in.platformNames)

	for _, job := range in.jobs {
		if job.JobType != jobTypeBlackbox {
			continue
		}
		domainName := domainNames[job.NetworkDomainID]
		if domainName == "" {
			// 字典缺条目回落网域 ID（与 v2 同口径，不留空、不编造）。
			domainName = job.NetworkDomainID
		}
		for _, resourceID := range job.SelectedInstanceIDs {
			res, ok := live[resourceID]
			if !ok {
				continue // 资源已软删：不计入拨测目标
			}
			item := dto.ProbeTargetItem{
				ResourceCategory:  res.ResourceCategory,
				NetworkDomainID:   job.NetworkDomainID,
				NetworkDomainName: domainName,
				LastProbeAt:       nil,
			}
			switch res.ResourceCategory {
			case "interface_service":
				endpoint, ok := in.interfaceServices[resourceID]
				if !ok || endpoint.URL == "" {
					continue
				}
				item.URL = endpoint.URL
				item.ServiceName = endpoint.Name
				// 接口服务不归属平台：platform_names 恒为空串。
				item.PlatformNames = ""
			case "application":
				endpoint, ok := in.applications[resourceID]
				if !ok || endpoint.URL == "" {
					continue
				}
				item.URL = endpoint.URL
				item.ServiceName = probeAppName(res.AppCode, in.appNames)
				item.PlatformNames = probePlatformNames(res, appPlatformNames, in.platformNames)
			default:
				continue // 非拨测资源类别：不产出目标
			}
			items = append(items, item)
		}
	}
	return items
}

// appPlatformDisplayNames folds app_platform_rels into app_code → sorted
// platform display names（同一应用可部署在多个平台，展示时「、」连接）。
func appPlatformDisplayNames(rels []repository.AppPlatformRelRow, platformNames map[string]string) map[string][]string {
	out := make(map[string][]string, len(rels))
	for _, rel := range rels {
		name := platformNames[rel.PlatformCode]
		if name == "" {
			name = rel.PlatformCode
		}
		if name == "" {
			continue
		}
		out[rel.AppCode] = append(out[rel.AppCode], name)
	}
	for code, names := range out {
		sort.Strings(names)
		out[code] = names
	}
	return out
}

// probeAppName 拨测目标展示名（应用类）：应用字典名 → 回落 app_code（v2 同口径，
// 这里的回落是「不臆造」，空 app_code 保持空串由前端显示 '-'）。
func probeAppName(appCode string, appNames map[string]string) string {
	if name := appNames[appCode]; name != "" {
		return name
	}
	return appCode
}

// probePlatformNames 应用类拨测目标的平台展示：优先应用↔平台 M:N 关联（「、」连接），
// 无关联时回落资源行 platform_code（字典缺条目回落编码）。
func probePlatformNames(res repository.ResourceRow, appPlatformNames map[string][]string, platformNames map[string]string) string {
	if names := appPlatformNames[res.AppCode]; len(names) > 0 {
		return strings.Join(names, "、")
	}
	if res.PlatformCode == "" {
		return ""
	}
	if name := platformNames[res.PlatformCode]; name != "" {
		return name
	}
	return res.PlatformCode
}
