package resource

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// importTestDBCounter 为每个测试生成唯一的内存 DB 名，避免同包内测试共享同一库。
var importTestDBCounter int64

// openImportTestDB 打开逐测试的内存 SQLite，并迁移五类资源模型、NetworkDomain
// （导入行级校验以 M06 行政记录为准，§5.4）与 ImportRecord（§6.4）。
func openImportTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&importTestDBCounter, 1)
	dsn := fmt.Sprintf("file:resource_import_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.NetworkDomain{},
		&models.ImportRecord{},
	))
	return db
}

// mountImport 挂载导入执行与导入记录查询 handler 供测试（路由收口见 T07-18）。
func mountImport(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v2/platform/resources/:type/import", ImportResources(db, newBizStore(t)))
	r.GET("/api/v2/platform/imports", ListImports(db))
	r.GET("/api/v2/platform/imports/:import_id", GetImportRecord(db))
	return r
}

// seedHostImport 落一条主机 fixture 用于判重测试：判重键 host|default|<ip>
// 依赖 network_domain_id + private_ip（instance_ip 的 legacy 列）。
func seedHostImport(t *testing.T, db *gorm.DB, id, ip, instanceName, status string) *models.Host {
	t.Helper()
	h := &models.Host{
		ResourceID:       id,
		ServerID:         id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  models.DefaultDomainID,
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		TenantID:         models.PlatformAdminTenantID,
		InstanceName:     instanceName,
		Status:           status,
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		PrivateIP:        ip,
	}
	require.NoError(t, db.Create(h).Error)
	return h
}

// seedImportRecord 直接落一条导入记录 fixture（供列表/详情/分页筛选测试）。
func seedImportRecord(t *testing.T, db *gorm.DB, importNo string, category models.ResourceCategory, status models.ImportStatus) *models.ImportRecord {
	t.Helper()
	rec := &models.ImportRecord{
		ImportNo:         importNo,
		ResourceCategory: category,
		Mode:             models.ImportModeCreateOnly,
		Total:            1,
		Success:          1,
		Failed:           0,
		Status:           status,
		Operator:         models.PlatformAdminTenantID,
	}
	require.NoError(t, db.Create(rec).Error)
	return rec
}

// importResponse 镜像导入接口的统一响应信封，data 为 §5.16.3 结构。
type importResponse struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		Total   int                        `json:"total"`
		Success int                        `json:"success"`
		Updated int                        `json:"updated"`
		Failed  int                        `json:"failed"`
		Errors  []models.ImportErrorDetail `json:"errors"`
	} `json:"data"`
}

// doImportUpload 以 multipart/form-data 请求导入接口并解码统一响应。
func doImportUpload(t *testing.T, r *gin.Engine, typeName string, fileBytes []byte, form map[string]string) (*httptest.ResponseRecorder, importResponse) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", "data.xlsx")
	require.NoError(t, err)
	_, err = fw.Write(fileBytes)
	require.NoError(t, err)
	for k, v := range form {
		require.NoError(t, w.WriteField(k, v))
	}
	require.NoError(t, w.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/resources/"+typeName+"/import", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	ww := httptest.NewRecorder()
	r.ServeHTTP(ww, req)

	var out importResponse
	require.NoError(t, json.Unmarshal(ww.Body.Bytes(), &out))
	return ww, out
}

// doListImports 以指定 query 请求导入记录列表并解码统一响应。
func doListImports(t *testing.T, r *gin.Engine, query string) (*httptest.ResponseRecorder, importListResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/imports"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out importListResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// importListResponse 镜像导入记录列表接口的统一响应信封。
type importListResponse struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		List     []models.ImportRecord `json:"list"`
		Total    int64                 `json:"total"`
		Page     int                   `json:"page"`
		PageSize int                   `json:"page_size"`
	} `json:"data"`
}

