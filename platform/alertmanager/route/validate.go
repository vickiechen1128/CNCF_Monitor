// validate.go 实现 Module_08 告警路由（route）前台化的**编辑态校验纯函数**（提案
// §3.4 交互规则 / §6 验收 5/6；task-sequence.yaml T08-13）：对 parse.go 解析出的路由树
// （[]RouteNode）做 AM 语义体检，产出结论集合，**不阻断**——由调用方按 Level 决定
// 「阻断保存（error）」还是「警告级提示（warning）」。
//
// 权威口径（upstream/alertmanager/config/config.go Load 校验，逐条对齐）：
//
//  1. 根 route 必须指定兜底 receiver（AM：`root route must specify a default receiver`）；
//  2. 根 route 不得带 matchers（AM：`root route must not have any matchers`）——根是
//     全量告警的兜底节点，带条件会使未命中告警无兜底；
//  3. 时长字段必须是 AM 可解析时长（支持 ms/s/m/h/d/w/y 及组合，如 `1h30m`）；
//  4. `repeat_interval` 不是 `group_interval` 的整数倍时 AM 会**向上取整**（官方口径），
//     故本函数只给 **warning**，绝不阻断保存（提案 §3.4 / §6 验收 6）。
//
// 校验纯函数不触碰外部二进制：生成物的 `amtool check-config` 等价校验走
// generator.ValidateRouteSectionWithAmtool（同语义、可注入，避免测试依赖 PATH）。
//
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §5.2（Route 数据模型）/ §5.5（Matcher）/ §9.2；
//   docs/05-execution-records/module-08/design-proposals/alert-route-frontend-editor.md §3.4 / §6。
package route

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
)

// 校验结论等级：error = 阻断保存；warning = 仅提示（可保存）。
const (
	// RouteIssueLevelError 阻断级（配置在 AM 侧必然失败或语义非法）。
	RouteIssueLevelError = "error"
	// RouteIssueLevelWarning 警告级（与 AM 行为一致、可保存，仅提示用户）。
	RouteIssueLevelWarning = "warning"
)

// 校验码（前端按 code 展示文案，不解析 message）。
const (
	// RouteIssueCodeRootReceiverRequired 根路由未指定兜底 receiver（AM 校验必然失败）。
	RouteIssueCodeRootReceiverRequired = "root_receiver_required"
	// RouteIssueCodeRootMatchersForbidden 根路由带 matchers（AM 禁止，兜底节点须匹配全量）。
	RouteIssueCodeRootMatchersForbidden = "root_matchers_forbidden"
	// RouteIssueCodeMatcherNameEmpty matcher 标签名为空（无法构造匹配条件）。
	RouteIssueCodeMatcherNameEmpty = "matcher_name_empty"
	// RouteIssueCodeMatcherRegexInvalid matcher 正则值非法（运行时匹配会报错）。
	RouteIssueCodeMatcherRegexInvalid = "matcher_regex_invalid"
	// RouteIssueCodeDurationInvalid 时长字段不是 AM 可解析时长。
	RouteIssueCodeDurationInvalid = "duration_invalid"
	// RouteIssueCodeRepeatNotMultiple repeat_interval 不是 group_interval 的整数倍
	// （AM 会向上取整，故仅警告级，不阻断）。
	RouteIssueCodeRepeatNotMultiple = "repeat_interval_not_multiple_of_group_interval"
)

