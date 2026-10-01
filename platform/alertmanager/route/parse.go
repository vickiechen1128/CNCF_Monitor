// Package route 实现 Module_08 告警路由（route）前台化。
//
// 本文件（parse.go）提供 route 树解析**纯函数** ParseRouteTree：把 alertmanager.yml 的
// route 段解析为前端「路由规则」页（PRD §11.7 / 提案 §3.2）可消费的扁平节点序列——
//   - 层级：YAML 嵌套位置 → parent_id（根 route 本体为空，locked=true 不可删不可移）；
//   - 顺序：routes[] 数组位置 → order（同级优先级，先进先出匹配）；
//   - matchers 归一：新式映射 `[{name,value,isRegex}]` 与字符串简写 `severity="critical"`
//     双形态统一为 RouteMatcher（含 is_equal / is_regex）；
//   - receiver / group_by / group_wait / group_interval / repeat_interval / continue；
//   - name：从注释 `# 路由名称: xxx` 还原；**无注释回落空串，绝不造值**。
//
// 解析失败 / 非常规结构返回 error，由 handler 降级为「200 + parse_error + raw_yaml」的
// 原文只读展示（不 500、不白屏）。本函数与 T08-13 的对称生成器共用同一字段口径。
//
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §5.2（Route 数据模型）/ §5.5（Matcher）/ §9.1（v0.3-a 只读渲染）/ §11.7；
//   docs/05-execution-records/module-08/design-proposals/alert-route-frontend-editor.md
//   §3.2 / §4.5 / §8.2；docs/05-execution-records/module-08/task-sequence.yaml T08-12。
package route

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// route 段作者模式（提案 §4.3 / §4.5）。本期只读渲染恒返回 ModeHandwritten。
const (
	// ModeHandwritten 手写模式（默认）：route 段由用户手写维护，平台只读渲染。
	ModeHandwritten = "handwritten"
	// ModePlatform 平台管理模式：route 段由平台生成。
	// T08-F12「模式开关」尚未实现，本期 GET /routes 恒返回 ModeHandwritten（不预置假开关）；
	// 该字段将在 T08-F12 接入真实模式来源（平台管理域开关）后按实返回。
	ModePlatform = "platform"
)

// RouteMatcher 是归一后的单条匹配条件（PRD §5.5 Matcher；JSON 键与 models.SilenceMatcher 对齐）。
//
//	Name    标签名
//	Value   匹配值
//	IsEqual true=`=`（相等）false=`!=`（取反）
//	IsRegex true=正则匹配（`=~` / `!~`）
type RouteMatcher struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	IsEqual bool   `json:"is_equal"`
	IsRegex bool   `json:"is_regex"`
}

// RouteNode 是路由树节点（PRD §5.2 + 提案 §3.2 列表态 IA）。
//
// ID/ParentID/Order 为平台编辑态内部标识（不落盘，仅供前端渲染树与定位）：
//   - ID：稳定路径标识（根为 "root"，子为 "<parent_id>/<同级下标>"）；
//   - ParentID：父节点 ID（根为空串）；
//   - Order：同级 routes[] 数组位置（0-based；根恒 0）；
//   - Locked：根路由标记（对应 AM 的 `route:` 本体，不可删、不可移）。
type RouteNode struct {
	ID             string         `json:"id"`
	ParentID       string         `json:"parent_id"`
	Name           string         `json:"name"`
	Matchers       []RouteMatcher `json:"matchers"`
	Receiver       string         `json:"receiver"`
	GroupBy        []string       `json:"group_by"`
	GroupWait      string         `json:"group_wait"`
	GroupInterval  string         `json:"group_interval"`
	RepeatInterval string         `json:"repeat_interval"`
	Continue       bool           `json:"continue"`
	Order          int            `json:"order"`
	Locked         bool           `json:"locked"`
}

// routeNameCommentPrefix 是 route 名称注释前缀（PRD §5.2 注 1：`# 路由名称: xxx`，落盘于节点上方）。
const routeNameCommentPrefix = "路由名称"

// matcherShorthandRe 解析 matcher 字符串简写：`name=value` / `name=~value` / `name!=value` / `name!~value`。
var matcherShorthandRe = regexp.MustCompile(`^\s*([^=!~]+?)\s*(=~|!~|!=|=)\s*(.*)$`)

