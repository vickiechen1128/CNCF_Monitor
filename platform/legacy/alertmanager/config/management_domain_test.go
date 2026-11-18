package config

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/domainregistry"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
)

// alertmanager.yml 恒属中心直连域（决策 60）。中心直连域按需登记后，未登记时
// 挂载必须明确拒绝，不能写入一条永远无法生成变更单的版本。
func TestSubmitRejectsWhenManagementDomainMissing(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	require.NoError(t, db.Unscoped().Where("id = ?", models.DefaultDomainID).Delete(&models.NetworkDomain{}).Error)

	_, err := Submit(db, validAMConfig, "tester")
	require.ErrorIs(t, err, domainregistry.ErrManagementDomainNotRegistered)
}
