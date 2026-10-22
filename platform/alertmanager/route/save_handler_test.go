package route

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// rootEditNode 造一个最小可保存的根路由。
func rootEditNode(receiver string) generator.RouteEditNode {
	return generator.RouteEditNode{
		ID:       "root",
		ParentID: "",
		Receiver: receiver,
		GroupBy:  []string{"alertname"},
	}
}

// stubSubmitRoutes 替换保存链路的后端提交工序，捕获合并后的整份 YAML。
func stubSubmitRoutes(t *testing.T) *string {
	t.Helper()
	orig := submitRoutesConfig
	var captured string
	submitRoutesConfig = func(db *gorm.DB, content, uploadedBy string) (*models.AlertmanagerConfigVersion, error) {
		captured = content
		return &models.AlertmanagerConfigVersion{
			Content:  content,
			Checksum: models.AlertmanagerConfigChecksum(content),
			Status:   models.AlertmanagerConfigStatusApplied,
		}, nil
	}
	t.Cleanup(func() { submitRoutesConfig = orig })
	return &captured
}

func TestSaveRoutes_RejectsStaleBaseChecksum(t *testing.T) {
	db := newRoutesDB(t)
	base := "route:\n  receiver: default\nreceivers:\n  - name: default\n"
	seedAppliedConfig(t, db, base)

	_, err := SaveRoutes(db, SaveRoutesRequest{
		BaseChecksum: "stale",
		RouteTree:    []generator.RouteEditNode{rootEditNode("default")},
	}, "tester")
	require.ErrorIs(t, err, ErrRoutesConflict)
}

func TestSaveRoutes_RejectsInvalidTree(t *testing.T) {
	db := newRoutesDB(t)
	base := "route:\n  receiver: default\nreceivers:\n  - name: default\n"
	seedAppliedConfig(t, db, base)

	_, err := SaveRoutes(db, SaveRoutesRequest{
		BaseChecksum: models.AlertmanagerConfigChecksum(base),
		RouteTree:    []generator.RouteEditNode{rootEditNode("")},
	}, "tester")
	var treeErr *ErrRouteTreeInvalid
	require.ErrorAs(t, err, &treeErr)
	require.NotEmpty(t, treeErr.Issues)
}

func TestSaveRoutes_RejectsDanglingReceiver(t *testing.T) {
	db := newRoutesDB(t)
	base := "route:\n  receiver: default\nreceivers:\n  - name: default\n"
	seedAppliedConfig(t, db, base)

	_, err := SaveRoutes(db, SaveRoutesRequest{
		BaseChecksum: models.AlertmanagerConfigChecksum(base),
		RouteTree:    []generator.RouteEditNode{rootEditNode("ghost")},
	}, "tester")
	var treeErr *ErrRouteTreeInvalid
	require.ErrorAs(t, err, &treeErr)
	assert.Equal(t, RouteIssueCodeReceiverDangling, treeErr.Issues[0].Code)
}

func TestSaveRoutes_GeneratesRouteAndPreservesOtherSections(t *testing.T) {
	db := newRoutesDB(t)
	ch := seedWebhookChannel(t, db, "SRE 飞书群", "https://open.feishu.cn/hook/A")
	base := `global:
  resolve_timeout: 5m
route:
  receiver: default
receivers:
  - name: default
  - name: team-a
inhibit_rules:
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="warning"']
`
	seedAppliedConfig(t, db, base)
	captured := stubSubmitRoutes(t)

	tree := []generator.RouteEditNode{
		rootEditNode("default"),
		{
			ID:            "root/0",
			ParentID:      "root",
			Name:          "严重告警",
			Receiver:      ch.ReceiverName(),
			Matchers:      []generator.RouteEditMatcher{{Name: "severity", Value: "critical", IsEqual: true}},
			GroupWait:     "15s",
			GroupInterval: "3m",
			RepeatInterval: "1h",
		},
	}

	result, err := SaveRoutes(db, SaveRoutesRequest{
		BaseChecksum: models.AlertmanagerConfigChecksum(base),
		RouteTree:    tree,
	}, "tester")
	require.NoError(t, err)
	require.NotNil(t, result.Version)

	// 非 route 段逐字保留。
	assert.Contains(t, *captured, "resolve_timeout: 5m")
	assert.Contains(t, *captured, "inhibit_rules:")
	assert.Contains(t, *captured, "name: team-a")
	// 路由引用的渠道 receiver 尚未物化时补空占位，保证 amtool 校验闭合
	assert.Contains(t, *captured, "name: "+ch.ReceiverName())
	// route 段由后端按树生成。
	assert.Contains(t, *captured, "receiver: 'default'")
	assert.Contains(t, *captured, ch.ReceiverName())
	assert.Contains(t, *captured, `severity="critical"`)
	assert.Contains(t, *captured, "# 路由名称: 严重告警")
}

func TestValidateRouteReceivers_OnlyEmittedNodes(t *testing.T) {
	disabled := false
	nodes := []generator.RouteEditNode{
		rootEditNode("default"),
		{
			ID:       "root/0",
			ParentID: "root",
			Receiver: "ghost",
			Enabled:  &disabled,
		},
	}
	issues := ValidateRouteReceivers(nodes, []string{"default"})
	assert.Empty(t, issues, "禁用节点不会被生成，不应判悬空")
}