// doGetImport 以指定 import_id 请求导入详情并解码统一响应。
func doGetImport(t *testing.T, r *gin.Engine, importID string) (*httptest.ResponseRecorder, importDetailResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/imports/"+importID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out importDetailResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// importDetailResponse 镜像导入详情接口的统一响应信封，data 为 ImportRecord（含 errors）。
type importDetailResponse struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		ImportNo         string                     `json:"import_no"`
		ResourceCategory string                     `json:"resource_category"`
		Mode             string                     `json:"mode"`
		Total            int                        `json:"total"`
		Success          int                        `json:"success"`
		Updated          int                        `json:"updated"`
		Failed           int                        `json:"failed"`
		Status           string                     `json:"status"`
		Operator         string                     `json:"operator"`
		Errors           []models.ImportErrorDetail `json:"errors"`
	} `json:"data"`
}

// loadLatestImport 读取最近一条 ImportRecord（按 id 倒序），供落库断言。
func loadLatestImport(t *testing.T, db *gorm.DB) *models.ImportRecord {
	t.Helper()
	var rec models.ImportRecord
	require.NoError(t, db.Order("id desc").First(&rec).Error)
	return &rec
}

// countHosts 统计当前主机总数。
func countHosts(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.Host{}).Count(&n).Error)
	return n
}

// hostRow 构造一行 host Excel 数据：给定 instance_ip，其余列取 baseValues。
func hostRow(ip, status string) []string {
	vals := baseValues(models.ResourceCategoryHost)
	vals["instance_ip"] = ip
	if status != "" {
		vals["status"] = status
	}
	return makeRow(models.ResourceCategoryHost, vals)
}

// ---------------------------------------------------------------------------
// POST import：create_only 模式
// ---------------------------------------------------------------------------

func TestImportResource_CreateOnly_Success(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{
		hostRow("10.0.0.1", "运行中"),
		hostRow("10.0.0.2", "已停止"),
	})
	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusOK, w.Code, "导入应成功：%s", out.Error)
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, 2, out.Data.Total)
	assert.Equal(t, 2, out.Data.Success)
	assert.Equal(t, 0, out.Data.Failed)
	assert.Empty(t, out.Data.Errors)
	assert.False(t, strings.Contains(w.Body.String(), `"updated"`), "create_only 不应返回 updated 字段（§5.16.3）")

	// 落库断言：两行均创建，source_type=import（§5.2）。
	assert.Equal(t, int64(2), countHosts(t, db))
	var h1, h2 models.Host
	require.NoError(t, db.Where("private_ip = ?", "10.0.0.1").First(&h1).Error)
	require.NoError(t, db.Where("private_ip = ?", "10.0.0.2").First(&h2).Error)
	assert.Equal(t, models.SourceTypeImport, h1.SourceType)
	assert.Equal(t, models.SourceTypeImport, h2.SourceType)
	assert.Equal(t, models.ResourceStatusOnline, models.ResourceStatus(h1.Status), "运行中→online")
	assert.Equal(t, models.ResourceStatusOffline, models.ResourceStatus(h2.Status), "已停止→offline")

	// ImportRecord 落库（§6.4）。
	rec := loadLatestImport(t, db)
	assert.Equal(t, models.ResourceCategoryHost, rec.ResourceCategory)
	assert.Equal(t, models.ImportModeCreateOnly, rec.Mode)
	assert.Equal(t, 2, rec.Total)
	assert.Equal(t, 2, rec.Success)
	assert.Equal(t, 0, rec.Failed)
	assert.Equal(t, models.ImportStatusSuccess, rec.Status)
	assert.Equal(t, models.PlatformAdminTenantID, rec.Operator, "MVP 操作人固定 platform_admin")
	assert.NotEmpty(t, rec.ImportNo)
}

