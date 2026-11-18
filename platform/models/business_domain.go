// Package models defines the unified data models for MetricCenter.
package models

// DictSource 是字典条目的来源（决策 97）：
//   - manual       手工登记（web / API 录入，默认值）；
//   - excel-import Excel 导入文件「业务声明」/「应用声明」sheet 批量建出；
//   - cmdb         外部 CMDB 同步（v0.4+ 预留）。
//
// 来源仅用于审计与追踪，不影响条目的启用/停用判定。
type DictSource string

// Dict source constants.
const (
	DictSourceManual      DictSource = "manual"
	DictSourceExcelImport DictSource = "excel-import"
	DictSourceCMDB        DictSource = "cmdb" // v0.4+
)

// BusinessDomain 是业务分组字典的对外传输视图（DTO）。
//
//   - code        不可变主键（biz_code），永不可改、停用不删除（PRD §3.1 红线）；
//   - name        展示名（biz_name），可改，仅 UI 展示，修改不触发监控配置重生成；
//   - description 描述，可改；
//   - enabled     启用状态；停用条目不可被新资源/新增/编辑选用，存量资源保留历史值；
//   - source      条目来源（决策 97）：manual / excel-import / cmdb {v0.4+}。
//
// 字典权威存储为 DB（决策 48）：系统不预置任何业务字典，`infra` 兜底条目
// 已于 M07 SRS v2.0 删除；`business_domains.yaml` 仅作为可选的空库一次性导入
// 模板，DB 非空时被忽略。
type BusinessDomain struct {
	BaseModel
	Code        string     `gorm:"size:64;not null;uniqueIndex:idx_business_domain_code" json:"code"`
	Name        string     `gorm:"size:100;not null" json:"name"`
	Description string     `gorm:"size:500" json:"description"`
	Enabled     bool       `gorm:"not null" json:"enabled"`
	Source      DictSource `gorm:"size:20;not null;default:manual" json:"source"`
}
