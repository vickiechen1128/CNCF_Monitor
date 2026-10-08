package generator

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 目标解析跳过归因的 Reason 取值（见 SkippedInstance）。
const (
	// SkipReasonResourceNotFound：selected_instance_ids 中的资源已不存在（可能已被删除）。
	SkipReasonResourceNotFound = "resource_not_found"
	// SkipReasonAddressEmpty：资源存在但采集地址为空——application 取 endpoint（主机）
	// + port（采集端口）拼接，其余类别取实例 IP。
	SkipReasonAddressEmpty = "address_empty"
	// SkipReasonOffline：资源状态为 offline，按设计排除（M07 §8.1 / 决策 47-1），
	// 属预期行为而非用户配置缺陷。
	SkipReasonOffline = "offline"
)

// SkippedInstance 记录一次目标解析中未进入产物 targets 的实例及其归因。
// 仅用于生成侧校验给出资源级定位（哪个实例、为什么没解析出地址），不做持久化。
type SkippedInstance struct {
	ResourceID string
	Category   string // host/database/middleware/application/generic_target；解析不到资源时为空，blackbox 跳过填 blackbox
	Reason     string // resource_not_found / address_empty / offline
	Detail     string // 人类可读补充（如「健康检查地址（health_check_url）为空」）
}

// addressEmptyDetail 按资源类别返回「采集地址为空」的归因说明。
// application 的采集地址由 endpoint（主机）+ port（采集端口）拼接（M07 §5.2），
// 单独措辞避免与实例 IP 混淆。
func addressEmptyDetail(category string) string {
	if category == string(models.ResourceCategoryApplication) {
		return "采集地址为空（endpoint 主机或 port 采集端口未填写）"
	}
	return "实例 IP 为空"
}

// exporterPortOr 返回采集策略层端口；为 0（未配置映射/采集器）时回落资源业务端口。
// PRD M07 §5.12C：target/instance 端口取自 CITypeExporterMapping.default_port
// （如 node_exporter 9100），而非资源业务端口（M07 §5.6 host 无 port 字段；
// database/middleware 的 port 是服务端口，不是 exporter 监听端口）。
func exporterPortOr(exporterPort, fallback int) int {
	if exporterPort > 0 {
		return exporterPort
	}
	return fallback
}

