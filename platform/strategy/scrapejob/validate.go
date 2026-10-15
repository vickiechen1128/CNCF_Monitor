package scrapejob

import (
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// io 常量：下拉所需已纳管网域的校验与默认实例选择方式。
const (
	defaultInstanceSelection = models.InstanceSelectionManual
)

// validateJobRequest 校验 ScrapeJob 创建/更新请求的基础业务规则
// （api-contract-snapshot §5/§10 决策31）：
//   - network_domain_id 必填且 is_monitored=true 且 status=enabled（冻结 bad_request）
//   - monitor_type ∈ ValidMonitorTypes（standard）
//   - 采集参数可留空（F-28）：留空=继承映射/模板/全局默认，保存时由
//     resolveJobScrapeParams 解析为生效快照；**例外** application_http 的
//     metrics_path 必须显式填写（应用指标端点无通用默认值）
//   - 采集器联动（validateExporterForMonitorType）：standard 任务的 monitor_type
//     必须有可用采集器（内置目录/已登记模板声明支持，或有 is_default 默认采集配置
//     兜底）；application_http 直采端点，留空 exporter_template_id 放行
//   - 认证TLS：basic→username+password 必填；bearer→token 必填；password/token 仅存储
//   - blackbox：blackbox_module 必填 + **从资源选择目标**（resource_type 合法类别 +
//     target_field 为该类别可读字段 + selected_instance_ids 非空且逐条命中该类别资源表）；
//     手填 blackbox_targets 一律拒绝；monitor_type / exporter_template_id 置空
//   - instance_selection_mode 默认 manual
//   - scrape_interval / scrape_timeout 非空时须为带单位的 Prometheus duration
//     字面量（裸数字如 "180" 会被 promtool check config 拒绝，2026-10-12 诊断）
func validateJobRequest(db *gorm.DB, job *models.ScrapeJob) error {
	if strings.TrimSpace(job.JobName) == "" {
		return fmt.Errorf("job_name 不能为空")
	}
	if job.NetworkDomainID == "" {
		return fmt.Errorf("network_domain_id 必填（须为已纳管且非冻结的网域）")
	}
	if err := validateNetworkDomain(db, job.NetworkDomainID); err != nil {
		return err
	}
	// 时长校验：空串合法（F-28 留空=继承，保存时由 resolveJobScrapeParams 回落
	// 层叠默认）；非空但缺单位（如 "180"）在保存时即拦为 bad_request，避免留到
	// 变更单外部校验才失败，用户还要回头重新编辑下发。
	if job.ScrapeInterval != "" && !models.ValidPromDuration(job.ScrapeInterval) {
		return fmt.Errorf("scrape_interval %q 非法：须为带单位的时长（如 15s/1m/2h），单位可选 ms/s/m/h/d/w/y", job.ScrapeInterval)
	}
	if job.ScrapeTimeout != "" && !models.ValidPromDuration(job.ScrapeTimeout) {
		return fmt.Errorf("scrape_timeout %q 非法：须为带单位的时长（如 10s/30s），单位可选 ms/s/m/h/d/w/y", job.ScrapeTimeout)
	}
	if job.InstanceSelectionMode == "" {
		job.InstanceSelectionMode = defaultInstanceSelection
	}
	if job.JobType != models.JobTypeStandard && job.JobType != models.JobTypeBlackbox {
		return fmt.Errorf("job_type 非法，可选 standard/blackbox")
	}

	switch job.JobType {
	case models.JobTypeBlackbox:
		// blackbox：不绑定 monitor_type / exporter，二者保持置空——H13：重新填
		// MonitorType 会触发 validateExporterForMonitorType / LoadExporterPort 副作用。
		// 拨测与采集同构：由用户选资源类别（ResourceType）+ 探测地址字段（TargetField）+
		// 实例（SelectedInstanceIDs）。类别不预设、字段不预设，一律由用户选择。
		job.MonitorType = ""
		job.ExporterTemplateID = ""
		if strings.TrimSpace(job.BlackboxModule) == "" {
			return fmt.Errorf("job_type=blackbox 时 blackbox_module 必填")
		}
		// 手填模式彻底禁用：任何非空 blackbox_targets 一律拒绝（不做存量迁移，
		// 见实施计划 D2）。
		if len(job.BlackboxTargets) > 0 {
			return fmt.Errorf("拨测任务已改为从资源选择，不再支持手填 blackbox_targets；请清空后改用 selected_instance_ids")
		}
		if !validResourceCategory(models.ResourceCategory(job.ResourceType)) {
			return fmt.Errorf("拨测任务必须选择合法的资源类别 resource_type，当前 %q（可选 %s）", job.ResourceType, models.CategoriesHint())
		}
		if len(job.SelectedInstanceIDs) == 0 {
			return fmt.Errorf("拨测任务必须选择探测实例（selected_instance_ids 不能为空）")
		}
		if strings.TrimSpace(job.TargetField) == "" {
			return fmt.Errorf("拨测任务必须指定探测地址字段 target_field（从所选资源类别的字段中选择一个）")
		}
		if _, ok := models.LegacyFieldMap(models.ResourceCategory(job.ResourceType))[job.TargetField]; !ok {
			return fmt.Errorf("target_field %q 不是资源类别 %q 的可读字段，请从该类别字段中选择", job.TargetField, job.ResourceType)
		}
	default:
		// standard：monitor_type 合法即可。采集参数（scrape_interval/scrape_timeout/
		// metrics_path/scheme）允许留空（F-28 层叠默认）：留空=继承下层默认，
		// 由 resolveJobScrapeParams 在保存时解析为生效快照（映射→模板→全局兜底）。
		if !models.ValidMonitorType(job.MonitorType) {
			return fmt.Errorf("monitor_type %q 非法", job.MonitorType)
		}
		// application_http：采集路径必须显式填写。application 的采集地址（主机 + 采集
		// 端口）由 M07 资源台账给出（generator 拼接 endpoint:port），而「指标落在哪个
		// 路径、用什么协议」由本 Job 决定；应用指标端点没有通用默认值，留空继承 /metrics
		// 会静默抓不到样本，故在此强制显式填写。
		if job.MonitorType == models.MonitorTypeApplicationHTTP && strings.TrimSpace(job.MetricsPath) == "" {
			return fmt.Errorf("monitor_type=application_http 时必须填写采集路径 metrics_path（例如 /actuator/prometheus）；应用指标端点没有通用默认值，不能留空继承")
		}
		// 采集器联动：monitor_type 必须有可用采集器，否则保存时报错而不是留到运行时
		// 静默 up=0（详见 validateExporterForMonitorType）。
		if err := validateExporterForMonitorType(db, job); err != nil {
			return err
		}
	}

	// 认证TLS（决策31）。
	switch job.AuthType {
	case models.AuthTypeNone:
		// 无认证：清除遗留的认证字段，避免残留明文。
		job.Username = ""
		job.Password = ""
		job.Token = ""
	case models.AuthTypeBasic:
		if strings.TrimSpace(job.Username) == "" || strings.TrimSpace(job.Password) == "" {
			return fmt.Errorf("auth_type=basic 时 username 与 password 必填")
		}
		job.Token = ""
	case models.AuthTypeBearer:
		if strings.TrimSpace(job.Token) == "" {
			return fmt.Errorf("auth_type=bearer 时 token 必填")
		}
		job.Username = ""
		job.Password = ""
	default:
		job.AuthType = models.AuthTypeNone
	}

	// 保存时回收失效实例引用（根治编辑死锁）：资源在 CMDB 被软删后
	// selected_instance_ids 无人回收，而前端实例选择器只列存活资源——用户既看不到
	// 也无法取消勾选这些失效 ID，编辑任何字段（如 scrape_interval）回传旧 ID 都会被
	// 网域校验拦下，形成"改任何参数都报错"的死锁。这里统一剔除已不存在（含软删）
	// 的引用；**存活但跨网域**的引用不剔除——那是真正的配置错误，仍由
	// validateSelectedInstancesDomain 拦为 bad_request。
	reclaimMissingInstanceIDs(db, job)

	// 已选实例须属于同一网域（非同域 bad_request）。
	if err := validateSelectedInstancesDomain(db, job); err != nil {
		return err
	}

	// 黑盒拨测：所选实例必须属于 job.ResourceType 指定的资源类别。放在 reclaim / 网域
	// 校验之后：失效引用已回收、跨网域已拦下，此处再对存活引用做类别归属判定。
	if job.JobType == models.JobTypeBlackbox {
		if err := validateBlackboxSelectedInstances(db, job); err != nil {
			return err
		}
	}
	return nil
}

// validateBlackboxSelectedInstances 逐条校验黑盒拨测任务所选实例均命中
// job.ResourceType（资源类别）对应的资源表——拨测目标 = 该类别实例在 job.TargetField
// 上的值，选到别类别资源会导致生成侧解析不到该字段（拨测必失败）。
func validateBlackboxSelectedInstances(db *gorm.DB, job *models.ScrapeJob) error {
	model := resourceModelForCategory(models.ResourceCategory(job.ResourceType))
	if model == nil {
		return fmt.Errorf("拨测任务资源类别 %q 非法", job.ResourceType)
	}
	for _, id := range job.SelectedInstanceIDs {
		var count int64
		if err := db.Model(model).
			Where("resource_id = ?", id).Count(&count).Error; err != nil {
			return fmt.Errorf("check %s %q: %w", job.ResourceType, id, err)
		}
		if count == 0 {
			return fmt.Errorf("所选实例 %q 不属于资源类别 %q；拨测任务必须选择该类别下的实例", id, job.ResourceType)
		}
	}
	return nil
}

// resourceModelForCategory 返回某个资源类别对应的 GORM 模型（用于按类别归属判定），
// 未知类别返回 nil。六类与 models.ValidResourceCategories() 一一对应。
func resourceModelForCategory(cat models.ResourceCategory) interface{} {
	switch cat {
	case models.ResourceCategoryHost:
		return &models.Host{}
	case models.ResourceCategoryDatabase:
		return &models.Database{}
	case models.ResourceCategoryMiddleware:
		return &models.Middleware{}
	case models.ResourceCategoryApplication:
		return &models.Application{}
	case models.ResourceCategoryGenericTarget:
		return &models.GenericTarget{}
	case models.ResourceCategoryInterfaceService:
		return &models.InterfaceService{}
	}
	return nil
}

// reclaimMissingInstanceIDs 剔除 job.SelectedInstanceIDs 中已不存在（含软删）的
// 资源引用。存活引用原样保留（含跨网域的，交由域校验拦截）。
func reclaimMissingInstanceIDs(db *gorm.DB, job *models.ScrapeJob) {
	if len(job.SelectedInstanceIDs) == 0 {
		return
	}
	kept := make([]string, 0, len(job.SelectedInstanceIDs))
	dropped := 0
	for _, id := range job.SelectedInstanceIDs {
		if _, _, _, alive := lookupResourceMeta(db, id, false); alive {
			kept = append(kept, id)
		} else {
			dropped++
		}
	}
	if dropped > 0 {
		log.Printf("[scrapejob] job %q 保存时回收 %d 个失效实例引用（资源已删除或不存在）", job.JobName, dropped)
		job.SelectedInstanceIDs = kept
	}
}

// validateNetworkDomain 校验网域已纳管且非冻结：is_monitored=true 且 status=enabled
// （用户决策，Module_01 §5.4 / §10）。
func validateNetworkDomain(db *gorm.DB, domainID string) error {
	var domain models.NetworkDomain
	if err := db.First(&domain, "id = ?", domainID).Error; err != nil {
		return fmt.Errorf("network_domain_id %q 不存在", domainID)
	}
	if !domain.IsMonitored {
		return fmt.Errorf("网域 %q 未纳管（is_monitored=false），禁止创建采集任务", domainID)
	}
	if domain.Status != models.DomainStatusEnabled {
		return fmt.Errorf("网域 %q 已冻结（status=%s），禁止创建采集任务", domainID, domain.Status)
	}
	return nil
}

// validateSelectedInstancesDomain 校验 job.SelectedInstanceIDs 均属于 job 的网域
// （非同域 bad_request）。空选择集（手填 exporter 场景）直接通过。
// 校验失败时经 describeInstanceRejection 解析真实原因并生成带实例名的文案。
func validateSelectedInstancesDomain(db *gorm.DB, job *models.ScrapeJob) error {
	if len(job.SelectedInstanceIDs) == 0 {
		return nil
	}
	for _, id := range job.SelectedInstanceIDs {
		ok, err := resourceInDomain(db, id, job.NetworkDomainID)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("%s", describeInstanceRejection(db, id, job.NetworkDomainID))
		}
	}
	return nil
}

