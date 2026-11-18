package inhibition

import (
	"fmt"
	"testing"

	"github.com/metriccenter/metriccenter/platform/alertmanager/route"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const inhibitionBase = `route:
  receiver: default
receivers:
  - name: default
inhibit_rules:
  # 抑制规则名称: 严重故障抑制一般告警
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity=~"warning|info"']
    equal: ['network_domain']
`

func newInhibitionDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:inhibition_%s?mode=memory&cache=shared", t.Name())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.AlertmanagerConfigVersion{}, &models.NotifyChannel{}, &models.ConfigDraft{}, &models.ConfigVersion{}))
	require.NoError(t, db.Create(&models.AlertmanagerConfigVersion{
		Content: inhibitionBase, Checksum: models.AlertmanagerConfigChecksum(inhibitionBase),
		Status: models.AlertmanagerConfigStatusApplied, AppliedBy: "tester",
	}).Error)
	return db
}

func TestServiceListAndSaveUsesSharedRoutePipeline(t *testing.T) {
	db := newInhibitionDB(t)
	svc := NewService(NewRepository(db))
	view, err := svc.List()
	require.NoError(t, err)
	require.Len(t, view.Items, 1)
	assert.Equal(t, "严重故障抑制一般告警", view.Items[0].Name)
	assert.Equal(t, models.AlertmanagerConfigChecksum(inhibitionBase), view.EffectiveChecksum)

	oldSave := saveAlertmanagerConfig
	defer func() { saveAlertmanagerConfig = oldSave }()
	var capturedTree []generator.RouteEditNode
	var capturedRules []generator.InhibitionRule
	var capturedChecksum string
	saveAlertmanagerConfig = func(_ *gorm.DB, tree []generator.RouteEditNode, rules []generator.InhibitionRule, checksum, _ string) (*route.SaveRoutesResult, error) {
		capturedTree, capturedRules, capturedChecksum = tree, rules, checksum
		return &route.SaveRoutesResult{ChangeNo: "CHG-001"}, nil
	}
	result, err := svc.Save(view.EffectiveChecksum, view.Items, "tester")
	require.NoError(t, err)
	assert.Equal(t, "CHG-001", result.ChangeNo)
	assert.Equal(t, view.EffectiveChecksum, capturedChecksum)
	assert.Equal(t, view.Items, capturedRules)
	require.NotEmpty(t, capturedTree)
	assert.Equal(t, "default", capturedTree[0].Receiver)
}

func TestServiceRejectsInvalidRules(t *testing.T) {
	svc := NewService(NewRepository(newInhibitionDB(t)))
	rules := []generator.InhibitionRule{{
		SourceMatchers: []generator.RouteEditMatcher{{Name: "severity", Value: "critical", IsEqual: true}},
		TargetMatchers: []generator.RouteEditMatcher{{Name: "severity", Value: "[", IsEqual: true, IsRegex: true}},
		Equal:          []string{"network_domain", "network_domain"},
	}}
	_, err := svc.Save("", rules, "tester")
	require.ErrorIs(t, err, ErrInvalidRule)
}
