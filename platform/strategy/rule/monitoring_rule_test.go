package rule

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:rule_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.MonitoringRule{}))
	return db
}

func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterRoutes(r.Group("/api/v2/platform"), db)
	return r
}

func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var buf *bytes.Buffer
	if body == "" {
		buf = bytes.NewBuffer(nil)
	} else {
		buf = bytes.NewBufferString(body)
	}
	req := httptest.NewRequest(method, path, buf)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// rulesFixture 返回一份携带一组 groups 的合法规则 YAML。
func rulesFixture() string {
	return rulesFixtureGroup("host-cpu-alerts")
}

// rulesFixtureGroup 返回携带指定组名的一组 groups 的合法规则 YAML
// （group 名全局唯一约束下，多规则用例须用不同组名）。
func rulesFixtureGroup(group string) string {
	return fmt.Sprintf(`
groups:
- name: %s
  rules:
  - alert: HighCPU
    expr: node_cpu_usage > 0.9
`, group)
}

func TestValidateRuleYamlSyntax(t *testing.T) {
	require.NoError(t, validateRuleYAML(rulesFixture()))

	// 顶层的 groups 缺失 / 非数组 → 报错。
	require.Error(t, validateRuleYAML("name: x\n"))
	require.Error(t, validateRuleYAML("groups: scalar"))
	require.Error(t, validateRuleYAML("not: yaml: ["))
	require.Error(t, validateRuleYAML(""))
}

