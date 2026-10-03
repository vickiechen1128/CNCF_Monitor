// 本文件实现 M08「route 前台化」v0.3-b 的**生成器纯函数**（提案 §3.5 / §4.4 / §6 验收 2/3/4/5；
// task-sequence.yaml T08-13）：把编辑态路由树（RouteEditNode 扁平序列）生成为 alertmanager.yml
// 的 route 段，并可原地替换回整份配置。
//
// 设计取舍（与 T08-12 解析器 platform/alertmanager/route/parse.go 严格对称）：
//
//  1. 编辑态字段彻底不落盘：id / parent_id / order / enabled 一律不写入 YAML——层级由
//     routes[] 嵌套位置表达、顺序由数组位置表达；name 以注释 `# 路由名称: xxx` 落盘于
//     节点上方（AM 无 name 字段）；enabled=false 的节点**及其整条子树**剔除。
//  2. matchers 落 **AM 字符串简写**（`severity="critical"` / `alertname=~"HostDown"`）。
//     提案 §3.5 允许「新式映射或字符串简写」二选一，但 amtool check-config（0.34）只接受
//     简写（映射形态报 `cannot unmarshal !!map into string`），故本实现固定走简写——
//     解析器对两种形态都能归一，往返不受影响。
//  3. 不可表达结构（未知 matcher 变体 / 非标量 group_by / 平台未建模键，如 match /
//     match_re / mute_time_intervals）由上游标 raw（RouteEditNode.RawYAML），生成时
//     **原样回写**；raw 原文不可解析时显式报错，**绝不静默丢弃**。
//  4. 只做纯函数：不读库、不写盘、不校验业务可达性（receiver 是否存在由调用方按
//     receivers 段判定）；产物校验走 ValidateRouteSectionWithAmtool。
//
// YAML 处理沿用本包既有范式（notify_receivers.go / notify_route_skeleton.go）：yaml.Node
// 原地改写，保注释、保手写节点样式、保幂等。
//
// 注：platform/alertmanager/route 依赖本包（route/handler.go 引用 LoadEnabledNotifyChannels），
// 故本包不得反向 import route（成环），RouteEditMatcher 在此镜像定义，字段口径与
// route.RouteMatcher 一致。
package generator

import (
	"errors"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"
)

// 落盘键名与名称注释前缀（与 route/parse.go 的解析器严格对称）。
const (
	// routeSectionKey 是 alertmanager.yml 顶层 route 段键名。
	routeSectionKey = "route"
	// routeNameCommentPrefix 是路由名称注释前缀：`# 路由名称: xxx`。
	routeNameCommentPrefix = "路由名称"
)

// RouteEditMatcher 是编辑态单条匹配条件（口径与 route.RouteMatcher 一致）。
//
//	Name    标签名
//	Value   匹配值
//	IsEqual true=`=` / `=~`（相等）false=`!=` / `!~`（取反）
//	IsRegex true=正则匹配（`=~` / `!~`）
type RouteEditMatcher struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	IsEqual bool   `json:"is_equal"`
	IsRegex bool   `json:"is_regex"`
}

// RouteEditNode 是编辑态路由节点（前序扁平序列，items[0] 为根路由）。
//
// ID / ParentID / Order 为平台编辑态内部标识（不落盘）：层级由 routes[] 嵌套位置表达，
// 顺序由**同层节点的数组顺序**表达（界面顺序 = 生效顺序，先匹配先生效）。
type RouteEditNode struct {
	ID             string             `json:"id"`
	ParentID       string             `json:"parent_id"`
	Name           string             `json:"name"`
	Matchers       []RouteEditMatcher `json:"matchers"`
	Receiver       string             `json:"receiver"`
	GroupBy        []string           `json:"group_by"`
	GroupWait      string             `json:"group_wait"`
	GroupInterval  string             `json:"group_interval"`
	RepeatInterval string             `json:"repeat_interval"`
	Continue       bool               `json:"continue"`
	Order          int                `json:"order"`
	// Enabled 为编辑态开关（不落盘）：false 时该节点**及其整条子树**整条剔除。
	// 使用 *bool：零值 nil = 未设定（视为启用，向后兼容导入侧无需显式置位）；
	// 仅 *false = 显式禁用。生成逻辑以 nodeEnabled 归一读取。
	Enabled *bool `json:"enabled"`
	// RawYAML 是不可表达子树的原文（不落盘为平台键，原样回写）：非空时本节点（含子树）
	// 整体以该原文输出，其余建模字段不再展开。用于承载未知 matcher 变体、非标量
	// group_by、平台未建模键（match / match_re / mute_time_intervals 等）。
	RawYAML string `json:"raw_yaml"`
	// Raw 是「route 级未建模键」的原样 YAML 片段（同 route.RouteNode.Raw 口径），
	// 由解析器捕获、生成时原样回写本节点映射，确保手写配置往返无损（B1）。
	// 与 RawYAML 区分：RawYAML 是整节点替换，Raw 是节点内附加键。
	Raw string `json:"raw"`
}

