package notify

import (
	"net/http"
	"testing"
	"text/template"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// stubTemplateValid 令模板校验恒通过。
func stubTemplateValid(t *testing.T) {
	t.Helper()
	orig := validateTemplateFn
	validateTemplateFn = func(string) error { return nil }
	t.Cleanup(func() { validateTemplateFn = orig })
}

// stubTemplateInvalid 令模板校验失败（返回 config 行级错误）。
func stubTemplateInvalid(t *testing.T) {
	t.Helper()
	orig := validateTemplateFn
	validateTemplateFn = func(string) error {
		return &config.ErrValidation{
			Items: []models.ValidateErrorItem{{File: "template", Message: "模板解析失败: boom"}},
			Note:  "校验失败未保存",
		}
	}
	t.Cleanup(func() { validateTemplateFn = orig })
}

const validTplContent = `{"msg_type":"text","text":{"content":"{{ .Status }}"}}`

// TestSubmitTemplateValidatesAndPersists 覆盖校验通过 → 落库留痕。
func TestSubmitTemplateValidatesAndPersists(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)

	tpl, err := SubmitTemplate(db, SubmitTemplateInput{Name: "自定义", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	require.NotZero(t, tpl.ID)
	assert.Equal(t, models.NotifyTemplateStatusApplied, tpl.Status)
	assert.Equal(t, models.AlertmanagerConfigChecksum(validTplContent), tpl.Checksum)

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

// TestSubmitTemplateRejectsValidationFailureNoPersist 覆盖校验失败 → 不落库（决策 59/60 纪律）。
func TestSubmitTemplateRejectsValidationFailureNoPersist(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateInvalid(t)

	_, err := SubmitTemplate(db, SubmitTemplateInput{Name: "bad", ChannelType: "feishu", Content: "{{ .Status"})
	require.Error(t, err)
	var valErr *config.ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Count(&count).Error)
	assert.EqualValues(t, 0, count)
}

// TestSubmitTemplateRejectsBadNameAndType 覆盖名称 / 渠道类型前置校验。
func TestSubmitTemplateRejectsBadNameAndType(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	_, err := SubmitTemplate(db, SubmitTemplateInput{Name: "", ChannelType: "feishu", Content: validTplContent})
	assert.ErrorIs(t, err, ErrTemplateNameRequired)
	_, err = SubmitTemplate(db, SubmitTemplateInput{Name: "n", ChannelType: "email", Content: validTplContent})
	assert.ErrorIs(t, err, ErrTemplateChannelTypeInvalid)
}

// TestSubmitTemplateIdempotent 覆盖同 content 幂等（同 channel_type + checksum 返回已有）。
func TestSubmitTemplateIdempotent(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	a, err := SubmitTemplate(db, SubmitTemplateInput{Name: "a", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	b, err := SubmitTemplate(db, SubmitTemplateInput{Name: "b", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	assert.Equal(t, a.ID, b.ID)
}

// TestRemountTemplateWritesNewRow 覆盖回滚：总是写入新留痕，内容与渠道类型继承原版本。
func TestRemountTemplateWritesNewRow(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	old, err := SubmitTemplate(db, SubmitTemplateInput{Name: "old", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)

	remounted, err := RemountTemplate(db, old.ID, "rolled")
	require.NoError(t, err)
	assert.NotEqual(t, old.ID, remounted.ID)
	assert.Equal(t, "rolled", remounted.Name)
	assert.Equal(t, old.ChannelType, remounted.ChannelType)
	assert.Equal(t, old.Content, remounted.Content)

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)

	// 不存在 → not found。
	_, err = RemountTemplate(db, 9999, "")
	assert.ErrorIs(t, err, ErrTemplateNotFound)
}

// TestEnsureBuiltinTemplatesIdempotent 覆盖内置模板幂等 seed + 按渠道类型取默认模板。
func TestEnsureBuiltinTemplatesIdempotent(t *testing.T) {
	db := newNotifyDB(t)
	require.NoError(t, EnsureBuiltinTemplates(db))
	require.NoError(t, EnsureBuiltinTemplates(db))

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Where("is_builtin = ?", true).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	builtin, err := BuiltinTemplateForType(db, "feishu")
	require.NoError(t, err)
	assert.True(t, builtin.IsBuiltin)
	assert.Equal(t, BuiltinFeishuCardTemplate, builtin.Content)

	// 无内置模板的渠道类型 → ErrTemplateBuiltinMissing。
	_, err = BuiltinTemplateForType(db, "dingtalk")
	assert.ErrorIs(t, err, ErrTemplateBuiltinMissing)
}

// TestBuiltinFeishuTemplateParses 覆盖内置模板可被共用 FuncMap 解析（渲染前置条件）。
func TestBuiltinFeishuTemplateParses(t *testing.T) {
	_, err := template.New("builtin").Funcs(config.TemplateFuncs()).Parse(BuiltinFeishuCardTemplate)
	require.NoError(t, err)
}

// --- Handler 层 ---

func newTemplateRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	am := r.Group("/api/v2/platform/alertmanager")
	tpl := am.Group("/notify-templates")
	tpl.GET("", ListTemplatesHandler(db))
	tpl.POST("", SubmitTemplateHandler(db))
	tpl.POST("/:id/remount", RemountTemplateHandler(db))
	return r
}

func TestTemplateHandlersSubmitValidationAndRemount(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	r := newTemplateRouter(db)

	// 提交合法模板 → 200。
	code, out := doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-templates", map[string]interface{}{
		"name": "自定义", "channel_type": "feishu", "content": validTplContent,
	})
	require.Equal(t, http.StatusOK, code)
	id, _ := out.Data["id"].(string)
	require.NotEmpty(t, id)

	// 列表。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/alertmanager/notify-templates", nil)
	require.Equal(t, http.StatusOK, code)
	items, _ := out.Data["items"].([]interface{})
	assert.Len(t, items, 1)

	// 回滚 → 新版本。
	code, _ = doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-templates/"+id+"/remount", map[string]interface{}{"name": "v2"})
	assert.Equal(t, http.StatusOK, code)

	// 校验失败 → 400 + 行级错误。
	stubTemplateInvalid(t)
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-templates", map[string]interface{}{
		"name": "bad", "channel_type": "feishu", "content": "{{ .Status",
	})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)
	data, _ := out.Data["items"].([]interface{})
	assert.NotEmpty(t, data)

	// 不存在的模板回滚 → 404。
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-templates/9999/remount", map[string]interface{}{})
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out.ErrorType)
}