// resolveResource 按 resource_id 在五类资源表中解析目标实例
// （address / 标签模板字段视图 / status / category）。
//
// 字段视图与 platform_code（决策 118-2）：五类字段视图**均须携带 `platform_code`**——
// 它是 `platform` 标签的唯一模板来源字段（`platform_code → platform` 的 resource_field
// 映射，决策 110 ②）。决策 118 归一前本视图不含该键，导致模板映射恒 `v != ""` 判空
// 跳过、`platform` 只能由 system 层派生——即「兜底前移物化」不生效的直接原因。
//
// 多态探测说明（L3 / TQ 取舍）：resource_id 当前未冗余 category 字段，故按
// host→database→middleware→application→generic_target 顺序探测，命中即返回。
// 单资源最多 4 次 ErrRecordNotFound 探测，属既有模式、非本次回归。网域 N+1 已
// 由 ResolveJobTargets 的 domainCache 批量预取消除；若后续需彻底去掉 5 路探测，
// 需在资源表冗余 category（或 resource_id 编码 category），属 schema 变更（中风险，
// 超出本 LOW 修复范围），届时再统一改造。
//
// exporterPort 为采集策略层端口（见 LoadExporterPort）：host/database/middleware
// 的抓取地址一律拼接 exporter 端口（exporter 进程监听端口），避免 Prometheus 默认
// 落到 80 端口（target 缺端口修复，决策 42-4）；application 用实例自己登记的
// endpoint（主机）+ port（采集端口）拼接、generic_target 用用户登记的服务端口
// （M07 §5.9），均不走 exporter 端口。
func resolveResource(db *gorm.DB, resourceID string, exporterPort int) (*resourceTarget, error) {
	var host models.Host
	if err := db.Where("resource_id = ?", resourceID).First(&host).Error; err == nil {
		return &resourceTarget{
			ResourceID:      host.GetResourceID(),
			NetworkDomainID: host.NetworkDomainID,
			Address:         instanceAddress(host.PrivateIP, exporterPort),
			Status:          host.Status,
			Category:        models.ResourceCategoryHost,
			AppCode:         host.GetAppCode(),
			Fields: map[string]string{
				"app_name":         host.AppCode,
				"biz_code":         host.BizCode,
				"cluster":          host.SubAppCode,
				"instance_ip":      host.PrivateIP,
				"service_name":     host.InstanceName,
				"health_check_url": "",
				"env":              host.GetEnv(),
				"platform_code":    host.PlatformCode,
			},
		}, nil
	}
	var database models.Database
	if err := db.Where("resource_id = ?", resourceID).First(&database).Error; err == nil {
		return &resourceTarget{
			ResourceID:      database.GetResourceID(),
			NetworkDomainID: database.NetworkDomainID,
			Address:         instanceAddress(database.InstanceIP, exporterPortOr(exporterPort, database.Port)),
			Status:          database.Status,
			Category:        models.ResourceCategoryDatabase,
			AppCode:         database.GetAppCode(),
			Fields: map[string]string{
				"app_name":      database.GetAppCode(),
				"biz_code":      database.BizCode,
				"cluster":       database.GetCluster(),
				"instance_ip":   database.InstanceIP,
				"env":           database.GetEnv(),
				"platform_code": database.PlatformCode,
			},
		}, nil
	}
	var middleware models.Middleware
	if err := db.Where("resource_id = ?", resourceID).First(&middleware).Error; err == nil {
		return &resourceTarget{
			ResourceID:      middleware.GetResourceID(),
			NetworkDomainID: middleware.NetworkDomainID,
			Address:         instanceAddress(middleware.InstanceIP, exporterPortOr(exporterPort, middleware.Port)),
			Status:          middleware.Status,
			Category:        models.ResourceCategoryMiddleware,
			AppCode:         middleware.GetAppCode(),
			Fields: map[string]string{
				"app_name":      middleware.AppName,
				"biz_code":      middleware.BizCode,
				"cluster":       middleware.GetCluster(),
				"instance_ip":   middleware.InstanceIP,
				"env":           middleware.GetEnv(),
				"platform_code": middleware.PlatformCode,
			},
		}, nil
	}
	var application models.Application
	if err := db.Where("resource_id = ?", resourceID).First(&application).Error; err == nil {
		return &resourceTarget{
			ResourceID:      application.GetResourceID(),
			NetworkDomainID: application.NetworkDomainID,
			Address:         instanceAddress(application.Endpoint, application.Port),
			Status:          application.Status,
			Category:        models.ResourceCategoryApplication,
			AppCode:         application.GetAppCode(),
			Fields: map[string]string{
				"app_code":         application.GetAppCode(),
				"service_code":     application.ServiceCode,
				"biz_code":         application.BizCode,
				"cluster":          application.GetCluster(),
				"service_name":     application.ServiceName,
				"health_check_url": application.HealthCheckURL,
				"env":              application.GetEnv(),
				"platform_code":    application.PlatformCode,
			},
		}, nil
	}
	var generic models.GenericTarget
	if err := db.Where("resource_id = ?", resourceID).First(&generic).Error; err == nil {
		return &resourceTarget{
			ResourceID:      generic.GetResourceID(),
			NetworkDomainID: generic.NetworkDomainID,
			Address:         instanceAddress(generic.InstanceIP, generic.Port),
			Status:          generic.Status,
			Category:        models.ResourceCategoryGenericTarget,
			AppCode:         generic.GetAppCode(),
			Fields: map[string]string{
				"app_name":      generic.GetAppCode(),
				"service_code":  generic.ServiceCode,
				"biz_code":      generic.BizCode,
				"cluster":       generic.GetCluster(),
				"instance_ip":   generic.InstanceIP,
				"env":           generic.GetEnv(),
				"platform_code": generic.PlatformCode,
			},
		}, nil
	}
	return nil, nil
}

// instanceAddress 组合 `ip:port`；port 为 0 时仅返回 ip（file_sd 目标可无端口）。
func instanceAddress(ip string, port int) string {
	if port == 0 || ip == "" {
		return ip
	}
	return fmt.Sprintf("%s:%d", ip, port)
}

