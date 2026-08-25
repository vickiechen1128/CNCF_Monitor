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
	Jobs   []models.ScrapeJob       // enabled + draft_status=ready
	Rules  []models.MonitoringRule  // enabled + draft_status=ready + scope central/both
}

// resourceTarget 是单个采集目标（含标签模板展开所需的源字段视图）。
type resourceTarget struct {
	ResourceID string
	Address    string
	Status     string
	Category   models.ResourceCategory
	Fields     map[string]string // LabelTemplate 源字段展开视图
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
func LoadDefaultTemplate(db *gorm.DB, category models.ResourceCategory) (*models.LabelTemplate, error) {
	var tmpl models.LabelTemplate
	err := db.Where("resource_category = ? AND is_default = ?", category, true).
		Order("created_at asc").
		First(&tmpl).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("load default label template %s: %w", category, err)
	}
	return &tmpl, nil
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

// ErrNotFound 表示按 ID 未命中某资源（用于区分 not_found 与 internal）。
type ErrNotFound struct {
	Resource string
	ID       string
}

func (e ErrNotFound) Error() string {
	return fmt.Sprintf("%s %s not found", e.Resource, e.ID)
}