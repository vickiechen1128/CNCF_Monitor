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

// bizTestDBCounter 为每个业务字典测试生成唯一的内存 DB 名，避免同包测试共享串扰。
var bizTestDBCounter int64

// testBizFixtures 返回业务字典测试夹具（原 sampleYAML 语义）：infra/payment/data-api
// 启用，legacy 停用。供 store 读与资源校验测试复用（validate/create/import 等）。
func testBizFixtures() []models.BusinessDomain {
	return []models.BusinessDomain{
		{Code: "infra", Name: "公共基础设施", Description: "基础设施兜底", Enabled: true},
		{Code: "payment", Name: "支付业务", Description: "支付业务域", Enabled: true},
		{Code: "data-api", Name: "数据接口业务", Description: "数据接口业务域", Enabled: true},
		{Code: "legacy", Name: "遗留系统", Description: "遗留业务（停用示例）", Enabled: false},
	}
}

// openBizTestDB 打开逐测试的内存 SQLite 并迁移 BusinessDomain 表；随后落 fixtures
// 夹具（缺省 testBizFixtures，可传入覆盖实现特定前置）。
func openBizTestDB(t *testing.T, fixtures ...models.BusinessDomain) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&bizTestDBCounter, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:resource_biz_%d?mode=memory&cache=shared", n)), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.BusinessDomain{}))
	if len(fixtures) == 0 {
		fixtures = testBizFixtures()
	}
	for i := range fixtures {
		require.NoError(t, db.Create(&fixtures[i]).Error)
	}
	return db
}

// newBizStore 构造一个 DB-backed 业务字典 store，预置 testBizFixtures 夹具
// （infra/payment/data-api 启用、legacy 停用）。供 validate/create/import 等测试复用。
func newBizStore(t *testing.T) *BusinessDomainStore {
	t.Helper()
	return NewBusinessDomainStore(openBizTestDB(t))
}

func TestStoreListPreservesOrder(t *testing.T) {
	store := NewBusinessDomainStore(openBizTestDB(t))

	list, err := store.List()
	require.NoError(t, err)
	require.Len(t, list, 4)
	assert.Equal(t, "infra", list[0].Code)
	assert.Equal(t, "payment", list[1].Code)
	assert.Equal(t, "data-api", list[2].Code)
	assert.Equal(t, "legacy", list[3].Code)
}

func TestStoreLookup(t *testing.T) {
	store := NewBusinessDomainStore(openBizTestDB(t))

	d, ok, err := store.Lookup("payment")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "支付业务", d.Name)
	assert.True(t, d.Enabled)

	_, ok, err = store.Lookup("not-exist")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestStoreEnabledListAndMapExcludeDisabled(t *testing.T) {
	store := NewBusinessDomainStore(openBizTestDB(t))

	enabled, err := store.EnabledList()
	require.NoError(t, err)
	require.Len(t, enabled, 3, "停用项 legacy 不应进入 EnabledList")
	for _, d := range enabled {
		assert.True(t, d.Enabled)
		assert.NotEqual(t, "legacy", d.Code)
	}

	enabledMap, err := store.GetEnabledMap()
	require.NoError(t, err)
	require.Len(t, enabledMap, 3)
	_, exists := enabledMap["legacy"]
	assert.False(t, exists)
	_, exists = enabledMap["infra"]
	assert.True(t, exists)
}

func TestStoreCreateThenVisible(t *testing.T) {
	store := NewBusinessDomainStore(openBizTestDB(t))

	created, err := store.Create(models.BusinessDomain{Code: "risk-control", Name: "风控业务", Description: "风控域", Enabled: true})
	require.NoError(t, err)
	assert.Equal(t, "risk-control", created.Code)
	assert.True(t, created.Enabled)

	_, ok, err := store.Lookup("risk-control")
	require.NoError(t, err)
	assert.True(t, ok, "创建后应可读")
}

func TestStoreUpdateLimitedFields(t *testing.T) {
	store := NewBusinessDomainStore(openBizTestDB(t))

	enabled := false
	updated, err := store.Update("payment", UpdateBusinessDomainRequest{Name: strPtrT("支付业务新"), Enabled: &enabled})
	require.NoError(t, err)
	assert.Equal(t, "支付业务新", updated.Name)
	assert.False(t, updated.Enabled)
	assert.Equal(t, "payment", updated.Code, "code 不可改")

	d, _, err := store.Lookup("payment")
	require.NoError(t, err)
	assert.False(t, d.Enabled, "更新后停用应持久化")
}

func TestListBusinessDomainsHandlerDBBacked(t *testing.T) {
	store := NewBusinessDomainStore(openBizTestDB(t))

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/business-domains", ListBusinessDomains(store))

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/business-domains", nil)
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string `json:"status"`
		Data   struct {
			List  []BusinessDomain `json:"list"`
			Total int              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status)
	assert.Len(t, out.Data.List, 4, "只读接口返回全量字典（含停用项，携带 enabled）")
	assert.Equal(t, 4, out.Data.Total)
	assert.Equal(t, "infra", out.Data.List[0].Code)
	assert.Equal(t, "公共基础设施", out.Data.List[0].Name)
}

// strPtrT 转换字符串为 *string，供 UpdateBusinessDomainRequest 测试赋值。
func strPtrT(s string) *string { return &s }