// describeInstanceRejection 解析「已选实例未通过网域校验」的真实原因，生成带实例名
// 的可操作文案（不暴露裸 UUID——用户不认识资源 ID）。
//
// 存在的理由：GORM 软删过滤让「实例已删除」与「实例属于其他网域」在资源查询中同样
// 表现为查不到；旧文案一律报「不属于网域」，把用户引去排查网域配置（实际该实例的
// 网域就是当前网域）。这里用 Unscoped 复查区分三种情况：
//   - 资源已软删：报「已被删除」，指引从已选实例中移除（实例选择器只列存活资源，
//     保存时由 reclaimMissingInstanceIDs 自动回收，见 validateJobRequest）；
//   - 资源存活但网域不同：报真实归属网域，指引改选本网域实例；
//   - 彻底不存在：报不存在。
func describeInstanceRejection(db *gorm.DB, resourceID, domainID string) string {
	name, _, resDomain, found := lookupResourceMeta(db, resourceID, true) // Unscoped：含软删
	if !found {
		return fmt.Sprintf("实例 %q 不存在（可能已被彻底删除），请从已选实例中移除", resourceID)
	}
	label := strings.TrimSpace(name)
	if label == "" {
		label = resourceID
	}
	if _, _, _, alive := lookupResourceMeta(db, resourceID, false); alive {
		return fmt.Sprintf("实例 %q 属于网域 %q，与本任务网域 %q 不同；请改选本网域实例", label, resDomain, domainID)
	}
	return fmt.Sprintf("实例 %q 已被删除，仍残留在已选实例中；请从已选实例中移除后重试", label)
}

