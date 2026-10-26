package generator

import (
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// labelDictionary 是标签模板「字典翻译」转换规则（transform=dict）所需的
// code → 展示名缓存，一次 Job 生成内只加载一次，避免逐 target 回查。
//
// 字典表规模很小（部署级 / 百级条目），整表加载比逐条查询更简单且无 N+1。
// 任一字典加载失败只影响对应维度的翻译（translate 未命中时回退原始 code），
// 不阻断配置生成。
type labelDictionary struct {
	appNames      map[string]string
	bizNames      map[string]string
	platformNames map[string]string
	domainNames   map[string]string
	cloudNames    map[string]string
	zoneNames     map[string]string
}

// newLabelDictionary 加载全部可翻译字典（应用 / 业务 / 平台 / 网域 / 云 / 区域）。
// 环境（env）为固定枚举，直接走 models.LabelEnvDisplayNames（当前恒等映射，输出原代码），无需查库。
func newLabelDictionary(db *gorm.DB) *labelDictionary {
	d := &labelDictionary{
		appNames:      map[string]string{},
		bizNames:      map[string]string{},
		platformNames: map[string]string{},
		domainNames:   map[string]string{},
		cloudNames:    map[string]string{},
		zoneNames:     map[string]string{},
	}
	if db == nil {
		return d
	}

	var apps []models.ApplicationDict
	if err := db.Select("app_code", "app_name").Find(&apps).Error; err == nil {
		for _, a := range apps {
			if a.AppCode != "" && a.AppName != "" {
				d.appNames[a.AppCode] = a.AppName
			}
		}
	}

	var bizs []models.BusinessDomain
	if err := db.Select("code", "name").Find(&bizs).Error; err == nil {
		for _, b := range bizs {
			if b.Code != "" && b.Name != "" {
				d.bizNames[b.Code] = b.Name
			}
		}
	}

	var platforms []models.PlatformDict
	if err := db.Select("platform_code", "platform_name").Find(&platforms).Error; err == nil {
		for _, p := range platforms {
			if p.PlatformCode != "" && p.PlatformName != "" {
				d.platformNames[p.PlatformCode] = p.PlatformName
			}
		}
	}

	var domains []models.NetworkDomain
	if err := db.Select("id", "name").Find(&domains).Error; err == nil {
		for _, nd := range domains {
			if nd.ID != "" && nd.Name != "" {
				d.domainNames[nd.ID] = nd.Name
			}
		}
	}

	// 云 / 区域字典用于 target 级展示名标签（cloud_name / zone_name）。
	// 不过滤 enabled：存量网域可能引用已停用字典项，展示名仍应可读。
	var clouds []models.CloudDict
	if err := db.Select("cloud_code", "cloud_name").Find(&clouds).Error; err == nil {
		for _, c := range clouds {
			if c.CloudCode != "" && c.CloudName != "" {
				d.cloudNames[c.CloudCode] = c.CloudName
			}
		}
	}

	var zones []models.ZoneType
	if err := db.Select("code", "display_name").Find(&zones).Error; err == nil {
		for _, z := range zones {
			if z.Code != "" && z.DisplayName != "" {
				d.zoneNames[z.Code] = z.DisplayName
			}
		}
	}

	return d
}

// cloudDisplayName 返回云编码对应的中文展示名；字典未命中回退原始编码。
// 用于 target 级 cloud_name 标签（仅展示，不改变 cloud 身份标签的 code 口径）。
func (d *labelDictionary) cloudDisplayName(code string) string {
	if d != nil {
		if name, ok := d.cloudNames[code]; ok && name != "" {
			return name
		}
	}
	return code
}

// zoneDisplayName 返回区域编码对应的中文展示名；字典未命中回退原始编码。
// 用于 target 级 zone_name 标签（仅展示，不改变 zone 身份标签的 code 口径）。
func (d *labelDictionary) zoneDisplayName(code string) string {
	if d != nil {
		if name, ok := d.zoneNames[code]; ok && name != "" {
			return name
		}
	}
	return code
}

// translate 按来源字段把字典编码翻译为展示名。
// 返回值 ok=false 表示该字段不支持翻译或字典未命中，调用方应回退原始值。
func (d *labelDictionary) translate(sourceField, value string) (string, bool) {
	if d == nil || value == "" {
		return value, false
	}
	switch sourceField {
	case "app_code", "app_name":
		// app_name 是 host/database/middleware/generic_target 字段视图的历史键名，
		// 其值同样是 app_code（见 resolveResource）。
		if v, ok := d.appNames[value]; ok {
			return v, true
		}
	case "biz_code":
		if v, ok := d.bizNames[value]; ok {
			return v, true
		}
	case "platform_code":
		if v, ok := d.platformNames[value]; ok {
			return v, true
		}
	case "network_domain_id":
		if v, ok := d.domainNames[value]; ok {
			return v, true
		}
	case "env":
		if v, ok := models.LabelEnvDisplayNames[value]; ok {
			return v, true
		}
	}
	return value, false
}