// RouteIssue 是单条校验结论（不阻断：由调用方按 Level 决定处置）。
//
//	Level   等级（error / warning）
//	Code    校验码（稳定枚举，供前端映射文案）
//	NodeID  命中的路由节点 ID（根节点为空串时表示整树级结论）
//	Field   命中的字段名（无则空串）
//	Message 可直接展示的中文说明
type RouteIssue struct {
	Level   string `json:"level"`
	Code    string `json:"code"`
	NodeID  string `json:"node_id"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

// HasBlockingIssue 判定结论集合中是否存在阻断级（error）结论。
func HasBlockingIssue(issues []RouteIssue) bool {
	for _, it := range issues {
		if it.Level == RouteIssueLevelError {
			return true
		}
	}
	return false
}

// ValidateRouteTree 校验编辑态路由树（[]generator.RouteEditNode，items[0] 为根路由），
// 返回结论集合。它接收保存链实际持有的类型（与生成器 GenerateRouteSection 同口径），
// 因此可在生成前拦截会产出 amtool 拒绝内容（如标签名为空的 matcher 渲染成 `="x"` 字面量）
// 的编辑态输入。
//
// 空树返回空集合（无结论）。本函数不做 I/O、不调用外部二进制、不修改入参。
//
// 仅校验「会被生成器实际产出」的节点：从根出发、经 Enabled 归一并递归其子路由判定可达性，
// 被禁用（*false）的节点及其整条子树不会被生成器输出，故跳过其校验，避免对落盘内容误报。
func ValidateRouteTree(nodes []generator.RouteEditNode) []RouteIssue {
	issues := []RouteIssue{}
	if len(nodes) == 0 {
		return issues
	}

	children := map[string][]int{}
	rootIdx := -1
	for i := range nodes {
		if nodes[i].ParentID == "" {
			if rootIdx < 0 {
				rootIdx = i
			}
			continue
		}
		children[nodes[i].ParentID] = append(children[nodes[i].ParentID], i)
	}
	if rootIdx < 0 {
		return issues
	}

	// 标记「会被产出」的节点（根启用且自顶向下 Enabled 链路可达）。
	emitted := make([]bool, len(nodes))
	var mark func(i int)
	mark = func(i int) {
		if !generator.NodeEnabled(nodes[i]) {
			return
		}
		if emitted[i] {
			return
		}
		emitted[i] = true
		for _, c := range children[nodes[i].ID] {
			mark(c)
		}
	}
	mark(rootIdx)

	root := nodes[rootIdx]
	if emitted[rootIdx] {
		if root.Receiver == "" {
			issues = append(issues, RouteIssue{
				Level:   RouteIssueLevelError,
				Code:    RouteIssueCodeRootReceiverRequired,
				NodeID:  root.ID,
				Field:   "receiver",
				Message: "根路由必须指定兜底接收人（Alertmanager 要求 root route must specify a default receiver）",
			})
		}
		if len(root.Matchers) > 0 {
			issues = append(issues, RouteIssue{
				Level:   RouteIssueLevelError,
				Code:    RouteIssueCodeRootMatchersForbidden,
				NodeID:  root.ID,
				Field:   "matchers",
				Message: "根路由不得设置匹配条件（Alertmanager 要求 root route must not have any matchers）",
			})
		}
	}

	for i := range nodes {
		if !emitted[i] {
			continue
		}
		issues = append(issues, validateRouteEditNodeFields(&nodes[i])...)
	}
	return issues
}

// validateRouteEditNodeFields 校验单个编辑态节点的 matchers 与时长字段（含整除告警）。
func validateRouteEditNodeFields(n *generator.RouteEditNode) []RouteIssue {
	issues := []RouteIssue{}

	for _, m := range n.Matchers {
		if strings.TrimSpace(m.Name) == "" {
			issues = append(issues, RouteIssue{
				Level:   RouteIssueLevelError,
				Code:    RouteIssueCodeMatcherNameEmpty,
				NodeID:  n.ID,
				Field:   "matchers",
				Message: "匹配条件的标签名不能为空（否则生成器会渲染成 amtool 拒绝的 =\"x\" 字面量）",
			})
			continue
		}
		if m.IsRegex {
			if _, err := regexp.Compile(m.Value); err != nil {
				issues = append(issues, RouteIssue{
					Level:   RouteIssueLevelError,
					Code:    RouteIssueCodeMatcherRegexInvalid,
					NodeID:  n.ID,
					Field:   "matchers",
					Message: fmt.Sprintf("匹配条件 %q 的正则值 %q 非法: %v", m.Name, m.Value, err),
				})
			}
		}
	}

	_, waitOK := parseRouteDurationIfSet(n.GroupWait)
	if !waitOK {
		issues = append(issues, durationIssue(n, "group_wait", n.GroupWait))
	}
	interval, intervalOK := parseRouteDurationIfSet(n.GroupInterval)
	if !intervalOK {
		issues = append(issues, durationIssue(n, "group_interval", n.GroupInterval))
	}
	repeat, repeatOK := parseRouteDurationIfSet(n.RepeatInterval)
	if !repeatOK {
		issues = append(issues, durationIssue(n, "repeat_interval", n.RepeatInterval))
	}
	// 提案 §3.4 / §6 验收 6：不整除时 AM 会向上取整，故仅警告级，绝不阻断保存。
	if waitOK && intervalOK && repeatOK && interval > 0 && repeat%interval != 0 {
		issues = append(issues, RouteIssue{
			Level:  RouteIssueLevelWarning,
			Code:   RouteIssueCodeRepeatNotMultiple,
			NodeID: n.ID,
			Field:  "repeat_interval",
			Message: fmt.Sprintf(
				"重复间隔 %s 不是分组间隔 %s 的整数倍，Alertmanager 会向上取整到分组间隔的整数倍（可保存，如需精确节奏请调整分组间隔）",
				n.RepeatInterval, n.GroupInterval),
		})
	}
	return issues
}

// durationIssue 组装时长字段非法结论。
func durationIssue(n *generator.RouteEditNode, field, value string) RouteIssue {
	return RouteIssue{
		Level:   RouteIssueLevelError,
		Code:    RouteIssueCodeDurationInvalid,
		NodeID:  n.ID,
		Field:   field,
		Message: fmt.Sprintf("%s 的值 %q 不是合法的时长（支持 ms/s/m/h/d/w/y 及其组合，如 30s / 1h30m）", field, value),
	}
}

// parseRouteDurationIfSet 解析「可空」时长字段：空串视为未设置（0, true）。
func parseRouteDurationIfSet(raw string) (int64, bool) {
	if strings.TrimSpace(raw) == "" {
		return 0, true
	}
	return ParseRouteDuration(raw)
}

// routeDurationUnitMS 是 AM 时长单位到毫秒的换算（model.Duration 口径：w=7d、y=365d）。
var routeDurationUnitMS = map[string]int64{
	"ms": 1,
	"s":  1000,
	"m":  60 * 1000,
	"h":  60 * 60 * 1000,
	"d":  24 * 60 * 60 * 1000,
	"w":  7 * 24 * 60 * 60 * 1000,
	"y":  365 * 24 * 60 * 60 * 1000,
}

// routeDurationTokenRe 匹配单个「数值 + 单位」片段（`ms` 必须优先于 `m` / `s`）。
var routeDurationTokenRe = regexp.MustCompile(`^(\d+)(ms|y|w|d|h|m|s)`)

// ParseRouteDuration 解析 AM 时长为毫秒（支持 ms/s/m/h/d/w/y 及其组合，如 `1h30m`）；
// 非法返回 false。空串视为非法（未设置字段由调用方用 parseRouteDurationIfSet 放行）。
func ParseRouteDuration(raw string) (int64, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, false
	}
	if s == "0" {
		return 0, true
	}
	var total int64
	for len(s) > 0 {
		m := routeDurationTokenRe.FindStringSubmatch(s)
		if m == nil {
			return 0, false
		}
		n, err := strconv.ParseInt(m[1], 10, 64)
		if err != nil {
			return 0, false
		}
		total += n * routeDurationUnitMS[m[2]]
		s = s[len(m[0]):]
	}
	return total, true
}
