package generator

import (
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// CollectRouteReceiverNames 收集 alertmanager.yml route 段中所有被引用的 receiver 名
// （根 `route.receiver` + 递归 `routes[].receiver`）。
//
// 用途（2026-10-22 渠道/模板解耦）：M09 物化 receivers 时只物化被路由引用的渠道，
// 未被引用的渠道不进入 alertmanager.yml；因此新增渠道、改名、改 webhook、换绑模板
// 都不会触发配置变更，只有路由规则变化才会。
//
// 空内容 / 无 route 段返回空集合（没有路由就不会引用任何渠道）；
// YAML 非法或 route 结构非法返回错误（由生成链路转为草稿校验失败）。
func CollectRouteReceiverNames(baseYAML string) (map[string]struct{}, error) {
	names := make(map[string]struct{})
	if strings.TrimSpace(baseYAML) == "" {
		return names, nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return nil, fmt.Errorf("parse alertmanager.yml for route receivers: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 {
		return names, nil
	}
	root := derefYAMLNode(doc.Content[0])
	if root == nil || root.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("alertmanager.yml 顶层不是映射，无法解析 route receiver")
	}
	idx := mappingValueIndex(root, "route")
	if idx < 0 {
		return names, nil
	}
	if err := collectRouteReceivers(root.Content[idx], names); err != nil {
		return nil, err
	}
	return names, nil
}

// collectRouteReceivers 递归收集单个 route 节点及其子路由引用的 receiver 名。
func collectRouteReceivers(n *yaml.Node, out map[string]struct{}) error {
	n = derefYAMLNode(n)
	if n == nil || n.Kind != yaml.MappingNode {
		return fmt.Errorf("alertmanager.yml 的 route 段不是映射，无法解析 receiver 引用")
	}
	if idx := mappingValueIndex(n, "receiver"); idx >= 0 {
		v := derefYAMLNode(n.Content[idx])
		if v != nil && v.Kind == yaml.ScalarNode && v.Value != "" {
			out[v.Value] = struct{}{}
		}
	}
	if idx := mappingValueIndex(n, "routes"); idx >= 0 {
		seq := derefYAMLNode(n.Content[idx])
		if seq != nil && seq.Kind == yaml.SequenceNode {
			for _, child := range seq.Content {
				if err := collectRouteReceivers(child, out); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// derefYAMLNode 展开 YAML alias 节点（原样保留 nil 语义）。
func derefYAMLNode(n *yaml.Node) *yaml.Node {
	for n != nil && n.Kind == yaml.AliasNode {
		n = n.Alias
	}
	return n
}
