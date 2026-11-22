package service

import (
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Query guardrails (M09 SRS NFR-11 / HLD §10.1). They protect the center
// Prometheus and the control plane from oversized query requests. The limits
// are intentionally conservative and are applied before the domain matcher is
// injected, so the user-supplied expression is measured as written.
const (
	// MaxQueryLength is the maximum byte length of a user-supplied PromQL
	// expression.
	MaxQueryLength = 8 << 10
	// MaxQueryRange is the maximum start-to-end window for range queries and
	// label/series enumeration.
	MaxQueryRange = 30 * 24 * time.Hour
	// MinQueryStep is the minimum resolution for range queries.
	MinQueryStep = 15 * time.Second
	// MaxQueryPoints is the maximum number of points returned per series.
	MaxQueryPoints = 11000
	// QueryTimeout bounds one upstream query round trip.
	QueryTimeout = 30 * time.Second
)

// GuardError marks a query rejected by the NFR-11 guardrails. The message is
// user-facing and contains an actionable next step (shrink the range or
// increase the step); handlers map it to HTTP 400 bad_request.
type GuardError struct {
	Message string
}

// Error implements the error interface.
func (e *GuardError) Error() string { return e.Message }

func newGuardError(format string, args ...any) *GuardError {
	return &GuardError{Message: fmt.Sprintf(format, args...)}
}

// GuardQuery validates one Prometheus-compatible proxy request against the
// NFR-11 limits. Unknown or partially supplied parameters are left to
// Prometheus so valid PromQL/Prometheus duration syntax is never rejected by
// the guard itself.
func GuardQuery(path string, params url.Values) error {
	switch path {
	case "/api/v1/query", "/api/v1/query_range":
		if err := ValidateQueryLength(params.Get("query")); err != nil {
			return err
		}
	}

	switch {
	case path == "/api/v1/query_range":
		return ValidateRangeParams(params.Get("start"), params.Get("end"), params.Get("step"))
	case path == "/api/v1/labels", path == "/api/v1/series", strings.HasPrefix(path, "/api/v1/label/"):
		return ValidateRangeWindow(params.Get("start"), params.Get("end"))
	default:
		return nil
	}
}

// ValidateQueryLength rejects expressions longer than MaxQueryLength bytes.
func ValidateQueryLength(expr string) error {
	if len(expr) <= MaxQueryLength {
		return nil
	}
	return newGuardError("查询表达式长度 %d 字节，超过上限 %d 字节，请简化表达式后重试",
		len(expr), MaxQueryLength)
}

// ValidateRangeWindow validates a start/end window shared by range queries and
// label/series enumeration. Missing or unrecognized values are ignored so the
// upstream keeps its native error semantics.
func ValidateRangeWindow(startRaw, endRaw string) error {
	start, okStart := parseQueryTime(startRaw)
	end, okEnd := parseQueryTime(endRaw)
	if !okStart || !okEnd {
		return nil
	}
	if !end.After(start) {
		return newGuardError("结束时间必须晚于开始时间")
	}
	if span := end.Sub(start); span > MaxQueryRange {
		return newGuardError("查询时间范围 %s 超过上限 %s，请缩小时间范围后重试",
			formatGuardDuration(span), formatGuardDuration(MaxQueryRange))
	}
	return nil
}

// ValidateRangeParams validates the query_range window and resolution. It
// enforces the minimum step and the per-series point budget, and suggests a
// usable step when the point budget is exceeded.
func ValidateRangeParams(startRaw, endRaw, stepRaw string) error {
	if err := ValidateRangeWindow(startRaw, endRaw); err != nil {
		return err
	}
	start, okStart := parseQueryTime(startRaw)
	end, okEnd := parseQueryTime(endRaw)
	step, okStep := parseQueryStep(stepRaw)
	if !okStart || !okEnd || !okStep {
		return nil
	}
	if step < MinQueryStep {
		return newGuardError("查询步长 %s 小于下限 %s，请使用 %s 或更大步长",
			formatGuardDuration(step), formatGuardDuration(MinQueryStep), formatGuardDuration(MinQueryStep))
	}

	span := end.Sub(start)
	points := int64(span/step) + 1
	if points <= MaxQueryPoints {
		return nil
	}
	return newGuardError("预计返回 %d 点/序列，超过上限 %d，请将步长增大到 %s 或缩小时间范围",
		points, MaxQueryPoints, formatGuardDuration(suggestQueryStep(span)))
}

// parseQueryTime accepts RFC3339 or unix seconds (fractions allowed), matching
// the Prometheus HTTP API.
func parseQueryTime(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, false
	}
	if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		return parsed, true
	}
	if parsed, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return parsed, true
	}
	seconds, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return time.Time{}, false
	}
	whole, fraction := math.Modf(seconds)
	return time.Unix(int64(whole), int64(fraction*float64(time.Second))).UTC(), true
}