// resourceInDomain 报告 resourceID 资源是否存在于指定网域（host/database/
// middleware/application/generic_target/interface_service 六类任一命中）。
func resourceInDomain(db *gorm.DB, resourceID, domainID string) (bool, error) {
	checks := []struct {
		model interface{}
	}{
		{&models.Host{}},
		{&models.Database{}},
		{&models.Middleware{}},
		{&models.Application{}},
		{&models.GenericTarget{}},
		{&models.InterfaceService{}},
	}
	for _, c := range checks {
		var count int64
		if err := db.Model(c.model).
			Where("resource_id = ? AND network_domain_id = ?", resourceID, domainID).
			Count(&count).Error; err != nil {
			return false, fmt.Errorf("check resource %q in domain: %w", resourceID, err)
		}
		if count > 0 {
			return true, nil
		}
	}
	return false, nil
}

// resolveJobScrapeParams 解析 Job 采集参数的生效快照（F-28 层叠默认 + 稀疏覆盖）。
// 逐字段按以下优先级回落，仅填充留空字段（用户显式填写的值优先，快照语义不变）：
//  1. CITypeExporterMapping（该 monitor_type 的 is_default 映射，可稀疏留空）；
//  2. ExporterTemplate（按 exporter_template_id / 映射引用的采集器，仅 metrics_path/scheme）；
//  3. 全局兜底常量（models.DefaultScrapeInterval/Timeout/MetricsPath/Scheme）。
//
// label_template_id 仅做映射层继承（无更下层默认）。调用方已保证 job.MonitorType 合法。
//
// 归一（normalizeScrapePath）刻意放在本函数入口、层叠默认解析之前：用户填了
// " /actuator/prometheus" 这类带首尾空白的路径时，若不先 trim，"非空但带空白"
// 既不会命中下面的 `== ""` 回落分支、也不会被纠正，会原样进入生效快照，
// 最终生成带前导空格的抓取路径 → 目标应用 404 → up=0 且无业务样本。
// 先归一再解析，"纯空白"也才会退化为真正的"留空"（F-28 恢复继承 / 被
// application_http 校验拦为 bad_request）。
func resolveJobScrapeParams(db *gorm.DB, job *models.ScrapeJob) {
	normalizeScrapePath(job)
	if job.JobType == models.JobTypeBlackbox {
		return
	}
	var m models.CITypeExporterMapping
	found := db.Where("monitor_type = ? AND is_default = ?", job.MonitorType, true).
		First(&m).Error == nil
	if found {
		if job.ScrapeInterval == "" {
			job.ScrapeInterval = m.ScrapeInterval
		}
		if job.ScrapeTimeout == "" {
			job.ScrapeTimeout = m.ScrapeTimeout
		}
		if job.MetricsPath == "" {
			job.MetricsPath = m.MetricsPath
		}
		if job.Scheme == "" {
			job.Scheme = m.Scheme
		}
		if job.LabelTemplateID == "" {
			job.LabelTemplateID = m.LabelTemplateID
		}
	}

	// 模板层回落（仅 metrics_path/scheme 有采集器级默认；端口由生成器
	// LoadExporterPort 单独解析，不在 Job 快照内）。
	if job.MetricsPath == "" || job.Scheme == "" {
		exporterID := job.ExporterTemplateID
		if exporterID == "" && found {
			exporterID = m.ExporterTemplateID
		}
		if id, err := strconv.ParseUint(exporterID, 10, 64); err == nil && id > 0 {
			var tmpl models.ExporterTemplate
			if db.First(&tmpl, id).Error == nil {
				if job.MetricsPath == "" {
					job.MetricsPath = tmpl.MetricsPath
				}
				if job.Scheme == "" {
					job.Scheme = tmpl.Scheme
				}
			}
		}
	}

	// 全局兜底：保证 ready 任务的生效参数永远非空。
	// 例外（application_http）：应用指标端点没有通用默认值（/metrics 对 Spring Boot
	// actuator 之类的容器无效），故不回填全局兜底——留空由 validateJobRequest 拦为
	// bad_request，强制用户显式填写（如 /actuator/prometheus）。
	if job.ScrapeInterval == "" {
		job.ScrapeInterval = models.DefaultScrapeInterval
	}
	if job.ScrapeTimeout == "" {
		job.ScrapeTimeout = models.DefaultScrapeTimeout
	}
	if job.MetricsPath == "" && job.MonitorType != models.MonitorTypeApplicationHTTP {
		job.MetricsPath = models.DefaultMetricsPath
	}
	if job.Scheme == "" {
		job.Scheme = models.DefaultScheme
	}
}

