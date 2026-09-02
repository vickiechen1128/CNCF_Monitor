// monitored.go —— is_monitored 查询参数处理（Module_07 §6.1 / 决策 47-3，修订决策 31-M1 /
// §11.2「采集状态」三态筛选）。
//
// 三态采集状态数据源为 M02 `GET /api/v1/health/coverage`（decision 47-3，修订决策 31-M1）：
//   - is_monitored（M01 选中关系）仅作为参数接受并透传解析，M07 为**只读映射**；
//   - 本接口**不内嵌 up/down 采集状态字段**（M07 不反向查询 ScrapeJob/时序，见 §6.5
//     「采集状态不反向依赖」），前端经 coverage 聚合（items 按 resource_id）合并渲染；
//   - 参数仅解析透传、**不生效**（不拼 GORM 条件、不查询 ScrapeJob，避免反向依赖）。
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
// 注意：本函数不访问数据库，不查询 ScrapeJob；本接口不内嵌 up/down 采集状态字段——
// 三态采集状态数据源为 M02 GET /api/v1/health/coverage，前端经 coverage 聚合合并
// （decision 47-3，修订决策 31-M1；M07 只读消费、不直连时序）。
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
