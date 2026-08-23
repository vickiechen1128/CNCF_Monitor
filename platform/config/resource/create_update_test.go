package resource

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// uuidRe 校验服务端生成的 resource_id 为 uuid v4 格式（PRD §5.2）。
var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// createUpdateTestDBCounter 为每个测试生成唯一的内存 DB 名。
var createUpdateTestDBCounter int64

// openCreateUpdateTestDB 打开逐测试的内存 SQLite，并迁移五类资源模型与
// NetworkDomain（T07-06 网域存在性校验以 M06 行政记录为准，§5.4）。
func openCreateUpdateTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&createUpdateTestDBCounter, 1)
	dsn := fmt.Sprintf("file:resource_create_update_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.NetworkDomain{},
	))
	return db
}

// mountCreateUpdate 挂载创建/更新 handler 供测试（路由收口见 T07-18，此处仅测试挂载）。
func mountCreateUpdate(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	bizStore := newBizStore(t)
	r := gin.New()
	r.POST("/api/v2/platform/resources", CreateResource(db, bizStore))
	r.PUT("/api/v2/platform/resources/:resource_id", UpdateResource(db, bizStore))
	return r
}

// seedDomain 落一条非 default 网域 fixture（M06 行政记录）。
func seedDomain(t *testing.T, db *gorm.DB, id, name string) *models.NetworkDomain {
	t.Helper()
	d := &models.NetworkDomain{
		ID:                  id,
		Name:                name,
		DomainType:          models.DomainTypeEdge,
		Channel:             models.ChannelTypeLocal,
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Status:              models.DomainStatusEnabled,
	}
	require.NoError(t, db.Create(d).Error)
	return d
}

// cuResponse 镜像创建/更新接口的统一响应信封，data 为完整资源对象。
type cuResponse struct {
	Status    string                 `json:"status"`
	ErrorType string                 `json:"errorType"`
	Error     string                 `json:"error"`
	Data      map[string]interface{} `json:"data"`
}

