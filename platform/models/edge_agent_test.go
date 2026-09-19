package models

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIsValidEdgeAgentStatus(t *testing.T) {
	valid := map[string]bool{
		EdgeAgentStatusOnline:  true,
		EdgeAgentStatusOffline: true,
		EdgeAgentStatusUnknown: true,
		EdgeAgentStatusRetired: true,
		"":                     false,
		"active":               false,
		"pending":              false,
	}
	for status, want := range valid {
		if got := IsValidEdgeAgentStatus(status); got != want {
			t.Errorf("IsValidEdgeAgentStatus(%q) = %v, want %v", status, got, want)
		}
	}
}

func TestCanTransitionToEdgeAgentStatus(t *testing.T) {
	t.Run("retired is terminal and cannot transition", func(t *testing.T) {
		for _, to := range []string{EdgeAgentStatusOnline, EdgeAgentStatusOffline, EdgeAgentStatusUnknown, EdgeAgentStatusRetired} {
			err := CanTransitionToEdgeAgentStatus(EdgeAgentStatusRetired, to)
			require.Error(t, err)
			require.Contains(t, strings.ToLower(err.Error()), "terminal", "error should mention terminal")
		}
	})

	t.Run("invalid target status", func(t *testing.T) {
		err := CanTransitionToEdgeAgentStatus(EdgeAgentStatusOnline, "active")
		require.Error(t, err)
	})

	t.Run("valid transitions to retired", func(t *testing.T) {
		for _, from := range []string{EdgeAgentStatusOnline, EdgeAgentStatusOffline, EdgeAgentStatusUnknown} {
			require.NoError(t, CanTransitionToEdgeAgentStatus(from, EdgeAgentStatusRetired))
		}
	})
}