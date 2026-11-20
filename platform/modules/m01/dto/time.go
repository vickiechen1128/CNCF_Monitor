package dto

import "time"

// formatTime renders a timestamp as RFC3339 and maps the Go zero value to an
// empty string (the contract forbids "0001-01-01T00:00:00Z").
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
