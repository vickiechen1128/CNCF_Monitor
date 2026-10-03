// Package models 承载 MetricCenter 领域模型。
// 本文件定义 Module_08「最小运行骨架自动布缆」（决策 113，口径 C）的管理域单例设定：
// AlertmanagerRouteSetting——用户选定「默认接收人」即授权平台接管 alertmanager.yml 根兜底
// route.receiver 单键。平台仅在设定生效时原地替换该键，绝不触碰 group_by / group_wait /
// group_interval / repeat_interval / continue，绝不写入 route.routes[]。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §4.1.1（最小运行骨架 / 默认接收人来源）/ §9.1 / §9.2；
//   docs/05-execution-records/module-08/design-decisions.md 决策 113。
package models

// RouteMode 是 alertmanager.yml route 段的作者模式（提案 §4.3 / §4.5；T08-F12 模式开关）：
//   - RouteModeHandwritten：手写模式（默认）——route 段由用户手写维护，平台只读渲染；
//   - RouteModeManaged：平台管理模式——route 段由平台生成（关闭手写模式）。
//
// 存量零值行（Mode=""）读取时归一为 RouteModeHandwritten（向后兼容、零影响）。
type RouteMode string

const (
	RouteModeHandwritten RouteMode = "handwritten"
	RouteModeManaged     RouteMode = "managed"
)

// AlertmanagerRouteSetting 是管理域（default）单例设定：默认接收人 = 授权平台接管根兜底。
//
//   - NetworkDomainID：归属管理域（决策 60：alertmanager.yml 恒属 default，不按网域扇出）；
//     uniqueIndex 保证每域至多一条（单例）。
//   - DefaultReceiverChannelID：目标通知渠道 ID；**nil = 不接管**（默认零值、存量零影响）。
//     非 nil 时平台生成配置按 NotifyChannel.ReceiverName() 取 AM receiver 名，原地替换根
//     route.receiver 单键。
//   - Mode：route 段作者模式（T08-F12 模式开关）。零值（存量行）归一为 handwritten；
//     由 LoadRouteSetting 在读取时回填，保证 GET /routes 返回真实持久化模式而非硬编码。
//
// 可用性判定不落库：目标渠道被禁用 / 删除时设定原值保留（不回写库、不报错），生成时经
// EffectiveDefaultReceiver 回落为不接管（决策 113 护栏③：关闭 = 停止替换、不删最后写入的值）。
type AlertmanagerRouteSetting struct {
	BaseModel
	NetworkDomainID          string   `gorm:"size:64;not null;uniqueIndex" json:"network_domain_id"`
	DefaultReceiverChannelID *uint    `gorm:"index" json:"default_receiver_channel_id,omitempty"`
	Mode                     RouteMode `gorm:"size:16;not null;default:handwritten" json:"mode"`
}

// TableName 返回 GORM 表名。
func (AlertmanagerRouteSetting) TableName() string { return "alertmanager_route_settings" }

// EffectiveDefaultReceiver 在给定通知渠道集合中解析本设定实际生效的默认接收人。
//
// 返回 (receiverName, ok)：
//   - ok=false：不接管——DefaultReceiverChannelID 为 nil，或其目标渠道不存在 / enabled=false；
//   - ok=true：目标渠道存在且启用，receiverName 为其 AM receiver 名（NotifyChannel.ReceiverName()，
//     与 M09 receivers 物化 / 桥渲染同源，决策 74 定稿第 1 条）。
//
// 纯函数：不访问 DB、不修改设定。渠道被禁用 / 删除仅导致回落为不接管（决策 113 护栏③），
// 设定原值保留，待渠道恢复启用后自动重新生效。
func (s AlertmanagerRouteSetting) EffectiveDefaultReceiver(channels []NotifyChannel) (string, bool) {
	if s.DefaultReceiverChannelID == nil {
		return "", false
	}
	for _, ch := range channels {
		if ch.ID == *s.DefaultReceiverChannelID && ch.Enabled {
			return ch.ReceiverName(), true
		}
	}
	return "", false
}