// ParseRouteTree 把 alertmanager.yml 原文解析为前序扁平化的路由节点序列（items[0] = 根路由）。
//
// 空内容（无生效配置）返回空序列 + nil（前端渲染空态；此时全部平台接收人视为无引用）。
// 解析失败 / 非常规结构（YAML 非法、顶层非映射、缺 route、route 非映射、routes 非列表、
// 子路由非映射、matchers 元素形态非法等）返回 error，由 handler 降级为原文只读展示。
func ParseRouteTree(baseYAML string) ([]RouteNode, error) {
	if strings.TrimSpace(baseYAML) == "" {
		return []RouteNode{}, nil
	}
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return nil, fmt.Errorf("解析 alertmanager.yml 失败: %w", err)
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || deref(doc.Content[0]).Kind != yaml.MappingNode {
		return nil, fmt.Errorf("alertmanager.yml 顶层不是映射，无法解析 route")
	}
	root := deref(doc.Content[0])

	routeNode := mappingValue(root, "route")
	if routeNode == nil {
		return nil, fmt.Errorf("alertmanager.yml 缺少 route 段，无法解析路由树")
	}
	if routeNode.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("alertmanager.yml 的 route 段不是映射，无法解析路由树")
	}

	nodes := make([]RouteNode, 0, 4)
	if err := appendRoute(&nodes, routeNode, "", "root", 0, true); err != nil {
		return nil, err
	}
	return nodes, nil
}

// appendRoute 递归解析单个 route 节点并前序写入 out（父先于子），随后递归其子路由。
func appendRoute(out *[]RouteNode, n *yaml.Node, parentID, id string, order int, locked bool) error {
	node, err := parseRouteNode(n, parentID, id, order, locked)
	if err != nil {
		return err
	}
	*out = append(*out, *node)

	children, err := routeChildren(n)
	if err != nil {
		return err
	}
	for i, child := range children {
		if err := appendRoute(out, child, id, id+"/"+strconv.Itoa(i), i, false); err != nil {
			return err
		}
	}
	return nil
}

// parseRouteNode 解析单个 route 映射节点的全部字段（不含子路由递归）。
func parseRouteNode(n *yaml.Node, parentID, id string, order int, locked bool) (*RouteNode, error) {
	matchers, err := parseMatchers(mappingValue(n, "matchers"))
	if err != nil {
		return nil, err
	}
	groupBy, err := parseStringList(mappingValue(n, "group_by"))
	if err != nil {
		return nil, err
	}
	return &RouteNode{
		ID:             id,
		ParentID:       parentID,
		Name:           routeNameFromComments(n),
		Matchers:       matchers,
		Receiver:       scalarValue(mappingValue(n, "receiver")),
		GroupBy:        groupBy,
		GroupWait:      scalarValue(mappingValue(n, "group_wait")),
		GroupInterval:  scalarValue(mappingValue(n, "group_interval")),
		RepeatInterval: scalarValue(mappingValue(n, "repeat_interval")),
		Continue:       boolOrDefault(mappingValue(n, "continue"), false),
		Order:          order,
		Locked:         locked,
	}, nil
}

// routeChildren 取 route 节点的子路由（routes[]），每个元素必须是映射（否则非常规结构 → error）。
func routeChildren(n *yaml.Node) ([]*yaml.Node, error) {
	seq := mappingValue(n, "routes")
	if seq == nil {
		return nil, nil
	}
	if seq.Kind != yaml.SequenceNode {
		return nil, fmt.Errorf("route.routes 不是列表，无法解析子路由")
	}
	children := make([]*yaml.Node, 0, len(seq.Content))
	for _, item := range seq.Content {
		item = deref(item)
		if item == nil || item.Kind != yaml.MappingNode {
			return nil, fmt.Errorf("route.routes 存在非常规元素（子路由不是映射）")
		}
		children = append(children, item)
	}
	return children, nil
}

// parseMatchers 归一 matchers 双形态：
//   - 新式映射序列 `[{name,value,isRegex,isEqual}]`（键兼容 camelCase / snake_case）；
//   - 字符串简写序列 `["severity=\"critical\""]`（单个标量亦容错按一条简写处理）。
func parseMatchers(n *yaml.Node) ([]RouteMatcher, error) {
	out := []RouteMatcher{}
	if n == nil {
		return out, nil
	}
	switch n.Kind {
	case yaml.SequenceNode:
		for _, item := range n.Content {
			m, err := parseMatcherItem(deref(item))
			if err != nil {
				return nil, err
			}
			out = append(out, m)
		}
	case yaml.ScalarNode:
		m, err := parseMatcherShorthand(n.Value)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	default:
		return nil, fmt.Errorf("matchers 不是列表，无法解析路由匹配条件")
	}
	return out, nil
}

