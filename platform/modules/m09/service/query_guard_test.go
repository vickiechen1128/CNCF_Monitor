package service

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateQueryLength(t *testing.T) {
	assert.NoError(t, ValidateQueryLength(strings.Repeat("a", MaxQueryLength)))

	err := ValidateQueryLength(strings.Repeat("a", MaxQueryLength+1))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "超过上限")
}

func TestValidateRangeParams(t *testing.T) {
	tests := []struct {
		name    string
		start   string
		end     string
		step    string
		wantErr string
	}{
		{name: "valid unix seconds", start: "0", end: "3600", step: "15"},
		{name: "valid RFC3339", start: "2026-11-22T00:00:00Z", end: "2026-11-22T01:00:00Z", step: "15s"},
		{name: "valid prometheus duration", start: "0", end: "3600", step: "1h30m"},
		{name: "valid day duration", start: "0", end: "86400", step: "1d"},
		{name: "end before start", start: "3600", end: "0", step: "15", wantErr: "结束时间"},
		{name: "range over 30 days", start: "0", end: "2592001", step: "15", wantErr: "超过上限"},
		{name: "step below 15s", start: "0", end: "3600", step: "5", wantErr: "小于下限"},
		{name: "too many points", start: "0", end: "165000", step: "15", wantErr: "预计返回"},
		{name: "exactly 11000 points is allowed", start: "0", end: "164985", step: "15"},
		{name: "unparseable params are left to prometheus", start: "bad", end: "also-bad", step: "bad"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRangeParams(tt.start, tt.end, tt.step)
			if tt.wantErr == "" {
				assert.NoError(t, err)
				return
			}
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestValidateRangeWindow(t *testing.T) {
	assert.NoError(t, ValidateRangeWindow("", ""))
	assert.NoError(t, ValidateRangeWindow("0", "2592000"), "exactly 30 days is allowed")

	err := ValidateRangeWindow("0", "2592001")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "30d")
}

func TestGuardQuery(t *testing.T) {
	long := strings.Repeat("a", MaxQueryLength+1)

	assert.Error(t, GuardQuery("/api/v1/query", url.Values{"query": {long}}))
	assert.NoError(t, GuardQuery("/api/v1/alerts", url.Values{}))

	err := GuardQuery("/api/v1/query_range", url.Values{
		"query": {"up"},
		"start": {"0"},
		"end":   {"3600"},
		"step":  {"5"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "步长")

	err = GuardQuery("/api/v1/labels", url.Values{"start": {"0"}, "end": {"2592001"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "超过上限")

	err = GuardQuery("/api/v1/label/job/values", url.Values{"start": {"0"}, "end": {"2592001"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "超过上限")

	assert.NoError(t, GuardQuery("/api/v1/labels", url.Values{"start": {"0"}, "end": {"3600"}}))
}

func TestParseQueryStep(t *testing.T) {
	tests := []struct {
		raw  string
		want time.Duration
		ok   bool
	}{
		{raw: "30", want: 30 * time.Second, ok: true},
		{raw: "15s", want: 15 * time.Second, ok: true},
		{raw: "1h30m", want: 90 * time.Minute, ok: true},
		{raw: "1d", want: 24 * time.Hour, ok: true},
		{raw: "1w", want: 7 * 24 * time.Hour, ok: true},
		{raw: "0", ok: false},
		{raw: "-5", ok: false},
		{raw: "not-a-duration", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.raw, func(t *testing.T) {
			got, ok := parseQueryStep(tt.raw)
			assert.Equal(t, tt.ok, ok)
			if tt.ok {
				assert.Equal(t, tt.want, got)
			}
		})
	}
}

func TestSuggestQueryStep(t *testing.T) {
	assert.Equal(t, 15*time.Second, suggestQueryStep(time.Hour))
	assert.Equal(t, 60*time.Second, suggestQueryStep(7*24*time.Hour))
	assert.Equal(t, 300*time.Second, suggestQueryStep(30*24*time.Hour))
}

func TestFormatGuardDuration(t *testing.T) {
	assert.Equal(t, "15s", formatGuardDuration(15*time.Second))
	assert.Equal(t, "6h", formatGuardDuration(6*time.Hour))
	assert.Equal(t, "30d", formatGuardDuration(30*24*time.Hour))
}