// materializePrimaryPlatform 实现决策 110 ③「应用主平台兜底」，且**不新增注入点**：
// 资源行 `platform_code` 已填时原样返回（资源行一等字段优先）；留空且所属应用存在
// `is_primary=true` 的关联平台时，把该平台编码**写入本次模板展开所用的字段视图**
// `rt.Fields["platform_code"]`，随后由模板既有 `platform_code → platform` 的
// resource_field 映射自然产出 `platform` 标签。
//
// 两条不写入兜底（PRD §5.2 / 决策 118-2）：
//   - 资源无 app_code（如未挂应用的 host、仅填 biz_code 的 generic_target）→ 不查询、不写入；
//   - 应用无 is_primary 平台（含无任何关联、或仅非主平台关联）→ 不写入，
//     由 expandLabelTemplate 的 `v != ""` 判空跳过、**不注入** platform。
//
// cache 按 app_code 缓存主平台查询结果（同一 Job 内多个资源共享同一 app_code 时避免
// N+1，模式同 domainCache）；空串亦入缓存以缓存「无主平台」这一结果。
//
// 直查 models.AppPlatformRel（generator 已直查 models），不 import config/resource ——
// 避免 configcenter → config 的依赖倒置。
func materializePrimaryPlatform(db *gorm.DB, rt *resourceTarget, cache map[string]string) map[string]string {
	if rt.Fields["platform_code"] != "" || rt.AppCode == "" {
		return rt.Fields
	}
	primary, cached := cache[rt.AppCode]
	if !cached {
		var rel models.AppPlatformRel
		if err := db.Where("app_code = ? AND is_primary = ?", rt.AppCode, true).
			Order("id ASC").First(&rel).Error; err == nil {
			primary = rel.PlatformCode
		}
		cache[rt.AppCode] = primary
	}
	if primary != "" {
		rt.Fields["platform_code"] = primary
	}
	return rt.Fields
}

