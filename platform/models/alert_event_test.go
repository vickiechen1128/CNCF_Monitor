package models

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// TestAlertEventOccurrenceKeyNormalizesToUTCMillisecond 去重键只认时刻，不认写法：
// 同一时刻的 UTC / UTC+8、纳秒 / 毫秒写法必须算出同一个键。
func TestAlertEventOccurrenceKeyNormalizesToUTCMillisecond(t *testing.T) {
	utc := time.Date(2026, 10, 25, 8, 0, 0, 123456789, time.UTC)
	cst := utc.In(time.FixedZone("UTC+8", 8*3600))
	sameMs := time.Date(2026, 10, 25, 8, 0, 0, 123000000, time.UTC)

	assert.Equal(t, AlertEventOccurrenceKey("fp-1", utc), AlertEventOccurrenceKey("fp-1", cst))
	assert.Equal(t, AlertEventOccurrenceKey("fp-1", utc), AlertEventOccurrenceKey("fp-1", sameMs),
		"归一化截到毫秒，纳秒尾差不影响去重")

	assert.NotEqual(t, AlertEventOccurrenceKey("fp-1", utc), AlertEventOccurrenceKey("fp-2", utc),
		"不同指纹必须是不同发生")
	assert.NotEqual(t, AlertEventOccurrenceKey("fp-1", utc), AlertEventOccurrenceKey("fp-1", utc.Add(time.Millisecond)),
		"不同开始时间必须是不同发生")
}

// TestAlertEventOccurrenceKeyEmptyFingerprint 无指纹不生成去重键，保持原样落库口径。
func TestAlertEventOccurrenceKeyEmptyFingerprint(t *testing.T) {
	assert.Empty(t, AlertEventOccurrenceKey("", time.Now()))
}

// TestNormalizeAlertEventTime 存储时区固定为 UTC+8，且不改变时刻本身。
func TestNormalizeAlertEventTime(t *testing.T) {
	utc := time.Date(2026, 10, 25, 8, 0, 0, 0, time.UTC)
	got := NormalizeAlertEventTime(utc)
	assert.True(t, got.Equal(utc))
	_, offset := got.Zone()
	assert.Equal(t, 8*3600, offset)
}

// TestAlertEventStatusSets 七态集合与未结 / 终态 / 恢复未知终态划分自洽。
func TestAlertEventStatusSets(t *testing.T) {
	assert.Len(t, AlertEventOpenStatuses, 3)
	assert.Len(t, AlertEventTerminalStatuses, 4)
	assert.Len(t, AlertEventInferredTerminalStatuses, 3)

	for _, s := range AlertEventOpenStatuses {
		assert.True(t, IsOpenAlertEventStatus(s))
		assert.False(t, IsInferredAlertEventStatus(s))
	}
	for _, s := range AlertEventInferredTerminalStatuses {
		assert.True(t, IsInferredAlertEventStatus(s))
		assert.False(t, IsOpenAlertEventStatus(s))
	}
	assert.True(t, IsValidAlertEventStatus(AlertEventStatusInhibitedClosed))
	assert.False(t, IsValidAlertEventStatus("bogus"))
}
