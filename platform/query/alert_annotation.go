// Package query — Prometheus 兼容的告警注解模板渲染（2026-10-13，修复历史告警摘要泄露原始模板）。
//
// 背景（缺陷根因）：`/api/v1/alerts/history` 基于 ALERTS 序列重建触发区间，而 ALERTS 序列
// **不含 annotations**。原实现在 `fetchRulesAnnotations` 中从 Prometheus `/api/v1/rules`
// 取 `annotations.summary` 回填——但该 API 返回的是**规则文件里的未渲染模板**
// （Prometheus 只在告警实际触发 / 推送时才渲染），于是历史告警页与首页告警卡长期显示
// `业务拨测失败：{{ $labels.instance }}` 这样的原始模板。
//
// 修法：把 `/api/v1/rules` 拿到的**模板串**按该告警序列的真实 labels 在服务端渲染一次，
// 使历史摘要与 Prometheus `/api/v1/alerts`、Alertmanager `/api/v2/alerts` 的渲染结果同构。
//
// 语义对齐（关键）：
//   - `$labels` / `$labels["x"]`：取该告警序列标签；缺失键渲染为空串（与 Prometheus 一致，
//     它同样渲染为空并记日志），**不返回模板原文**。
//   - `$value`：ALERTS 序列 firing 样本值恒为 1，与 Prometheus 渲染告警注解时的取值一致。
//   - `$externalLabels` / `$externalURL`：中心 TSDB 的本地序列不含 external_labels
//     （它只在 remote write / federation / 发往 AM 时附加），故历史渲染取空值。
//   - 渲染失败（模板语法非法 / 用了不支持的函数）→ 返回 error，调用方降级为**空摘要**
//     （前端显示 `-`）。**严禁降级回原始模板**——那正是本缺陷本身。
//
// 函数子集说明：`$labels` / `$value` / `strvalue` / 字符串类函数与 Prometheus 语义一致；
// `humanize*` 系列为标准 SI 近似实现（不逐字节复刻上游 fmt.go，末位可能有差异，不影响可用性）；
// `graphLink` / `tableLink` 依赖 externalURL，历史场景返回空串（不制造假链接）。
//
// 不做模板缓存：Prometheus 是「规则加载时解析一次、每次求值复用」，本模块是
// 「按需取模板 + 单次历史查询内渲染数百个区间」，量级差三个数量级，缓存的复杂度不划算。
package query

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"text/template"
	"time"
	"unicode"
)

// annotationTemplateData 是模板数据（字段名与 Prometheus template 包对齐），
// 使 `{{ .Labels.instance }}` 这类显式写法同样可用。
type annotationTemplateData struct {
	// Labels 是该告警序列的全部标签（ALERTS 序列 metric）。
	Labels map[string]string
	// ExternalLabels 恒空（见包注释语义对齐说明），保留字段供模板显式引用。
	ExternalLabels map[string]string
	// ExternalURL 恒空（同上）。
	ExternalURL string
	// Value 是告警样本值（firing 恒为 1）；Prometheus 中同为 float64。
	Value float64
}

// annotationVarDefs 是前置到用户模板前的变量定义（与 Prometheus template 包同构）。
//
// 为什么必须前置：`{{ $labels.instance }}` 里的 `$labels` 在 Go 模板中是**变量引用**，
// 仅在函数表注册 `labels` 函数并不够——实测（2026-10-13）会直接 Parse 失败
// `undefined variable "$labels"`。Prometheus 的做法正是在展开时把
// `{{$labels := .Labels}}…` 拼到模板文本前面，本实现照搬，保证用户按 Prometheus
// 习惯书写的模板无需改写即可渲染。
const annotationVarDefs = `{{$labels := .Labels}}{{$externalLabels := .ExternalLabels}}` +
	`{{$externalURL := .ExternalURL}}{{$value := .Value}}`

// RenderAnnotation 按给定标签渲染一条告警注解模板（Prometheus 模板语法子集）。
//
// 调用方约定（重要）：返回 error 时必须降级为空摘要，**不得**改用模板原文——
// 原始模板外泄正是本文件修复的缺陷本身。
func RenderAnnotation(src string, labels map[string]string, value string) (string, error) {
	src = strings.TrimSpace(src)
	if src == "" {
		return "", nil
	}
	if labels == nil {
		labels = map[string]string{}
	}
	// $value 在 Prometheus 中是 float64（告警样本值），未标注类型的模板按数值使用。
	valueNum, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		valueNum = 0
	}
	t, err := template.New("annotation").Funcs(annotationFuncMap(labels, valueNum)).
		Option("missingkey=zero").Parse(annotationVarDefs + src)
	if err != nil {
		return "", fmt.Errorf("解析告警注解模板失败: %w", err)
	}
	var sb strings.Builder
	data := annotationTemplateData{
		Labels:         labels,
		ExternalLabels: map[string]string{},
		ExternalURL:    "",
		Value:          valueNum,
	}
	if err := t.Execute(&sb, data); err != nil {
		return "", fmt.Errorf("渲染告警注解模板失败: %w", err)
	}
	return sb.String(), nil
}

