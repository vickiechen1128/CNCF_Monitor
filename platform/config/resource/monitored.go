// monitored.go —— is_monitored 查询参数处理（Module_07 §6.1 / 决策 31-M1 /
// §11.2「未监控」筛选）。
//
// 采集状态口径（§5.2 / §6.5）：
//   - is_monitored 字段由 Module_01（采集策略管理）维护，M07 为**只读映射**；
//   - M01 未实现时，该参数仅解析透传、**不生效**（不拼 GORM 条件、不查询
//     ScrapeJob，避免反向依赖，§6.5「采集状态不反向依赖」）；
//   - 前端「未监控」筛选（§11.2）传 is_monitored=false，M01 上线后可按本文件
//     返回值在 ListResources 中追加关联过滤（本阶段不实现）。
package resource

import "strings"

// IsMonitoredKey 是资源列表的 is_monitored 查询参数名（Module_07 §6.1）。
const IsMonitoredKey = "is_monitored"

// ParseIsMonitored 校验并解析 is_monitored 查询参数。
//
// 返回 (valid, monitored)：
//   - raw 为空或非法值 → (false, false)，按未传处理（不报错，保证「透传不报错」）；
//   - raw 为 true/1（忽略大小写）→ (true, true)，已监控；
//   - raw 为 false/0（忽略大小写）→ (true, false)，未监控（「未监控」筛选，§11.2）。
//
// 注意：本函数不访问数据库，不查询 ScrapeJob；M01 未实现时 ListResources 忽略
// 返回值（透传不生效），仅承载 M01 上线后的关联过滤契约（§6.5）。
func ParseIsMonitored(raw string) (valid, monitored bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "true", "1":
		return true, true
	case "false", "0":
		return true, false
	default:
		return false, false
	}
}
