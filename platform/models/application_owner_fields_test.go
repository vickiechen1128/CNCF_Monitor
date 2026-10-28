package models

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestApplicationOwnerFields(t *testing.T) {
	live := time.Date(2026, 10, 28, 8, 0, 0, 0, time.UTC)
	app := &Application{
		Owner1: "张三", Owner1Contact: "13800000001",
		Owner2: "李四", Owner2Contact: "13800000002", GoLiveAt: &live,
	}
	for field, want := range map[string]string{
		"owner1": "张三", "owner1_contact": "13800000001",
		"owner2": "李四", "owner2_contact": "13800000002",
		"go_live_at": "2026-10-28T08:00:00Z",
	} {
		got, ok := GetResourceField(app, field)
		assert.True(t, ok, field)
		assert.Equal(t, want, got, field)
	}
}
