package notify

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

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
	// ErrTemplateChannelTypeImmutable 模板适用渠道类型创建后不可修改。
	ErrTemplateChannelTypeImmutable = errors.New("模板适用渠道类型创建后不可修改；如需其他类型请复制模板")
	// ErrTemplateNameConflict 同渠道类型下已存在同名模板。
	ErrTemplateNameConflict = errors.New("同渠道类型下已存在同名模板，请更换名称")
	// ErrTemplateNotFound 通知模板不存在。
	ErrTemplateNotFound = errors.New("通知模板不存在")
	// ErrTemplateBuiltinMissing 该渠道类型暂无内置默认模板（且未显式指定模板）。
	ErrTemplateBuiltinMissing = errors.New("该渠道类型暂无内置默认模板，请显式指定模板")
	// ErrTemplateBuiltinNotDeletable 内置模板随版本升级、系统统一维护，禁止删除。
	ErrTemplateBuiltinNotDeletable = errors.New("内置模板不可删除")
	// ErrTemplateBuiltinNotEditable 内置模板随版本升级、系统统一维护，禁止编辑。
	ErrTemplateBuiltinNotEditable = errors.New("内置模板不可编辑，请复制为自定义模板")
)

// ErrTemplateInUse 模板正被通知渠道绑定，禁止删除。
type ErrTemplateInUse struct {
	Channels []string
}

func (e *ErrTemplateInUse) Error() string {
	if len(e.Channels) == 0 {
		return "模板正被通知渠道使用，请先在通知渠道页改绑后再删除"
	}
	return fmt.Sprintf("模板正被 %d 个通知渠道使用（%s），请先在通知渠道页改绑后再删除",
		len(e.Channels), strings.Join(e.Channels, "、"))
}

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

// CreateTemplateInput 是新建模板入参（服务层）。
type CreateTemplateInput struct {
	Name        string
	ChannelType string
	Content     string
}

// UpdateTemplateInput 是编辑模板入参（服务层）。
// ChannelType 只用于「不可变」校验：非空且与原类型不一致时返回 ErrTemplateChannelTypeImmutable。
type UpdateTemplateInput struct {
	Name        string
	ChannelType string
	Content     string
}

// CreateTemplate 新建一份自定义模板：校验名称 / 渠道类型 / 模板内容后落库。
// 校验失败返回 *config.ErrValidation，不落库；同渠道类型下名称唯一。
func CreateTemplate(db *gorm.DB, in CreateTemplateInput) (*models.NotifyTemplate, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, ErrTemplateNameRequired
	}
	if !models.IsTemplateChannelType(in.ChannelType) {
		return nil, ErrTemplateChannelTypeInvalid
	}
	if err := validateTemplateFn(in.Content); err != nil {
		return nil, err
	}
	if err := ensureTemplateNameAvailable(db, name, in.ChannelType, 0); err != nil {
		return nil, err
	}
	tpl := &models.NotifyTemplate{
		Name:        name,
		ChannelType: models.NotifyChannelType(in.ChannelType),
		Content:     in.Content,
		Checksum:    models.AlertmanagerConfigChecksum(in.Content),
		Status:      models.NotifyTemplateStatusApplied,
	}
	if err := db.Create(tpl).Error; err != nil {
		return nil, fmt.Errorf("persist notify template: %w", err)
	}
	return tpl, nil
}