// normalizeScrapePath 归一（trim）采集路径 metrics_path。
//
// 存在的理由：采集路径会被拼进 vmagent 的 scrape 路径原样发往被采集端，
// 首尾空白会生成形如 " http://ip:8081/actuator/prometheus" 的非法请求 →
// 被采集应用返回 404 → 中心 Prometheus instance=... up=0 且无任何业务样本，
// 而用户在界面上"已经改对了"却看不到数据（只差一个不可见空格）。
//
// 语义约束（不破坏 F-28 层叠默认）：
//   - 归一后为空串 ≡ 留空，仍表示"继承下层默认"（映射→模板→全局兜底），
//     resolveJobScrapeParams 的回落分支语义完全不变；
//   - application_http 归一后为空串，由 validateJobRequest 拦为 bad_request
//     （应用指标端点无通用默认值），不会把空串写进库；
//   - 只处理 metrics_path，不动 scheme/scrape_interval/scrape_timeout/认证字段。
func normalizeScrapePath(job *models.ScrapeJob) {
	job.MetricsPath = strings.TrimSpace(job.MetricsPath)
}

// validateExporterForMonitorType 校验采集任务与采集器的联动：monitor_type 必须有
// 可用采集器，把"该类型根本没有采集器"这类配置错误拦在保存时，而不是留到运行时
// 才暴露为中心 Prometheus up=0（用户在界面上完全看不出是配置问题）。
//
// 三条判定：
//  1. 显式选了 exporter_template_id：模板须声明支持该 monitor_type（不匹配报错）。
//     模板不存在/ID 非法不在此拦，交给 exporterExists 统一报（避免重复错误信息）。
//  2. application_http：应用自带指标端点直采（如 Spring Boot /actuator/prometheus），
//     不经采集器中转，留空 exporter_template_id 是既有设计，放行。
//  3. 其余类型留空：必须确有可用采集器——内置采集器目录、已登记的采集器模板、
//     或该类型的默认采集配置（CITypeExporterMapping）任一命中即视为可用。
func validateExporterForMonitorType(db *gorm.DB, job *models.ScrapeJob) error {
	if job.ExporterTemplateID != "" {
		id, err := strconv.ParseUint(job.ExporterTemplateID, 10, 64)
		if err != nil || id == 0 {
			return nil // ID 非法 → exporterExists 报"非法"
		}
		var tmpl models.ExporterTemplate
		if err := db.First(&tmpl, id).Error; err != nil {
			return nil // 模板不存在 → exporterExists 报"不存在"
		}
		if !exporterTemplateSupportsType(&tmpl, job.MonitorType) {
			return fmt.Errorf("采集器 %q 未声明支持监控对象类型 %q（supported_monitor_types=%v）；请改选支持 %s 的采集器模板，或在「采集器模板」中为 %q 补正支持类型",
				tmpl.Name, job.MonitorType, tmpl.SupportedMonitorTypes, job.MonitorType, tmpl.Name)
		}
		return nil
	}

	// application_http 直采端点：不经过采集器，留空 exporter_template_id 合法。
	if job.MonitorType == models.MonitorTypeApplicationHTTP {
		return nil
	}

	supported, err := supportedMonitorTypesByCollector(db)
	if err != nil {
		return err
	}
	for _, mt := range supported {
		if mt == job.MonitorType {
			return nil
		}
	}
	return fmt.Errorf("monitor_type=%s 无可用采集器：内置采集器与已登记采集器模板均未声明支持该类型（当前可用类型：%s）；请先在「采集器模板」中登记支持 %s 的采集器后再创建本任务，或改用拨测（job_type=blackbox）监控",
		job.MonitorType, strings.Join(supported, "/"), job.MonitorType)
}

