package resource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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

// appTestDBCounter 为每个应用字典测试生成唯一的内存 DB 名，避免同包测试共享串扰。
var appTestDBCounter int64

// openAppTestDB 打开逐测试的内存 SQLite 并迁移 ApplicationDict 表；随后落 fixtures。
func openAppTestDB(t *testing.T, fixtures ...models.ApplicationDict) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&appTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_app_%d?mode=memory&cache=shared", n)), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ApplicationDict{}))
	if len(fixtures) == 0 {
		fixtures = []models.ApplicationDict{
			{AppCode: "pay-db", AppName: "支付库", Status: models.AppStatusEnabled},
			{AppCode: "pay-web", AppName: "支付前端", Status: models.AppStatusEnabled},
			{AppCode: "app", AppName: "示例应用", Status: models.AppStatusEnabled},
			{AppCode: "kafka-app", AppName: "消息应用", Status: models.AppStatusEnabled},
			{AppCode: "pay-service", AppName: "支付服务", Status: models.AppStatusEnabled},
			{AppCode: "legacy-app", AppName: "遗留应用", Status: models.AppStatusDisabled},
		}
	}
	for i := range fixtures {
		require.NoError(t, db.Create(&fixtures[i]).Error)
	}
	return db
}

func newAppStore(t *testing.T) *ApplicationDictStore {
	t.Helper()
	return NewApplicationDictStore(openAppTestDB(t))
}

// TestValidateResourceInput_AppCodeEnabled 覆盖决策 92 红线：资源侧 app_code 只允许
// 引用未停用条目（录入/编辑/Excel 导入三处同校验，此处覆盖校验内核）。
func TestValidateResourceInput_AppCodeEnabled(t *testing.T) {
	appStore := newAppStore(t)

	t.Run("enabled app_code passes", func(t *testing.T) {
		in := &ResourceInput{
			ResourceCategory: string(models.ResourceCategoryDatabase),
			NetworkDomainID:  "default",
			BizCode:          "payment",
			AppCode:          "pay-db", // 已启用
			Cluster:          "pay",
			Status:           "online",
			Env:              "prod",
			DatabaseType:     "mysql",
			InstanceIP:       "10.0.0.10",
			Port:             3306,
		}
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryDatabase, in, newBizStore(t), appStore, alwaysExists))
	})

	t.Run("disabled app_code fails", func(t *testing.T) {
		in := &ResourceInput{
			ResourceCategory: string(models.ResourceCategoryDatabase),
			NetworkDomainID:  "default",
			BizCode:          "payment",
			AppCode:          "legacy-app", // 已停用
			Cluster:          "pay",
			Status:           "online",
			Env:              "prod",
			DatabaseType:     "mysql",
			InstanceIP:       "10.0.0.10",
			Port:             3306,
		}
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, newBizStore(t), appStore, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "legacy-app")
	})

	t.Run("unknown app_code fails", func(t *testing.T) {
		in := &ResourceInput{
			ResourceCategory: string(models.ResourceCategoryDatabase),
			NetworkDomainID:  "default",
			BizCode:          "payment",
			AppCode:          "not-registered",
			Cluster:          "pay",
			Status:           "online",
			Env:              "prod",
			DatabaseType:     "mysql",
			InstanceIP:       "10.0.0.10",
			Port:             3306,
		}
		err := ValidateResourceInput(models.ResourceCategoryDatabase, in, newBizStore(t), appStore, alwaysExists)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not-registered")
	})

	t.Run("empty app_code allowed for host", func(t *testing.T) {
		in := validHostInput()
		in.AppCode = ""
		require.NoError(t, ValidateResourceInput(models.ResourceCategoryHost, in, newBizStore(t), appStore, alwaysExists))
	})
}

// TestApplicationDictEndpoints 覆盖应用字典端点（决策 92，与 business-domains 同构）：
// 登记 + 受限编辑 + 只读列表；app_code 不可改、无 DELETE、停用不删除。
func TestApplicationDictEndpoints(t *testing.T) {
	// 本用例自带 3 条固件（不依赖共享缺省固件集，避免其扩容时计数漂移）。
	db := openAppTestDB(t,
		models.ApplicationDict{AppCode: "pay-db", AppName: "支付库", Status: models.AppStatusEnabled},
		models.ApplicationDict{AppCode: "pay-web", AppName: "支付前端", Status: models.AppStatusEnabled},
		models.ApplicationDict{AppCode: "legacy-app", AppName: "遗留应用", Status: models.AppStatusDisabled},
	)
	store := NewApplicationDictStore(db)
	r := gin.New()
	r.GET("/api/v2/platform/application-dict", ListApplicationDicts(store))
	r.POST("/api/v2/platform/application-dict", CreateApplicationDict(store))
	r.PUT("/api/v2/platform/application-dict/:app_code", UpdateApplicationDict(store))

	// 初始列表包含 3 条 fixture。
	code, out := doJSON(t, r, http.MethodGet, "/api/v2/platform/application-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(3), out["total"])

	// 登记新应用（默认 enabled）。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"order-svc","app_name":"订单服务"}`)
	require.Equal(t, http.StatusOK, code, "登记应成功：%v", out)
	assert.Equal(t, "order-svc", out["app_code"])
	assert.Equal(t, "enabled", out["status"])

	// 重名 app_code 登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"order-svc","app_name":"重复"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 非法 app_code（大写）登记 → bad_request。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/application-dict", `{"app_code":"BAD","app_name":"坏"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 受限编辑：改 app_name 与 status（停用）；app_code 不可改（请求体不接收）。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/application-dict/order-svc", `{"app_name":"订单服务-改","status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, "编辑应成功：%v", out)
	assert.Equal(t, "订单服务-改", out["app_name"])
	assert.Equal(t, "disabled", out["status"])
	assert.Equal(t, "order-svc", out["app_code"], "app_code 不可改")

	// 不存在的 app_code 编辑 → not_found。
	code, _ = doJSON(t, r, http.MethodPut, "/api/v2/platform/application-dict/nope", `{"app_name":"x"}`)
	require.Equal(t, http.StatusNotFound, code)

	// 列表总数：3 fixture + 1 新登记 = 4。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/application-dict", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(4), out["total"])
}

// doJSON 以 JSON 请求体调用 handler 并返回状态码与解析后的响应体（测试辅助）。
func doJSON(t *testing.T, r *gin.Engine, method, path, body string) (int, map[string]interface{}) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	out := map[string]interface{}{}
	if strings.TrimSpace(w.Body.String()) != "" {
		_ = json.Unmarshal(w.Body.Bytes(), &out)
	}
	// 统一响应信封 {status, data}：断言针对 data 载荷，故存在 data 时下钻一层。
	if d, ok := out["data"].(map[string]interface{}); ok {
		return w.Code, d
	}
	return w.Code, out
}
