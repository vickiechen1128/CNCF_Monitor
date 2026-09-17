package models

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// TestResolveNetworkDomain 覆盖网域标签解析与回落链：
// network_domain（消费侧契约键）> network_domain_id（写入侧 external_labels 键）> default。
func TestResolveNetworkDomain(t *testing.T) {
	t.Run("消费侧契约键优先", func(t *testing.T) {
		labels := map[string]string{
			NetworkDomainLabelKey:   "dmz",
			NetworkDomainIDLabelKey: "gov-cloud-a",
		}
		assert.Equal(t, "dmz", ResolveNetworkDomain(labels))
	})

	t.Run("仅携带写入侧 external_labels 键时按它解析", func(t *testing.T) {
		labels := map[string]string{NetworkDomainIDLabelKey: "gov-cloud-a"}
		assert.Equal(t, "gov-cloud-a", ResolveNetworkDomain(labels))
	})

	t.Run("契约键为空串时继续下探", func(t *testing.T) {
		labels := map[string]string{
			NetworkDomainLabelKey:   "",
			NetworkDomainIDLabelKey: "gov-cloud-a",
		}
		assert.Equal(t, "gov-cloud-a", ResolveNetworkDomain(labels))
	})

	t.Run("两者均缺失回落 default", func(t *testing.T) {
		assert.Equal(t, DefaultDomainID, ResolveNetworkDomain(map[string]string{"alertname": "HostDown"}))
	})

	t.Run("nil map 安全回落 default", func(t *testing.T) {
		assert.Equal(t, DefaultDomainID, ResolveNetworkDomain(nil))
	})
}

// TestEnsureNetworkDomain 覆盖回写语义：已有网域键时被覆盖为解析结果；
// nil map 新建后写入（不 panic），保证响应 labels 恒含 network_domain。
func TestEnsureNetworkDomain(t *testing.T) {
	t.Run("新建 nil map 并写入", func(t *testing.T) {
		out := EnsureNetworkDomain(nil, "default")
		assert.Equal(t, "default", out[NetworkDomainLabelKey])
		assert.Equal(t, "default", ResolveNetworkDomain(out))
	})

	t.Run("原地覆盖既有网域键", func(t *testing.T) {
		labels := map[string]string{NetworkDomainLabelKey: "stale", "alertname": "HostDown"}
		out := EnsureNetworkDomain(labels, "dmz")
		assert.Equal(t, "dmz", out[NetworkDomainLabelKey])
		assert.Equal(t, "HostDown", out["alertname"], "其余标签不受影响")
	})
}
