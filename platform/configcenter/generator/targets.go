package generator

import (
	"encoding/json"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// resolveResource 按 resource_id 在五类资源表中解析目标实例
// （address / 标签模板字段视图 / status / category）。
func resolveResource(db *gorm.DB, resourceID string) (*resourceTarget, error) {
	var host models.Host
	if err := db.Where("resource_id = ?", resourceID).First(&host).Error; err == nil {
		return &resourceTarget{
			ResourceID: host.GetResourceID(),
			Address:    host.PrivateIP,
			Status:     host.Status,
			Category:   models.ResourceCategoryHost,
			Fields: map[string]string{
				"app_name":         host.AppCode,
				"biz_code":         host.BizCode,
				"cluster":          host.SubAppCode,
				"instance_ip":      host.PrivateIP,
				"service_name":     host.InstanceName,
				"health_check_url": "",
			},
		}, nil
	}
	var database models.Database
	if err := db.Where("resource_id = ?", resourceID).First(&database).Error; err == nil {
		return &resourceTarget{
			ResourceID: database.GetResourceID(),
			Address:    instanceAddress(database.InstanceIP, database.Port),
			Status:     database.Status,
			Category:   models.ResourceCategoryDatabase,
			Fields: map[string]string{
				"app_name":    "",
				"biz_code":    database.BizCode,
				"cluster":     database.GetCluster(),
				"instance_ip": database.InstanceIP,
			},
		}, nil
	}
	var middleware models.Middleware
	if err := db.Where("resource_id = ?", resourceID).First(&middleware).Error; err == nil {
		return &resourceTarget{
			ResourceID: middleware.GetResourceID(),
			Address:    instanceAddress(middleware.InstanceIP, middleware.Port),
			Status:     middleware.Status,
			Category:   models.ResourceCategoryMiddleware,
			Fields: map[string]string{
				"app_name":    middleware.AppName,
				"biz_code":    middleware.BizCode,
				"cluster":     middleware.GetCluster(),
				"instance_ip": middleware.InstanceIP,
			},
		}, nil
	}
	var application models.Application
	if err := db.Where("resource_id = ?", resourceID).First(&application).Error; err == nil {
		return &resourceTarget{
			ResourceID: application.GetResourceID(),
			Address:    application.HealthCheckURL,
			Status:     application.Status,
			Category:   models.ResourceCategoryApplication,
			Fields: map[string]string{
				"app_name":         application.AppName,
				"biz_code":         application.BizCode,
				"cluster":          application.GetCluster(),
				"service_name":     application.ServiceName,
				"health_check_url": application.HealthCheckURL,
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

// ResolveJobTargets 解析单个 Job 的文件发现目标组列表。
//   - standard：从已选实例解析目标，排除 Resource.status=offline（跨模块契约 M07 §8.1）；
//   - blackbox：将 ScrapeJob.blackbox_targets 展开为目标组（labels 空）。
//
// 每实例生成一个 TargetGroup（targets=[地址]，labels=模板展开标签）。
func ResolveJobTargets(db *gorm.DB, job models.ScrapeJob, tmpl *models.LabelTemplate) ([]TargetGroup, error) {
	if job.JobType == models.JobTypeBlackbox {
		groups := make([]TargetGroup, 0, len(job.BlackboxTargets))
		for _, t := range job.BlackboxTargets {
			if t.Target == "" {
				continue
			}
			groups = append(groups, TargetGroup{Targets: []string{t.Target}, Labels: map[string]string{}})
		}
		return groups, nil
	}
	groups := make([]TargetGroup, 0, len(job.SelectedInstanceIDs))
	for _, rid := range job.SelectedInstanceIDs {
		rt, err := resolveResource(db, rid)
		if err != nil || rt == nil {
			continue
		}
		if rt.Status == "offline" { // 已下线实例排除（MVP 必实现）
			continue
		}
		if rt.Address == "" {
			continue
		}
		templateLabels := expandLabelTemplate(tmpl, rt.Fields, rt.Address)
		labels := mergeIntoLabels(templateLabels)
		groups = append(groups, TargetGroup{Targets: []string{rt.Address}, Labels: labels})
	}
	return groups, nil
}

// MarshalTargetGroups 将目标组序列化为 file_sd JSON 文件内容（顶层数组）。
func MarshalTargetGroups(groups []TargetGroup) (string, error) {
	if groups == nil {
		groups = []TargetGroup{}
	}
	b, err := json.Marshal(groups)
	if err != nil {
		return "", fmt.Errorf("marshal target groups: %w", err)
	}
	return string(b), nil
}