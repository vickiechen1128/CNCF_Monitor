package models

import "regexp"

// AppStatus 是应用字典条目的启用状态（决策 92，对齐业务分组双层编码）：
//   - enabled  启用：可被资源录入 / 编辑 / Excel 导入引用；
//   - disabled 停用：不删除（停用不删除红线），但不可被新资源选用，存量资源保留历史值。
const (
	AppStatusEnabled  = "enabled"
	AppStatusDisabled = "disabled"
)

// ValidAppCode 与应用编码规范：小写字母 / 数字 / 连字符，长度 ≤ 64（与 biz 同构，
// 决策 48/92 服务端校验）。
var ValidAppCode = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

// ApplicationDict 是应用字典（决策 92）：把原「app」从「展示名兼任编码」拆分为
// 「不可变编码 app_code + 字典展示名 app_name」，与业务分组 biz_code/biz_name 同构。
//
//   - AppCode     不可变主键（app_code），创建后不可改、停用不删除；
//   - AppName     展示名（app_name），可改，仅 UI 展示，修改不触发监控配置重生成 / 下发；
//   - Description 描述，可改；
//   - Status      启用状态（enabled/disabled）；停用不删除，停用条目不可被新资源选用；
//   - Source      条目来源（决策 97）：manual / excel-import / cmdb {v0.4+}；
//   - PlatformCode {v2.49} 已废弃，仅供一次性迁移读取；写链路不再维护，
//     应用↔平台 M:N 关系由 AppPlatformRel 承载。
//
// 资源表只存 AppCode（Host 物理列 app_code；Middleware/Application/Database/
// GenericTarget 物理列 app_name），app label 恒取 AppCode；AppName 不落在资源表上。
// 红线：不提供删除入口；资源侧 AppCode 只允许引用未停用条目（录入 / 编辑 / Excel
// 导入三处同校验）。
type ApplicationDict struct {
	BaseModel
	AppCode     string     `gorm:"size:64;not null;uniqueIndex:idx_application_dict_code" json:"app_code"`
	AppName     string     `gorm:"size:100;not null" json:"app_name"`
	Description string     `gorm:"size:500" json:"description"`
	Status      string     `gorm:"size:20;not null;default:enabled" json:"status"`
	Source      DictSource `gorm:"size:20;not null;default:manual" json:"source"`
	// PlatformCode {v2.49} 已废弃，仅供一次性迁移读取。应用↔平台关系由
	// AppPlatformRel 承载，写链路不再维护此字段。
	PlatformCode string `gorm:"size:64" json:"platform_code"`
}
