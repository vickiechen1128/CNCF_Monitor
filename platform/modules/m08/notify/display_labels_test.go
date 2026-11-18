package notify

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEnrichAlertsDisplayLabels：通知渲染前按网域字典补齐中文展示名；
// 身份标签 network_domain / network_domain_id 保持原值不变。
func TestEnrichAlertsDisplayLabels(t *testing.T) {
	db := newNotifyDB(t)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "gov-cloud-a", Name: "政务网A区", DomainType: models.DomainTypeEdge,
		ZoneType: "internet", CloudCode: "PUB-TX", TenantID: models.PlatformAdminTenantID,
		Channel: models.ChannelTypeAgentPull, Status: models.DomainStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&models.CloudDict{
		CloudCode: "PUB-TX", CloudName: "腾讯云", CloudType: models.CloudTypePublic,
		Carrier: models.CloudCarrierTencent, Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.ZoneType{
		Code: "internet", DisplayName: "互联网区", Enabled: true,
	}).Error)

	alerts := []amWebhookAlert{
		{Labels: map[string]string{
			"alertname":         "HighCPU",
			"network_domain_id": "gov-cloud-a",
		}},
		// 存量 / 聚合告警：无网域标签 → 不补展示名、不 panic。
		{Labels: map[string]string{"alertname": "HostTargetsMissing"}},
		{Labels: nil},
	}
	enrichAlertsDisplayLabels(db, alerts)

	assert.Equal(t, "政务网A区", alerts[0].Labels[models.NetworkDomainNameLabelKey])
	assert.Equal(t, "腾讯云", alerts[0].Labels[models.CloudNameLabelKey])
	assert.Equal(t, "互联网区", alerts[0].Labels[models.ZoneNameLabelKey])
	assert.Equal(t, "gov-cloud-a", alerts[0].Labels[models.NetworkDomainIDLabelKey],
		"身份标签不得被展示名覆盖")
	assert.NotContains(t, alerts[1].Labels, models.NetworkDomainNameLabelKey)
	assert.Nil(t, alerts[2].Labels)
}

// TestEnrichAlertsDisplayLabelsUnknownDomain：网域已被删除 / 字典未命中时静默降级，
// 保留原标签，不阻断通知。
func TestEnrichAlertsDisplayLabelsUnknownDomain(t *testing.T) {
	db := newNotifyDB(t)
	alerts := []amWebhookAlert{{Labels: map[string]string{
		"network_domain_id": "not-exists",
		"alertname":         "HighCPU",
	}}}
	enrichAlertsDisplayLabels(db, alerts)

	assert.NotContains(t, alerts[0].Labels, models.NetworkDomainNameLabelKey)
	assert.Equal(t, "not-exists", alerts[0].Labels[models.NetworkDomainIDLabelKey])
}

// TestBuiltinFeishuTemplatePrefersDisplayLabels：内置飞书卡片优先展示
// network_domain_name / zone_name，无展示标签时才回落 code。
func TestBuiltinFeishuTemplatePrefersDisplayLabels(t *testing.T) {
	payload := amWebhookPayload{
		Status: "firing",
		Alerts: []amWebhookAlert{{
			Status: "firing",
			Labels: map[string]string{
				"alertname":           "HighCPU",
				"instance":            "10.0.0.1:9100",
				"severity":            "critical",
				"network_domain":      "gov-cloud-a",
				"network_domain_name": "政务网A区",
				"zone":                "internet",
				"zone_name":           "互联网区",
			},
		}},
	}
	out, err := Render(BuiltinFeishuCardTemplate, payload, DefaultRenderLocation)
	require.NoError(t, err)

	s := string(out)
	assert.Contains(t, s, "**网域**: 政务网A区")
	assert.Contains(t, s, "**区域**: 互联网区")
	assert.NotContains(t, s, "**网域**: gov-cloud-a")
	assert.NotContains(t, s, "**区域**: internet")
}
