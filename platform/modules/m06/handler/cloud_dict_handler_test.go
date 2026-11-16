package handler

import (
	"net/http"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

// newCloudDictTestRouter mounts the M06 v3 routes with the cloud dictionary
// handler wired (D37).
func newCloudDictTestRouter(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m06_cloud.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	domainSvc := service.NewNetworkDomainService(
		repository.NewGORMNetworkDomainRepository(gormDB),
		repository.NewGORMDictionaryRepository(gormDB),
		references.NewGORMM07Reader(gormDB),
		references.NoopMonitoring{},
	)
	RegisterRoutes(router.Group("/api/v3/platform"), Handlers{
		Tenants:   NewTenantHandler(service.NewTenantService(repository.NewGORMRepository(gormDB))),
		Domains:   NewNetworkDomainHandler(domainSvc),
		Users:     NewUserHandler(service.NewUserService(repository.NewGORMUserRepository(gormDB))),
		LoginLogs: NewLoginLogHandler(service.NewLoginLogService(repository.NewGORMLoginLogRepository(gormDB))),
		Clouds:    NewCloudDictHandler(service.NewCloudDictService(repository.NewGORMCloudDictRepository(gormDB))),
	})
	return router, gormDB
}

// TestCloudDictCreateAndDisable covers the D37 happy path: create is enabled by
// default and disable flips only the enabled flag.
func TestCloudDictCreateAndDisable(t *testing.T) {
	router, gormDB := newCloudDictTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/cloud-dict",
		`{"cloud_code":"IND-CM","cloud_name":"行业云（移动）","cloud_type":"IND","carrier":"CM","description":"新增"}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, "IND-CM", data["cloud_code"])
	assert.Equal(t, "行业云（移动）", data["cloud_name"])
	assert.Equal(t, "IND", data["cloud_type"])
	assert.Equal(t, "CM", data["carrier"])
	assert.Equal(t, true, data["enabled"], "新增默认启用")

	var row models.CloudDict
	require.NoError(t, gormDB.Where("cloud_code = ?", "IND-CM").First(&row).Error)
	assert.True(t, row.Enabled)

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/IND-CM", `{"enabled":false}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["enabled"])

	require.NoError(t, gormDB.Where("cloud_code = ?", "IND-CM").First(&row).Error)
	assert.False(t, row.Enabled)
	assert.Equal(t, "行业云（移动）", row.CloudName, "停用不改属性")
}

// TestCloudDictCreateValidation covers composite-code validation and duplicates.
func TestCloudDictCreateValidation(t *testing.T) {
	router, _ := newCloudDictTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/cloud-dict",
		`{"cloud_code":"PUB-TX","cloud_name":"腾讯云","cloud_type":"PUB","carrier":"TX"}`)
	require.Equal(t, http.StatusOK, code, out)

	// 重名 → 409（编码不可变，不可重建）
	code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/cloud-dict",
		`{"cloud_code":"PUB-TX","cloud_name":"重复","cloud_type":"PUB","carrier":"TX"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	cases := []string{
		`{"cloud_code":"PUB-XX","cloud_name":"x","cloud_type":"PUB","carrier":"TX"}`,
		`{"cloud_code":"PUB-TX","cloud_name":"x","cloud_type":"GM","carrier":"CU"}`,
		`{"cloud_code":"PUB-TX","cloud_name":"","cloud_type":"PUB","carrier":"TX"}`,
		`{"cloud_code":"PUB-TX","cloud_name":"x","cloud_type":"PUB","carrier":"TX","enabled":false}`,
	}
	for _, body := range cases {
		code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/cloud-dict", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}
}

// TestCloudDictDisableGuards covers in-use rejection, not-found and the
// disable-only contract.
func TestCloudDictDisableGuards(t *testing.T) {
	router, gormDB := newCloudDictTestRouter(t, adminUser())

	for _, body := range []string{
		`{"cloud_code":"PUB-TX","cloud_name":"腾讯云","cloud_type":"PUB","carrier":"TX"}`,
		`{"cloud_code":"GM-CU","cloud_name":"政务云（联通）","cloud_type":"GM","carrier":"CU"}`,
	} {
		code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/cloud-dict", body)
		require.Equal(t, http.StatusOK, code, out)
	}
	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: "mc-ref", Name: "引用网域", DomainType: models.DomainTypeEdge,
		ZoneType: "beijing", CloudCode: "GM-CU",
		TenantID: models.PlatformAdminTenantID, Channel: models.ChannelTypeAgentPull,
		Status: models.DomainStatusEnabled,
	}).Error)

	// 被网域引用 → 409
	code, out := doRequest(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/GM-CU", `{"enabled":false}`)
	assert.Equal(t, http.StatusConflict, code, out)

	// 不存在 → 404
	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/NOPE-XX", `{"enabled":false}`)
	assert.Equal(t, http.StatusNotFound, code, out)

	// 仅支持停用：enabled=true 或缺省 → 400
	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/PUB-TX", `{"enabled":true}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/PUB-TX", `{}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// 停用幂等：二次停用仍 200
	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/PUB-TX", `{"enabled":false}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/PUB-TX", `{"enabled":false}`)
	assert.Equal(t, http.StatusOK, code, out)
}

// TestCloudDictRequiresAdmin ensures the maintenance routes stay behind RequireAdmin.
func TestCloudDictRequiresAdmin(t *testing.T) {
	viewer := &models.User{Role: models.UserRoleUser, Status: models.UserStatusActive}
	router, _ := newCloudDictTestRouter(t, viewer)

	code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/cloud-dict",
		`{"cloud_code":"PRI-TX","cloud_name":"私有云","cloud_type":"PRI","carrier":"TX"}`)
	assert.Equal(t, http.StatusForbidden, code, out)
	assert.Equal(t, "forbidden", out["errorType"])
}
