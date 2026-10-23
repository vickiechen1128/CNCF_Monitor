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

// TestCreateTemplateValidatesAndPersists 覆盖校验通过 → 落库。
func TestCreateTemplateValidatesAndPersists(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)

	tpl, err := CreateTemplate(db, CreateTemplateInput{Name: "自定义", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	require.NotZero(t, tpl.ID)
	assert.Equal(t, models.NotifyTemplateStatusApplied, tpl.Status)
	assert.Equal(t, models.AlertmanagerConfigChecksum(validTplContent), tpl.Checksum)
	assert.False(t, tpl.IsBuiltin)

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

// TestCreateTemplateRejectsValidationFailureNoPersist 覆盖校验失败 → 不落库。
func TestCreateTemplateRejectsValidationFailureNoPersist(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateInvalid(t)

	_, err := CreateTemplate(db, CreateTemplateInput{Name: "bad", ChannelType: "feishu", Content: "{{ .Status"})
	require.Error(t, err)
	var valErr *config.ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Count(&count).Error)
	assert.EqualValues(t, 0, count)
}

// TestCreateTemplateRejectsBadNameAndType 覆盖名称 / 渠道类型前置校验。
func TestCreateTemplateRejectsBadNameAndType(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	_, err := CreateTemplate(db, CreateTemplateInput{Name: "", ChannelType: "feishu", Content: validTplContent})
	assert.ErrorIs(t, err, ErrTemplateNameRequired)
	_, err = CreateTemplate(db, CreateTemplateInput{Name: "n", ChannelType: "email", Content: validTplContent})
	assert.ErrorIs(t, err, ErrTemplateChannelTypeInvalid)
}

// TestCreateTemplateNameConflict 同渠道类型下名称唯一；不同渠道类型可同名。
func TestCreateTemplateNameConflict(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	_, err := CreateTemplate(db, CreateTemplateInput{Name: "同名", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)

	_, err = CreateTemplate(db, CreateTemplateInput{Name: "同名", ChannelType: "feishu", Content: validTplContent + " "})
	assert.ErrorIs(t, err, ErrTemplateNameConflict)

	_, err = CreateTemplate(db, CreateTemplateInput{Name: "同名", ChannelType: "dingtalk", Content: validTplContent})
	require.NoError(t, err, "不同渠道类型允许同名")
}

// TestCreateTemplateCloneBuiltinVerbatimCreatesNewRow 克隆内置模板、仅改名、内容原样保存，
// 应新建一条独立的自定义模板（不再被内容去重误伤）。
func TestCreateTemplateCloneBuiltinVerbatimCreatesNewRow(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	require.NoError(t, EnsureBuiltinTemplates(db))

	var builtin models.NotifyTemplate
	require.NoError(t, db.Where("is_builtin = ?", true).First(&builtin).Error)

	cloneName := builtin.Name + "（副本）"
	tpl, err := CreateTemplate(db, CreateTemplateInput{
		Name:        cloneName,
		ChannelType: string(builtin.ChannelType),
		Content:     builtin.Content,
	})
	require.NoError(t, err)
	assert.Equal(t, cloneName, tpl.Name)
	assert.NotEqual(t, builtin.ID, tpl.ID)
	assert.False(t, tpl.IsBuiltin)

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

// TestUpdateTemplateInPlace 编辑原地更新（不新增版本），checksum 随内容更新。
func TestUpdateTemplateInPlace(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	tpl, err := CreateTemplate(db, CreateTemplateInput{Name: "old", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)

	updated, err := UpdateTemplate(db, tpl.ID, UpdateTemplateInput{Name: "new", ChannelType: "feishu", Content: validTplContent + " "})
	require.NoError(t, err)
	assert.Equal(t, tpl.ID, updated.ID)
	assert.Equal(t, "new", updated.Name)
	assert.Equal(t, validTplContent+" ", updated.Content)
	assert.Equal(t, models.AlertmanagerConfigChecksum(validTplContent+" "), updated.Checksum)

	var count int64
	require.NoError(t, db.Model(&models.NotifyTemplate{}).Count(&count).Error)
	assert.EqualValues(t, 1, count, "编辑不得新增版本")
}

// TestUpdateTemplateRejectsBuiltinAndTypeChange 内置不可编辑；渠道类型创建后不可变。
func TestUpdateTemplateRejectsBuiltinAndTypeChange(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	require.NoError(t, EnsureBuiltinTemplates(db))
	var builtin models.NotifyTemplate
	require.NoError(t, db.Where("is_builtin = ?", true).First(&builtin).Error)
	_, err := UpdateTemplate(db, builtin.ID, UpdateTemplateInput{Name: builtin.Name, Content: builtin.Content})
	assert.ErrorIs(t, err, ErrTemplateBuiltinNotEditable)

	custom, err := CreateTemplate(db, CreateTemplateInput{Name: "custom", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	_, err = UpdateTemplate(db, custom.ID, UpdateTemplateInput{Name: "custom", ChannelType: "dingtalk", Content: validTplContent})
	assert.ErrorIs(t, err, ErrTemplateChannelTypeImmutable)
}

// TestUpdateTemplateNameConflict 改名不得与同渠道类型下其他模板重名。
func TestUpdateTemplateNameConflict(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	a, err := CreateTemplate(db, CreateTemplateInput{Name: "a", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	_, err = CreateTemplate(db, CreateTemplateInput{Name: "b", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)

	_, err = UpdateTemplate(db, a.ID, UpdateTemplateInput{Name: "b", Content: validTplContent})
	assert.ErrorIs(t, err, ErrTemplateNameConflict)
}

// TestDeleteTemplateRejectsBuiltinAndBound 内置 / 被渠道绑定的模板禁止删除。
func TestDeleteTemplateRejectsBuiltinAndBound(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	require.NoError(t, EnsureBuiltinTemplates(db))
	var builtin models.NotifyTemplate
	require.NoError(t, db.Where("is_builtin = ?", true).First(&builtin).Error)
	assert.ErrorIs(t, DeleteTemplate(db, builtin.ID), ErrTemplateBuiltinNotDeletable)

	tpl, err := CreateTemplate(db, CreateTemplateInput{Name: "bound", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	ch := &models.NotifyChannel{Name: "SRE 飞书群", Type: models.NotifyChannelTypeFeishu, WebhookURL: "https://open.feishu.cn/x"}
	require.NoError(t, db.Create(ch).Error)
	require.NoError(t, db.Model(ch).Update("default_template_id", tpl.ID).Error)

	err = DeleteTemplate(db, tpl.ID)
	var inUse *ErrTemplateInUse
	require.ErrorAs(t, err, &inUse)
	assert.Contains(t, inUse.Error(), "SRE 飞书群")

	// 解绑后可删。
	require.NoError(t, db.Model(ch).Update("default_template_id", nil).Error)
	require.NoError(t, DeleteTemplate(db, tpl.ID))
}

// TestDeleteTemplateSoftDeletesUnbound 未绑定的自定义模板删除后不再出现在默认查询中。
func TestDeleteTemplateSoftDeletesUnbound(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	tpl, err := CreateTemplate(db, CreateTemplateInput{Name: "solo", ChannelType: "feishu", Content: validTplContent})
	require.NoError(t, err)
	require.NoError(t, DeleteTemplate(db, tpl.ID))

	_, err = GetTemplate(db, tpl.ID)
	assert.ErrorIs(t, err, ErrTemplateNotFound)
}

// TestCompactTemplateVersionsRemapsBindings 历史 append-only 留痕收敛为一行，
// 渠道绑定重定向到保留的最新行。
func TestCompactTemplateVersionsRemapsBindings(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	old := &models.NotifyTemplate{
		Name: "同名", ChannelType: models.NotifyChannelTypeFeishu,
		Content: validTplContent, Checksum: models.AlertmanagerConfigChecksum(validTplContent),
		Status: models.NotifyTemplateStatusApplied,
	}
	require.NoError(t, db.Create(old).Error)
	latest := &models.NotifyTemplate{
		Name: "同名", ChannelType: models.NotifyChannelTypeFeishu,
		Content: validTplContent + " ", Checksum: models.AlertmanagerConfigChecksum(validTplContent + " "),
		Status: models.NotifyTemplateStatusApplied,
	}
	require.NoError(t, db.Create(latest).Error)

	ch := &models.NotifyChannel{Name: "SRE", Type: models.NotifyChannelTypeFeishu, WebhookURL: "https://open.feishu.cn/x"}
	require.NoError(t, db.Create(ch).Error)
	require.NoError(t, db.Model(ch).Update("default_template_id", old.ID).Error)

	require.NoError(t, CompactTemplateVersions(db))

	var stored models.NotifyChannel
	require.NoError(t, db.First(&stored, ch.ID).Error)
	require.NotNil(t, stored.DefaultTemplateID)
	assert.Equal(t, latest.ID, *stored.DefaultTemplateID)

	_, err := GetTemplate(db, old.ID)
	assert.ErrorIs(t, err, ErrTemplateNotFound)
	_, err = GetTemplate(db, latest.ID)
	require.NoError(t, err)

	// 幂等：再跑一次不报错、不改变结果。
	require.NoError(t, CompactTemplateVersions(db))
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
	tpl.GET("/:id", GetTemplateHandler(db))
	tpl.POST("", CreateTemplateHandler(db))
	tpl.PUT("/:id", UpdateTemplateHandler(db))
	tpl.DELETE("/:id", DeleteTemplateHandler(db))
	return r
}

func TestTemplateHandlersCRUD(t *testing.T) {
	db := newNotifyDB(t)
	stubTemplateValid(t)
	r := newTemplateRouter(db)

	// 新建 → 200，返回详情（含 content）。
	code, out := doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-templates", map[string]interface{}{
		"name": "自定义", "channel_type": "feishu", "content": validTplContent,
	})
	require.Equal(t, http.StatusOK, code)
	id, _ := out.Data["id"].(string)
	require.NotEmpty(t, id)
	assert.Equal(t, validTplContent, out.Data["content"])

	// 列表不含 content。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/alertmanager/notify-templates", nil)
	require.Equal(t, http.StatusOK, code)
	items, _ := out.Data["items"].([]interface{})
	require.Len(t, items, 1)
	item, _ := items[0].(map[string]interface{})
	assert.NotContains(t, item, "content", "列表不返回模板全文")

	// 详情含 content。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/alertmanager/notify-templates/"+id, nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, validTplContent, out.Data["content"])

	// 编辑 → 原地更新。
	code, out = doJSON(t, r, http.MethodPut, "/api/v2/platform/alertmanager/notify-templates/"+id, map[string]interface{}{
		"name": "改名", "channel_type": "feishu", "content": validTplContent + " ",
	})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "改名", out.Data["name"])
	assert.Equal(t, validTplContent+" ", out.Data["content"])

	// 校验失败 → 400 + 行级错误。
	stubTemplateInvalid(t)
	code, out = doJSON(t, r, http.MethodPost, "/api/v2/platform/alertmanager/notify-templates", map[string]interface{}{
		"name": "bad", "channel_type": "feishu", "content": "{{ .Status",
	})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)
	data, _ := out.Data["items"].([]interface{})
	assert.NotEmpty(t, data)

	// 删除 → 200；再查 → 404。
	code, _ = doJSON(t, r, http.MethodDelete, "/api/v2/platform/alertmanager/notify-templates/"+id, nil)
	require.Equal(t, http.StatusOK, code)
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/alertmanager/notify-templates/"+id, nil)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out.ErrorType)
}