// parseQueryStep accepts unix seconds, Go durations, and Prometheus durations
// (including d/w/y units). Unrecognized values are left to Prometheus.
func parseQueryStep(raw string) (time.Duration, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0, false
	}
	if seconds, err := strconv.ParseFloat(raw, 64); err == nil {
		if math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds <= 0 {
			return 0, false
		}
		return time.Duration(seconds * float64(time.Second)), true
	}
	if parsed, ok := parsePrometheusDuration(raw); ok {
		return parsed, true
	}
	if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
		return parsed, true
	}
	return 0, false
}

// parsePrometheusDuration parses Prometheus duration syntax with d/w/y units
// that time.ParseDuration does not support (for example "1d" or "1w").
func parsePrometheusDuration(raw string) (time.Duration, bool) {
	if raw == "" {
		return 0, false
	}
	var total time.Duration
	for i := 0; i < len(raw); {
		start := i
		for i < len(raw) && ((raw[i] >= '0' && raw[i] <= '9') || raw[i] == '.') {
			i++
		}
		if start == i {
			return 0, false
		}
		number, err := strconv.ParseFloat(raw[start:i], 64)
		if err != nil || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) {
			return 0, false
		}

		unitStart := i
		for i < len(raw) && ((raw[i] < '0' || raw[i] > '9') && raw[i] != '.') {
			i++
		}
		unit := raw[unitStart:i]
		var factor time.Duration
		switch unit {
		case "ms":
			factor = time.Millisecond
		case "s":
			factor = time.Second
		case "m":
			factor = time.Minute
		case "h":
			factor = time.Hour
		case "d":
			factor = 24 * time.Hour
		case "w":
			factor = 7 * 24 * time.Hour
		case "y":
			factor = 365 * 24 * time.Hour
		default:
			return 0, false
		}
		total += time.Duration(number * float64(factor))
		if total < 0 {
			return 0, false
		}
	}
	return total, true
}

// suggestQueryStep returns the smallest common resolution that keeps a window
// within the point budget.
func suggestQueryStep(span time.Duration) time.Duration {
	minimum := span / (MaxQueryPoints - 1)
	if minimum < MinQueryStep {
		return MinQueryStep
	}
	for _, step := range commonQuerySteps {
		if step >= minimum {
			return step
		}
	}
	return commonQuerySteps[len(commonQuerySteps)-1]
}

var commonQuerySteps = []time.Duration{
	15 * time.Second,
	30 * time.Second,
	time.Minute,
	2 * time.Minute,
	5 * time.Minute,
	10 * time.Minute,
	15 * time.Minute,
	30 * time.Minute,
	time.Hour,
	2 * time.Hour,
	4 * time.Hour,
	6 * time.Hour,
	12 * time.Hour,
	24 * time.Hour,
	48 * time.Hour,
	7 * 24 * time.Hour,
}

// formatGuardDuration renders a duration in the most readable unit used by the
// query page (15s, 5m, 6h, 30d).
func formatGuardDuration(d time.Duration) string {
	if d <= 0 {
		return "0s"
	}
	if d%(24*time.Hour) == 0 {
		return fmt.Sprintf("%dd", d/(24*time.Hour))
	}
	if d%time.Hour == 0 {
		return fmt.Sprintf("%dh", d/time.Hour)
	}
	if d%time.Minute == 0 {
		return fmt.Sprintf("%dm", d/time.Minute)
	}
	if d%time.Second == 0 {
		return fmt.Sprintf("%ds", d/time.Second)
	}
	return d.String()
}