func TestCreateMonitoringRule(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// YAML 非法 → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", `{"rule_content":"name: x\n"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// content_mode 非 yaml_passthrough → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", `{"content_mode":"structured","rule_content":"groups: []"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 合法创建：draft_status=ready，change_status=pending，scope=central。
	body := fmt.Sprintf(`{"content_mode":"yaml_passthrough","rule_content":%s,"name":"cpu-rules","enabled":true}`, jsonString(rulesFixture()))
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string              `json:"status"`
		Data   models.MonitoringRule `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, "cpu-rules", out.Data.Name)
	assert.Equal(t, string(models.RuleContentModeYAMLPassthrough), string(out.Data.ContentMode))
	assert.Equal(t, string(models.ScopeTypeCentral), string(out.Data.Scope))
	assert.Equal(t, "ready", out.Data.DraftStatus)
	assert.Equal(t, string(models.ChangeStatusPending), string(out.Data.ChangeStatus))
}

// TestCreateMonitoringRuleDefaultEnabled 覆盖「创建默认启用」（M01 PRD §8，与采集
// Job 对齐）：请求体不传 enabled 时必须默认 true，不得以零值 false 落库造成
// 「保存并提交后规则变停用」。
func TestCreateMonitoringRuleDefaultEnabled(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 不传 enabled → 默认启用。
	body := fmt.Sprintf(`{"rule_content":%s,"name":"default-enabled"}`, jsonString(rulesFixture()))
	w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.MonitoringRule `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.True(t, out.Data.Enabled, "缺省 enabled 应默认 true")

	// 显式传 enabled=false → 尊重调用方（停用挂载场景）。
	body = fmt.Sprintf(`{"rule_content":%s,"name":"explicit-disabled","enabled":false}`, jsonString(rulesFixture()))
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.False(t, out.Data.Enabled, "显式 enabled=false 应落库为停用")
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestListUpdateDeleteMonitoringRule(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 创建两条规则（生效规则合并为同一份 rules.yml，组名须全局唯一）。
	for _, name := range []string{"cpu-rules", "disk-rules"} {
		body := fmt.Sprintf(`{"rule_content":%s,"name":%s,"enabled":true}`, jsonString(rulesFixtureGroup(name+"-grp")), jsonString(name))
		w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
		require.Equal(t, http.StatusOK, w.Code)
	}
	// 新建规则 change_status=pending（F-25 禁止编辑/删除），此处测的是常规
	// CRUD 链路，先将状态流转为非 pending（模拟 M09 变更单已确认下发）。
	require.NoError(t, db.Model(&models.MonitoringRule{}).
		Where("change_status = ?", models.ChangeStatusPending).
		Update("change_status", models.ChangeStatusDeployed).Error)

	// 关键字筛选。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/monitoring-rules?keyword=cpu", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []models.MonitoringRule `json:"list"`
			Total int64                   `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "cpu-rules", out.Data.List[0].Name)
	cpuRuleID := strconv.FormatUint(uint64(out.Data.List[0].ID), 10)
	cpuRuleUID := out.Data.List[0].ID

	// enabled=false 筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/monitoring-rules?enabled=false", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(0), out.Data.Total)

	// 更新 name + enabled。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/monitoring-rules/"+cpuRuleID, `{"name":"cpu-rules-v2","enabled":false}`)
	require.Equal(t, http.StatusOK, w.Code)
	var upd struct {
		Data struct {
			Name    string `json:"name"`
			Enabled bool   `json:"enabled"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &upd))
	assert.Equal(t, "cpu-rules-v2", upd.Data.Name)
	assert.Equal(t, false, upd.Data.Enabled)

	// 更新非法 YAML → bad_request。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/monitoring-rules/"+cpuRuleID, `{"rule_content":"name: x\n"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 未命中 not_found。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/monitoring-rules/999999", `{"name":"x"}`)
	require.Equal(t, http.StatusNotFound, w.Code)

	// 软删返回 {id}，列表为空。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/monitoring-rules/"+cpuRuleID, "")
	require.Equal(t, http.StatusOK, w.Code)
	var del struct {
		Data struct {
			ID uint `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &del))
	assert.Equal(t, cpuRuleUID, del.Data.ID)

	w = perform(t, r, http.MethodGet, "/api/v2/platform/monitoring-rules", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total, "软删后仅剩 disk-rules")

	w = perform(t, r, http.MethodDelete, "/api/v2/platform/monitoring-rules/999999", "")
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestValidateYAMLEndpoint(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 创建一条规则作为 :id 上下文目标。
	body := fmt.Sprintf(`{"rule_content":%s,"name":"cpu-rules"}`, jsonString(rulesFixture()))
	w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
	_ = w

	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules/1/validate-yaml", fmt.Sprintf(`{"rule_content":%s}`, jsonString(rulesFixture())))
	require.Equal(t, http.StatusOK, w.Code)
	var okResp struct {
		Data struct {
			Valid bool `json:"valid"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &okResp))
	assert.True(t, okResp.Data.Valid)

	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules/1/validate-yaml", `{"rule_content":"name: x\n"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var badResp struct {
		Data struct {
			Valid bool   `json:"valid"`
			Error string `json:"error"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &badResp))
	assert.False(t, badResp.Data.Valid)
	assert.NotEmpty(t, badResp.Data.Error)
}
// TestExtractGroupNames 覆盖 group 名提取：空 name、文件内重名均报错。
func TestExtractGroupNames(t *testing.T) {
	names, err := extractGroupNames("groups:\n- name: a\n  rules: []\n- name: b\n  rules: []\n")
	require.NoError(t, err)
	assert.Equal(t, []string{"a", "b"}, names)

	_, err = extractGroupNames("groups:\n- rules: []\n")
	require.Error(t, err, "空 name 应报错")

	_, err = extractGroupNames("groups:\n- name: a\n  rules: []\n- name: a\n  rules: []\n")
	require.Error(t, err, "文件内重名应报错")
}

// TestCreateMonitoringRuleGroupNameConflict 覆盖「生效规则合并为同一份 rules.yml，
// group 名全局唯一」：与已生效规则重名 → 400；组名不同或自身停用 → 放行。
func TestCreateMonitoringRuleGroupNameConflict(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	body := fmt.Sprintf(`{"rule_content":%s,"name":"rule-a"}`, jsonString(rulesFixtureGroup("shared-grp")))
	w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)

	// 重名（新规则默认启用）→ bad_request，错误信息点名占用方。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "shared-grp")
	assert.Contains(t, w.Body.String(), "rule-a")

	// 组名不同 → 放行。
	body = fmt.Sprintf(`{"rule_content":%s,"name":"rule-b"}`, jsonString(rulesFixtureGroup("other-grp")))
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)

	// 显式停用创建：不下发，不做唯一性校验 → 放行。
	body = fmt.Sprintf(`{"rule_content":%s,"name":"rule-c","enabled":false}`, jsonString(rulesFixtureGroup("shared-grp")))
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
}

// TestCreateMonitoringRuleMonitorType 覆盖 monitor_type：非法值 400；合法值落库；
// 可空（PRD §5.5 透传模式可空）。
func TestCreateMonitoringRuleMonitorType(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 非法 monitor_type → bad_request。
	body := fmt.Sprintf(`{"rule_content":%s,"monitor_type":"not_a_type"}`, jsonString(rulesFixture()))
	w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "monitor_type")

	// 合法 monitor_type → 落库。
	body = fmt.Sprintf(`{"rule_content":%s,"monitor_type":"mysql","name":"mysql-rules"}`, jsonString(rulesFixture()))
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.MonitoringRule `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "mysql", out.Data.MonitorType)

	// 不传 monitor_type → 可空放行。
	body = fmt.Sprintf(`{"rule_content":%s,"name":"no-type"}`, jsonString(rulesFixtureGroup("no-type-grp")))
	w = perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
	require.Equal(t, http.StatusOK, w.Code)

	// monitor_type 列表筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/monitoring-rules?monitor_type=mysql", "")
	require.Equal(t, http.StatusOK, w.Code)
	var listOut struct {
		Data struct {
			List  []models.MonitoringRule `json:"list"`
			Total int64                   `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &listOut))
	require.Equal(t, int64(1), listOut.Data.Total)
	assert.Equal(t, "mysql-rules", listOut.Data.List[0].Name)
}

// TestUpdateMonitoringRuleGroupNameConflict 覆盖更新路径的唯一性校验：
// 改内容撞名 400；排除自身；占用方停用后放行；monitor_type 非法 400。
func TestUpdateMonitoringRuleGroupNameConflict(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	create := func(name, group string) uint {
		body := fmt.Sprintf(`{"rule_content":%s,"name":%s}`, jsonString(rulesFixtureGroup(group)), jsonString(name))
		w := perform(t, r, http.MethodPost, "/api/v2/platform/monitoring-rules", body)
		require.Equal(t, http.StatusOK, w.Code)
		var out struct {
			Data models.MonitoringRule `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		return out.Data.ID
	}
	idA := create("rule-a", "grp-a")
	idB := create("rule-b", "grp-b")
	// 新建规则 change_status=pending（F-25 禁止编辑/删除），此处测的是常规更新
	// 校验链路，先将状态流转为非 pending（模拟 M09 变更单已确认下发）。
	require.NoError(t, db.Model(&models.MonitoringRule{}).
		Where("change_status = ?", models.ChangeStatusPending).
		Update("change_status", models.ChangeStatusDeployed).Error)

	// 自身内容不变、仅改名字 → 排除自身，不应误判冲突。
	w := perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", idB), `{"name":"rule-b-v2"}`)
	require.Equal(t, http.StatusOK, w.Code)

	// 更新内容撞上 rule-a 的组名 → bad_request。
	body := fmt.Sprintf(`{"rule_content":%s}`, jsonString(rulesFixtureGroup("grp-a")))
	w = perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", idB), body)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "grp-a")

	// 非法 monitor_type → bad_request。
	w = perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", idB), `{"monitor_type":"bad"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 合法 monitor_type → 落库。
	w = perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", idB), `{"monitor_type":"redis"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.MonitoringRule `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "redis", out.Data.MonitorType)

	// 停用 rule-a 后，grp-a 释放 → rule-b 可改用。
	w = perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", idA), `{"enabled":false}`)
	require.Equal(t, http.StatusOK, w.Code)
	w = perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", idB), body)
	require.Equal(t, http.StatusOK, w.Code)
}