// NodeEnabled 归一读取编辑态开关：nil = 未设定 = 启用；*true = 启用；*false = 禁用。
// 导出供 route 包校验逻辑（ValidateRouteTree）复用同一口径，避免语义分叉。
func NodeEnabled(n RouteEditNode) bool {
	return n.Enabled == nil || *n.Enabled
}

// RouteAmtoolChecker 是 amtool check-config 等价校验的调用点（可注入，便于测试不依赖
// 外部二进制；默认实现复用本包 runAmmtoolCheck，与 ValidateArtifacts 同口径）。
var RouteAmtoolChecker = func(content string) error { return runAmmtoolCheck(content) }

// GenerateRouteSection 把编辑态路由树生成为 route 段 YAML（含顶层 `route:` 键）。
//
//   - routes[] 顺序 = 同层节点的数组顺序（界面顺序）；
//   - matchers 落 AM 字符串简写；continue 仅在 true 时输出；group_by 留空不输出该键；
//   - name 以 `# 路由名称: xxx` 注释落盘于节点上方；id / parent_id / order / enabled 不落盘；
//   - 畸形树（空树 / 无根 / 多根 / 重复 ID / 父节点不存在 / 从根不可达 / 根节点未启用 /
//     raw 原文非法）一律返回 error，**绝不产出半截 route 段**。
func GenerateRouteSection(tree []RouteEditNode) (string, error) {
	if len(tree) == 0 {
		return "", errors.New("编辑态路由树为空，无法生成 route 段")
	}
	idx, err := indexRouteEditTree(tree)
	if err != nil {
		return "", err
	}
	if !NodeEnabled(idx.nodes[idx.root]) {
		return "", errors.New("编辑态路由树根节点未启用，无法生成 route 段（AM 语义为有序单根）")
	}
	route, err := buildRouteNode(idx, idx.root, map[string]bool{})
	if err != nil {
		return "", err
	}
	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{
		Kind: yaml.MappingNode,
		Content: []*yaml.Node{
			{Kind: yaml.ScalarNode, Value: routeSectionKey},
			route,
		},
	}}}
	out, err := yaml.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("序列化 route 段失败: %w", err)
	}
	return string(out), nil
}

// MergeRouteSection 把生成的 route 段（generated，含顶层 `route:` 键）原地替换进
// baseYAML：只替换根 route 节点，其余顶层段（global / receivers / inhibit_rules /
// templates / mute_time_intervals 等）**逐字保留**（含注释与样式）。
//
// baseYAML 无 route 段时（畸形存量文件）追加生成物，而非丢弃生成结果。
func MergeRouteSection(baseYAML, generated string) (string, error) {
	route, err := routeSectionNode(generated)
	if err != nil {
		return "", err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return "", fmt.Errorf("解析 base alertmanager.yml 失败: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return "", errors.New("base alertmanager.yml 顶层不是映射，无法合并 route 段")
	}
	root := doc.Content[0]
	if vi := mappingValueIndex(root, routeSectionKey); vi >= 0 {
		root.Content[vi] = route
	} else {
		root.Content = append(root.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Value: routeSectionKey}, route)
	}
	out, err := yaml.Marshal(&doc)
	if err != nil {
		return "", fmt.Errorf("序列化合并后的 alertmanager.yml 失败: %w", err)
	}
	return string(out), nil
}

// ValidateRouteSectionWithAmtool 对生成的 route 段做 amtool check-config 等价校验。
//
// amtool 要求「route 引用的 receiver 必须已声明」，故本函数把 route 段包成最小可校验
// 文档（补 receivers 声明）后再校验；产物缺失根兜底 receiver 时由 amtool 判定失败，
// 本函数不代为造值。
func ValidateRouteSectionWithAmtool(routeYAML string) error {
	names, err := routeSectionReceiverNames(routeYAML)
	if err != nil {
		return err
	}
	var b strings.Builder
	b.WriteString(strings.TrimRight(routeYAML, "\n"))
	b.WriteString("\nreceivers:\n")
	for _, n := range names {
		b.WriteString("    - name: '" + n + "'\n")
	}
	return RouteAmtoolChecker(b.String())
}

