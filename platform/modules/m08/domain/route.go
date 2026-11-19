package domain

import (
	"fmt"
	"strings"
	"time"
)

// RouteNode is one node of the platform-owned routing tree (FR-13). The tree is
// persisted verbatim inside the current snapshot (D47) and rendered to the
// `route` section; nobody edits the YAML by hand.
type RouteNode struct {
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	Matchers      []Matcher   `json:"matchers"`
	Receiver      string      `json:"receiver"`
	GroupBy       []string    `json:"group_by"`
	GroupWait     string      `json:"group_wait"`
	GroupInterval string      `json:"group_interval"`
	RepeatInterval string     `json:"repeat_interval"`
	Continue      bool        `json:"continue"`
	Enabled       bool        `json:"enabled"`
	Children      []RouteNode `json:"children"`
}

// maxRouteDepth bounds recursion so a malformed tree cannot exhaust the stack.
const maxRouteDepth = 10

// ValidateRouteTree validates the whole tree: exactly one root, valid
// receivers, durations and matcher grammar.
func ValidateRouteTree(nodes []RouteNode, allowedReceivers map[string]bool) []ValidationIssue {
	if len(nodes) == 0 {
		return []ValidationIssue{{Field: "route_tree", Message: "路由树不能为空"}}
	}
	if len(nodes) > 1 {
		return []ValidationIssue{{Field: "route_tree", Message: "路由树只能有一个根路由"}}
	}
	var issues []ValidationIssue
	walkRoute(&nodes[0], "root", 1, allowedReceivers, &issues)
	return issues
}

func walkRoute(node *RouteNode, path string, depth int, allowed map[string]bool, issues *[]ValidationIssue) {
	if depth > maxRouteDepth {
		*issues = append(*issues, ValidationIssue{Field: path, Message: "路由层级超过 10 层"})
		return
	}
	if node.ID == "" {
		*issues = append(*issues, ValidationIssue{Field: path + ".id", Message: "路由节点 ID 不能为空"})
	}
	*issues = append(*issues, ValidateMatchers(path+".matchers", node.Matchers)...)
	if depth == 1 {
		if node.Receiver == "" {
			*issues = append(*issues, ValidationIssue{Field: path + ".receiver", Message: "根路由必须指定接收人"})
		}
	}
	if node.Receiver != "" && allowed != nil && !allowed[node.Receiver] {
		*issues = append(*issues, ValidationIssue{
			Field:   path + ".receiver",
			Message: fmt.Sprintf("接收人 %q 不在候选集合内（default 或 notify-<渠道ID>）", node.Receiver),
		})
	}
	for _, field := range []struct{ name, value string }{
		{"group_wait", node.GroupWait},
		{"group_interval", node.GroupInterval},
		{"repeat_interval", node.RepeatInterval},
	} {
		if field.value == "" {
			continue
		}
		d, err := time.ParseDuration(field.value)
		if err != nil || d <= 0 {
			*issues = append(*issues, ValidationIssue{
				Field:   path + "." + field.name,
				Message: fmt.Sprintf("时长 %q 非法：需为正的 Go duration（如 30s / 5m / 4h）", field.value),
			})
		}
	}
	for i := range node.GroupBy {
		name := strings.TrimSpace(node.GroupBy[i])
		if name == "" {
			*issues = append(*issues, ValidationIssue{
				Field: fmt.Sprintf("%s.group_by[%d]", path, i), Message: "分组标签名不能为空",
			})
		}
	}
	if len(node.Children) > 50 {
		*issues = append(*issues, ValidationIssue{Field: path + ".children", Message: "单个节点的子路由不能超过 50 个"})
	}
	for i := range node.Children {
		walkRoute(&node.Children[i], fmt.Sprintf("%s.children[%d]", path, i), depth+1, allowed, issues)
	}
}

// EnabledRoute returns a copy of the tree with disabled nodes (and their
// subtrees) removed; the generator renders only enabled branches.
func EnabledRoute(nodes []RouteNode) []RouteNode {
	out := make([]RouteNode, 0, len(nodes))
	for _, node := range nodes {
		if !node.Enabled && len(nodes) == 1 && node.ID != "" {
			// Keep the root even when disabled: AM requires a route root.
			node.Enabled = true
		}
		if !node.Enabled {
			continue
		}
		node.Children = EnabledRoute(node.Children)
		out = append(out, node)
	}
	return out
}

// CollectReceivers returns every receiver referenced by an enabled node.
func CollectReceivers(nodes []RouteNode) map[string]bool {
	out := make(map[string]bool)
	var walk func([]RouteNode)
	walk = func(list []RouteNode) {
		for _, node := range list {
			if !node.Enabled {
				continue
			}
			if node.Receiver != "" {
				out[node.Receiver] = true
			}
			walk(node.Children)
		}
	}
	walk(nodes)
	return out
}

