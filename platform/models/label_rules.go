package models

import (
	"fmt"
	"regexp"
	"strings"
)

// PROTECTED_PROMETHEUS_LABELS are Prometheus-reserved labels that templates and
// user labels must not overwrite, aligned with Module_07 §5.3 / §5.11
// (instance / job / scheme / __address__ etc.). instance is granted as an
// exception for composite→instance mappings, which is enforced at the label
// mapping layer (T07-16), not here.
var PROTECTED_PROMETHEUS_LABELS = map[string]struct{}{
	"instance":         {},
	"job":              {},
	"scheme":           {},
	"__address__":      {},
	"__scheme__":       {},
	"__metrics_path__": {},
	"__name__":         {},
}

// IsProtectedLabel reports whether key is a protected Prometheus label.
func IsProtectedLabel(key string) bool {
	_, ok := PROTECTED_PROMETHEUS_LABELS[key]
	return ok
}

// LabelTransformDict 是标签映射的「字典翻译」转换规则：把来源字段的编码值
// 翻译为字典展示名后再写入 Prometheus 标签（如 app_code ``ceshi`` → 应用名）。
//
// 仅对引用字典 / 固定枚举的 resource_field 来源生效，见
// IsDictTranslatableSourceField；未知取值回退原始 code。
const LabelTransformDict = "dict"

// dictTranslatableSourceFields 是支持「字典翻译」的来源字段集合。
//   - app_code / app_name：应用字典 app_code → app_name（app_name 为 generator
//     host/database/middleware/generic_target 字段视图的历史键名，值同样是 app_code）；
//   - biz_code：业务字典 code → name；
//   - platform_code：平台字典 platform_code → platform_name；
//   - network_domain_id：网域 id → name；
//   - env：固定环境枚举 → 中文展示名（LabelEnvDisplayNames）。
var dictTranslatableSourceFields = map[string]struct{}{
	"app_code":          {},
	"app_name":          {},
	"biz_code":          {},
	"platform_code":     {},
	"network_domain_id": {},
	"env":               {},
}

// IsDictTranslatableSourceField reports whether field supports the dict transform.
func IsDictTranslatableSourceField(field string) bool {
	_, ok := dictTranslatableSourceFields[field]
	return ok
}

// LabelEnvDisplayNames 是 env 标签值的固定中文展示名（环境为固定枚举，非 DB 字典）。
var LabelEnvDisplayNames = map[string]string{
	"dev":     "开发",
	"test":    "测试",
	"staging": "预发",
	"prod":    "生产",
}

// ValidEnvs lists the accepted environment values (Module_07 §5.16.2).
var ValidEnvs = []string{"dev", "test", "staging", "prod"}

// ValidProtocols lists the accepted health-check protocol values
// (Module_07 §5.16.2).
var ValidProtocols = []string{"http", "https", "tcp"}

// ValidSchemes lists the accepted scrape scheme values (Module_07 §5.16.2).
var ValidSchemes = []string{"http", "https"}

// ValidBizCode matches a well-formed business code: lowercase letters, digits
// and hyphens, length ≤ 64 (Module_07 §5.16.2).
var ValidBizCode = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

// validLabelKey matches a well-formed label key: lowercase letters, digits and
// underscores, length 1..128 (Module_07 §5.3).
var validLabelKey = regexp.MustCompile(`^[a-z0-9_]{1,128}$`)

// ValidateLabelKey validates a Prometheus-style label key: lowercase letters,
// digits and underscores, must not start with "__", length ≤ 128
// (Module_07 §5.3 / §5.11).
func ValidateLabelKey(key string) error {
	if strings.HasPrefix(key, "__") {
		return fmt.Errorf("label key 禁止以 __ 开头")
	}
	if !validLabelKey.MatchString(key) {
		return fmt.Errorf("label key 只能包含小写字母、数字和下划线，长度不超过 128")
	}
	return nil
}