// routeEditTreeIndex 是编辑态树的索引：节点切片 + 父 ID → 子下标（保序）+ 根下标。
type routeEditTreeIndex struct {
	nodes    []RouteEditNode
	children map[string][]int
	root     int
}

// indexRouteEditTree 建立编辑态树索引并做结构体检：唯一根、ID 唯一、父节点存在、
// 全部节点从根可达（杜绝孤立 / 成环导致的静默丢弃）。
func indexRouteEditTree(tree []RouteEditNode) (*routeEditTreeIndex, error) {
	seen := make(map[string]int, len(tree))
	idx := &routeEditTreeIndex{nodes: tree, children: map[string][]int{}, root: -1}
	for i := range tree {
		if _, dup := seen[tree[i].ID]; dup {
			return nil, fmt.Errorf("编辑态路由树存在重复节点 ID %q", tree[i].ID)
		}
		seen[tree[i].ID] = i
	}
	for i := range tree {
		parent := tree[i].ParentID
		if parent == "" {
			if idx.root >= 0 {
				return nil, errors.New("编辑态路由树存在多个根节点（AM 语义为有序单根）")
			}
			idx.root = i
			continue
		}
		if _, ok := seen[parent]; !ok {
			return nil, fmt.Errorf("编辑态路由树节点 %q 的父节点 %q 不存在（孤立节点，拒绝静默丢弃）",
				tree[i].ID, parent)
		}
		idx.children[parent] = append(idx.children[parent], i)
	}
	if idx.root < 0 {
		return nil, errors.New("编辑态路由树缺少根节点（parent_id 为空的节点）")
	}
	if reached := reachableCount(idx); reached != len(tree) {
		return nil, fmt.Errorf("编辑态路由树存在从根不可达的节点（%d/%d 可达），拒绝静默丢弃",
			reached, len(tree))
	}
	return idx, nil
}

// reachableCount 统计从根出发可达的节点数（含根）。
func reachableCount(idx *routeEditTreeIndex) int {
	count := 0
	var walk func(i int)
	walk = func(i int) {
		count++
		for _, c := range idx.children[idx.nodes[i].ID] {
			walk(c)
		}
	}
	walk(idx.root)
	return count
}

// buildRouteNode 递归构造单个 route 映射节点（含 name 注释与子路由）。
func buildRouteNode(idx *routeEditTreeIndex, i int, visiting map[string]bool) (*yaml.Node, error) {
	n := &idx.nodes[i]
	if visiting[n.ID] {
		return nil, fmt.Errorf("编辑态路由树存在环路：节点 %q 被重复引用", n.ID)
	}
	visiting[n.ID] = true
	defer delete(visiting, n.ID)

	if strings.TrimSpace(n.RawYAML) != "" {
		return rawRouteNode(n.RawYAML)
	}

	m := &yaml.Node{Kind: yaml.MappingNode}
	if len(n.Matchers) > 0 {
		matchers := &yaml.Node{Kind: yaml.SequenceNode}
		for _, mt := range n.Matchers {
			matchers.Content = append(matchers.Content,
				&yaml.Node{Kind: yaml.ScalarNode, Value: matcherShorthand(mt)})
		}
		appendMapping(m, "matchers", matchers)
	}
	if n.Receiver != "" {
		appendMapping(m, "receiver", &yaml.Node{Kind: yaml.ScalarNode, Value: n.Receiver, Style: yaml.SingleQuotedStyle})
	}
	if len(n.GroupBy) > 0 {
		groupBy := &yaml.Node{Kind: yaml.SequenceNode, Style: yaml.FlowStyle}
		for _, g := range n.GroupBy {
			groupBy.Content = append(groupBy.Content, &yaml.Node{Kind: yaml.ScalarNode, Value: g})
		}
		appendMapping(m, "group_by", groupBy)
	}
	appendMappingIfSet(m, "group_wait", n.GroupWait)
	appendMappingIfSet(m, "group_interval", n.GroupInterval)
	appendMappingIfSet(m, "repeat_interval", n.RepeatInterval)
	if n.Continue {
		appendMapping(m, "continue", &yaml.Node{Kind: yaml.ScalarNode, Value: "true"})
	}

	routes, err := buildChildRoutes(idx, n.ID, visiting)
	if err != nil {
		return nil, err
	}
	if routes != nil {
		appendMapping(m, "routes", routes)
	}
	if n.Name != "" {
		m.HeadComment = "# " + routeNameCommentPrefix + ": " + n.Name
	}

	// 原样回写 route 级未建模键（match / match_re / mute_time_intervals 等），确保无损。
	if err := appendRawExtra(m, n.Raw); err != nil {
		return nil, err
	}
	return m, nil
}

