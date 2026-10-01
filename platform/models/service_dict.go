package models

import "regexp"

// ServiceDict 是服务字典（决策 105/112：四层骨架 platform → app → service
// → instance 的第三层）。它是 `svc` label 的取值权威，与应用字典（§5.19）/
// 平台字典（§5.21）同构：
//
//   - ServiceCode 不可变主键（service_code），创建后不可改、停用不删除；
//   - ServiceName 展示名（service_name），必填，UI 展示用，修改不触发配置重生成；
//   - AppCode     可空所属应用，是应用↔服务 1:N 的关系权威；
//   - BizCode     可空主业务，是服务↔业务 N:1 的关系权威；
//   - Enabled     启用状态；停用条目不可被新资源选用（录入/编辑/Excel 导入三处同校验）；
//   - Source      条目来源（决策 97 延伸）：manual / excel-import。
//
// 决策 112 推翻原“本字典不设父子字段”口径：关系由可空 AppCode/BizCode 显式承载，
// 资源行 app_code/service_code 仅作为实例归属镜像。
//
// 红线（PRD §5.22）：①service_code 永不可改；②仅 service_name/description/Enabled/
// AppCode/BizCode 可编辑；③停用不删除（无删除入口）；④资源侧 service_code 只允许引用未停用条目；
// ⑤禁止用展示名当编码（svc label 恒取 service_code）；⑥服务 label 恒为 `svc`，
// **禁用 `service`**（撞名 §5.15 机制 B 归一规则与既有 service_name）。
type ServiceDict struct {
	BaseModel
	ServiceCode string     `gorm:"size:64;not null;uniqueIndex:idx_service_dict_code" json:"service_code"`
	ServiceName string     `gorm:"size:100;not null" json:"service_name"`
	AppCode     string     `gorm:"size:64" json:"app_code,omitempty"`
	BizCode     string     `gorm:"size:64" json:"biz_code,omitempty"`
	Description string     `gorm:"size:500" json:"description"`
	Enabled     bool       `gorm:"not null" json:"enabled"`
	Source      DictSource `gorm:"size:20;not null;default:manual" json:"source"`
}

// ValidServiceCode 是服务编码规范：小写字母 / 数字 / 连字符，长度 ≤ 64
// （与 biz_code / app_code / platform_code 同构，服务端硬性校验）。
var ValidServiceCode = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)