// F-25 / 决策 44-1：change_status=pending 的规则已挂起待确认变更单，编辑/删除
// 均拒绝（409），与采集 Job 侧一致；none/confirmed/deployed 状态不受影响。
func TestUpdateDeletePendingRuleRejected(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	seedRule := func(name string, status models.ChangeStatus) uint {
		rule := &models.MonitoringRule{
			Name:         name,
			ContentMode:  models.RuleContentModeYAMLPassthrough,
			RuleContent:  rulesFixtureGroup(name + "-grp"),
			Scope:        models.ScopeTypeCentral,
			Enabled:      false, // 停用，规避 group 名全局唯一校验，聚焦 409 语义。
			DraftStatus:  "ready",
			ChangeStatus: status,
		}
		require.NoError(t, db.Create(rule).Error)
		return rule.ID
	}

	pendingID := seedRule("rule-pending", models.ChangeStatusPending)

	// 编辑 → 409 conflict，且字段未被修改。
	w := perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", pendingID), `{"name":"rule-pending-v2"}`)
	require.Equal(t, http.StatusConflict, w.Code)
	assert.Contains(t, w.Body.String(), "待确认变更单")
	var reloaded models.MonitoringRule
	require.NoError(t, db.First(&reloaded, pendingID).Error)
	assert.Equal(t, "rule-pending", reloaded.Name, "pending 规则不得被修改")

	// 删除 → 409 conflict，且记录仍在。
	w = perform(t, r, http.MethodDelete, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", pendingID), "")
	require.Equal(t, http.StatusConflict, w.Code)
	require.NoError(t, db.First(&reloaded, pendingID).Error, "pending 规则不得被删除")

	// none / confirmed / deployed 状态编辑、删除均放行。
	for _, status := range []models.ChangeStatus{
		models.ChangeStatusNone,
		models.ChangeStatusConfirmed,
		models.ChangeStatusDeployed,
	} {
		id := seedRule("rule-"+string(status), status)
		w := perform(t, r, http.MethodPut, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", id), `{"name":"renamed"}`)
		require.Equal(t, http.StatusOK, w.Code, "status=%s 应允许编辑", status)
		w = perform(t, r, http.MethodDelete, fmt.Sprintf("/api/v2/platform/monitoring-rules/%d", id), "")
		require.Equal(t, http.StatusOK, w.Code, "status=%s 应允许删除", status)
	}
}
