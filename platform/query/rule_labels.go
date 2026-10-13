// Package query — 规则表达式「可用标签清单 + 注解预览」探查（M01 规则编辑器辅助，2026-10-13）。
//
// 动机（用户在拨测告警上的真实困惑）：规则里写 `{{ $labels.instance }}` 后，历史告警摘要
// 长期显示原始模板，用户据此以为「取不到实例 IP」。编辑器当时既不告诉用户该表达式能匹配到
// 哪些标签、也不展示注解渲染后的样子，只能靠猜——这是**编辑期反馈缺失**，与数据面无关。
//
// 本接口在「检查」通过后被前端调用，对 rules.yml 里每条规则做两件事：
//  1. 用 Prometheus 瞬时查询（/api/v1/query）取该 expr 当前匹配序列的标签键与样例值
//     ——即「可用标签清单」，让用户知道 `{{ $labels.xxx }}` 能取哪些键；
//  2. 用**第一条匹配序列**的标签渲染该规则的 `annotations.summary`，给出注解预览——
//     与历史告警摘要渲染复用同一套 RenderAnnotation，所见即所得。
//
// 边界与降级（均不阻断「检查」结论）：
//   - expr 非法 → 该条返回上游错误信息（如 PromQL 语法错），前端按提示展示；
//   - 当前无匹配序列 → 明确告知「指标尚未产生样本」，不编造标签清单；
//   - 无 summary 注解 → 预览为空，前端不展示该区。
//
// 成本控制：规则条数、扫描序列数、每键样例值数均设上限（见下方常量），
// 避免一条宽表达式把控制面请求拖住。
package query

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

// 探查接口的规模上限（防止一条宽表达式把控制面 / 中心 Prometheus 拖住）。
const (
	inspectMaxRules        = 50  // 单次最多探查的规则条数
	inspectMaxSeries       = 500 // 单条规则最多扫描的匹配序列数
	inspectMaxValuesPerKey = 3   // 每个标签键最多回显的样例值数
)

// InspectRuleLabelsRequest 是 POST /api/v2/platform/monitoring-rule-labels 的请求体。
type InspectRuleLabelsRequest struct {
	RuleContent string `json:"rule_content"`
}

// InspectRuleLabel 是单个标签键及其样例值（样例值来自真实匹配序列，供用户对照）。
type InspectRuleLabel struct {
	Key    string   `json:"key"`
	Values []string `json:"values"`
}

// InspectRuleResult 是单条规则的探查结果。
type InspectRuleResult struct {
	Group string `json:"group"`
	// Rule 是 alert 名或 record 名（两者皆空时为空）。
	Rule string `json:"rule"`
	// Kind 是 alert / record / empty（无 expr 的组内条目）。
	Kind string `json:"kind"`
	Expr string `json:"expr"`
	// Error 是该规则的探查失败原因（expr 非法 / 上游不可达），空表示成功。
	Error string `json:"error,omitempty"`
	// Note 是成功但需提示的情况（如当前无匹配序列）。
	Note string `json:"note,omitempty"`
	// SeriesCount 是该 expr 当前匹配到的序列数（受 inspectMaxSeries 上限约束）。
	SeriesCount int `json:"series_count"`
	// Labels 是可用标签清单（按 key 升序）。
	Labels []InspectRuleLabel `json:"labels"`
	// SummaryTemplate 是规则里写的 summary 原文（可能含 {{ $labels.xxx }}）。
	SummaryTemplate string `json:"summary_template,omitempty"`
	// SummaryPreview 是用第一条匹配序列的标签渲染后的摘要；无序列 / 渲染失败时为空。
	SummaryPreview string `json:"summary_preview,omitempty"`
	// SummaryError 是注解模板渲染失败原因（模板非法 / 用了不支持的函数）。
	SummaryError string `json:"summary_error,omitempty"`
}

// InspectRuleLabelsHandler 处理 POST /api/v2/platform/monitoring-rule-labels：
// body {rule_content} → data {rules: InspectRuleResult[]}。
//
// 只读探查，不落库、不改任何状态；单个规则探查失败不影响其余规则。
func InspectRuleLabelsHandler(promURL *url.URL, client *http.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req InspectRuleLabelsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid rule labels payload: %w", err))
			return
		}
		if strings.TrimSpace(req.RuleContent) == "" {
			response.BadRequest(c, fmt.Errorf("rule_content 不能为空"))
			return
		}
		results := inspectRuleContent(c.Request.Context(), client, promURL, req.RuleContent)
		response.OK(c, gin.H{"rules": results})
	}
}

// inspectRuleYAML 是探查所需的 rules.yml 结构子集（只取用得到的键）。
type inspectRuleYAML struct {
	Groups []struct {
		Name  string `yaml:"name"`
		Rules []struct {
			Alert       string            `yaml:"alert"`
			Record      string            `yaml:"record"`
			Expr        string            `yaml:"expr"`
			Annotations map[string]string `yaml:"annotations"`
		} `yaml:"rules"`
	} `yaml:"groups"`
}

// inspectRuleContent 解析 rules.yml 并逐条探查。
func inspectRuleContent(ctx context.Context, client *http.Client, promURL *url.URL, content string) []InspectRuleResult {
	var f inspectRuleYAML
	if err := yaml.Unmarshal([]byte(content), &f); err != nil {
		// YAML 非法不属于本接口职责（「检查」已拦截），此处返回一条说明而非报错，
		// 免得前端把探查失败误当规则本身有问题。
		return []InspectRuleResult{{Error: "规则文件不是合法 YAML，无法探查（请先在「检查」中修正语法）"}}
	}
	results := make([]InspectRuleResult, 0, 8)
	for _, g := range f.Groups {
		for _, r := range g.Rules {
			if len(results) >= inspectMaxRules {
				return append(results, InspectRuleResult{
					Group: g.Name,
					Note:  fmt.Sprintf("规则条数超过 %d 条，仅探查前 %d 条", inspectMaxRules, inspectMaxRules),
				})
			}
			results = append(results, inspectSingleRule(ctx, client, promURL, g.Name, r.Alert, r.Record, r.Expr, r.Annotations))
		}
	}
	return results
}