// exporterTemplateSupportsType 报告采集器模板是否可用于该 monitor_type。
// supported_monitor_types 为空视为未标注（兼容存量登记的采集器）→ 放行，
// 与 ci-exporter.ensureExporterSupportsType（F-27 C）同口径。
func exporterTemplateSupportsType(tmpl *models.ExporterTemplate, monitorType string) bool {
	if len(tmpl.SupportedMonitorTypes) == 0 {
		return true
	}
	for _, t := range tmpl.SupportedMonitorTypes {
		if t == monitorType {
			return true
		}
	}
	return false
}

// supportedMonitorTypesByCollector 汇总平台当前"有采集器可用"的 monitor_type 集合，
// 按 models.ValidMonitorTypes() 顺序返回（顺序稳定，便于错误提示文案可读）：
//   - 内置采集器目录（models.BuiltinExporterTemplates）：内置模板只读禁删
//     （exporter-template/delete.go），是平台采集能力的权威声明，不依赖 seed 是否跑过；
//   - 已登记的采集器模板：用户可自行登记 nginx 等类型的采集器使其变为可用；
//   - 已配置的默认采集配置（CITypeExporterMapping）：其引用的采集器即该类型可用。
func supportedMonitorTypesByCollector(db *gorm.DB) ([]string, error) {
	supported := map[string]bool{}
	mark := func(types []string) {
		for _, t := range types {
			if t = strings.TrimSpace(t); t != "" {
				supported[t] = true
			}
		}
	}
	for _, t := range models.BuiltinExporterTemplates() {
		mark(t.SupportedMonitorTypes)
	}
	var tmpls []models.ExporterTemplate
	if err := db.Find(&tmpls).Error; err != nil {
		return nil, fmt.Errorf("list exporter templates: %w", err)
	}
	for _, t := range tmpls {
		mark(t.SupportedMonitorTypes)
	}
	var mappings []models.CITypeExporterMapping
	if err := db.Find(&mappings).Error; err != nil {
		return nil, fmt.Errorf("list ci-exporter mappings: %w", err)
	}
	for _, m := range mappings {
		mark([]string{m.MonitorType})
	}
	var ordered []string
	for _, mt := range models.ValidMonitorTypes() {
		if supported[mt] {
			ordered = append(ordered, mt)
		}
	}
	return ordered, nil
}

// exporterExists 校验 exporter_template_id（存 ID 字符串）对应采集器存在；
// 非空且非法/不存在返回错误。
func exporterExists(db *gorm.DB, exporterTemplateID string) error {
	if exporterTemplateID == "" {
		return nil // 手填 exporter 场景允许空
	}
	id, err := strconv.ParseUint(exporterTemplateID, 10, 64)
	if err != nil || id == 0 {
		return fmt.Errorf("exporter_template_id %q 非法", exporterTemplateID)
	}
	var tmpl models.ExporterTemplate
	if err := db.First(&tmpl, id).Error; err != nil {
		return fmt.Errorf("exporter_template_id %s 不存在", exporterTemplateID)
	}
	return nil
}