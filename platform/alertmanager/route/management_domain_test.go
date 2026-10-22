package route

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/domainregistry"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
)

// 告警路由设定归属中心直连域（决策 60）：未登记时不写入设定行。
func TestPutRouteSettingRejectsWhenManagementDomainMissing(t *testing.T) {
	db := newRouteDB(t)
	require.NoError(t, db.Unscoped().Where("id = ?", models.DefaultDomainID).Delete(&models.NetworkDomain{}).Error)

	err := PutRouteSetting(db, nil, models.RouteModeHandwritten)
	require.ErrorIs(t, err, domainregistry.ErrManagementDomainNotRegistered)
}
