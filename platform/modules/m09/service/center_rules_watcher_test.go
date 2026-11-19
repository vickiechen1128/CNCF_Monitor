package service

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

func TestCenterSyncSettled(t *testing.T) {
	tests := []struct {
		name     string
		snapshot *repository.CenterConfigSnapshot
		want     bool
	}{
		{name: "nil", snapshot: nil, want: false},
		{
			name:     "passed",
			snapshot: &repository.CenterConfigSnapshot{ValidationStatus: "passed"},
			want:     true,
		},
		{
			name:     "user config failure",
			snapshot: &repository.CenterConfigSnapshot{ValidationStatus: "failed", ValidationCause: "user_config"},
			want:     true,
		},
		{
			name:     "platform fault retries",
			snapshot: &repository.CenterConfigSnapshot{ValidationStatus: "failed", ValidationCause: "platform_fault"},
			want:     false,
		},
		{
			name:     "failed without cause retries",
			snapshot: &repository.CenterConfigSnapshot{ValidationStatus: "failed", ValidationCause: "none"},
			want:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, centerSyncSettled(tt.snapshot))
		})
	}
}