// appendRawExtra 把未建模键原样 YAML 片段附加到映射节点 m（键:值 对），保证手写配置往返无损。
func appendRawExtra(m *yaml.Node, raw string) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return fmt.Errorf("解析 raw 未建模键失败，拒绝静默丢弃: %w", err)
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return errors.New("raw 未建模键不是映射，拒绝静默丢弃")
	}
	m.Content = append(m.Content, doc.Content[0].Content...)
	return nil
}

// buildChildRoutes 构造子路由序列：按数组顺序、跳过 enabled=false 的整条子树。
func buildChildRoutes(idx *routeEditTreeIndex, parentID string, visiting map[string]bool) (*yaml.Node, error) {
	kids := idx.children[parentID]
	if len(kids) == 0 {
		return nil, nil
	}
	routes := &yaml.Node{Kind: yaml.SequenceNode}
	for _, k := range kids {
		if !NodeEnabled(idx.nodes[k]) {
			continue
		}
		child, err := buildRouteNode(idx, k, visiting)
		if err != nil {
			return nil, err
		}
		routes.Content = append(routes.Content, child)
	}
	if len(routes.Content) == 0 {
		return nil, nil
	}
	return routes, nil
}

// rawRouteNode 解析 raw 原文为节点（不可表达子树的原样回写通道）。
func rawRouteNode(raw string) (*yaml.Node, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("raw route 段原文无法解析，拒绝静默丢弃: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, errors.New("raw route 段原文不是映射，拒绝静默丢弃")
	}
	return doc.Content[0], nil
}

// matcherShorthand 把编辑态 matcher 渲染为 AM 字符串简写 `name<op>"value"`。
// 值内含双引号时改用单引号包裹（保持 YAML 合法，且解析器可原样还原）。
func matcherShorthand(m RouteEditMatcher) string {
	op := "="
	switch {
	case m.IsRegex && m.IsEqual:
		op = "=~"
	case m.IsRegex && !m.IsEqual:
		op = "!~"
	case !m.IsRegex && !m.IsEqual:
		op = "!="
	}
	quote := `"`
	if strings.ContainsRune(m.Value, '"') {
		quote = `'`
	}
	return m.Name + op + quote + m.Value + quote
}

// appendMapping 追加一对键值节点。
func appendMapping(m *yaml.Node, key string, value *yaml.Node) {
	m.Content = append(m.Content, &yaml.Node{Kind: yaml.ScalarNode, Value: key}, value)
}

// appendMappingIfSet 仅在值非空时追加标量键值对（留空不输出该键）。
func appendMappingIfSet(m *yaml.Node, key, value string) {
	if value == "" {
		return
	}
	appendMapping(m, key, &yaml.Node{Kind: yaml.ScalarNode, Value: value})
}

// routeSectionNode 从生成的 route 段 YAML 中取出 route 映射节点。
func routeSectionNode(generated string) (*yaml.Node, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(generated), &doc); err != nil {
		return nil, fmt.Errorf("解析生成的 route 段失败: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, errors.New("生成的 route 段顶层不是映射")
	}
	vi := mappingValueIndex(doc.Content[0], routeSectionKey)
	if vi < 0 || doc.Content[0].Content[vi].Kind != yaml.MappingNode {
		return nil, errors.New("生成的 route 段缺少 route 映射节点")
	}
	return doc.Content[0].Content[vi], nil
}

// routeSectionReceiverNames 收集 route 段中引用的 receiver 名（按出现顺序去重），
// 用于补齐 amtool 校验所需的最小 receivers 声明。
func routeSectionReceiverNames(routeYAML string) ([]string, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(routeYAML), &doc); err != nil {
		return nil, fmt.Errorf("解析 route 段以收集 receiver 失败: %w", err)
	}
	names := []string{}
	seen := map[string]bool{}
	var walk func(n *yaml.Node)
	walk = func(n *yaml.Node) {
		if n == nil {
			return
		}
		if n.Kind == yaml.MappingNode {
			if vi := mappingValueIndex(n, "receiver"); vi >= 0 {
				name := n.Content[vi].Value
				if name != "" && !seen[name] {
					seen[name] = true
					names = append(names, name)
				}
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(&doc)
	return names, nil
}
