package domainregistry

import (
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var dbSeq int64

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&dbSeq, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:domainregistry_%d?mode=memory&cache=shared", n)), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.NetworkDomain{}))
	return db
}

func TestManagementDomainNotRegistered(t *testing.T) {
	db := newTestDB(t)
	_, err := ManagementDomain(db)
	require.ErrorIs(t, err, ErrManagementDomainNotRegistered)

	_, err = ManagementDomainID(db)
	require.ErrorIs(t, err, ErrManagementDomainNotRegistered)
}

func TestManagementDomainResolvesSingleton(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: models.DefaultDomainID, Name: "中心直连域",
		DomainType: models.DomainTypeManagement, Channel: models.ChannelTypeLocal,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusEnabled,
	}).Error)

	dom, err := ManagementDomain(db)
	require.NoError(t, err)
	assert.Equal(t, models.DefaultDomainID, dom.ID)

	id, err := ManagementDomainID(db)
	require.NoError(t, err)
	assert.Equal(t, models.DefaultDomainID, id)
}

func TestManagementDomainDeletedIsTreatedAsAbsent(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: models.DefaultDomainID, Name: "中心直连域",
		DomainType: models.DomainTypeManagement, Channel: models.ChannelTypeLocal,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusEnabled,
	}).Error)
	require.NoError(t, db.Where("id = ?", models.DefaultDomainID).Delete(&models.NetworkDomain{}).Error)

	_, err := ManagementDomain(db)
	require.ErrorIs(t, err, ErrManagementDomainNotRegistered)
}

func TestManagementDomainInvariantViolation(t *testing.T) {
	db := newTestDB(t)
	for _, id := range []string{"mgmt-a", "mgmt-b"} {
		require.NoError(t, db.Create(&models.NetworkDomain{
			ID: id, Name: id, DomainType: models.DomainTypeManagement,
			Channel: models.ChannelTypeLocal, TenantID: models.PlatformAdminTenantID,
			Status: models.DomainStatusEnabled,
		}).Error)
	}
	_, err := ManagementDomain(db)
	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrManagementDomainNotRegistered)
}
