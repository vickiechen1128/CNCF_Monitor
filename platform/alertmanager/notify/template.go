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
	// ErrTemplateBuiltinNotDeletable 内置模板随版本升级、系统统一维护，禁止删除。
	ErrTemplateBuiltinNotDeletable = errors.New("内置模板不可删除")
)

// validateTemplateFn 是模板校验入口：默认复用 config 的 amtool check-config 等价工序
// （含 Go 模板解析，决策 59/60 纪律：校验失败不落库）。测试可替换以模拟校验通过/失败。
var validateTemplateFn = config.ValidateTemplate

// BuiltinFeishuCardTemplateName 内置默认飞书卡片模板名称。
const BuiltinFeishuCardTemplateName = "飞书卡片-默认"

// BuiltinFeishuCardTemplate 内置默认飞书卡片模板（Alertmanager 标准 Go template，
// 渲染为飞书 interactive 卡片 JSON）。**以用户自建脚本 feishu_alert_notify.py 的样式为准**
// （docs/06-mvp-e2e-testing/tests/feishu_alert_notify.py 的 format_alert）：
//   - header：`{🟢|🔴} {恢复|告警}: {alertname}`，模板色由 status 决定（firing=红 / resolved=绿）；
//   - 字段：状态 / 主机 / **网域** / 区域 / 级别，再按需追加 摘要 / 详情 / 开始 / 恢复（空则省略）。
//
// 「网域」相对用户原脚本为**新增字段**（M08 §10.2 与前端告警列表同口径）：桥层已把写入侧
// network_domain_id 经 ResolveNetworkDomain 归一为消费侧 network_domain 并回写标签，故此处置前
// 读 network_domain、再兜底 network_domain_id。时间字段已由渲染层本地化
// （RenderAlert.StartsAtLocal / EndsAtLocal），不依赖宿主机时区。用户零模板即可接入。
const BuiltinFeishuCardTemplate = `{{- $resolved := eq .Status "resolved" -}}
{{- $color := "red" -}}{{- $icon := "🔴" -}}{{- $verb := "告警" -}}
{{- if $resolved -}}{{- $color = "green" -}}{{- $icon = "🟢" -}}{{- $verb = "恢复" -}}{{- end -}}
{{- $an := index .CommonLabels "alertname" -}}
{{- range $i, $a := .Alerts -}}{{- if and (eq $i 0) (not $an) -}}{{- $an = index $a.Labels "alertname" -}}{{- end -}}{{- end -}}
{{- if not $an }}{{- $an = "-" -}}{{- end -}}
{
  "msg_type": "interactive",
  "card": {
    "config": {"wide_screen_mode": true},
    "header": {
      "template": {{ jsonStr $color }},
      "title": {"tag": "plain_text", "content": {{ jsonStr (printf "%s %s: %s" $icon $verb $an) }}}
    },
    "elements": [
{{- range $i, $a := .Alerts }}
{{- if $i }},{{ end }}
{{- $nd := index $a.Labels "network_domain" -}}
{{- if not $nd }}{{- $nd = index $a.Labels "network_domain_id" -}}{{- end -}}
{{- if not $nd }}{{- $nd = "-" -}}{{- end -}}
{{- $zone := index $a.Labels "zone" -}}{{- if not $zone }}{{- $zone = "-" -}}{{- end -}}
{{- $inst := index $a.Labels "instance" -}}{{- if not $inst }}{{- $inst = "-" -}}{{- end -}}
{{- $sev := index $a.Labels "severity" -}}{{- if not $sev }}{{- $sev = "-" -}}{{- end -}}
{{- $st := "告警中" -}}{{- if eq $a.Status "resolved" -}}{{- $st = "已恢复" -}}{{- end -}}
{{- $content := printf "**状态**: %s\n**主机**: %s\n**网域**: %s\n**区域**: %s\n**级别**: %s" $st $inst $nd $zone $sev -}}
{{- if index $a.Annotations "summary" }}{{- $content = printf "%s\n**摘要**: %s" $content (index $a.Annotations "summary") -}}{{- end -}}
{{- if index $a.Annotations "description" }}{{- $content = printf "%s\n**详情**: %s" $content (index $a.Annotations "description") -}}{{- end -}}
{{- if $a.StartsAtLocal }}{{- $content = printf "%s\n**开始**: %s" $content $a.StartsAtLocal -}}{{- end -}}
{{- if and $resolved $a.EndsAtLocal }}{{- $content = printf "%s\n**恢复**: %s" $content $a.EndsAtLocal -}}{{- end -}}
      {
        "tag": "div",
        "text": {"tag": "lark_md", "content": {{ jsonStr $content }} }
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

// EnsureBuiltinTemplates 幂等写入/演进平台内置默认模板（is_builtin=true）。
// 同名内置模板已存在时按 content/checksum 原地更新（不新增重复行），使内置模板随
// 版本迭代收敛；同 channel_type + checksum 已存在则跳过。
func EnsureBuiltinTemplates(db *gorm.DB) error {
	for _, bt := range builtinTemplates() {
		checksum := models.AlertmanagerConfigChecksum(bt.content)
		// 同名内置模板：演进式更新，避免每次改模板都留历史重复行。
		var existing models.NotifyTemplate
		qErr := db.Where("channel_type = ? AND is_builtin = ? AND name = ?",
			string(bt.channelType), true, bt.name).First(&existing).Error
		if qErr == nil {
			if existing.Checksum == checksum {
				continue
			}
			existing.Content = bt.content
			existing.Checksum = checksum
			existing.Status = models.NotifyTemplateStatusApplied
			if err := db.Save(&existing).Error; err != nil {
				return fmt.Errorf("update builtin notify template: %w", err)
			}
			continue
		}
		if !errors.Is(qErr, gorm.ErrRecordNotFound) {
			return qErr
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
	existing, err := findTemplateByChecksum(db, in.Name, in.ChannelType, checksum)
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

// DeleteTemplate 删除一条自定义模板留痕版本（仅自定义，内置模板禁止删除）。
// 不存在返回 ErrTemplateNotFound；内置返回 ErrTemplateBuiltinNotDeletable。
// 删除是物理删除（模板为不可变留痕版本，无关联下发态依赖；桥层按 id 解析，删除后该 id 不再被引用）。
func DeleteTemplate(db *gorm.DB, id uint) error {
	tpl, err := GetTemplate(db, id)
	if err != nil {
		return err
	}
	if tpl.IsBuiltin {
		return ErrTemplateBuiltinNotDeletable
	}
	if err := db.Delete(&models.NotifyTemplate{}, id).Error; err != nil {
		return fmt.Errorf("delete notify template: %w", err)
	}
	return nil
}

// BuiltinTemplateForType 返回该渠道类型最近一条内置默认模板；无则 ErrTemplateBuiltinMissing.
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

// findTemplateByChecksum 按 name + channel_type + checksum 查询已留痕模板；无则 (nil, nil)。
// 去重键含 name（而非仅 channel_type + checksum）：同名同内容才视为同一份、幂等返回既有行；
// 改名同内容（如「复制并自定义」克隆内置模板仅改名）一律视为新模板、新建留痕，避免克隆副本被
// 既有内置模板的内容去重误伤（dev-feedback #29）。同名改内容 → checksum 不同 → 新建一版（append-only）。
func findTemplateByChecksum(db *gorm.DB, name, channelType, checksum string) (*models.NotifyTemplate, error) {
	var tpl models.NotifyTemplate
	err := db.Where("name = ? AND channel_type = ? AND checksum = ?", name, channelType, checksum).First(&tpl).Error
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