func TestImportResource_CreateOnly_DuplicateFails(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)
	seedHostImport(t, db, "host-seed-1", "10.0.0.1", "web-01", "online")

	// 第 2 行命中判重键（network_domain=default + instance_ip=10.0.0.1），第 3 行为新 IP。
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{
		hostRow("10.0.0.1", "运行中"),
		hostRow("10.0.0.2", "运行中"),
	})
	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusOK, w.Code, "部分失败仍返回 200（部分成功不整体回滚）")
	assert.Equal(t, 2, out.Data.Total)
	assert.Equal(t, 1, out.Data.Success, "仅新 IP 新建")
	assert.Equal(t, 1, out.Data.Failed, "判重命中计入 failed")
	require.Len(t, out.Data.Errors, 1)
	assert.Equal(t, 2, out.Data.Errors[0].Row)
	assert.Equal(t, "host", out.Data.Errors[0].ResourceCategory)
	assert.Equal(t, "dedup_key", out.Data.Errors[0].Field)
	assert.Contains(t, out.Data.Errors[0].Reason, "已存在")

	// 失败行不写入：总量仍为 2（1 条预置 + 1 条新导入）。
	assert.Equal(t, int64(2), countHosts(t, db))

	// ImportRecord：partial + errors 明细。
	rec := loadLatestImport(t, db)
	assert.Equal(t, models.ImportStatusPartial, rec.Status)
	assert.Equal(t, 1, rec.Success)
	assert.Equal(t, 1, rec.Failed)
	require.Len(t, rec.Errors, 1)
	assert.Equal(t, "dedup_key", rec.Errors[0].Field)
}

// ---------------------------------------------------------------------------
// POST import：upsert 模式
// ---------------------------------------------------------------------------

func TestImportResource_Upsert_UpdatesExisting(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)
	seedHostImport(t, db, "host-seed-1", "10.0.0.1", "web-01", "online")

	// 同一判重键（default + 10.0.0.1），instance_name 与 status 变更 → 覆盖更新。
	vals := baseValues(models.ResourceCategoryHost)
	vals["instance_ip"] = "10.0.0.1"
	vals["instance_name"] = "web-01-renamed"
	vals["hostname"] = "web-01-renamed"
	vals["status"] = "已停止"
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{makeRow(models.ResourceCategoryHost, vals)})

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "upsert",
	})
	require.Equal(t, http.StatusOK, w.Code, "导入应成功：%s", out.Error)
	assert.Equal(t, 1, out.Data.Total)
	assert.Equal(t, 0, out.Data.Success, "命中判重键不新建")
	assert.Equal(t, 1, out.Data.Updated, "命中判重键覆盖更新 updated++")
	assert.Equal(t, 0, out.Data.Failed)
	assert.Contains(t, w.Body.String(), `"updated"`, "upsert 应返回 updated 字段（§5.16.3）")

	// 覆盖更新落库断言：仍 1 条主机，字段已更新，source_type 保持 manual（不可改）。
	assert.Equal(t, int64(1), countHosts(t, db))
	var h models.Host
	require.NoError(t, db.Where("resource_id = ?", "host-seed-1").First(&h).Error)
	assert.Equal(t, "web-01-renamed", h.InstanceName)
	assert.Equal(t, models.ResourceStatusOffline, models.ResourceStatus(h.Status), "已停止→offline")
	assert.Equal(t, models.SourceTypeManual, h.SourceType, "source_type 创建后不可改")

	// ImportRecord：updated=1、status success。
	rec := loadLatestImport(t, db)
	assert.Equal(t, models.ImportModeUpsert, rec.Mode)
	assert.Equal(t, 1, rec.Updated)
	assert.Equal(t, 0, rec.Success)
	assert.Equal(t, models.ImportStatusSuccess, rec.Status)
}

func TestImportResource_Upsert_Mixed(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)
	seedHostImport(t, db, "host-seed-1", "10.0.0.1", "web-01", "online")

	// 第 2 行命中（更新），第 3 行新 IP（新建）。
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{
		hostRow("10.0.0.1", "已停止"),
		hostRow("10.0.0.3", "运行中"),
	})
	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "upsert",
	})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, 2, out.Data.Total)
	assert.Equal(t, 1, out.Data.Success, "未命中新建 success++")
	assert.Equal(t, 1, out.Data.Updated, "命中更新 updated++")
	assert.Equal(t, 0, out.Data.Failed)

	assert.Equal(t, int64(2), countHosts(t, db))
	var h models.Host
	require.NoError(t, db.Where("resource_id = ?", "host-seed-1").First(&h).Error)
	assert.Equal(t, models.ResourceStatusOffline, models.ResourceStatus(h.Status))
	var created models.Host
	require.NoError(t, db.Where("private_ip = ?", "10.0.0.3").First(&created).Error)
	assert.Equal(t, models.SourceTypeImport, created.SourceType, "新导入资源 source_type=import")
}