// UpdateTemplate 编辑自定义模板（内置模板拒绝）。模板内容先校验，失败不落库；改名须满足
// 同渠道类型下名称唯一。渠道类型创建后不可变（如需其他类型请复制模板）。
func UpdateTemplate(db *gorm.DB, id uint, in UpdateTemplateInput) (*models.NotifyTemplate, error) {
	tpl, err := GetTemplate(db, id)
	if err != nil {
		return nil, err
	}
	if tpl.IsBuiltin {
		return nil, ErrTemplateBuiltinNotEditable
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, ErrTemplateNameRequired
	}
	if in.ChannelType != "" && in.ChannelType != string(tpl.ChannelType) {
		return nil, ErrTemplateChannelTypeImmutable
	}
	if err := validateTemplateFn(in.Content); err != nil {
		return nil, err
	}
	if err := ensureTemplateNameAvailable(db, name, string(tpl.ChannelType), tpl.ID); err != nil {
		return nil, err
	}
	if name == tpl.Name && in.Content == tpl.Content {
		return tpl, nil
	}
	tpl.Name = name
	tpl.Content = in.Content
	tpl.Checksum = models.AlertmanagerConfigChecksum(in.Content)
	tpl.Status = models.NotifyTemplateStatusApplied
	if err := db.Save(tpl).Error; err != nil {
		return nil, fmt.Errorf("update notify template: %w", err)
	}
	return tpl, nil
}

// ensureTemplateNameAvailable 校验同渠道类型下模板名称唯一（excludeID 用于编辑时排除自身）。
func ensureTemplateNameAvailable(db *gorm.DB, name, channelType string, excludeID uint) error {
	q := db.Model(&models.NotifyTemplate{}).Where("name = ? AND channel_type = ?", name, channelType)
	if excludeID != 0 {
		q = q.Where("id <> ?", excludeID)
	}
	var n int64
	if err := q.Count(&n).Error; err != nil {
		return fmt.Errorf("check notify template name: %w", err)
	}
	if n > 0 {
		return ErrTemplateNameConflict
	}
	return nil
}

// TemplateListItem 是模板列表项（不含 content，避免列表按体积拉取模板全文）。
type TemplateListItem struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	ChannelType       string `json:"channel_type"`
	IsBuiltin         bool   `json:"is_builtin"`
	BoundChannelCount int64  `json:"bound_channel_count"`
	CreatedAt         string `json:"created_at"`
	UpdatedAt         string `json:"updated_at"`
}

// TemplateDetail 是模板详情（含 content，供查看 / 编辑 / 复制）。
type TemplateDetail struct {
	TemplateListItem
	Content string `json:"content"`
}

// ListTemplates 返回模板清单（内置在前，其后按更新时间倒序），可按渠道类型过滤。
// bound_channel_count 为该模板被多少个未删除的通知渠道显式绑定（用于删除前提示）。
func ListTemplates(db *gorm.DB, channelType string) ([]TemplateListItem, error) {
	q := db.Order("is_builtin DESC, updated_at DESC, id DESC")
	if channelType != "" {
		q = q.Where("channel_type = ?", channelType)
	}
	var rows []models.NotifyTemplate
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	counts, err := templateBoundChannelCounts(db)
	if err != nil {
		return nil, err
	}
	items := make([]TemplateListItem, 0, len(rows))
	for i := range rows {
		items = append(items, toTemplateListItem(&rows[i], counts[rows[i].ID]))
	}
	return items, nil
}

// templateBoundChannelCount 返回单个模板被多少个未删除渠道绑定。
func templateBoundChannelCount(db *gorm.DB, id uint) (int64, error) {
	var n int64
	if err := db.Model(&models.NotifyChannel{}).
		Where("default_template_id = ?", id).
		Count(&n).Error; err != nil {
		return 0, fmt.Errorf("count template bindings: %w", err)
	}
	return n, nil
}

// templateBoundChannelCounts 聚合每个模板被多少个未删除渠道绑定（模板 ID → 数量）。
func templateBoundChannelCounts(db *gorm.DB) (map[uint]int64, error) {
	type countRow struct {
		TemplateID uint
		Count      int64
	}
	var rows []countRow
	if err := db.Model(&models.NotifyChannel{}).
		Select("default_template_id AS template_id, COUNT(*) AS count").
		Where("default_template_id IS NOT NULL").
		Group("default_template_id").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("count template bindings: %w", err)
	}
	out := make(map[uint]int64, len(rows))
	for _, r := range rows {
		out[r.TemplateID] = r.Count
	}
	return out, nil
}

