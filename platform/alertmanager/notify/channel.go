// Package notify 实现 Module_08 告警收敛与通知管理的 PL-3 通知渲染桥：
// 通知渠道（NotifyChannel）CRUD + 通知模板（NotifyTemplate）校验留痕与回滚 +
// 平台内置渲染端点 POST /api/v1/webhooks/notify（AM 投递 → 按模板渲染 → 转投机器人）。
// 参见设计提案 docs/05-execution-records/module-08/design-proposals/alert-config-scope-and-notification-bridge.md
//   §3.3.2（数据模型）/ §3.3.3（内置渲染端点）/ §3.3.8（接口契约汇总）。
// 安全口径：桥端点仅接受平台内已登记的 channel ID（目标地址由服务端从 DB 解析，
// 杜绝 SSRF）；内网调用令牌鉴权；出站 HTTP 客户端统一 CA 配置（client.go）。
package notify

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 渠道服务层错误（handler 映射为统一 errorType：bad_request / not_found）。
var (
	// ErrChannelNameRequired 渠道名称必填。
	ErrChannelNameRequired = errors.New("渠道名称不能为空")
	// ErrChannelTypeInvalid 渠道类型非法。
	ErrChannelTypeInvalid = errors.New("渠道类型非法（仅支持 feishu / dingtalk / wecom）")
	// ErrChannelWebhookInvalid 机器人 Webhook 地址非法。
	ErrChannelWebhookInvalid = errors.New("机器人 Webhook 地址非法（仅允许 http/https 且 host 非空）")
	// ErrChannelNotFound 渠道不存在。
	ErrChannelNotFound = errors.New("通知渠道不存在")
)

// ValidateWebhookURL 校验出站目标地址：仅允许 http / https scheme 且 host 非空
// （对齐 AGENTS.md §9 SSRF 防护与 API 标准 URL 校验规则）。
func ValidateWebhookURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return ErrChannelWebhookInvalid
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrChannelWebhookInvalid
	}
	if u.Host == "" {
		return ErrChannelWebhookInvalid
	}
	return nil
}

// ChannelInput 是创建渠道入参（服务层）。
type ChannelInput struct {
	Name       string
	Type       string
	WebhookURL string
	Secret     string
	// Enabled 为 nil 时默认 true（创建）。
	Enabled *bool
}

// UpdateChannelInput 是更新渠道入参：指针字段语义为「仅更新显式提供的字段」，
// 未提供（nil）时保留原值——列表响应已对 webhook_url / secret 脱敏，更新无需回显凭据。
type UpdateChannelInput struct {
	Name       *string
	Type       *string
	WebhookURL *string
	Secret     *string
	Enabled    *bool
}

// CreateChannel 创建通知渠道：校验名称 / 类型 / Webhook 地址后落库。
func CreateChannel(db *gorm.DB, in ChannelInput) (*models.NotifyChannel, error) {
	if in.Name == "" {
		return nil, ErrChannelNameRequired
	}
	if !models.IsValidNotifyChannelType(in.Type) {
		return nil, ErrChannelTypeInvalid
	}
	if err := ValidateWebhookURL(in.WebhookURL); err != nil {
		return nil, err
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	ch := &models.NotifyChannel{
		Name:       in.Name,
		Type:       models.NotifyChannelType(in.Type),
		WebhookURL: in.WebhookURL,
		Secret:     in.Secret,
		Enabled:    enabled,
	}
	if err := db.Create(ch).Error; err != nil {
		return nil, fmt.Errorf("persist notify channel: %w", err)
	}
	return ch, nil
}

// UpdateChannel 更新通知渠道（仅更新显式提供的字段）；不存在返回 ErrChannelNotFound。
func UpdateChannel(db *gorm.DB, id uint, in UpdateChannelInput) (*models.NotifyChannel, error) {
	ch, err := GetChannel(db, id)
	if err != nil {
		return nil, err
	}
	if in.Name != nil {
		if *in.Name == "" {
			return nil, ErrChannelNameRequired
		}
		ch.Name = *in.Name
	}
	if in.Type != nil {
		if !models.IsValidNotifyChannelType(*in.Type) {
			return nil, ErrChannelTypeInvalid
		}
		ch.Type = models.NotifyChannelType(*in.Type)
	}
	if in.WebhookURL != nil {
		if err := ValidateWebhookURL(*in.WebhookURL); err != nil {
			return nil, err
		}
		ch.WebhookURL = *in.WebhookURL
	}
	if in.Secret != nil {
		ch.Secret = *in.Secret
	}
	if in.Enabled != nil {
		ch.Enabled = *in.Enabled
	}
	if err := db.Save(ch).Error; err != nil {
		return nil, fmt.Errorf("update notify channel: %w", err)
	}
	return ch, nil
}

// ListChannels 返回全部通知渠道（按 ID 升序）。
func ListChannels(db *gorm.DB) ([]models.NotifyChannel, error) {
	var rows []models.NotifyChannel
	if err := db.Order("id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

// GetChannel 按 ID 查询通知渠道；不存在返回 ErrChannelNotFound。
func GetChannel(db *gorm.DB, id uint) (*models.NotifyChannel, error) {
	if id == 0 {
		return nil, ErrChannelNotFound
	}
	var ch models.NotifyChannel
	err := db.First(&ch, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrChannelNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ch, nil
}

// DeleteChannel 删除通知渠道（GORM 软删除）；不存在返回 ErrChannelNotFound。
func DeleteChannel(db *gorm.DB, id uint) error {
	if _, err := GetChannel(db, id); err != nil {
		return err
	}
	if err := db.Delete(&models.NotifyChannel{}, id).Error; err != nil {
		return fmt.Errorf("delete notify channel: %w", err)
	}
	return nil
}

// ChannelView 是渠道响应视图（契约：响应脱敏，不回显 secret / 完整 webhook_url）。
type ChannelView struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	WebhookURL string `json:"webhook_url"`
	SecretSet  bool   `json:"secret_set"`
	Enabled    bool   `json:"enabled"`
	CreatedAt  string `json:"created_at"`
}

// ToChannelView 将渠道转换为脱敏响应视图。
func ToChannelView(ch *models.NotifyChannel) ChannelView {
	return ChannelView{
		ID:         strconv.FormatUint(uint64(ch.ID), 10),
		Name:       ch.Name,
		Type:       string(ch.Type),
		WebhookURL: maskWebhookURL(ch.WebhookURL),
		SecretSet:  ch.Secret != "",
		Enabled:    ch.Enabled,
		CreatedAt:  ch.CreatedAt.Format(time.RFC3339),
	}
}

// maskWebhookURL 脱敏出站地址：保留 scheme://host，路径与查询（含 token）以 /*** 替代。
func maskWebhookURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "***"
	}
	return u.Scheme + "://" + u.Host + "/***"
}