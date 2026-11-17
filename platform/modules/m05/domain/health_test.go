package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestClassifyUpHealth covers the three states and the nil degradation.
func TestClassifyUpHealth(t *testing.T) {
	index := NewUpHealthIndex(
		map[string]bool{"collecting": true, "partial": true},
		map[string]bool{"partial": true, "down": true},
	)

	counts := ClassifyUpHealth([]string{"collecting", "partial", "down", "unknown"}, index)
	require.NotNil(t, counts)
	assert.Equal(t, 4, counts.Total)
	assert.Equal(t, 1, counts.Collecting)
	assert.Equal(t, 1, counts.Partial)
	assert.Equal(t, 2, counts.Down)

	// No querier / failed query ⇒ nil so the response omits the field.
	assert.Nil(t, ClassifyUpHealth([]string{"collecting"}, nil))

	// An empty dispatched set still produces a zeroed struct (all four counters
	// exist, the frontend renders 0/0 as "nothing dispatched").
	empty := ClassifyUpHealth(nil, NewUpHealthIndex(nil, nil))
	require.NotNil(t, empty)
	assert.Zero(t, empty.Total+empty.Collecting+empty.Partial+empty.Down)
}
