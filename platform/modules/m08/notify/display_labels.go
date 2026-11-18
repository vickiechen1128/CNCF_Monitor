package notify

import (
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// enrichAlertsDisplayLabels 在渲染前给告警标签补齐中文展示名：
//
//	network_domain_name = 网域名称（network_domains.name）
//	cloud_name          = 云字典展示名（cloud_dicts.cloud_name，未命中保留原值）
//	zone_name           = 网络分区展示名（zone_types.display_name，未命中保留原值）
//
// 仅修改本次通知的渲染副本，不回写数据库、不影响 Prometheus 标签与身份过滤。
// 展示标签优先级：生成期 target 级注入 → 本函数按当前字典覆盖（网域改名后
// 无需等待配置重新下发即可展示新名称）。DB 查询失败时静默降级，通知照常发送。
func enrichAlertsDisplayLabels(db *gorm.DB, alerts []amWebhookAlert) {
	if db == nil || len(alerts) == 0 {
		return
	}

	// 收集去重后的网域 ID（network_domain → network_domain_id → default）。
	ids := make([]string, 0, len(alerts))
	seen := make(map[string]struct{}, len(alerts))
	for i := range alerts {
		id := models.ResolveNetworkDomain(alerts[i].Labels)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return
	}

	var domains []models.NetworkDomain
	if err := db.Select("id", "name", "cloud_code", "zone_type").
		Where("id IN ?", ids).Find(&domains).Error; err != nil || len(domains) == 0 {
		return
	}
	domainByID := make(map[string]models.NetworkDomain, len(domains))
	for _, d := range domains {
		domainByID[d.ID] = d
	}

	// 云 / 区域字典规模很小（部署级百级以内），整表加载一次，避免逐告警回查。
	cloudNames := make(map[string]string)
	var clouds []models.CloudDict
	if err := db.Select("cloud_code", "cloud_name").Find(&clouds).Error; err == nil {
		for _, c := range clouds {
			if c.CloudCode != "" && c.CloudName != "" {
				cloudNames[c.CloudCode] = c.CloudName
			}
		}
	}

	zoneNames := make(map[string]string)
	var zones []models.ZoneType
	if err := db.Select("code", "display_name").Find(&zones).Error; err == nil {
		for _, z := range zones {
			if z.Code != "" && z.DisplayName != "" {
				zoneNames[z.Code] = z.DisplayName
			}
		}
	}

	for i := range alerts {
		labels := alerts[i].Labels
		if labels == nil {
			continue
		}
		dom, ok := domainByID[models.ResolveNetworkDomain(labels)]
		if !ok {
			continue
		}
		if dom.Name != "" {
			labels[models.NetworkDomainNameLabelKey] = dom.Name
		}
		if name, ok := cloudNames[dom.CloudCode]; ok {
			labels[models.CloudNameLabelKey] = name
		}
		if name, ok := zoneNames[dom.ZoneType]; ok {
			labels[models.ZoneNameLabelKey] = name
		}
	}
}