// inspectSingleRule 探查单条规则：查匹配序列 → 汇总标签清单 → 渲染注解预览。
func inspectSingleRule(
	ctx context.Context, client *http.Client, promURL *url.URL,
	group, alert, record, expr string, annotations map[string]string,
) InspectRuleResult {
	res := InspectRuleResult{Group: group, Rule: alert, Expr: expr, Labels: []InspectRuleLabel{}}
	switch {
	case alert != "":
		res.Kind = "alert"
	case record != "":
		res.Kind = "record"
		res.Rule = record
	default:
		res.Kind = "empty"
		res.Note = "该条目既非 alert 也非 record（可能只有 labels），无需探查"
		return res
	}
	if strings.TrimSpace(expr) == "" {
		res.Note = "该规则没有 expr，无需探查"
		return res
	}
	res.SummaryTemplate = annotations["summary"]

	series, err := queryInstantSeries(ctx, client, promURL, expr)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.SeriesCount = len(series)
	if len(series) == 0 {
		res.Note = "该表达式当前没有匹配到序列（指标可能尚未产生样本），标签清单暂不可用"
		return res
	}
	res.Labels = summarizeSeriesLabels(series)

	// 注解预览：用第一条序列的标签与样本值渲染，与历史告警摘要同一套渲染器。
	first := series[0]
	previewLabels := make(map[string]string, len(first.Labels)+1)
	for k, v := range first.Labels {
		previewLabels[k] = v
	}
	// 与历史告警渲染保持一致：补平台归一的 network_domain，避免预览里该变量恒空。
	if _, ok := previewLabels["network_domain"]; !ok {
		previewLabels["network_domain"] = models.ResolveNetworkDomain(first.Labels)
	}
	if res.SummaryTemplate != "" {
		preview, rerr := RenderAnnotation(res.SummaryTemplate, previewLabels, first.Value)
		if rerr != nil {
			res.SummaryError = rerr.Error()
		} else {
			res.SummaryPreview = preview
		}
	}
	return res
}

// inspectSeries 是一条匹配序列的标签与样本值字符串。
type inspectSeries struct {
	Labels map[string]string
	Value  string
}

// queryInstantSeries 调用 Prometheus 瞬时查询，返回该 expr 当前匹配的序列（标签 + 样本值）。
// expr 非法时上游返回 4xx + errorType=bad_data，这里把错误信息原样带回前端定位。
func queryInstantSeries(ctx context.Context, client *http.Client, promURL *url.URL, expr string) ([]inspectSeries, error) {
	u := *promURL
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/query"
	params := url.Values{}
	params.Set("query", expr)
	u.RawQuery = params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("构造查询请求失败: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("查询中心 Prometheus 失败: %w", err)
	}
	defer resp.Body.Close()

	var envelope struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
		Error     string `json:"error"`
		Data      struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  []interface{}     `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("中心 Prometheus 返回 %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("解析查询响应失败: %w", err)
	}
	if envelope.Status != "success" {
		msg := strings.TrimSpace(envelope.Error)
		if msg == "" {
			msg = fmt.Sprintf("中心 Prometheus 返回 %s", envelope.Status)
		}
		return nil, fmt.Errorf("%s", msg)
	}

	out := make([]inspectSeries, 0, len(envelope.Data.Result))
	for _, r := range envelope.Data.Result {
		if len(out) >= inspectMaxSeries {
			break
		}
		labels := make(map[string]string, len(r.Metric))
		for k, v := range r.Metric {
			// __name__ 是指标名本身，不是「可用于 {{ $labels.x }}」的标签键；
			// 用户要的是维度标签，这里排除避免误导（指标名在规则 expr 里已经写了）。
			if k == "__name__" {
				continue
			}
			labels[k] = v
		}
		out = append(out, inspectSeries{Labels: labels, Value: sampleValueString(r.Value)})
	}
	return out, nil
}

// sampleValueString 从 [ts, "val"] 里取样本值字符串；缺失时返回空串。
func sampleValueString(v []interface{}) string {
	if len(v) < 2 {
		return ""
	}
	switch n := v[1].(type) {
	case string:
		return n
	case float64:
		return strconv.FormatFloat(n, 'f', -1, 64)
	default:
		return fmt.Sprintf("%v", n)
	}
}

// summarizeSeriesLabels 汇总各标签键的样例值（去重、按首次出现顺序，最多 N 个），按键名升序输出。
func summarizeSeriesLabels(series []inspectSeries) []InspectRuleLabel {
	order := make([]string, 0, 8)
	values := make(map[string][]string, 8)
	seen := make(map[string]map[string]struct{}, 8)
	for _, s := range series {
		for k, v := range s.Labels {
			if _, ok := values[k]; !ok {
				order = append(order, k)
				values[k] = []string{}
				seen[k] = map[string]struct{}{}
			}
			if len(values[k]) >= inspectMaxValuesPerKey {
				continue
			}
			if _, dup := seen[k][v]; dup {
				continue
			}
			seen[k][v] = struct{}{}
			values[k] = append(values[k], v)
		}
	}
	sort.Strings(order)
	out := make([]InspectRuleLabel, 0, len(order))
	for _, k := range order {
		out = append(out, InspectRuleLabel{Key: k, Values: values[k]})
	}
	return out
}
