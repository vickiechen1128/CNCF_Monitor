package route

import (
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
)

func TestPendingChangeViewScopesChangedSections(t *testing.T) {
	db := newRoutesDB(t)
	require.NoError(t, db.AutoMigrate(&models.NetworkDomain{}))
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: models.DefaultDomainID, Name: "管理域", DomainType: models.DomainTypeManagement,
		ZoneType: "internet", CloudCode: "PUB-TX", Channel: models.ChannelTypeLocal,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusEnabled,
	}).Error)
	base := "route:\n  receiver: default\nreceivers:\n  - name: default\ninhibit_rules:\n  - source_matchers: ['severity=\"critical\"']\n    target_matchers: ['severity=\"warning\"']\n"
	require.NoError(t, db.Create(&models.ConfigVersion{
		NetworkDomainID: models.DefaultDomainID, DraftID: "draft-base", ChangeNo: "CHG-BASE",
		AlertmanagerYml: base,
	}).Error)

	inhibitChanged := "route:\n  receiver: default\nreceivers:\n  - name: default\ninhibit_rules:\n  - source_matchers: ['severity=\"critical\"']\n    target_matchers: ['severity=\"info\"']\n"
	require.NoError(t, db.Create(&models.ConfigDraft{
		NetworkDomainID: models.DefaultDomainID, ChangeNo: "CHG-INHIBIT", Status: models.DraftStatusPending,
		AlertmanagerYml: inhibitChanged, BaseModel: models.BaseModel{CreatedAt: time.Now()},
	}).Error)
	view, err := ListRoutes(db)
	require.NoError(t, err)
	pending := view["pending"].(gin.H)
	require.Equal(t, false, pending["route_changed"])
	require.Equal(t, true, pending["inhibit_rules_changed"])

	routeChanged := "route:\n  receiver: sre\nreceivers:\n  - name: default\ninhibit_rules:\n  - source_matchers: ['severity=\"critical\"']\n    target_matchers: ['severity=\"warning\"']\n"
	require.NoError(t, db.Model(&models.ConfigDraft{}).Where("change_no = ?", "CHG-INHIBIT").Update("alertmanager_yml", routeChanged).Error)
	view, err = ListRoutes(db)
	require.NoError(t, err)
	pending = view["pending"].(gin.H)
	require.Equal(t, true, pending["route_changed"])
	require.Equal(t, false, pending["inhibit_rules_changed"])
}
