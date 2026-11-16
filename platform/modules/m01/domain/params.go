package domain

import (
	"strconv"
	"strings"
)

// Default duration / path values shared by mappings and jobs.
const (
	DefaultScrapeInterval = "15s"
	DefaultScrapeTimeout  = "10s"
	DefaultMetricsPath    = "/metrics"
)

// ValidDuration reports whether s is a Prometheus duration literal
// (`^\d+(ms|s|m|h|d|w|y)$`). Empty values are rejected; callers decide whether
// "empty means inherit" applies before calling.
func ValidDuration(s string) bool {
	value := strings.TrimSpace(s)
	i := 0
	for i < len(value) && value[i] >= '0' && value[i] <= '9' {
		i++
	}
	if i == 0 || i == len(value) {
		return false
	}
	switch value[i:] {
	case "ms", "s", "m", "h", "d", "w", "y":
		return true
	default:
		return false
	}
}

// ParseDurationSeconds converts a supported duration literal into seconds.
// It returns ok=false for invalid literals.
func ParseDurationSeconds(s string) (int64, bool) {
	value := strings.TrimSpace(s)
	i := 0
	for i < len(value) && value[i] >= '0' && value[i] <= '9' {
		i++
	}
	if i == 0 || i == len(value) {
		return 0, false
	}
	amount, err := strconv.ParseInt(value[:i], 10, 64)
	if err != nil {
		return 0, false
	}
	switch value[i:] {
	case "ms":
		return amount / 1000, true
	case "s":
		return amount, true
	case "m":
		return amount * 60, true
	case "h":
		return amount * 3600, true
	case "d":
		return amount * 86400, true
	case "w":
		return amount * 7 * 86400, true
	case "y":
		return amount * 365 * 86400, true
	default:
		return 0, false
	}
}

// ValidateScrapeTiming checks interval/timeout literals and the timeout <
// interval invariant. Empty values are accepted so callers can apply the
// inheritance chain first.
func ValidateScrapeTiming(interval, timeout string) error {
	if interval != "" && !ValidDuration(interval) {
		return NewValidationError("scrape_interval", "must be a Prometheus duration such as 15s or 1m")
	}
	if timeout != "" && !ValidDuration(timeout) {
		return NewValidationError("scrape_timeout", "must be a Prometheus duration such as 10s")
	}
	if interval == "" || timeout == "" {
		return nil
	}
	intervalSeconds, _ := ParseDurationSeconds(interval)
	timeoutSeconds, _ := ParseDurationSeconds(timeout)
	if timeoutSeconds >= intervalSeconds {
		return NewValidationError("scrape_timeout", "must be shorter than scrape_interval")
	}
	return nil
}

// ValidateMetricsPath checks a metrics path starts with "/".
func ValidateMetricsPath(path string) error {
	if path == "" {
		return nil
	}
	if !strings.HasPrefix(path, "/") {
		return NewValidationError("metrics_path", "must start with /")
	}
	return nil
}

// ValidatePort checks a port is 0 (unset) or in 1..65535.
func ValidatePort(port int) error {
	if port < 0 || port > 65535 {
		return NewValidationError("port", "must be between 0 and 65535")
	}
	return nil
}