// ---------------------------------------------------------------------------
// POST import：非法输入与文件格式
// ---------------------------------------------------------------------------

func TestImportResource_InvalidMode(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{hostRow("10.0.0.1", "运行中")})

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "bogus",
	})
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "mode")
	assert.Equal(t, int64(0), countHosts(t, db), "非法 mode 不落任何资源")
}

func TestImportResource_UnknownCategory(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{hostRow("10.0.0.1", "运行中")})

	w, out := doImportUpload(t, r, "bogus", xlsx, map[string]string{
		"resource_category": "bogus",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "resource_category")
}

func TestImportResource_TypeFromPathFallback(t *testing.T) {
	// 前端 F1 仅传 file+mode，资源类型取自路径 :type（T07-18 路由）。
	db := openImportTestDB(t)
	r := mountImport(t, db)
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{hostRow("10.0.0.1", "运行中")})

	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{"mode": "create_only"})
	require.Equal(t, http.StatusOK, w.Code, "resource_category 缺省时应回退路径 :type：%s", out.Error)
	assert.Equal(t, 1, out.Data.Success)
	assert.Equal(t, int64(1), countHosts(t, db))
}

func TestImportResource_InvalidFileFormat(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	w, out := doImportUpload(t, r, "host", []byte("this is not a valid xlsx"), map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "Excel")
	assert.Equal(t, int64(0), countHosts(t, db))
}

func TestImportResource_MissingFile(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	require.NoError(t, w.WriteField("resource_category", "host"))
	require.NoError(t, w.WriteField("mode", "create_only"))
	require.NoError(t, w.Close())
	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/resources/host/import", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	ww := httptest.NewRecorder()
	r.ServeHTTP(ww, req)
	var out importResponse
	require.NoError(t, json.Unmarshal(ww.Body.Bytes(), &out))
	require.Equal(t, http.StatusBadRequest, ww.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "file")
}

func TestImportResource_OversizedFileRejected(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	// 超过 10MB 限制的文件应被拒绝（防恶意超大 xlsx 内存耗尽）。
	w, out := doImportUpload(t, r, "host", make([]byte, maxImportFileSize+1), map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "10MB")
	assert.Equal(t, int64(0), countHosts(t, db))
}

// ---------------------------------------------------------------------------
// POST import：行级校验失败（错误行不写入，部分成功不整体回滚）
// ---------------------------------------------------------------------------

func TestImportResource_InvalidRowsFailWithoutWrite(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	bad := baseValues(models.ResourceCategoryHost)
	bad["instance_ip"] = "999.999.999.999" // 第 3 行非法 IP
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{
		hostRow("10.0.0.1", "运行中"), // 第 2 行合法
		makeRow(models.ResourceCategoryHost, bad),
	})
	w, out := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusOK, w.Code, "部分失败仍返回 200")
	assert.Equal(t, 2, out.Data.Total)
	assert.Equal(t, 1, out.Data.Success)
	assert.Equal(t, 1, out.Data.Failed)
	require.Len(t, out.Data.Errors, 1)
	assert.Equal(t, 3, out.Data.Errors[0].Row, "错误行号=3（§5.16.3 row 从 2 起始）")
	assert.Equal(t, "instance_ip", out.Data.Errors[0].Field)
	assert.Equal(t, "999.999.999.999", out.Data.Errors[0].Value)

	// 失败行不写入：仅合法行落库。
	assert.Equal(t, int64(1), countHosts(t, db))

	// ImportRecord：partial + errors 明细（§6.4）。
	rec := loadLatestImport(t, db)
	assert.Equal(t, models.ImportStatusPartial, rec.Status)
	assert.Equal(t, 1, rec.Success)
	assert.Equal(t, 1, rec.Failed)
	require.Len(t, rec.Errors, 1)
	assert.Equal(t, "999.999.999.999", rec.Errors[0].Value)
}

