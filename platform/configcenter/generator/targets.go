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
// exporterPort 为采集策略层端口（见 LoadExporterPort）：host/database/middleware
// 的抓取地址一律拼接 exporter 端口（exporter 进程监听端口），避免 Prometheus 默认
// 落到 80 端口（target 缺端口修复，决策 42-4）；application 用实例自己登记的
// endpoint（主机）+ port（采集端口）拼接、generic_target 用用户登记的服务端口
// （M07 §5.9），均不走 exporter 端口。
func resolveResource(db *gorm.DB, resourceID string, exporterPort int) (*resourceTarget, error) {
	var host models.Host
	if err := db.Where("resource_id = ?", resourceID).First(&host).Error; err == nil {
		return &resourceTarget{
			ResourceID: host.GetResourceID(),
			Address:    instanceAddress(host.PrivateIP, exporterPort),
			Status:     host.Status,
			Category:   models.ResourceCategoryHost,
			Fields: map[string]string{
				"app_name":         host.AppCode,
				"biz_code":         host.BizCode,
				"cluster":          host.SubAppCode,
				"instance_ip":      host.PrivateIP,
				"service_name":     host.InstanceName,
				"health_check_url": "",
				"env":              host.GetEnv(),
			},
		}, nil
	}
	var database models.Database
	if err := db.Where("resource_id = ?", resourceID).First(&database).Error; err == nil {
		return &resourceTarget{
			ResourceID: database.GetResourceID(),
			Address:    instanceAddress(database.InstanceIP, exporterPortOr(exporterPort, database.Port)),
			Status:     database.Status,
			Category:   models.ResourceCategoryDatabase,
			Fields: map[string]string{
				"app_name":    "",
				"biz_code":    database.BizCode,
				"cluster":     database.GetCluster(),
				"instance_ip": database.InstanceIP,
				"env":         database.GetEnv(),
			},
		}, nil
	}
	var middleware models.Middleware
	if err := db.Where("resource_id = ?", resourceID).First(&middleware).Error; err == nil {
		return &resourceTarget{
			ResourceID: middleware.GetResourceID(),
			Address:    instanceAddress(middleware.InstanceIP, exporterPortOr(exporterPort, middleware.Port)),
			Status:     middleware.Status,
			Category:   models.ResourceCategoryMiddleware,
			Fields: map[string]string{
				"app_name":    middleware.AppName,
				"biz_code":    middleware.BizCode,
				"cluster":     middleware.GetCluster(),
				"instance_ip": middleware.InstanceIP,
				"env":         middleware.GetEnv(),
			},
		}, nil
	}
	var application models.Application
	if err := db.Where("resource_id = ?", resourceID).First(&application).Error; err == nil {
		return &resourceTarget{
			ResourceID: application.GetResourceID(),
			Address:    instanceAddress(application.Endpoint, application.Port),
			Status:     application.Status,
			Category:   models.ResourceCategoryApplication,
			Fields: map[string]string{
				"app_code":         application.GetAppCode(),
				"biz_code":         application.BizCode,
				"cluster":          application.GetCluster(),
				"service_name":     application.ServiceName,
				"health_check_url": application.HealthCheckURL,
				"env":              application.GetEnv(),
			},
		}, nil
	}
	var generic models.GenericTarget
	if err := db.Where("resource_id = ?", resourceID).First(&generic).Error; err == nil {
		return &resourceTarget{
			ResourceID: generic.GetResourceID(),
			Address:    instanceAddress(generic.InstanceIP, generic.Port),
			Status:     generic.Status,
			Category:   models.ResourceCategoryGenericTarget,
			Fields: map[string]string{
				"app_name":    "",
				"biz_code":    generic.BizCode,
				"cluster":     generic.GetCluster(),
				"instance_ip": generic.InstanceIP,
				"env":         generic.GetEnv(),
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
		templateLabels := expandLabelTemplate(tmpl, rt.Fields, rt.Address)
		// 决策 47-3：resource_id 作为 system 层身份标签强制注入（不可被模板覆盖），
		// 保证 M02 coverage 能按 up{resource_id} 回连资源，与是否挂载标签模板无关。
		labels := mergeIntoLabels(map[string]string{"resource_id": rt.ResourceID}, templateLabels)
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