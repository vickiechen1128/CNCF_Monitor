package notify

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 模板服务层错误。
var (
	// ErrTemplateNameRequired 模板名称必填。
	ErrTemplateNameRequired = errors.New("模板名称不能为空")
	// ErrTemplateChannelTypeInvalid 模板适用渠道类型非法。
	ErrTemplateChannelTypeInvalid = errors.New("模板适用渠道类型非法（仅支持 feishu / dingtalk / wecom）")
	// ErrTemplateNotFound 通知模板不存在。
	ErrTemplateNotFound = errors.New("通知模板不存在")
	// ErrTemplateBuiltinMissing 该渠道类型暂无内置默认模板（且未显式指定模板）。
	ErrTemplateBuiltinMissing = errors.New("该渠道类型暂无内置默认模板，请显式指定模板")
)

// validateTemplateFn 是模板校验入口：默认复用 config 的 amtool check-config 等价工序
// （含 Go 模板解析，决策 59/60 纪律：校验失败不落库）。测试可替换以模拟校验通过/失败。
var validateTemplateFn = config.ValidateTemplate

// BuiltinFeishuCardTemplateName 内置默认飞书卡片模板名称。
const BuiltinFeishuCardTemplateName = "飞书卡片-默认"

// BuiltinFeishuCardTemplate 内置默认飞书卡片模板（Alertmanager 标准 Go template，
// 渲染为飞书 interactive 卡片 JSON）：header 模板色由 status 决定（红=告警 / 绿=恢复），
// 字段对齐用户自建脚本（alertname / instance / zone / severity / summary / description
// + 开始与恢复时间）；时间字段已由渲染层本地化（RenderAlert.StartsAtLocal / EndsAtLocal），
// 不依赖宿主机时区。用户零模板即可接入。
const BuiltinFeishuCardTemplate = `{{- $color := "red" -}}
{{- if eq .Status "resolved" -}}{{- $color = "green" -}}{{- end -}}
{
  "msg_type": "interactive",
  "card": {
    "config": {"wide_screen_mode": true},
    "header": {
      "template": {{ jsonStr $color }},
      "title": {"tag": "plain_text", "content": {{ jsonStr (printf "告警通知 · %s" .Status) }}}
    },
    "elements": [
{{- range $i, $a := .Alerts }}
{{- if $i }},{{ end }}
      {
        "tag": "div",
        "text": {"tag": "lark_md", "content": {{ jsonStr (printf "**告警名称**: %s\n**实例**: %s\n**网域**: %s\n**级别**: %s\n**摘要**: %s\n**描述**: %s\n**开始时间**: %s\n**恢复时间**: %s" (index $a.Labels "alertname") (index $a.Labels "instance") (index $a.Labels "zone") (index $a.Labels "severity") (index $a.Annotations "summary") (index $a.Annotations "description") $a.StartsAtLocal $a.EndsAtLocal) }}
      }
{{- end }}
    ]
  }
}`

// builtinTemplate 描述一条内置模板。
type builtinTemplate struct {
	name        string
	channelType models.NotifyChannelType
	content     string
}

// builtinTemplates 返回平台内置默认模板集合（当前内置飞书卡片-默认）。
func builtinTemplates() []builtinTemplate {
	return []builtinTemplate{
		{name: BuiltinFeishuCardTemplateName, channelType: models.NotifyChannelTypeFeishu, content: BuiltinFeishuCardTemplate},
	}
}

// EnsureBuiltinTemplates 幂等写入平台内置默认模板（is_builtin=true）。
// 同 channel_type + checksum 已存在则跳过，避免重复留痕。
func EnsureBuiltinTemplates(db *gorm.DB) error {
	for _, bt := range builtinTemplates() {
		checksum := models.AlertmanagerConfigChecksum(bt.content)
		existing, err := findTemplateByChecksum(db, string(bt.channelType), checksum)
		if err != nil {
			return err
		}
		if existing != nil {
			continue
		}
		tpl := &models.NotifyTemplate{
			Name:        bt.name,
			ChannelType: bt.channelType,
			Content:     bt.content,
			IsBuiltin:   true,
			Checksum:    checksum,
			Status:      models.NotifyTemplateStatusApplied,
		}
		if err := db.Create(tpl).Error; err != nil {
			return fmt.Errorf("seed builtin notify template: %w", err)
		}
	}
	return nil
}

