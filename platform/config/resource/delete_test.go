package resource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// deleteTestDBCounter 为每个测试生成唯一的内存 DB 名。
var deleteTestDBCounter int64

// openDeleteTestDB 打开逐测试的内存 SQLite，迁移五类资源模型、NetworkDomain 与
// ResourceLabel（删除前置清理标签需要该表，见 delete.go 说明）。
func openDeleteTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&deleteTestDBCounter, 1)
	dsn := fmt.Sprintf("file:resource_delete_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.NetworkDomain{},
		&models.ResourceLabel{},
	))
	return db
}

// mountDelete 挂载创建 + 删除 handler 供测试（路由收口见 T07-18，此处仅测试挂载）。
func mountDelete(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v2/platform/resources", CreateResource(db, newBizStore(t)))
	r.DELETE("/api/v2/platform/resources/:resource_id", DeleteResource(db))
	return r
}

// delResponse 镜像删除接口的统一响应信封，data 为 {resource_id}（PRD §6.6.1）。
type delResponse struct {
	Status    string            `json:"status"`
	ErrorType string            `json:"errorType"`
	Error     string            `json:"error"`
	Data      map[string]string `json:"data"`
}

// doDelete 请求 DELETE 删除接口并解码统一响应。
func doDelete(t *testing.T, r *gin.Engine, resourceID string) (*httptest.ResponseRecorder, delResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/api/v2/platform/resources/"+resourceID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out delResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// deleteCreate 经创建接口落一条资源并返回其 resource_id。
func deleteCreate(t *testing.T, r *gin.Engine, body map[string]interface{}) string {
	t.Helper()
	_, out := doCreate(t, r, body)
	require.Equal(t, "success", out.Status, "创建前置失败：%s", out.Error)
	id, _ := out.Data["resource_id"].(string)
	require.NotEmpty(t, id)
	return id
}

// assertSoftDeleted 验证资源已软删：正常查询（GORM 自动排除软删）不可见，
// Unscoped 可见且 DeletedAt 置位（BaseModel 体系软删断言，PRD §6.6.1）。
// 按 resource_category 路由到对应资源表做落库断言。
func assertSoftDeleted(t *testing.T, db *gorm.DB, category, resourceID string) {
	t.Helper()
	switch category {
	case "host":
		var h models.Host
		assert.ErrorIs(t, db.Where("resource_id = ?", resourceID).First(&h).Error, gorm.ErrRecordNotFound)
		var soft models.Host
		require.NoError(t, db.Unscoped().Where("resource_id = ?", resourceID).First(&soft).Error)
		assert.True(t, soft.DeletedAt.Valid, "资源应软删（DeletedAt 置位）")
	case "application":
		var a models.Application
		assert.ErrorIs(t, db.Where("resource_id = ?", resourceID).First(&a).Error, gorm.ErrRecordNotFound)
		var soft models.Application
		require.NoError(t, db.Unscoped().Where("resource_id = ?", resourceID).First(&soft).Error)
		assert.True(t, soft.DeletedAt.Valid, "资源应软删（DeletedAt 置位）")
	default:
		t.Fatalf("assertSoftDeleted 未覆盖 category %q", category)
	}
}

// TestDeleteResource_Success 验证删除成功：返回 {resource_id}，资源软删
// （BaseModel.DeletedAt 置位）后正常查询不可见、Unscoped 可见且 DeletedAt 有效。
func TestDeleteResource_Success(t *testing.T) {
	cases := []struct {
		name string
		body map[string]interface{}
	}{
		{
			name: "host",
			body: hostBody(),
		},
		{
			name: "application",
			body: map[string]interface{}{
				"resource_category": "application", "network_domain_id": "default",
				"biz_code": "payment", "app_name": "pay-service", "cluster": "pay-cluster",
				"status": "online", "env": "prod",
				"service_name": "pay-service", "endpoint": "10.0.0.12:8080",
				"health_check_url": "http://10.0.0.12:8080/health", "protocol": "http", "port": 8080,
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := openDeleteTestDB(t)
			r := mountDelete(t, db)
			resourceID := deleteCreate(t, r, tc.body)

			w, out := doDelete(t, r, resourceID)
			require.Equal(t, http.StatusOK, w.Code, "删除应成功：%s", out.Error)
			assert.Equal(t, "success", out.Status)
			require.NotNil(t, out.Data)
			assert.Equal(t, resourceID, out.Data["resource_id"])

			assertSoftDeleted(t, db, tc.body["resource_category"].(string), resourceID)
		})
	}
}

// TestDeleteResource_NotFound 验证不存在的 resource_id 删除 → not_found。
func TestDeleteResource_NotFound(t *testing.T) {
	db := openDeleteTestDB(t)
	r := mountDelete(t, db)

	w, out := doDelete(t, r, "not-exist")
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Contains(t, out.Error, "not-exist")
}

// TestDeleteResource_DoubleDelete 验证二次删除返回 not_found（已软删资源
// 不再被定位，findResourceByID 默认排除软删，PRD §6.6.1）。
func TestDeleteResource_DoubleDelete(t *testing.T) {
	db := openDeleteTestDB(t)
	r := mountDelete(t, db)
	resourceID := deleteCreate(t, r, hostBody())

	w, out := doDelete(t, r, resourceID)
	require.Equal(t, http.StatusOK, w.Code, "首次删除应成功：%s", out.Error)
	assert.Equal(t, "success", out.Status)

	w, out = doDelete(t, r, resourceID)
	require.Equal(t, http.StatusNotFound, w.Code, "二次删除应 not_found")
	assert.Equal(t, "not_found", out.ErrorType)
}

// TestDeleteResource_CleansResourceLabels 验证删除前置物理清理该资源下的
// ResourceLabel（user/system 均清理，物理删除不残留，见 delete.go 说明）。
func TestDeleteResource_CleansResourceLabels(t *testing.T) {
	db := openDeleteTestDB(t)
	r := mountDelete(t, db)
	resourceID := deleteCreate(t, r, hostBody())

	// 直插该资源的 user + system 标签
	require.NoError(t, db.Create(&models.ResourceLabel{
		ResourceID: resourceID, Key: "team", Value: "pay", Source: models.LabelSourceUser,
	}).Error)
	require.NoError(t, db.Create(&models.ResourceLabel{
		ResourceID: resourceID, Key: "app", Value: "web", Source: models.LabelSourceSystem,
	}).Error)

	w, out := doDelete(t, r, resourceID)
	require.Equal(t, http.StatusOK, w.Code, "删除应成功：%s", out.Error)
	assert.Equal(t, "success", out.Status)

	// 物理删除断言：Unscoped 也查不到残留标签
	var count int64
	require.NoError(t, db.Unscoped().Model(&models.ResourceLabel{}).
		Where("resource_id = ?", resourceID).Count(&count).Error)
	assert.Zero(t, count, "删除资源应物理清理其 ResourceLabel")
}
