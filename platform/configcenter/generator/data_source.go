package generator

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// Inputs 是一次配置生成的聚合输入（M01 ScrapeJob / MonitoringRule 只读，
// M07 Resource / LabelTemplate 只读，M06 NetworkDomain 只读）。
type Inputs struct {
	Domain models.NetworkDomain
	Jobs   []models.ScrapeJob      // enabled + draft_status=ready
	Rules  []models.MonitoringRule // enabled + draft_status=ready + scope central/both
}

// resourceTarget 是单个采集目标（含标签模板展开所需的源字段视图）。
type resourceTarget struct {
	ResourceID      string
	NetworkDomainID string // 所属网域（决策 103 scheme-B：cloud/zone/network_domain 三标签权威来源）
	Address         string
	Status          string
	Category        models.ResourceCategory
	// AppCode 是资源的应用编码（决策 92：五类一律经 GetAppCode() 取）。决策 118-2
	// 起它**仅**用于资源行 `platform_code` 留空时的应用主平台兜底
	// （materializePrimaryPlatform），不再作为 system 层 `platform` 派生来源。
	AppCode string
	Fields  map[string]string // LabelTemplate 源字段展开视图（须含 platform_code，决策 118-2）
	// Raw 是解析到的原始资源模型指针（*models.Host / *Database / ...），供
	// 拨测目标按任意字段取值复用 models.GetResourceField——避免为 label 模板视图
	// Fields（只覆盖部分字段）之外的字段另造取值逻辑。resolveResource 命中即填充。
	Raw any
}

// LoadDomain 按 ID 读取网域。
func LoadDomain(db *gorm.DB, domainID string) (*models.NetworkDomain, error) {
	var d models.NetworkDomain
	if err := db.Where("id = ?", domainID).First(&d).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, ErrNotFound{Resource: "network domain", ID: domainID}
		}
		return nil, fmt.Errorf("load network domain %s: %w", domainID, err)
	}
	return &d, nil
}

// LoadJobs 读取网域下 enabled + draft_status=ready 的采集 Job 候选集
// （PRD §3.3 草稿状态过滤；软删 / draft / disabled 不参与配置生成）。
func LoadJobs(db *gorm.DB, domainID string) ([]models.ScrapeJob, error) {
	var jobs []models.ScrapeJob
	err := db.
		Where("network_domain_id = ? AND enabled = ? AND draft_status = ?", domainID, true, "ready").
		Order("created_at asc").
		Find(&jobs).Error
	if err != nil {
		return nil, fmt.Errorf("load scrape jobs: %w", err)
	}
	return jobs, nil
}

// LoadRules 读取 enabled + draft_status=ready 且 scope 为 central/both 的规则候选集。
// MVP 规则均为 central，中心统一求值（PRD §3.3）。
func LoadRules(db *gorm.DB) ([]models.MonitoringRule, error) {
	var rules []models.MonitoringRule
	err := db.
		Where("enabled = ? AND draft_status = ? AND scope IN ?", true, "ready", []string{
			string(models.ScopeTypeCentral), string(models.ScopeTypeBoth),
		}).
		Order("created_at asc").
		Find(&rules).Error
	if err != nil {
		return nil, fmt.Errorf("load monitoring rules: %w", err)
	}
	return rules, nil
}

// LoadDefaultTemplate 读取某资源类别的默认标签模板（M07 is_default）。
// 未配置默认模板时返回 nil（targets 不带业务标签，仅地址）。
//
// 同类别出现多个 is_default=true 属数据异常：返回明确错误，不再按 created_at
// 静默取第一条——否则前端选择与生成结果可能指向不同模板，问题难以排查。
func LoadDefaultTemplate(db *gorm.DB, category models.ResourceCategory) (*models.LabelTemplate, error) {
	var tmpls []models.LabelTemplate
	if err := db.Where("resource_category = ? AND is_default = ?", category, true).
		Order("created_at asc").
		Find(&tmpls).Error; err != nil {
		return nil, fmt.Errorf("load default label template %s: %w", category, err)
	}
	switch len(tmpls) {
	case 0:
		return nil, nil
	case 1:
		return &tmpls[0], nil
	default:
		return nil, fmt.Errorf(
			"资源类别 %s 存在 %d 个默认标签模板（is_default=true），请先修复数据",
			category, len(tmpls),
		)
	}
}

// LoadTemplateForJob 解析某个采集 Job 应使用的标签模板：
//   - 优先按 Job 显式挂载的 LabelTemplateID（M01 ScrapeJob.label_template_id）；
//   - 未挂载或模板不存在时，回落该资源类别的默认模板（M07 is_default）。
//
// 二者都不可得时返回 nil（targets 不带业务标签，仅地址）。P1-1：修复 labels 为空——
// 此前仅按 resource_type 取默认模板，忽略了 Job 上挂载的 label_template_id。
func LoadTemplateForJob(db *gorm.DB, job models.ScrapeJob) (*models.LabelTemplate, error) {
	if job.LabelTemplateID != "" {
		var tmpl models.LabelTemplate
		if err := db.Where("id = ?", job.LabelTemplateID).First(&tmpl).Error; err == nil {
			return &tmpl, nil
		} else if err != gorm.ErrRecordNotFound {
			return nil, fmt.Errorf("load label template %s: %w", job.LabelTemplateID, err)
		}
		// 挂载的模板已被删除 → 回落默认模板
	}
	return LoadDefaultTemplate(db, models.ResourceCategory(job.ResourceType))
}

