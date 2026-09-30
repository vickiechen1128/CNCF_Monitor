package notify

import (
	"bytes"
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

var notifyDBCounter int64

// newNotifyDB 打开逐测试独享的内存 SQLite 并迁移 PL-3 通知模型表。
// 测试桩（httptest）为回环地址，默认放行私网目标以便桥端到端测试；私网拒绝断言在
// TestValidateWebhookURLRejectsPrivateTargets 中显式关闭后复原。
func newNotifyDB(t *testing.T) *gorm.DB {
	t.Helper()
	prev := allowPrivateWebhookTargets
	allowPrivateWebhookTargets = true
	t.Cleanup(func() { allowPrivateWebhookTargets = prev })
	dsn := fmt.Sprintf("file:notify_%d?mode=memory&cache=shared", atomic.AddInt64(&notifyDBCounter, 1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.NotifyChannel{}, &models.NotifyTemplate{}))
	return db
}

// TestValidateWebhookURLRejectsPrivateTargets 覆盖 M-2：默认拒绝私网 / 环回 /
// link-local / 云元数据（169.254.169.254）/ localhost，放行公网地址；显式开关放行私网。
func TestValidateWebhookURLRejectsPrivateTargets(t *testing.T) {
	prev := allowPrivateWebhookTargets
	allowPrivateWebhookTargets = false
	t.Cleanup(func() { allowPrivateWebhookTargets = prev })

	for _, raw := range []string{
		"http://127.0.0.1:8080/hook",
		"http://localhost/hook",
		"http://10.0.0.5/hook",
		"http://192.168.1.10/hook",
		"http://172.16.0.1/hook",
		"http://169.254.169.254/latest/meta-data/",
		"http://[::1]/hook",
		"http://0.0.0.0/hook",
	} {
		assert.ErrorIsf(t, ValidateWebhookURL(raw), ErrChannelWebhookInvalid, "raw=%q 应被拒", raw)
	}

	for _, raw := range []string{
		"https://open.feishu.cn/open-apis/bot/v2/hook/abc",
		"https://oapi.dingtalk.com/robot/send?access_token=x",
		"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x",
	} {
		assert.NoErrorf(t, ValidateWebhookURL(raw), "raw=%q 应放行", raw)
	}

	// 显式开关放行私网（内网自建机器人 / 测试桩场景）。
	allowPrivateWebhookTargets = true
	assert.NoError(t, ValidateWebhookURL("http://127.0.0.1:8080/hook"))
}

// --- 服务层：创建校验 ---

func TestCreateChannelPersistsAndValidates(t *testing.T) {
	db := newNotifyDB(t)

	ch, err := CreateChannel(db, ChannelInput{
		Name:       "SRE 飞书群",
		Type:       "feishu",
		WebhookURL: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
		Secret:     "s3cr3t",
	})
	require.NoError(t, err)
	require.NotZero(t, ch.ID)
	assert.True(t, ch.Enabled, "enabled 缺省为 true")

	// 非法输入。
	_, err = CreateChannel(db, ChannelInput{Name: "", Type: "feishu", WebhookURL: "https://x/y"})
	assert.ErrorIs(t, err, ErrChannelNameRequired)
	_, err = CreateChannel(db, ChannelInput{Name: "n", Type: "email", WebhookURL: "https://x/y"})
	assert.ErrorIs(t, err, ErrChannelTypeInvalid)
	_, err = CreateChannel(db, ChannelInput{Name: "n", Type: "feishu", WebhookURL: "ftp://x/y"})
	assert.ErrorIs(t, err, ErrChannelWebhookInvalid)
	_, err = CreateChannel(db, ChannelInput{Name: "n", Type: "feishu", WebhookURL: "http://"})
	assert.ErrorIs(t, err, ErrChannelWebhookInvalid)
}

// TestChannelViewMasksCredentials 覆盖响应脱敏：不回显完整 webhook_url / secret。
func TestChannelViewMasksCredentials(t *testing.T) {
	ch := &models.NotifyChannel{
		BaseModel:  models.BaseModel{ID: 7},
		Name:       "n",
		Type:       models.NotifyChannelTypeFeishu,
		WebhookURL: "https://open.feishu.cn/open-apis/bot/v2/hook/abc-secret-token",
		Secret:     "topsecret",
		Enabled:    true,
	}
	v := ToChannelView(ch)
	assert.Equal(t, "7", v.ID)
	assert.Equal(t, "https://open.feishu.cn/***", v.WebhookURL)
	assert.NotContains(t, v.WebhookURL, "abc-secret-token")
	assert.True(t, v.SecretSet)
	// 视图不含明文字段。
	raw, err := json.Marshal(v)
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "topsecret")
	assert.NotContains(t, string(raw), "abc-secret-token")
}