// ResolveJobTargets 解析单个 Job 的文件发现目标组列表，并返回未进入产物 targets
// 的实例归因（C-1，config-sync-stall-and-empty-targets-guard 设计提案 §3.1）：
//   - standard：从已选实例解析目标，排除 Resource.status=offline（跨模块契约 M07 §8.1）；
//     exporterPort 为采集策略层端口（host/database/middleware 拼接，见 resolveResource）；
//   - blackbox：将 ScrapeJob.blackbox_targets 展开为目标组（labels 空）。
//
// 每实例生成一个 TargetGroup（targets=[地址]，labels=模板展开标签）。
//
// 三类跳过均记录归因：resource_not_found（资源已删除）/ address_empty（采集地址缺失，
// 用户配置缺陷）/ offline（设计预期排除）。归因仅用于生成侧校验定位（不持久化、不
// 参与 checksum），判定结果不依赖归因。
//
// 决策 47-1（安装确认拆闸门）：本函数**只消费 selected_instance_ids**（+ offline
// 排除 + enabled + draft_status），**不读取、不排除、不阻塞 ExporterInstallationConfirmation**。
// 未确认 / 已确认实例一律进入 target 组——安装确认已降级为「可选登记、非生成闸门」，
// 真实采集状态（up/down）由 M02 targets/coverage 代理回显，M01 不直连 Prometheus。
//
// 决策 47-3：resource_id 是 coverage 三态判定（M02 /health/coverage 按 up 的
// resource_id 标签回连资源）的稳定身份回连键，作为 system 层标签强制注入——
// 不依赖 Job 是否挂载标签模板，也不可被模板映射覆盖。
//
// 决策 110 / 118：`platform` 与 `svc` **均走标签模板层**——`platform` 由资源行
// `platform_code` 经 `platform_code → platform` 的 resource_field 映射注入（资源留空
// 时由 materializePrimaryPlatform 兜底物化应用 is_primary 平台），`svc` 由
// `service_code → svc` 映射注入。**system 层不注入这两个标签**（决策 118-2：注入点
// 唯一权威 = 模板层；决策 104 / 107 / 108 的「经应用父级 platform_code 在 system 层
// 派生」实现已废止，`ApplicationDict.PlatformCode` 生产消费者归零）。
func ResolveJobTargets(db *gorm.DB, job models.ScrapeJob, tmpl *models.LabelTemplate, exporterPort int) ([]TargetGroup, []SkippedInstance, error) {
	if job.JobType == models.JobTypeBlackbox {
		groups := make([]TargetGroup, 0, len(job.BlackboxTargets))
		var skipped []SkippedInstance
		for _, t := range job.BlackboxTargets {
			if t.Target == "" {
				skipped = append(skipped, SkippedInstance{
					Category: "blackbox",
					Reason:   SkipReasonAddressEmpty,
					Detail:   "blackbox 拨测目标（target）为空",
				})
				continue
			}
			groups = append(groups, TargetGroup{Targets: []string{t.Target}, Labels: map[string]string{}})
		}
		return groups, skipped, nil
	}
	groups := make([]TargetGroup, 0, len(job.SelectedInstanceIDs))
	var skipped []SkippedInstance
	// domainCache / primaryPlatformCache 在同一 Job 内复用查询结果，避免相同
	// network_domain_id / app_code 重复回查（避免 N+1）。
	domainCache := make(map[string]*models.NetworkDomain)
	primaryPlatformCache := make(map[string]string)
	for _, rid := range job.SelectedInstanceIDs {
		rt, err := resolveResource(db, rid, exporterPort)
		if err != nil || rt == nil {
			skipped = append(skipped, SkippedInstance{
				ResourceID: rid,
				Reason:     SkipReasonResourceNotFound,
				Detail:     "选中的资源不存在或已被删除",
			})
			continue
		}
		if rt.Status == "offline" { // 已下线实例排除（MVP 必实现，M07 §8.1）
			skipped = append(skipped, SkippedInstance{
				ResourceID: rt.ResourceID,
				Category:   string(rt.Category),
				Reason:     SkipReasonOffline,
				Detail:     "资源状态为 offline，已按设计排除",
			})
			continue
		}
		if rt.Address == "" {
			skipped = append(skipped, SkippedInstance{
				ResourceID: rt.ResourceID,
				Category:   string(rt.Category),
				Reason:     SkipReasonAddressEmpty,
				Detail:     addressEmptyDetail(string(rt.Category)),
			})
			continue
		}
		templateLabels := expandLabelTemplate(tmpl, materializePrimaryPlatform(db, rt, primaryPlatformCache), rt.Address)
		// 决策 103 scheme-B：cloud / zone / network_domain 三标签在 TARGET-LEVEL SYSTEM
		// 层强制注入（不可被 LabelTemplate 覆盖，亦不经 external_labels）：
		//   - network_domain = 资源所属网域 id；
		//   - cloud         = 网域 cloud_code（引用启用云字典条目）；
		//   - zone          = 网域 zone_type；
		// 任一值为空则省略对应 key（不写空标签）。
		//
		// ⚠️ 通用规约（决策 118-2，防复发）：**同一 label 不得同时由 system 层与模板层
		// 产出**。mergeLabels 的 system 保护语义（labels.go）会让「system 已写该键」
		// 时模板层取值被**静默覆盖**且不报错——决策 115 的 ensurePlatformMapping 止血
		// 正是因此在主路径失效。故 `platform` 已从 system 层移除，改由模板层唯一产出。
		// 新增 system 层标签前须先确认无同名模板映射，反之亦然。
		systemLabels := map[string]string{"resource_id": rt.ResourceID}
		if rt.NetworkDomainID != "" {
			systemLabels["network_domain"] = rt.NetworkDomainID
			dom, ok := domainCache[rt.NetworkDomainID]
			if !ok {
				if d, derr := LoadDomain(db, rt.NetworkDomainID); derr == nil {
					dom = d
				} else {
					dom = nil // 网域缺失时省略 cloud/zone，不阻断目标生成
				}
				domainCache[rt.NetworkDomainID] = dom
			}
			if dom != nil {
				if dom.CloudCode != "" {
					systemLabels["cloud"] = dom.CloudCode
				}
				if dom.ZoneType != "" {
					systemLabels["zone"] = dom.ZoneType
				}
			}
		}
		labels := mergeIntoLabels(systemLabels, templateLabels)
		groups = append(groups, TargetGroup{Targets: []string{rt.Address}, Labels: labels})
	}
	return groups, skipped, nil
}

// MarshalTargetGroups 将目标组序列化为 file_sd JSON 文件内容（顶层数组）。
// 使用缩进格式输出：内容同时落盘到 targets/*.json 并存入下发记录的
// targets_files 快照，单行压缩格式在文件与记录页中均不便阅读/核对。
func MarshalTargetGroups(groups []TargetGroup) (string, error) {
	if groups == nil {
		groups = []TargetGroup{}
	}
	b, err := json.MarshalIndent(groups, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal target groups: %w", err)
	}
	return string(b), nil
}

// EnsureTargetsFilename 校验 targets 文件名为纯文件名（review-fix F6 防御纵深）。
// 正常 key 由 normalizeJobFilename 归一为安全名，但写入点复用 map key：若 DB/下游存入
// 脏 key（含 .. / 路径分隔符）可越界写文件。落盘前在各写入点二次断言兜底。
// 允许 base 名等于自身（无嵌套路径）且不含 '/' 与 '\'；拒绝空 / "." / ".."。
func EnsureTargetsFilename(name string) error {
	if name == "" || name == "." || name == ".." {
		return fmt.Errorf("unsafe targets filename: %q", name)
	}
	if filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("unsafe targets filename (path separators): %q", name)
	}
	return nil
}