// LoadExporterPort 解析采集 Job 的采集策略层端口（target/instance 拼接用）。
//
// 优先级（PRD M07 §5.12C / M01 §5.1 端口一致性说明）：
//  1. CITypeExporterMapping（按 monitor_type 的默认映射 default_port，映射表单可编辑）；
//  2. 回落 ExporterTemplate（按 exporter_template_id 的 default_port）；
//  3. 二者皆缺返回 0（host 不拼端口保持裸 IP；database/middleware 回落业务端口）。
//
// 缺陷 D2 修复（提案 resource-scrape-port-chain §7）：映射层严格限定 is_default=true，
// 与 strategy/scrapejob resolveJobScrapeParams 的 `monitor_type = ? AND is_default = true`
// 口径一致——同数据集两函数选中同一 mapping 行，is_default=false 的行不算命中。
func LoadExporterPort(db *gorm.DB, job models.ScrapeJob) (int, error) {
	if job.MonitorType != "" {
		var mapping models.CITypeExporterMapping
		err := db.Where("monitor_type = ? AND is_default = ?", job.MonitorType, true).First(&mapping).Error
		if err == nil && mapping.DefaultPort > 0 {
			return mapping.DefaultPort, nil
		} else if err != nil && err != gorm.ErrRecordNotFound {
			return 0, fmt.Errorf("load ci-exporter mapping %s: %w", job.MonitorType, err)
		}
	}
	if job.ExporterTemplateID != "" {
		var tmpl models.ExporterTemplate
		err := db.Where("id = ?", job.ExporterTemplateID).First(&tmpl).Error
		if err == nil && tmpl.DefaultPort > 0 {
			return tmpl.DefaultPort, nil
		} else if err != nil && err != gorm.ErrRecordNotFound {
			return 0, fmt.Errorf("load exporter template %s: %w", job.ExporterTemplateID, err)
		}
	}
	return 0, nil
}

// LoadLatestAlertmanagerConfigContent 读取最新一条已留痕（status=applied）的
// AlertmanagerConfigVersion.content（决策 60 / T09-60-1，M08 源数据只读）。
// 无告警配置留痕返回空字符串（不产生空 alertmanager.yml 产物）。
func LoadLatestAlertmanagerConfigContent(db *gorm.DB) (string, error) {
	cfg, err := LoadLatestAlertmanagerConfigVersion(db)
	if err != nil || cfg == nil {
		return "", err
	}
	return cfg.Content, nil
}

// LoadLatestAlertmanagerConfigVersion 读取最新一条已留痕（status=applied）的
// AlertmanagerConfigVersion 整行（content + ID）；无留痕返回 (nil, nil)。
// 供 buildArtifacts 同时取得产物内容与来源版本 ID（dev-feedback #44：回填/废弃联动的
// 精确匹配依据），避免两次查询在并发挂载下取到不同版本。
func LoadLatestAlertmanagerConfigVersion(db *gorm.DB) (*models.AlertmanagerConfigVersion, error) {
	var cfg models.AlertmanagerConfigVersion
	err := db.Where("status = ?", models.AlertmanagerConfigStatusApplied).
		Order("created_at DESC, id DESC").First(&cfg).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load latest alertmanager config: %w", err)
	}
	return &cfg, nil
}

// LoadNotifyChannels 读取平台全部通知渠道（M08 NotifyChannel），供 M09 物化管理域
// alertmanager.yml 的 receivers。按 ID 升序保证物化顺序稳定（checksum 可复现）。
//
// 2026-10-22 起渠道取消启停状态；是否进入 receivers 只取决于「是否被路由规则引用」，
// 由 BuildAlertmanagerConfig 结合 route 段判定。
func LoadNotifyChannels(db *gorm.DB) ([]models.NotifyChannel, error) {
	var channels []models.NotifyChannel
	if err := db.Order("id ASC").Find(&channels).Error; err != nil {
		return nil, fmt.Errorf("load notify channels: %w", err)
	}
	return channels, nil
}

// LoadAlertmanagerConfigInput 组装唯一生成规则的 route 与渠道输入。
// 抑制规则由路由保存 / 抑制保存 / M09 生成各自从当前产品视图解析后补入。
// 平台入口地址由生成器运行时配置 NotifyBridgeURL 统一提供，不属于调用方参数。
func LoadAlertmanagerConfigInput(db *gorm.DB, routeSection string) (AlertmanagerConfigInput, error) {
	channels, err := LoadNotifyChannels(db)
	if err != nil {
		return AlertmanagerConfigInput{}, err
	}
	return AlertmanagerConfigInput{RouteSection: routeSection, Channels: channels}, nil
}

// ErrNotFound 表示按 ID 未命中某资源（用于区分 not_found 与 internal）。
type ErrNotFound struct {
	Resource string
	ID       string
}

func (e ErrNotFound) Error() string {
	return fmt.Sprintf("%s %s not found", e.Resource, e.ID)
}
