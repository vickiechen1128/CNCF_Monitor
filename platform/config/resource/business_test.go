package resource

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sampleYAML mirrors the preset dictionary shape: code/name/description/enabled,
// with the mandatory infra fallback plus enabled and disabled sample entries.
const sampleYAML = `- code: infra
  name: 公共基础设施
  description: 公共基础设施兜底，无业务归属的设备类资源统一挂载
  enabled: true
- code: payment
  name: 支付业务
  description: 支付业务域
  enabled: true
- code: data-api
  name: 数据接口业务
  description: 数据接口业务域
  enabled: true
- code: legacy
  name: 遗留系统
  description: 遗留业务（停用示例）
  enabled: false
`

// writeDomains writes content into a fresh temp yaml file and returns its path.
func writeDomains(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "business_domains.yaml")
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
	return path
}

func TestNewBusinessDomainStoreLoadsEntries(t *testing.T) {
	store := NewBusinessDomainStore(writeDomains(t, sampleYAML))

	list, err := store.List()
	require.NoError(t, err)
	require.Len(t, list, 4)
	// 保留文件顺序，而非 map 随机序
	assert.Equal(t, "infra", list[0].Code)
	assert.Equal(t, "payment", list[1].Code)
	assert.Equal(t, "data-api", list[2].Code)
	assert.Equal(t, "legacy", list[3].Code)

	d, ok, err := store.Lookup("payment")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "支付业务", d.Name)
	assert.True(t, d.Enabled)

	_, ok, err = store.Lookup("not-exist")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestInfraFallbackPresent(t *testing.T) {
	store := NewBusinessDomainStore(writeDomains(t, sampleYAML))

	d, ok, err := store.Lookup("infra")
	require.NoError(t, err)
	assert.True(t, ok, "infra 兜底条目必须存在")
	assert.True(t, d.Enabled, "infra 兜底条目应保持启用")
	assert.Equal(t, "公共基础设施", d.Name)
}

func TestDisabledEntryExcludedFromEnabledList(t *testing.T) {
	store := NewBusinessDomainStore(writeDomains(t, sampleYAML))

	enabled, err := store.EnabledList()
	require.NoError(t, err)
	require.Len(t, enabled, 3, "停用项 legacy 不应进入 EnabledList")
	for _, d := range enabled {
		assert.True(t, d.Enabled, "EnabledList 中不应出现停用条目: %s", d.Code)
		assert.NotEqual(t, "legacy", d.Code)
	}

	enabledMap, err := store.GetEnabledMap()
	require.NoError(t, err)
	require.Len(t, enabledMap, 3)
	_, exists := enabledMap["legacy"]
	assert.False(t, exists, "停用项不应进入 GetEnabledMap")
	_, exists = enabledMap["infra"]
	assert.True(t, exists)
}

func TestHotReloadOnMtimeChange(t *testing.T) {
	path := writeDomains(t, sampleYAML)
	store := NewBusinessDomainStore(path)

	_, ok, err := store.Lookup("data-api")
	require.NoError(t, err)
	assert.True(t, ok)

	// 改写 yaml：新增一个业务并停用 payment，然后显式推进 mtime 确保重读。
	rewritten := `- code: infra
  name: 公共基础设施
  enabled: true
- code: data-api
  name: 数据接口业务（改名）
  enabled: true
- code: risk-control
  name: 风控业务
  enabled: true
- code: payment
  name: 支付业务
  enabled: false
`
	require.NoError(t, os.WriteFile(path, []byte(rewritten), 0o644))
	future := time.Now().Add(time.Hour)
	require.NoError(t, os.Chtimes(path, future, future))

	d, ok, err := store.Lookup("data-api")
	require.NoError(t, err)
	assert.True(t, ok)
	assert.Equal(t, "数据接口业务（改名）", d.Name, "mtime 变更后应热加载新值")

	_, ok, err = store.Lookup("risk-control")
	require.NoError(t, err)
	assert.True(t, ok, "新增条目应通过热加载可见")

	// 停用 payment 后不应出现在 EnabledList
	enabled, err := store.EnabledList()
	require.NoError(t, err)
	for _, e := range enabled {
		assert.NotEqual(t, "payment", e.Code, "改写后 payment 已停用，不应进入 EnabledList")
	}
}

func TestMissingFileReturnsErrorWithoutPanic(t *testing.T) {
	store := NewBusinessDomainStore(filepath.Join(t.TempDir(), "does-not-exist.yaml"))

	// 初始加载失败：读取返回错误但不 panic。
	list, err := store.List()
	assert.Error(t, err, "缺失文件应返回错误")
	assert.Empty(t, list)

	_, ok, err := store.Lookup("infra")
	assert.Error(t, err)
	assert.False(t, ok)
}

func TestLoadFailureKeepsLastSnapshot(t *testing.T) {
	path := writeDomains(t, sampleYAML)
	store := NewBusinessDomainStore(path)

	// 加载成功后删除文件：读取应返回错误，但保留上次快照。
	require.NoError(t, os.Remove(path))

	list, err := store.List()
	assert.Error(t, err, "文件缺失后应返回错误")
	require.Len(t, list, 4, "加载失败应保留上次快照")
	assert.Equal(t, "infra", list[0].Code)

	enabled, err := store.EnabledList()
	assert.Error(t, err)
	require.Len(t, enabled, 3)
}

func TestListBusinessDomainsHandler(t *testing.T) {
	store := NewBusinessDomainStore(writeDomains(t, sampleYAML))

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
	assert.Len(t, out.Data.List, 4, "只读接口返回全量字典（含停用项，携带 enabled 字段）")
	assert.Equal(t, 4, out.Data.Total)
	// 条目仅暴露字典字段（code/name/description/enabled）
	assert.Equal(t, "payment", out.Data.List[1].Code)
	assert.Equal(t, "支付业务", out.Data.List[1].Name)
}