func TestImportResource_EmptyFileData(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	// 仅表头、无数据行：total=0，无失败，不落任何资源。
	w, out := doImportUpload(t, r, "host", buildXLSX(t, models.ResourceCategoryHost, nil), map[string]string{
		"resource_category": "host",
		"mode":              "create_only",
	})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, 0, out.Data.Total)
	assert.Equal(t, 0, out.Data.Success)
	assert.Equal(t, 0, out.Data.Failed)
	assert.Equal(t, int64(0), countHosts(t, db))
	rec := loadLatestImport(t, db)
	assert.Equal(t, models.ImportStatusSuccess, rec.Status)
	assert.Equal(t, 0, rec.Total)
}

// ---------------------------------------------------------------------------
// GET /imports：列表（分页/筛选）与 GET /imports/:import_id 详情
// ---------------------------------------------------------------------------

func TestListImports_FilterAndPagination(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)
	seedImportRecord(t, db, "IMP-001", models.ResourceCategoryHost, models.ImportStatusSuccess)
	seedImportRecord(t, db, "IMP-002", models.ResourceCategoryHost, models.ImportStatusPartial)
	seedImportRecord(t, db, "IMP-003", models.ResourceCategoryApplication, models.ImportStatusSuccess)

	// 无筛选：3 条。
	_, out := doListImports(t, r, "")
	require.Equal(t, "success", out.Status)
	assert.Equal(t, int64(3), out.Data.Total)
	assert.Len(t, out.Data.List, 3)
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, DefaultPageSize, out.Data.PageSize)

	// 按 resource_category 筛选。
	_, out = doListImports(t, r, "?resource_category=host")
	assert.Equal(t, int64(2), out.Data.Total)
	assert.Len(t, out.Data.List, 2)

	// 按 status 筛选。
	_, out = doListImports(t, r, "?status=partial")
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "IMP-002", out.Data.List[0].ImportNo)

	// 组合筛选。
	_, out = doListImports(t, r, "?resource_category=host&status=partial")
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "IMP-002", out.Data.List[0].ImportNo)

	// 分页：page_size=1 取第一页。
	_, out = doListImports(t, r, "?page=1&page_size=1")
	assert.Equal(t, int64(3), out.Data.Total)
	assert.Len(t, out.Data.List, 1)
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, 1, out.Data.PageSize)

	// 非法 resource_category → bad_request。
	w, out := doListImports(t, r, "?resource_category=bogus")
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "resource_category")
}

func TestGetImportRecord_Detail(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	// 通过真实导入产生一条含错误明细的记录。
	bad := baseValues(models.ResourceCategoryHost)
	bad["instance_ip"] = "999.999.999.999"
	xlsx := buildXLSX(t, models.ResourceCategoryHost, [][]string{
		hostRow("10.0.0.1", "运行中"),
		makeRow(models.ResourceCategoryHost, bad),
	})
	_, importOut := doImportUpload(t, r, "host", xlsx, map[string]string{
		"resource_category": "host",
		"mode":              "upsert",
	})
	require.Equal(t, 1, importOut.Data.Failed)

	rec := loadLatestImport(t, db)
	w, out := doGetImport(t, r, strconv.FormatUint(uint64(rec.ID), 10))
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, rec.ImportNo, out.Data.ImportNo)
	assert.Equal(t, string(models.ResourceCategoryHost), out.Data.ResourceCategory)
	assert.Equal(t, string(models.ImportModeUpsert), out.Data.Mode)
	assert.Equal(t, 2, out.Data.Total)
	assert.Equal(t, 1, out.Data.Success)
	assert.Equal(t, 0, out.Data.Updated)
	assert.Equal(t, 1, out.Data.Failed)
	assert.Equal(t, models.PlatformAdminTenantID, out.Data.Operator)
	require.Len(t, out.Data.Errors, 1, "详情含 errors 明细（§6.4）")
	assert.Equal(t, "instance_ip", out.Data.Errors[0].Field)
	assert.Equal(t, "999.999.999.999", out.Data.Errors[0].Value)
}

func TestGetImportRecord_NotFound(t *testing.T) {
	db := openImportTestDB(t)
	r := mountImport(t, db)

	w, out := doGetImport(t, r, "999999")
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Contains(t, out.Error, "导入记录")
}
