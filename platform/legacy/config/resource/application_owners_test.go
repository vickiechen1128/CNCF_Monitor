package resource

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestApplicationGoLiveAtValidation(t *testing.T) {
	base := ResourceInput{
		BizCode: "pay", AppCode: "pay", Cluster: "c", ServiceName: "svc",
		HealthCheckURL: "https://example.com/health",
	}
	for _, value := range []string{"2026-10-28", "2026-10-28T08:00:00Z", ""} {
		in := base
		in.GoLiveAt = value
		assert.NoError(t, validateApplication(&in), value)
	}
	in := base
	in.GoLiveAt = "2026/10/28"
	assert.ErrorContains(t, validateApplication(&in), "go_live_at 格式非法")
}