func TestUpdateChannelPartialAndNotFound(t *testing.T) {
	db := newNotifyDB(t)
	ch, err := CreateChannel(db, ChannelInput{Name: "n", Type: "feishu", WebhookURL: "https://open.feishu.cn/hook/a", Secret: "s"})
	require.NoError(t, err)

	// 仅改 name：webhook / secret 保留。
	name := "renamed"
	updated, err := UpdateChannel(db, ch.ID, UpdateChannelInput{Name: &name})
	require.NoError(t, err)
	assert.Equal(t, "renamed", updated.Name)
	assert.Equal(t, "https://open.feishu.cn/hook/a", updated.WebhookURL)
	assert.Equal(t, "s", updated.Secret)

	// 改 webhook 非法 → 拒绝。
	bad := "ftp://x/y"
	_, err = UpdateChannel(db, ch.ID, UpdateChannelInput{WebhookURL: &bad})
	assert.ErrorIs(t, err, ErrChannelWebhookInvalid)

	// 不存在。
	_, err = UpdateChannel(db, 9999, UpdateChannelInput{Name: &name})
	assert.ErrorIs(t, err, ErrChannelNotFound)
}

func TestDeleteChannelAndList(t *testing.T) {
	db := newNotifyDB(t)
	c1, err := CreateChannel(db, ChannelInput{Name: "a", Type: "feishu", WebhookURL: "https://x/a"})
	require.NoError(t, err)
	_, err = CreateChannel(db, ChannelInput{Name: "b", Type: "wecom", WebhookURL: "https://y/b"})
	require.NoError(t, err)

	rows, err := ListChannels(db)
	require.NoError(t, err)
	assert.Len(t, rows, 2)

	require.NoError(t, DeleteChannel(db, c1.ID))
	_, err = GetChannel(db, c1.ID)
	assert.ErrorIs(t, err, ErrChannelNotFound)
	assert.ErrorIs(t, DeleteChannel(db, c1.ID), ErrChannelNotFound)
}

// --- Handler 层 ---

func newNotifyRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	am := r.Group("/api/v2/platform/alertmanager")
	ch := am.Group("/notify-channels")
	ch.GET("", ListChannelsHandler(db))
	ch.POST("", CreateChannelHandler(db))
	ch.PUT("/:id", UpdateChannelHandler(db))
	ch.DELETE("/:id", DeleteChannelHandler(db))
	return r
}

type channelResp struct {
	Status    string                 `json:"status"`
	ErrorType string                 `json:"errorType"`
	Error     string                 `json:"error"`
	Data      map[string]interface{} `json:"data"`
}

func doJSON(t *testing.T, r *gin.Engine, method, path string, body interface{}) (int, channelResp) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		require.NoError(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out channelResp
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

func TestChannelCRUDHandlers(t *testing.T) {
	db := newNotifyDB(t)
	r := newNotifyRouter(db)

	// 创建。
	code, out := doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-channels", map[string]interface{}{
		"name": "SRE", "type": "feishu", "webhook_url": "https://open.feishu.cn/hook/xyz", "secret": "sec",
	})
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "success", out.Status)
	assert.Equal(t, "https://open.feishu.cn/***", out.Data["webhook_url"])
	assert.Equal(t, true, out.Data["secret_set"])
	id, _ := out.Data["id"].(string)
	require.NotEmpty(t, id)

	// 创建非法 URL → bad_request。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-channels", map[string]interface{}{
		"name": "bad", "type": "feishu", "webhook_url": "ftp://evil/x",
	})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)

	// 列表。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/alertmanager/notify-channels", nil)
	require.Equal(t, http.StatusOK, code)
	items, ok := out.Data["items"].([]interface{})
	require.True(t, ok)
	assert.Len(t, items, 1)

	// 更新。
	code, _ = doJSON(t, r, http.MethodPut, "/api/v2/platform/alertmanager/notify-channels/"+id, map[string]interface{}{
		"name": "SRE-2",
	})
	assert.Equal(t, http.StatusOK, code)

	// 删除后 404。
	code, _ = doJSON(t, r, http.MethodDelete, "/api/v2/platform/alertmanager/notify-channels/"+id, nil)
	assert.Equal(t, http.StatusOK, code)
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/alertmanager/notify-channels/"+id, map[string]interface{}{"name": "x"})
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out.ErrorType)
}