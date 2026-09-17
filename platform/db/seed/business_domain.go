package seed

import (
	"fmt"
	"log"
	"os"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
	"gopkg.in/yaml.v3"
)

// yamlBusinessDomain 是 business_domains.yaml 中一条字典条目的加载视图。
// 与 models.BusinessDomain 分开定义：yaml 仅承载字典字段，不含 BaseModel 时间戳。
type yamlBusinessDomain struct {
	Code        string `yaml:"code"`
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Enabled     bool   `yaml:"enabled"`
}

// infraFallback 是无业务归属设备的兜底条目（决策 48）：yaml 中缺失时由 seed 强制
// 预置，保证设备类资源有可挂载的 biz，避免必填逼出假业务。
var infraFallback = models.BusinessDomain{
	Code:        models.InfraBizCode,
	Name:        "公共基础设施",
	Description: "公共基础设施兜底，无业务归属的设备类资源统一挂载",
	Enabled:     true,
}

// BusinessDomains 首次启动数据种子（决策 48）：仅当 BusinessDomain 表为空时，
// 从 business_domains.yaml 导入初始字典并强制预置 infra 兜底条目；之后 DB 为唯一
// 权威，本函数在 DB 非空时直接返回，绝不覆盖（幂等）。
//
// 容错：yaml 文件缺失/解析失败时降级为仅落 infra 兜底条目（log 告警但不阻断启动，
// 与旧 yaml 热加载的降级语义一致），保证 infra 恒存在。
func BusinessDomains(db *gorm.DB, path string) error {
	if db == nil {
		return fmt.Errorf("seed business domains: nil database connection")
	}

	var count int64
	if err := db.Model(&models.BusinessDomain{}).Count(&count).Error; err != nil {
		return fmt.Errorf("seed business domains: count: %w", err)
	}
	if count > 0 {
		return nil // DB 非空则不 seed（决策 48：之后不再覆盖）
	}

	entries, err := readBusinessDomainsFile(path)
	if err != nil {
		log.Printf("seed business domains: %v; falling back to infra fallback only", err)
		entries = nil
	}
	if !containsBizCode(entries, models.InfraBizCode) {
		entries = append(entries, yamlBusinessDomain{
			Code:        infraFallback.Code,
			Name:        infraFallback.Name,
			Description: infraFallback.Description,
			Enabled:     infraFallback.Enabled,
		})
	}

	for _, e := range entries {
		row := models.BusinessDomain{
			Code:        e.Code,
			Name:        e.Name,
			Description: e.Description,
			Enabled:     e.Enabled,
		}
		if err := db.Create(&row).Error; err != nil {
			return fmt.Errorf("seed business domain %q: %w", e.Code, err)
		}
	}
	return nil
}

// readBusinessDomainsFile 解析 business_domains.yaml 为字典条目列表。文件读取或
// 解析失败返回错误（调用方决定降级策略）。
func readBusinessDomainsFile(path string) ([]yamlBusinessDomain, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read business domains file %s: %w", path, err)
	}
	var entries []yamlBusinessDomain
	if err := yaml.Unmarshal(data, &entries); err != nil {
		return nil, fmt.Errorf("parse business domains file %s: %w", path, err)
	}
	return entries, nil
}

// containsBizCode 判断条目列表是否已含指定编码。
func containsBizCode(entries []yamlBusinessDomain, code string) bool {
	for _, e := range entries {
		if e.Code == code {
			return true
		}
	}
	return false
}