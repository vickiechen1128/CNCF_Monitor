package models

import "regexp"

// PlatformDict 是平台字典（决策 104：四层骨架 platform(1) → app(N) → service(M)
// → instance(K) 的顶层）。它是 `platform` label 的取值权威，与应用字典（§5.19）/
// 业务分组字典（§5.18）/ 云字典（§5.20）同规约：
//
//   - PlatformCode 不可变主键（platform_code），创建后不可改、停用不删除；
//   - PlatformName 展示名（platform_name），必填，UI 展示用，修改不触发配置重生成；
//   - Enabled     启用状态；停用条目不可被新/编辑中的应用条目引用；
//   - Source      条目来源（决策 97 延伸）：manual / excel-import。
//
// 红线（PRD §5.21）：①platform_code 永不可改；②仅 platform_name/description/
// enabled 可编辑；③停用不删除（无删除入口）；④应用侧 platform_code 只允许引用未
// 停用条目；⑤禁止用展示名当编码（platform label 恒取 platform_code）；⑥顶层命名
// 恒为 platform，**禁用 system**（撞名 ResourceLabel.source=system /「system 层」/
// os_dict）。
type PlatformDict struct {
	BaseModel
	PlatformCode string     `gorm:"size:64;not null;uniqueIndex:idx_platform_dict_code" json:"platform_code"`
	PlatformName string     `gorm:"size:100;not null" json:"platform_name"`
	Description  string     `gorm:"size:500" json:"description"`
	Enabled      bool       `gorm:"not null" json:"enabled"`
	Source       DictSource `gorm:"size:20;not null;default:manual" json:"source"`
}

// ValidPlatformCode 是平台编码规范：小写字母 / 数字 / 连字符，长度 ≤ 64
// （与 biz_code / app_code 同构，服务端硬性校验）。
var ValidPlatformCode = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)
