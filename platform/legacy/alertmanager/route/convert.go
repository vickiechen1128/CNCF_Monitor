// convert.go 提供 RouteNode（解析态）与 generator.RouteEditNode（编辑态）之间的生产级互转：
// ToEditNodes / ToRouteNodes。它们是「import→编辑」与「编辑→校验/生成」的唯一权威转换口径，
// 取代原先仅存在于测试中的 toEditNodes 帮助函数（避免生产代码依赖测试辅助）。
//
// 设计取舍：
//   - 转换不丢字段：matchers 双形态、group_by、节奏、continue、name、以及 route 级未建模键
//     Raw 均逐字段镜像；
//   - Enabled：解析态（RouteNode）无该概念，转为编辑态时一律置 *true（导入 = 全部启用，与
//     旧 toEditNodes 语义一致）；编辑态转回解析态时丢弃 *bool（RouteNode 不表达启用态）；
//   - 该文件位于 route 包（而非 generator 包）：generator 为规避与 route 成环已镜像定义
//     RouteEditMatcher，不得反向 import route，故互转收口在 route 包（route 已依赖 generator）。
//
// 参见 platform/alertmanager/route/parse.go / platform/configcenter/generator/notify_route_generate.go。
package route

import (
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
)

// boolPtr 返回 bool 指针（编辑态 *bool 字段构造用）。
func boolPtr(b bool) *bool { return &b }

// ToEditNodes 把解析态路由树（[]RouteNode）转换为编辑态树（[]generator.RouteEditNode）。
// 导入场景下全部节点视为启用（Enabled=*true），未建模键 Raw 原样透传。
func ToEditNodes(nodes []RouteNode) []generator.RouteEditNode {
	out := make([]generator.RouteEditNode, 0, len(nodes))
	for _, n := range nodes {
		e := generator.RouteEditNode{
			ID:             n.ID,
			ParentID:       n.ParentID,
			Name:           n.Name,
			Receiver:       n.Receiver,
			GroupBy:        n.GroupBy,
			GroupWait:      n.GroupWait,
			GroupInterval:  n.GroupInterval,
			RepeatInterval: n.RepeatInterval,
			Continue:       n.Continue,
			Order:          n.Order,
			Enabled:        boolPtr(true),
			Raw:            n.Raw,
			Matchers:       []generator.RouteEditMatcher{},
		}
		for _, m := range n.Matchers {
			e.Matchers = append(e.Matchers, generator.RouteEditMatcher{
				Name:    m.Name,
				Value:   m.Value,
				IsEqual: m.IsEqual,
				IsRegex: m.IsRegex,
			})
		}
		out = append(out, e)
	}
	return out
}

// ToRouteNodes 把编辑态树（[]generator.RouteEditNode）转换回解析态（[]RouteNode）。
// 编辑态的 *bool Enabled 被丢弃（解析态不表达启用态）；未建模键 Raw 原样透传。
// 用于把编辑态输入还原为可解析视图（如校验边界 / 调试），或保存链路上
// []RouteEditNode → []RouteNode 的归一。
func ToRouteNodes(nodes []generator.RouteEditNode) []RouteNode {
	out := make([]RouteNode, 0, len(nodes))
	for _, n := range nodes {
		r := RouteNode{
			ID:             n.ID,
			ParentID:       n.ParentID,
			Name:           n.Name,
			Receiver:       n.Receiver,
			GroupBy:        n.GroupBy,
			GroupWait:      n.GroupWait,
			GroupInterval:  n.GroupInterval,
			RepeatInterval: n.RepeatInterval,
			Continue:       n.Continue,
			Order:          n.Order,
			Raw:            n.Raw,
			Matchers:       []RouteMatcher{},
		}
		for _, m := range n.Matchers {
			r.Matchers = append(r.Matchers, RouteMatcher{
				Name:    m.Name,
				Value:   m.Value,
				IsEqual: m.IsEqual,
				IsRegex: m.IsRegex,
			})
		}
		out = append(out, r)
	}
	return out
}
