package dictionary

import (
	"context"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestEnsureDeclarations(t *testing.T) {
	db, err := gorm.Open(postgres.Open(testdb.DSN(t)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.BusinessDomain{}, &models.ApplicationDict{}, &models.PlatformDict{}))

	repo := NewGORMRepository(db)
	require.NoError(t, repo.EnsureDeclarations(context.Background(),
		[]DeclaredEntry{{Code: "payment", Name: "支付"}},
		[]DeclaredEntry{{Code: "order-service", Name: "订单服务"}},
		[]DeclaredEntry{{Code: "ecommerce", Name: "电商平台"}},
	))

	var biz models.BusinessDomain
	require.NoError(t, db.Where("code = ?", "payment").First(&biz).Error)
	assert.True(t, biz.Enabled)
	assert.Equal(t, models.DictSourceExcelImport, biz.Source)

	var app models.ApplicationDict
	require.NoError(t, db.Where("app_code = ?", "order-service").First(&app).Error)
	assert.Equal(t, models.AppStatusEnabled, app.Status)

	var platform models.PlatformDict
	require.NoError(t, db.Where("platform_code = ?", "ecommerce").First(&platform).Error)
	assert.True(t, platform.Enabled)

	// Idempotent with the same names.
	require.NoError(t, repo.EnsureDeclarations(context.Background(),
		[]DeclaredEntry{{Code: "payment", Name: "支付"}},
		[]DeclaredEntry{{Code: "order-service", Name: "订单服务"}},
		[]DeclaredEntry{{Code: "ecommerce", Name: "电商平台"}},
	))

	// Name mismatch is rejected.
	require.Error(t, repo.EnsureDeclarations(context.Background(),
		[]DeclaredEntry{{Code: "payment", Name: "另一个名字"}}, nil, nil))
}
