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