// GetTemplate 按 ID 查询模板；不存在返回 ErrTemplateNotFound。
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

// DeleteTemplate 删除一条自定义模板（内置模板禁止删除；被渠道绑定时禁止删除）。
// 不存在返回 ErrTemplateNotFound；内置返回 ErrTemplateBuiltinNotDeletable；
// 被绑定返回 *ErrTemplateInUse（附渠道名，提示先去通知渠道页改绑）。
func DeleteTemplate(db *gorm.DB, id uint) error {
	tpl, err := GetTemplate(db, id)
	if err != nil {
		return err
	}
	if tpl.IsBuiltin {
		return ErrTemplateBuiltinNotDeletable
	}
	var channels []models.NotifyChannel
	if err := db.Where("default_template_id = ?", id).Order("id ASC").Find(&channels).Error; err != nil {
		return fmt.Errorf("load template bindings: %w", err)
	}
	if len(channels) > 0 {
		names := make([]string, 0, len(channels))
		for i := range channels {
			names = append(names, channels[i].Name)
		}
		return &ErrTemplateInUse{Channels: names}
	}
	if err := db.Delete(&models.NotifyTemplate{}, id).Error; err != nil {
		return fmt.Errorf("delete notify template: %w", err)
	}
	return nil
}

// CompactTemplateVersions 把历史 append-only 留痕收敛为「一行 = 一个模板」：
// 按 (name, channel_type, is_builtin) 分组，只保留最新一条（created_at/id 最大），
// 把仍指向旧行的渠道绑定重定向到保留行，旧行软删。幂等，可重复执行。
//
// 2026-10-22 模板改为可编辑模型，不再保留版本历史；启动时执行一次即可。
func CompactTemplateVersions(db *gorm.DB) error {
	var rows []models.NotifyTemplate
	if err := db.Order("created_at ASC, id ASC").Find(&rows).Error; err != nil {
		return fmt.Errorf("load notify templates for compaction: %w", err)
	}
	type groupKey struct {
		Name        string
		ChannelType models.NotifyChannelType
		IsBuiltin   bool
	}
	groups := make(map[groupKey][]models.NotifyTemplate)
	for _, r := range rows {
		k := groupKey{Name: r.Name, ChannelType: r.ChannelType, IsBuiltin: r.IsBuiltin}
		groups[k] = append(groups[k], r)
	}
	for _, list := range groups {
		if len(list) <= 1 {
			continue
		}
		keep := list[len(list)-1]
		for _, old := range list[:len(list)-1] {
			if err := db.Model(&models.NotifyChannel{}).
				Where("default_template_id = ?", old.ID).
				Update("default_template_id", keep.ID).Error; err != nil {
				return fmt.Errorf("remap channel template binding %d -> %d: %w", old.ID, keep.ID, err)
			}
			if err := db.Delete(&models.NotifyTemplate{}, old.ID).Error; err != nil {
				return fmt.Errorf("delete superseded notify template %d: %w", old.ID, err)
			}
		}
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

// toTemplateListItem 转换列表视图（id 输出为字符串，对齐契约 id:string 风格）。
func toTemplateListItem(t *models.NotifyTemplate, bound int64) TemplateListItem {
	return TemplateListItem{
		ID:                strconv.FormatUint(uint64(t.ID), 10),
		Name:              t.Name,
		ChannelType:       string(t.ChannelType),
		IsBuiltin:         t.IsBuiltin,
		BoundChannelCount: bound,
		CreatedAt:         t.CreatedAt.Format(time.RFC3339),
		UpdatedAt:         t.UpdatedAt.Format(time.RFC3339),
	}
}

// toTemplateDetail 转换详情视图（含 content）。
func toTemplateDetail(t *models.NotifyTemplate, bound int64) TemplateDetail {
	return TemplateDetail{
		TemplateListItem: toTemplateListItem(t, bound),
		Content:          t.Content,
	}
}