// doCreate 以 JSON body 请求 POST 创建接口并解码统一响应。
func doCreate(t *testing.T, r *gin.Engine, body map[string]interface{}) (*httptest.ResponseRecorder, cuResponse) {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/resources", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out cuResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// doUpdate 以 JSON body 请求 PUT 更新接口并解码统一响应。
func doUpdate(t *testing.T, r *gin.Engine, resourceID string, body map[string]interface{}) (*httptest.ResponseRecorder, cuResponse) {
	t.Helper()
	raw, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequest(http.MethodPut, "/api/v2/platform/resources/"+resourceID, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out cuResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// loadHostByResourceID 读取指定 resource_id 的 Host 行（供落库断言）。
func loadHostByResourceID(t *testing.T, db *gorm.DB, resourceID string) *models.Host {
	t.Helper()
	var h models.Host
	require.NoError(t, db.Where("resource_id = ?", resourceID).First(&h).Error)
	return &h
}

// hostBody 构造通过校验的 host 创建/更新请求体。
func hostBody() map[string]interface{} {
	return map[string]interface{}{
		"resource_category": "host",
		"network_domain_id": "default",
		"biz_code":          "infra",
		"status":            "online",
		"env":               "prod",
		"instance_name":     "web-01",
		"instance_ip":       "10.0.0.1",
		"os_type":           "Linux",
	}
}

// TestCreateResource_Host_Success 验证创建成功：服务端生成 uuid、source_type=manual、
// tenant_id 缺省 platform_admin、legacy 映射落库（instance_ip→private_ip、os_type→image、
// env→env_flag）、返回完整对象。
func TestCreateResource_Host_Success(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	w, out := doCreate(t, r, hostBody())
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "success", out.Status)
	require.NotNil(t, out.Data)

	// 服务端生成 uuid
	resourceID, _ := out.Data["resource_id"].(string)
	require.NotEmpty(t, resourceID)
	assert.Regexp(t, uuidRe, resourceID, "resource_id 应为 uuid v4")

	// 完整对象共享契约字段（§5.2）
	assert.Equal(t, "host", out.Data["resource_category"])
	assert.Equal(t, "manual", out.Data["source_type"])
	assert.Equal(t, "default", out.Data["network_domain_id"])
	assert.Equal(t, "infra", out.Data["biz_code"])
	assert.Equal(t, "prod", out.Data["env"])
	assert.Equal(t, "online", out.Data["status"])
	assert.Equal(t, "web-01", out.Data["instance_name"])
	assert.Equal(t, "10.0.0.1", out.Data["instance_ip"])
	assert.Equal(t, "Linux", out.Data["os_type"])

	// 落库断言：legacy 映射 + 共享契约列
	h := loadHostByResourceID(t, db, resourceID)
	assert.Equal(t, resourceID, h.ResourceID)
	assert.Equal(t, resourceID, h.ServerID, "Host 唯一索引需要 ServerID 非空且唯一")
	assert.Equal(t, models.SourceTypeManual, h.SourceType)
	assert.Equal(t, models.PlatformAdminTenantID, h.TenantID, "缺省 tenant_id=platform_admin")
	assert.Equal(t, "10.0.0.1", h.PrivateIP, "instance_ip → private_ip（legacy）")
	assert.Equal(t, "Linux", h.Image, "os_type → image（legacy）")
	assert.Equal(t, "prod", h.EnvFlag, "env → env_flag（legacy）")
}

// TestCreateResource_EachCategory_Success 验证五类资源创建均成功且契约一致。
func TestCreateResource_EachCategory_Success(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	cases := []struct {
		name string
		body map[string]interface{}
	}{
		{
			name: "database",
			body: map[string]interface{}{
				"resource_category": "database", "network_domain_id": "default",
				"biz_code": "payment", "app_name": "pay-db", "cluster": "pay",
				"status": "online", "env": "prod",
				"database_type": "mysql", "instance_ip": "10.0.0.10", "port": 3306,
			},
		},
		{
			name: "middleware",
			body: map[string]interface{}{
				"resource_category": "middleware", "network_domain_id": "default",
				"biz_code": "infra", "app_name": "kafka-app", "cluster": "kafka-cluster",
				"status": "online", "env": "prod",
				"middleware_type": "kafka", "instance_ip": "10.0.0.11", "port": 9092,
			},
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
		{
			name: "generic_target",
			body: map[string]interface{}{
				"resource_category": "generic_target", "network_domain_id": "default",
				"biz_code": "infra", "status": "online", "env": "prod",
				"target_name": "switch-1", "instance_ip": "10.0.0.13", "port": 161,
				"metrics_path": "/metrics", "scheme": "http", "exporter_type": "snmp_exporter",
				"custom_labels": map[string]string{"device_type": "snmp_switch"},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w, out := doCreate(t, r, tc.body)
			require.Equal(t, http.StatusOK, w.Code, "创建 %s 应成功：%s", tc.name, out.Error)
			require.Equal(t, "success", out.Status)
			assert.Equal(t, tc.name, out.Data["resource_category"])
			assert.Equal(t, "manual", out.Data["source_type"])
			resourceID, _ := out.Data["resource_id"].(string)
			assert.Regexp(t, uuidRe, resourceID)
			assert.Equal(t, tc.body["network_domain_id"], out.Data["network_domain_id"])
			assert.Equal(t, tc.body["biz_code"], out.Data["biz_code"])
			assert.Equal(t, tc.body["env"], out.Data["env"])
			assert.Equal(t, tc.body["status"], out.Data["status"])
		})
	}

	// 五类落库 tenant_id 均缺省 platform_admin
	_, out := doCreate(t, r, cases[0].body)
	resourceID, _ := out.Data["resource_id"].(string)
	var d models.Database
	require.NoError(t, db.Where("resource_id = ?", resourceID).First(&d).Error)
	assert.Equal(t, models.PlatformAdminTenantID, d.TenantID)
}

// TestCreateResource_GeneratesUniqueUUID 验证两次创建生成不同的 uuid。
func TestCreateResource_GeneratesUniqueUUID(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	_, out1 := doCreate(t, r, hostBody())
	_, out2 := doCreate(t, r, hostBody())
	id1, _ := out1.Data["resource_id"].(string)
	id2, _ := out2.Data["resource_id"].(string)
	require.Regexp(t, uuidRe, id1)
	require.Regexp(t, uuidRe, id2)
	assert.NotEqual(t, id1, id2, "每次创建应生成不同 uuid")
}

// TestCreateResource_DomainMissing 验证未登记网域 → bad_request 且带引导文案（§5.4）。
func TestCreateResource_DomainMissing(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	body := hostBody()
	body["network_domain_id"] = "dc-missing" // 非 default 且未在 NetworkDomain 登记
	w, out := doCreate(t, r, body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "dc-missing")
	assert.Contains(t, out.Error, "网域")
}

// TestCreateResource_RegisteredDomainAccepted 验证已登记网域可通过 DB 存在性校验。
func TestCreateResource_RegisteredDomainAccepted(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)
	seedDomain(t, db, "dc-1", "机房一")

	body := hostBody()
	body["network_domain_id"] = "dc-1"
	w, out := doCreate(t, r, body)
	require.Equal(t, http.StatusOK, w.Code, "已登记网域应创建成功：%s", out.Error)
	assert.Equal(t, "dc-1", out.Data["network_domain_id"])
}

// TestCreateResource_BizDisabledRejected 验证停用业务不可被新资源选用（PRD §3.1）。
func TestCreateResource_BizDisabledRejected(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	body := hostBody()
	body["biz_code"] = "legacy" // sampleYAML 中停用项
	w, out := doCreate(t, r, body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "legacy")
	assert.Contains(t, out.Error, "未登记或已停用")
}

// TestCreateResource_FieldValidationError 验证字段校验失败返回 bad_request 且错误含字段名。
func TestCreateResource_FieldValidationError(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	body := hostBody()
	body["env"] = "production" // 非法枚举
	w, out := doCreate(t, r, body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "env", "错误信息应含字段名")

	body = hostBody()
	body["instance_ip"] = "999.999.999.999" // 非法 IP
	_, out = doCreate(t, r, body)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "instance_ip")
}

// TestUpdateResource_Success 验证按 resource_id 更新可更新字段并返回完整对象。
func TestUpdateResource_Success(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	_, created := doCreate(t, r, hostBody())
	resourceID, _ := created.Data["resource_id"].(string)
	require.NotEmpty(t, resourceID)

	body := hostBody()
	body["status"] = "offline"
	body["env"] = "staging"
	body["instance_ip"] = "10.0.0.2"
	body["os_type"] = "Windows"
	w, out := doUpdate(t, r, resourceID, body)
	require.Equal(t, http.StatusOK, w.Code, "更新应成功：%s", out.Error)
	assert.Equal(t, "success", out.Status)
	require.NotNil(t, out.Data)
	assert.Equal(t, resourceID, out.Data["resource_id"], "resource_id 更新后不可变")
	assert.Equal(t, "offline", out.Data["status"])
	assert.Equal(t, "staging", out.Data["env"])
	assert.Equal(t, "10.0.0.2", out.Data["instance_ip"])
	assert.Equal(t, "Windows", out.Data["os_type"])
	assert.Equal(t, "host", out.Data["resource_category"])
	assert.Equal(t, "manual", out.Data["source_type"])

	h := loadHostByResourceID(t, db, resourceID)
	assert.Equal(t, "offline", h.Status)
	assert.Equal(t, "staging", h.EnvFlag)
	assert.Equal(t, "10.0.0.2", h.PrivateIP)
	assert.Equal(t, "Windows", h.Image)
	assert.Equal(t, models.SourceTypeManual, h.SourceType)
}

// TestUpdateResource_NotFound 验证不存在/已软删资源更新 → not_found。
func TestUpdateResource_NotFound(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	w, out := doUpdate(t, r, "not-exist", hostBody())
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Contains(t, out.Error, "not-exist")

	// 已软删资源同样 not_found
	_, created := doCreate(t, r, hostBody())
	resourceID, _ := created.Data["resource_id"].(string)
	require.NoError(t, db.Delete(&models.Host{}, "resource_id = ?", resourceID).Error)
	w, out = doUpdate(t, r, resourceID, hostBody())
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", out.ErrorType)
}

// TestUpdateResource_ResourceIDImmutable 验证更新后 resource_id 保持不变。
func TestUpdateResource_ResourceIDImmutable(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	_, created := doCreate(t, r, hostBody())
	resourceID, _ := created.Data["resource_id"].(string)

	body := hostBody()
	body["status"] = "maintenance"
	_, out := doUpdate(t, r, resourceID, body)
	require.Equal(t, "success", out.Status)
	assert.Equal(t, resourceID, out.Data["resource_id"])

	h := loadHostByResourceID(t, db, resourceID)
	assert.Equal(t, resourceID, h.ResourceID, "resource_id 不可被更新修改")
	assert.Equal(t, resourceID, h.ServerID)
}

// TestUpdateResource_CategoryChangeRejected 验证 resource_category 变更被拒（§5.2）。
func TestUpdateResource_CategoryChangeRejected(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	_, created := doCreate(t, r, hostBody())
	resourceID, _ := created.Data["resource_id"].(string)

	body := hostBody()
	body["resource_category"] = "database"
	w, out := doUpdate(t, r, resourceID, body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "resource_category")

	h := loadHostByResourceID(t, db, resourceID)
	assert.Equal(t, models.ResourceCategoryHost, h.ResourceCategory, "resource_category 不应被修改")
}

// TestUpdateResource_SourceTypeChangeRejected 验证 source_type 不可改。
func TestUpdateResource_SourceTypeChangeRejected(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	_, created := doCreate(t, r, hostBody())
	resourceID, _ := created.Data["resource_id"].(string)

	body := hostBody()
	body["source_type"] = "import"
	w, out := doUpdate(t, r, resourceID, body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "source_type")
}

// TestUpdateResource_DomainValidationSameAsPost 验证更新时网域/biz 校验与 POST 一致。
func TestUpdateResource_DomainValidationSameAsPost(t *testing.T) {
	db := openCreateUpdateTestDB(t)
	r := mountCreateUpdate(t, db)

	_, created := doCreate(t, r, hostBody())
	resourceID, _ := created.Data["resource_id"].(string)

	body := hostBody()
	body["network_domain_id"] = "dc-missing"
	w, out := doUpdate(t, r, resourceID, body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "网域")

	// 停用 biz 同样拒绝
	body = hostBody()
	body["biz_code"] = "legacy"
	w, out = doUpdate(t, r, resourceID, body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "legacy")
}
