package generator

import (
	"bytes"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// DefaultReceiverName 是平台内置的空接收人（兜底占位）名。
//
// Alertmanager 要求根 route 必须指定 receiver（`root route must specify a default receiver`），
// 但接收人本身可以不挂任何通知配置——命中它的告警会被静默丢弃。平台把它作为「默认（不通知）」
// 选项提供给路由树，使新环境在尚未配置任何通知渠道时也能保存一份合法配置。
const DefaultReceiverName = "default"

// EnsureDefaultReceiver 确保 alertmanager.yml 的 receivers 段含内置空接收人 default。
//
//   - 已有同名 receiver：原样返回（用户/平台已声明，不覆盖其配置）；
//   - 无 receivers 段：追加 `receivers: [{name: default}]`；
//   - receivers 段不是列表 / YAML 无法解析：原样返回，交由 amtool 校验给出用户可读错误；
//   - 空内容：原样返回（没有 route 的配置本身不合法，不在这里造半份配置）。
//
// 仅在实际新增时重新序列化，其余路径字节级原样返回，保证幂等与 checksum 可复现。
func EnsureDefaultReceiver(baseYAML string) (string, error) {
	if strings.TrimSpace(baseYAML) == "" {
		return baseYAML, nil
	}

	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return baseYAML, nil
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return baseYAML, nil
	}
	root := doc.Content[0]

	ri := mappingValueIndex(root, "receivers")
	if ri < 0 {
		seq := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		seq.Content = append(seq.Content, defaultReceiverNode())
		root.Content = append(root.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "receivers"},
			seq,
		)
		return marshalDocument(&doc, baseYAML)
	}

	seq := root.Content[ri]
	if seq.Kind != yaml.SequenceNode {
		return baseYAML, nil
	}
	for _, item := range seq.Content {
		if item.Kind != yaml.MappingNode {
			continue
		}
		if ni := mappingValueIndex(item, "name"); ni >= 0 && item.Content[ni].Value == DefaultReceiverName {
			return baseYAML, nil
		}
	}

	seq.Content = append(seq.Content, defaultReceiverNode())
	return marshalDocument(&doc, baseYAML)
}

// EnsureReceiverNames 确保 receivers 段包含给定名字（缺失时追加**空 receiver 占位**：
// 只有 name，不挂通知配置）。
//
// 用途：路由保存时引用了「已启用通知渠道物化名」，但该 receiver 尚未写入 YAML
// （真实 webhook 要等 M09 生成阶段 MaterializeNotifyReceivers 才补齐）。amtool 要求
// route 引用的 receiver 必须已声明，故先补占位，后续物化会识别「同名残壳」并原地补齐。
//
// 已存在的同名 receiver 原样保留；无缺失时字节级原样返回。YAML 非法 / receivers 非列表
// 时原样返回，交由 amtool 给出用户可读错误。
func EnsureReceiverNames(baseYAML string, names []string) (string, error) {
	if strings.TrimSpace(baseYAML) == "" || len(names) == 0 {
		return baseYAML, nil
	}
	wanted := make(map[string]bool, len(names))
	for _, n := range names {
		if strings.TrimSpace(n) != "" {
			wanted[strings.TrimSpace(n)] = true
		}
	}
	if len(wanted) == 0 {
		return baseYAML, nil
	}

	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return baseYAML, nil
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return baseYAML, nil
	}
	root := doc.Content[0]

	ri := mappingValueIndex(root, "receivers")
	if ri < 0 {
		seq := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
		for _, name := range sortedNames(wanted) {
			seq.Content = append(seq.Content, receiverNameNode(name))
		}
		root.Content = append(root.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: "receivers"},
			seq,
		)
		return marshalDocument(&doc, baseYAML)
	}
	seq := root.Content[ri]
	if seq.Kind != yaml.SequenceNode {
		return baseYAML, nil
	}
	for _, item := range seq.Content {
		if item.Kind != yaml.MappingNode {
			continue
		}
		if ni := mappingValueIndex(item, "name"); ni >= 0 {
			delete(wanted, item.Content[ni].Value)
		}
	}
	if len(wanted) == 0 {
		return baseYAML, nil
	}
	for _, name := range sortedNames(wanted) {
		seq.Content = append(seq.Content, receiverNameNode(name))
	}
	return marshalDocument(&doc, baseYAML)
}

// sortedNames 返回集合中的名字（稳定排序，保证生成的 YAML 与 checksum 可复现）。
func sortedNames(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for name := range set {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// receiverNameNode 构造只有 name 的空 receiver 占位节点。
func receiverNameNode(name string) *yaml.Node {
	item := &yaml.Node{Kind: yaml.MappingNode}
	appendMapping(item, "name", &yaml.Node{Kind: yaml.ScalarNode, Value: name})
	return item
}

// defaultReceiverNode 构造空接收人节点：只有 name，不挂任何通知配置。
func defaultReceiverNode() *yaml.Node {
	item := &yaml.Node{Kind: yaml.MappingNode}
	appendMapping(item, "name", &yaml.Node{Kind: yaml.ScalarNode, Value: DefaultReceiverName})
	return item
}

// marshalDocument 序列化；失败时返回原内容，避免在生成链路上制造比「缺默认接收人」更严重的故障。
// 用 2 空格缩进（与 alertmanager.yml 手写惯例一致；yaml.Marshal 默认 4 空格会整体改版式）。
func marshalDocument(doc *yaml.Node, fallback string) (string, error) {
	var buf bytes.Buffer
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(doc); err != nil {
		return fallback, nil
	}
	if err := enc.Close(); err != nil {
		return fallback, nil
	}
	return buf.String(), nil
}
