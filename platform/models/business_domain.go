// Package models defines the unified data models for MetricCenter.
package models

// InfraBizCode 是无业务归属设备的兜底业务分组编码（决策 48）。
// 该条目由首次启动 seed 强制预置，且禁止停用/删除——无业务归属的设备类资源
// （如 SNMP 交换机、共享存储）统一挂载，避免必填逼出假业务污染 biz 聚合。
const InfraBizCode = "infra"

// BusinessDomain 是业务分组字典的对外传输视图（DTO）。
//
//   - code        不可变主键（biz_code），永不可改、停用不删除（PRD §3.1 红线）；
//   - name        展示名（biz_name），可改，仅 UI 展示，修改不触发监控配置重生成；
//   - description 描述，可改；
//   - enabled     启用状态；停用条目不可被新资源/新增/编辑选用，存量资源保留历史值。
//
// 字典权威存储为 DB（决策 48）：business_domains.yaml 仅首次启动 seed（DB 为空时
// 导入 + infra 兜底），之后 DB 为唯一权威，热加载机制退役。
type BusinessDomain struct {
	BaseModel
	Code        string `gorm:"size:64;not null;uniqueIndex:idx_business_domain_code" json:"code"`
	Name        string `gorm:"size:100;not null" json:"name"`
	Description string `gorm:"size:500" json:"description"`
	Enabled     bool   `gorm:"not null" json:"enabled"`
}