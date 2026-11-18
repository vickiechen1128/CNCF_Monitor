package seed

import (
	"fmt"
	"log"
	"os"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
	"gorm.io/gorm"
)

// yamlBusinessDomain 是 business_domains.yaml 中一条字典条目的加载视图。
// 与 models.BusinessDomain 分开定义：yaml 仅承载字典字段，不含 BaseModel 时间戳。
type yamlBusinessDomain struct {
	Code        string `yaml:"code"`
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Enabled     bool   `yaml:"enabled"`
}

// BusinessDomains 是可选的业务字典一次性导入入口。
//
// 自 M07 SRS v2.0 起系统**不预置任何业务字典**（`infra` 兜底条目已删除）：
//   - 仅当 business_domains 表为空时读取 yaml 模板；
//   - yaml 为空列表或文件不存在时什么也不做，不阻断启动；
//   - DB 非空时直接返回，DB 是唯一权威，绝不覆盖；
//   - 不强制补齐任何编码，导入内容完全由运维模板决定。
func BusinessDomains(db *gorm.DB, path string) error {
	if db == nil {
		return fmt.Errorf("seed business domains: nil database connection")
	}

	var count int64
	if err := db.Model(&models.BusinessDomain{}).Count(&count).Error; err != nil {
		return fmt.Errorf("seed business domains: count: %w", err)
	}
	if count > 0 {
		return nil // DB 非空则不 seed
	}

	entries, err := readBusinessDomainsFile(path)
	if err != nil {
		// 文件缺失或解析失败只记录告警：全新部署可以完全没有该文件，
		// 业务字典由运维在页面自助登记。
		log.Printf("seed business domains: %v (skipped)", err)
		return nil
	}
	if len(entries) == 0 {
		return nil
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