// parseMatcherItem 解析单条 matcher（映射形态或字符串简写形态）。
func parseMatcherItem(item *yaml.Node) (RouteMatcher, error) {
	switch item.Kind {
	case yaml.ScalarNode:
		return parseMatcherShorthand(item.Value)
	case yaml.MappingNode:
		return RouteMatcher{
			Name:    scalarValue(mappingValue(item, "name")),
			Value:   scalarValue(mappingValue(item, "value")),
			IsRegex: boolOrDefault(firstNonNil(mappingValue(item, "isRegex"), mappingValue(item, "is_regex")), false),
			IsEqual: boolOrDefault(firstNonNil(mappingValue(item, "isEqual"), mappingValue(item, "is_equal")), true),
		}, nil
	default:
		return RouteMatcher{}, fmt.Errorf("matchers 存在非常规元素（既非字符串简写也非映射）")
	}
}

// parseMatcherShorthand 解析 matcher 字符串简写 `name[=|!=|=~|!~]"value"`。
func parseMatcherShorthand(raw string) (RouteMatcher, error) {
	m := matcherShorthandRe.FindStringSubmatch(raw)
	if m == nil {
		return RouteMatcher{}, fmt.Errorf("无法解析 matcher 字符串简写: %q", raw)
	}
	op := m[2]
	return RouteMatcher{
		Name:    strings.TrimSpace(m[1]),
		Value:   strings.Trim(strings.TrimSpace(m[3]), `"'`),
		IsRegex: op == "=~" || op == "!~",
		IsEqual: op == "=" || op == "=~",
	}, nil
}

// parseStringList 解析字符串列表（group_by）：序列元素必须是标量；单标量按一项容错。
func parseStringList(n *yaml.Node) ([]string, error) {
	out := []string{}
	if n == nil {
		return out, nil
	}
	switch n.Kind {
	case yaml.SequenceNode:
		for _, item := range n.Content {
			item = deref(item)
			if item == nil || item.Kind != yaml.ScalarNode {
				return nil, fmt.Errorf("group_by 存在非常规元素（分组键不是标量）")
			}
			out = append(out, item.Value)
		}
	case yaml.ScalarNode:
		out = append(out, n.Value)
	default:
		return nil, fmt.Errorf("group_by 不是列表，无法解析分组键")
	}
	return out, nil
}

// routeNameFromComments 从节点注释还原路由名称（`# 路由名称: xxx`）：无则返回空串，不造值。
// 兼容注释落在节点自身或首个键上（yaml.v3 依缩进位置附着）。
func routeNameFromComments(n *yaml.Node) string {
	candidates := []string{n.HeadComment, n.LineComment}
	if len(n.Content) > 0 {
		first := deref(n.Content[0])
		candidates = append(candidates, first.HeadComment, first.LineComment)
	}
	for _, c := range candidates {
		if name, ok := routeNameFromComment(c); ok {
			return name
		}
	}
	return ""
}

// routeNameFromComment 在单段注释文本中查找 `路由名称` 行并提取其值。
func routeNameFromComment(comment string) (string, bool) {
	if comment == "" {
		return "", false
	}
	for _, line := range strings.Split(comment, "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "#"))
		if !strings.HasPrefix(line, routeNameCommentPrefix) {
			continue
		}
		value := strings.TrimLeft(strings.TrimPrefix(line, routeNameCommentPrefix), " \t:：")
		return strings.TrimSpace(value), true
	}
	return "", false
}

// deref 解析 YAML 别名（anchor/alias）到目标节点；非别名原样返回。
func deref(n *yaml.Node) *yaml.Node {
	for n != nil && n.Kind == yaml.AliasNode {
		n = n.Alias
	}
	return n
}

// mappingValue 返回映射节点中键 key 对应的值节点（已解析别名）；无则 nil。
func mappingValue(m *yaml.Node, key string) *yaml.Node {
	m = deref(m)
	if m == nil || m.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(m.Content); i += 2 {
		k := deref(m.Content[i])
		if k != nil && k.Value == key {
			return deref(m.Content[i+1])
		}
	}
	return nil
}

// firstNonNil 返回第一个非 nil 节点（键名兼容用）。
func firstNonNil(nodes ...*yaml.Node) *yaml.Node {
	for _, n := range nodes {
		if n != nil {
			return n
		}
	}
	return nil
}

// scalarValue 返回标量节点的值；非标量 / nil 返回空串。
func scalarValue(n *yaml.Node) string {
	n = deref(n)
	if n == nil || n.Kind != yaml.ScalarNode {
		return ""
	}
	return n.Value
}

// boolOrDefault 解析标量布尔值；缺失 / 非法回落 def。
func boolOrDefault(n *yaml.Node, def bool) bool {
	n = deref(n)
	if n == nil || n.Kind != yaml.ScalarNode {
		return def
	}
	switch strings.ToLower(strings.TrimSpace(n.Value)) {
	case "true":
		return true
	case "false":
		return false
	default:
		return def
	}
}