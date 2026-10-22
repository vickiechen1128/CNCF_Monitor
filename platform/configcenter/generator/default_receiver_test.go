package generator

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func TestEnsureDefaultReceiver_AddsWhenMissing(t *testing.T) {
	in := "route:\n  receiver: default\n  routes:\n    - receiver: team-a\n"
	out, err := EnsureDefaultReceiver(in)
	require.NoError(t, err)

	var doc struct {
		Receivers []struct {
			Name string `yaml:"name"`
		} `yaml:"receivers"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(out), &doc))
	require.Len(t, doc.Receivers, 1)
	assert.Equal(t, DefaultReceiverName, doc.Receivers[0].Name)
}

func TestEnsureDefaultReceiver_AppendsToExistingReceivers(t *testing.T) {
	in := `route:
  receiver: team-a
receivers:
  - name: team-a
    webhook_configs:
      - url: 'http://example.com/hook'
`
	out, err := EnsureDefaultReceiver(in)
	require.NoError(t, err)

	var doc struct {
		Receivers []struct {
			Name string `yaml:"name"`
		} `yaml:"receivers"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(out), &doc))
	require.Len(t, doc.Receivers, 2)
	assert.Equal(t, "team-a", doc.Receivers[0].Name)
	assert.Equal(t, DefaultReceiverName, doc.Receivers[1].Name)
}

func TestEnsureDefaultReceiver_ExistingDefaultByteIdentical(t *testing.T) {
	in := `route:
  receiver: default
receivers:
  - name: default
`
	out, err := EnsureDefaultReceiver(in)
	require.NoError(t, err)
	assert.Equal(t, in, out)
}

func TestEnsureDefaultReceiver_Idempotent(t *testing.T) {
	first, err := EnsureDefaultReceiver("route:\n  receiver: default\n")
	require.NoError(t, err)
	second, err := EnsureDefaultReceiver(first)
	require.NoError(t, err)
	assert.Equal(t, first, second)
}

func TestEnsureReceiverNames_AppendsMissingStubs(t *testing.T) {
	in := "route:\n  receiver: default\nreceivers:\n  - name: default\n    webhook_configs:\n      - url: 'http://example/hook'\n"
	out, err := EnsureReceiverNames(in, []string{"default", "notify-2", "notify-1"})
	require.NoError(t, err)

	var doc struct {
		Receivers []struct {
			Name string `yaml:"name"`
		} `yaml:"receivers"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(out), &doc))
	require.Len(t, doc.Receivers, 3)
	assert.Equal(t, "default", doc.Receivers[0].Name)
	// 缺失项按名称稳定排序追加，避免 map 随机序破坏 checksum
	assert.Equal(t, "notify-1", doc.Receivers[1].Name)
	assert.Equal(t, "notify-2", doc.Receivers[2].Name)
	// 已存在的 default 配置不被清空
	assert.Contains(t, out, "http://example/hook")
}

func TestEnsureReceiverNames_NoMissingIsByteIdentical(t *testing.T) {
	in := "route:\n  receiver: default\nreceivers:\n  - name: default\n"
	out, err := EnsureReceiverNames(in, []string{"default"})
	require.NoError(t, err)
	assert.Equal(t, in, out)
}

func TestEnsureReceiverNames_Idempotent(t *testing.T) {
	first, err := EnsureReceiverNames("route:\n  receiver: default\n", []string{"default", "notify-1"})
	require.NoError(t, err)
	second, err := EnsureReceiverNames(first, []string{"default", "notify-1"})
	require.NoError(t, err)
	assert.Equal(t, first, second)
}

func TestEnsureDefaultReceiver_DegradesWithoutError(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{name: "empty", in: ""},
		{name: "invalid yaml", in: "route: [broken\n"},
		{name: "top level not mapping", in: "- a\n- b\n"},
		{name: "receivers not sequence", in: "route:\n  receiver: default\nreceivers: nope\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := EnsureDefaultReceiver(tc.in)
			require.NoError(t, err)
			assert.Equal(t, tc.in, out)
		})
	}
}