// SubmitTemplateInput 是提交模板入参（服务层）。
type SubmitTemplateInput struct {
	Name        string
	ChannelType string
	Content     string
}

// SubmitTemplate 提交一份通知模板：先校验（复用 config 工序，失败返回 *config.ErrValidation，
// 不落库），校验通过才写入一条 applied 留痕；同 channel_type + checksum 幂等。
func SubmitTemplate(db *gorm.DB, in SubmitTemplateInput) (*models.NotifyTemplate, error) {
	if in.Name == "" {
		return nil, ErrTemplateNameRequired
	}
	if !models.IsValidNotifyChannelType(in.ChannelType) {
		return nil, ErrTemplateChannelTypeInvalid
	}
	if err := validateTemplateFn(in.Content); err != nil {
		return nil, err
	}
	checksum := models.AlertmanagerConfigChecksum(in.Content)
	existing, err := findTemplateByChecksum(db, in.ChannelType, checksum)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	tpl := &models.NotifyTemplate{
		Name:        in.Name,
		ChannelType: models.NotifyChannelType(in.ChannelType),
		Content:     in.Content,
		Checksum:    checksum,
		Status:      models.NotifyTemplateStatusApplied,
	}
	if err := db.Create(tpl).Error; err != nil {
		return nil, fmt.Errorf("persist notify template: %w", err)
	}
	return tpl, nil
}

// RemountTemplate 将历史版本内容重新提交（P0 回滚动线）：复用校验工序，**总是写入新
// 留痕**（即便该内容 checksum 此前已存在）。name 非空时覆盖模板名称。校验失败返回错误、不落库。
func RemountTemplate(db *gorm.DB, id uint, name string) (*models.NotifyTemplate, error) {
	old, err := GetTemplate(db, id)
	if err != nil {
		return nil, err
	}
	if err := validateTemplateFn(old.Content); err != nil {
		return nil, err
	}
	tplName := old.Name
	if name != "" {
		tplName = name
	}
	tpl := &models.NotifyTemplate{
		Name:        tplName,
		ChannelType: old.ChannelType,
		Content:     old.Content,
		IsBuiltin:   old.IsBuiltin,
		Checksum:    models.AlertmanagerConfigChecksum(old.Content),
		Status:      models.NotifyTemplateStatusApplied,
	}
	if err := db.Create(tpl).Error; err != nil {
		return nil, fmt.Errorf("remount notify template: %w", err)
	}
	return tpl, nil
}

// ListTemplates 返回全部模板留痕版本（按留痕时间倒序，最近在前）。
func ListTemplates(db *gorm.DB) ([]models.NotifyTemplate, error) {
	var rows []models.NotifyTemplate
	if err := db.Order("created_at DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// GetTemplate 按 ID 查询模板留痕版本；不存在返回 ErrTemplateNotFound。
func GetTemplate(db *gorm.DB, id uint) (*models.NotifyTemplate, error) {
	if id == 0 {
		return nil, ErrTemplateNotFound
	}
	var tpl models.NotifyTemplate
	err := db.First(&tpl, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTemplateNotFound
	}
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

// BuiltinTemplateForType 返回该渠道类型最近一条内置默认模板；无则 ErrTemplateBuiltinMissing。
func BuiltinTemplateForType(db *gorm.DB, channelType string) (*models.NotifyTemplate, error) {
	var tpl models.NotifyTemplate
	err := db.Where("channel_type = ? AND is_builtin = ?", channelType, true).
		Order("created_at DESC, id DESC").First(&tpl).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrTemplateBuiltinMissing
	}
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

// findTemplateByChecksum 按 channel_type + checksum 查询已留痕模板；无则 (nil, nil)。
func findTemplateByChecksum(db *gorm.DB, channelType, checksum string) (*models.NotifyTemplate, error) {
	var tpl models.NotifyTemplate
	err := db.Where("channel_type = ? AND checksum = ?", channelType, checksum).First(&tpl).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

// TemplateView 是模板响应视图（id 输出为字符串，对齐契约 id:string 风格）。
type TemplateView struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	ChannelType string `json:"channel_type"`
	Content     string `json:"content"`
	IsBuiltin   bool   `json:"is_builtin"`
	Checksum    string `json:"checksum"`
	Status      string `json:"status"`
	CreatedAt   string `json:"created_at"`
}