// annotationFuncMap 构造模板函数表。
//
// 除 `$labels` / `$value` 两个**变量**（见 annotationVarDefs）外，Prometheus 也把
// labels / value 暴露为同名函数（`{{ labels "instance" }}`），此处一并提供，
// 两种写法都可用。
func annotationFuncMap(labels map[string]string, value float64) template.FuncMap {
	return template.FuncMap{
		"labels": func(l ...string) string {
			for _, key := range l {
				if v, ok := labels[key]; ok {
					return v
				}
			}
			return ""
		},
		"value":          func() float64 { return value },
		"externalLabels": func(...string) string { return "" },
		"externalURL":    func() string { return "" },

		"strvalue": func(v interface{}) string { return fmt.Sprintf("%v", v) },
		"toUpper":  func(s string) string { return strings.ToUpper(s) },
		"toLower":  func(s string) string { return strings.ToLower(s) },
		"title":    func(s string) string { return titleCase(s) },
		"trim":     func(s string) string { return strings.TrimSpace(s) },
		"match": func(pattern, s string) bool {
			ok, err := regexp.MatchString(pattern, s)
			return err == nil && ok
		},
		"reReplaceAll": func(pattern, repl, text string) string {
			re, err := regexp.Compile(pattern)
			if err != nil {
				return text
			}
			return re.ReplaceAllString(text, repl)
		},
		"first": func(items []interface{}) interface{} {
			if len(items) == 0 {
				return nil
			}
			return items[0]
		},
		"last": func(items []interface{}) interface{} {
			if len(items) == 0 {
				return nil
			}
			return items[len(items)-1]
		},

		// 依赖 externalURL 的链接函数：历史场景无 externalURL，返回空串而非假链接。
		"graphLink":  func() string { return "" },
		"tableLink":  func() string { return "" },
		"pathPrefix": func(p string) string { return p },

		// humanize 系列：标准 SI / 二进制近似实现。
		"humanize":           func(v interface{}) string { return humanizeNumber(v, 1000, siSuffixes) },
		"humanize1024":       func(v interface{}) string { return humanizeNumber(v, 1024, binarySuffixes) },
		"humanizeDuration":   func(v interface{}) string { return humanizeDurationValue(v) },
		"humanizePercentage": func(v interface{}) string { return humanizePercentageValue(v) },
		"humanizeTimestamp":  func(v interface{}) string { return humanizeTimestampValue(v) },
	}
}

var (
	siSuffixes     = []string{"", "k", "M", "G", "T", "P", "E"}
	binarySuffixes = []string{"", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei"}
)

// toFloat 把模板传入值转为 float64；无法转换时返回 ok=false（调用方按原样返回字符串，
// 而不是让整个渲染失败——渲染失败会连带丢掉整条摘要）。
func toFloat(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	default:
		return 0, false
	}
}

// humanizeNumber 按 base 逐级缩放并加后缀（1000 → "1.5k"；1024 → "1Ki"）。
func humanizeNumber(v interface{}, base float64, suffixes []string) string {
	f, ok := toFloat(v)
	if !ok {
		return fmt.Sprintf("%v", v)
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	if f < base {
		return sign + strconv.FormatFloat(f, 'f', -1, 64)
	}
	exp := 0
	for f >= base && exp < len(suffixes)-1 {
		f /= base
		exp++
	}
	return sign + strconv.FormatFloat(f, 'f', -1, 64) + suffixes[exp]
}

// durationUnits 由大到小；与 Prometheus humanizeDuration 的单位集合一致。
var durationUnits = []struct {
	suffix string
	secs   float64
}{
	{"y", 365 * 24 * 3600},
	{"w", 7 * 24 * 3600},
	{"d", 24 * 3600},
	{"h", 3600},
	{"m", 60},
	{"s", 1},
	{"ms", 0.001},
}

// humanizeDurationValue 把秒数渲染为「1h 30m」形式的可读时长（最多两级，与 Prometheus 一致）。
func humanizeDurationValue(v interface{}) string {
	f, ok := toFloat(v)
	if !ok {
		return fmt.Sprintf("%v", v)
	}
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	if f == 0 {
		return "0s"
	}
	// 小于 1s 直接给毫秒值，避免拼出无意义组合。
	if f < 1 {
		return sign + strconv.FormatFloat(f*1000, 'f', -1, 64) + "ms"
	}
	var parts []string
	for _, u := range durationUnits {
		if f >= u.secs {
			n := math.Floor(f / u.secs)
			f -= n * u.secs
			parts = append(parts, strconv.FormatFloat(n, 'f', -1, 64)+u.suffix)
		}
		if len(parts) == 2 {
			break
		}
	}
	return sign + strings.Join(parts, " ")
}

// humanizePercentageValue 把 0~1 的比例渲染为百分数字符串（最多 4 位有效数字）。
func humanizePercentageValue(v interface{}) string {
	f, ok := toFloat(v)
	if !ok {
		return fmt.Sprintf("%v", v)
	}
	return strconv.FormatFloat(f*100, 'g', 4, 64) + "%"
}

// humanizeTimestampValue 把 Unix 秒渲染为本地可读时间戳。
func humanizeTimestampValue(v interface{}) string {
	f, ok := toFloat(v)
	if !ok {
		return fmt.Sprintf("%v", v)
	}
	return time.Unix(int64(f), 0).Format("2006-01-02 15:04:05 MST")
}

// titleCase 首字母大写（Go 1.18 起 strings.Title 已废弃，此处自实现避免引入 x/text 依赖）。
func titleCase(s string) string {
	prev := ' '
	return strings.Map(func(r rune) rune {
		out := r
		if unicode.IsSpace(prev) {
			out = unicode.ToTitle(r)
		}
		prev = r
		return out
	}, s)
}
