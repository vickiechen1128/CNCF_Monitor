package configgen

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

func baseTree() []domain.RouteNode {
	return []domain.RouteNode{{
		ID: "root", Name: "根路由", Receiver: "default", Enabled: true,
		GroupBy: []string{"alertname"}, GroupWait: "30s", GroupInterval: "5m", RepeatInterval: "4h",
		Children: []domain.RouteNode{{
			ID: "team-sre", Name: "SRE", Receiver: "notify-c1", Enabled: true,
			Matchers: []domain.Matcher{{Name: "severity", Value: "critical"}},
		}},
	}}
}

func TestGenerateMaterialisesOnlyReferencedChannels(t *testing.T) {
	output, err := Generate(Input{
		RouteTree:     baseTree(),
		BridgeBaseURL: "http://127.0.0.1:8080",
		Channels: []*domain.Channel{
			{ID: "c1", Name: "SRE 群", Type: domain.ChannelTypeFeishu},
			{ID: "c2", Name: "未引用", Type: domain.ChannelTypeWecom},
		},
	})
	require.NoError(t, err)
	assert.Contains(t, output.Content, "receiver: default")
	assert.Contains(t, output.Content, "name: notify-c1")
	assert.NotContains(t, output.Content, "notify-c2", "unreferenced channels must not be materialised")
	assert.Contains(t, output.Content, "http://127.0.0.1:8080/api/v3/platform/webhooks/alerts")
	assert.Contains(t, output.Content, "id=c1")
	assert.Contains(t, output.Content, `severity="critical"`)
	assert.NotEmpty(t, output.Checksum)

	again, err := Generate(Input{
		RouteTree:     baseTree(),
		BridgeBaseURL: "http://127.0.0.1:8080",
		Channels:      []*domain.Channel{{ID: "c1", Name: "SRE 群", Type: domain.ChannelTypeFeishu}},
	})
	require.NoError(t, err)
	assert.Equal(t, output.Checksum, again.Checksum, "generation must be deterministic")
}

func TestGenerateRendersInhibitRules(t *testing.T) {
	output, err := Generate(Input{
		RouteTree:     baseTree(),
		BridgeBaseURL: "http://center:8080",
		Channels:      []*domain.Channel{{ID: "c1", Type: domain.ChannelTypeFeishu}},
		InhibitRules: []*domain.InhibitionRule{{
			Name: "网域离线抑制", Enabled: true,
			SourceMatchers: []domain.Matcher{{Name: "alertname", Value: "NetworkDomainDown"}},
			TargetMatchers: []domain.Matcher{{Name: "inhibitable", Value: "true"}},
			Equal:          []string{"network_domain_id"},
		}},
	})
	require.NoError(t, err)
	assert.Contains(t, output.Content, "inhibit_rules:")
	assert.Contains(t, output.Content, "source_matchers:")
	assert.Contains(t, output.Content, "network_domain_id")
}

func TestGenerateRejectsUnknownReceiver(t *testing.T) {
	_, err := Generate(Input{
		RouteTree:     baseTree(),
		BridgeBaseURL: "http://center:8080",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown receiver")
}

func TestGenerateRequiresBridgeBaseAndSingleRoot(t *testing.T) {
	_, err := Generate(Input{RouteTree: baseTree()})
	require.Error(t, err)

	_, err = Generate(Input{RouteTree: append(baseTree(), baseTree()...), BridgeBaseURL: "http://x"})
	require.Error(t, err)
}

func TestGenerateRendersNegativeMatchers(t *testing.T) {
	no := false
	tree := baseTree()
	tree[0].Children[0].Matchers = []domain.Matcher{
		{Name: "severity", Value: "info", IsEqual: &no},
		{Name: "team", Value: "^tmp-", IsRegex: true, IsEqual: &no},
	}
	output, err := Generate(Input{
		RouteTree:     tree,
		BridgeBaseURL: "http://center:8080",
		Channels:      []*domain.Channel{{ID: "c1", Type: domain.ChannelTypeFeishu}},
	})
	require.NoError(t, err)
	assert.Contains(t, output.Content, `severity!="info"`)
	assert.Contains(t, output.Content, `team!~"^tmp-"`)
}

func TestGenerateSkipsDisabledBranches(t *testing.T) {
	tree := baseTree()
	tree[0].Children = append(tree[0].Children, domain.RouteNode{
		ID: "off", Receiver: "notify-c2", Enabled: false,
	})
	output, err := Generate(Input{
		RouteTree:     tree,
		BridgeBaseURL: "http://center:8080",
		Channels:      []*domain.Channel{{ID: "c1", Type: domain.ChannelTypeFeishu}},
	})
	require.NoError(t, err)
	assert.False(t, strings.Contains(output.Content, "notify-c2"))
}
