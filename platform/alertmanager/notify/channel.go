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
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/alertmanager/route"
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
	ErrChannelWebhookInvalid = errors.New("机器人 Webhook 地址非法（仅允许 http/https、host 非空，且禁止私网 / 环回 / link-local / 云元数据地址）")
	// ErrChannelReferenceCheckFailed 无法解析当前告警路由配置，删除前的引用检查无法完成。
	ErrChannelReferenceCheckFailed = errors.New("无法解析当前告警路由配置，暂不能删除渠道；请先修复路由配置")
	// ErrChannelNotFound 渠道不存在。
	ErrChannelNotFound = errors.New("通知渠道不存在")
	// ErrChannelTemplateNotFound 渠道绑定的通知模板不存在（渠道 ↔ 模板绑定，dev-feedback #30）。
	ErrChannelTemplateNotFound = errors.New("绑定的通知模板不存在")
	// ErrChannelTemplateMismatch 渠道绑定的通知模板类型与渠道类型不一致。
	ErrChannelTemplateMismatch = errors.New("绑定的模板渠道类型与渠道不一致")
)

// allowPrivateWebhookTargets 允许私网 / 环回 / link-local 目标地址（默认 false = 拒绝）。
//
// 生产默认拒绝：飞书 / 钉钉 / 企业微信机器人 Webhook 均为公网地址，私网、环回与云元数据
// 端点（169.254.169.254）应被 SSRF 防护拒绝（security-review-pl3 M-2）。仅在内网自建
// 机器人或测试桩（httptest 回环地址）场景显式置 true；测试用 newNotifyDB 置 true 并复原。
var allowPrivateWebhookTargets bool

// SetAllowPrivateWebhookTargets 允许 / 禁止私网 webhook 目标地址（内网自建机器人与
// 跨包集成测试场景显式开启；生产默认 false 拒绝）。非并发安全，仅供启动期装配 / 测试使用。
func SetAllowPrivateWebhookTargets(allow bool) { allowPrivateWebhookTargets = allow }

// ValidateWebhookURL 校验出站目标地址：仅允许 http / https scheme 且 host 非空
// （对齐 AGENTS.md §9 SSRF 防护与 API 标准 URL 校验规则）；默认拒绝私网 / 环回 /
// link-local / 云元数据（169.254.169.254）地址，除非 allowPrivateWebhookTargets（M-2）。
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
	if !allowPrivateWebhookTargets {
		if err := rejectPrivateHost(u.Hostname()); err != nil {
			return err
		}
	}
	return nil
}

// rejectPrivateHost 拒绝私网 / 环回 / link-local / 未指定地址与 localhost 主机名。
// 仅对 IP 字面量与 localhost 生效（不做 DNS 解析，避免校验期外联）；域名形式的 SSRF
// 需在下发/出站层另行收敛，属后续增量。
func rejectPrivateHost(host string) error {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	if h == "localhost" {
		return ErrChannelWebhookInvalid
	}
	ip := net.ParseIP(h)
	if ip == nil {
		return nil
	}
	// 169.254.0.0/16（含云元数据 169.254.169.254）已含于 LinkLocalUnicast。
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
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
	// DefaultTemplateID 绑定的通知模板（可选）：nil 不绑定（用内置默认）；非空须存在且渠道类型一致。
	DefaultTemplateID *uint
}

// UpdateChannelInput 是更新渠道入参：指针字段语义为「仅更新显式提供的字段」，
// 未提供（nil）时保留原值——列表响应已对 webhook_url / secret 脱敏，更新无需回显凭据。
type UpdateChannelInput struct {
	Name       *string
	Type       *string
	WebhookURL *string
	Secret     *string
	// DefaultTemplateID 绑定调整：nil = 保留原绑定；0 = 解绑（回落内置默认）；>0 = 改为该模板
	// （须存在且渠道类型一致）。以 0 表达「解绑」是因为「不传」已被「保留」占用，而用户需要能把
	// 已绑定的渠道改回内置默认（否则绑定一旦设置无法撤销）。
	DefaultTemplateID *uint
}

// resolveChannelTemplateID 校验并解析渠道模板绑定（dev-feedback #30 方案 B §5.5）：
// 非空绑定须存在（ErrChannelTemplateNotFound）且与渠道类型一致（ErrChannelTemplateMismatch）。
// 返回规范化后的绑定值（nil 或 >0 的指针）。
func resolveChannelTemplateID(db *gorm.DB, raw *uint, chType models.NotifyChannelType) (*uint, error) {
	if raw == nil || *raw == 0 {
		return nil, nil // 未绑定 / 解绑
	}
	tpl, err := GetTemplate(db, *raw)
	if err != nil {
		if errors.Is(err, ErrTemplateNotFound) {
			return nil, ErrChannelTemplateNotFound
		}
		return nil, err
	}
	if tpl.ChannelType != chType {
		return nil, ErrChannelTemplateMismatch
	}
	id := *raw
	return &id, nil
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
	binding, err := resolveChannelTemplateID(db, in.DefaultTemplateID, models.NotifyChannelType(in.Type))
	if err != nil {
		return nil, err
	}
	ch := &models.NotifyChannel{
		Name:              in.Name,
		Type:              models.NotifyChannelType(in.Type),
		WebhookURL:        in.WebhookURL,
		Secret:            in.Secret,
		DefaultTemplateID: binding,
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
	// 绑定校验用更新后的渠道类型（Type 与 DefaultTemplateID 可在同一次更新中调整）。
	if in.DefaultTemplateID != nil {
		binding, err := resolveChannelTemplateID(db, in.DefaultTemplateID, ch.Type)
		if err != nil {
			return nil, err
		}
		ch.DefaultTemplateID = binding
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

// ErrChannelInUse 表示渠道被当前路由规则引用，禁止删除（应先到路由规则页改绑）。
type ErrChannelInUse struct {
	Receiver string
	Routes   []string
}

func (e *ErrChannelInUse) Error() string {
	if len(e.Routes) == 0 {
		return fmt.Sprintf("通知渠道（%s）正在被路由规则引用，请先在路由规则页改绑后再删除", e.Receiver)
	}
	return fmt.Sprintf("通知渠道（%s）正在被 %d 条路由规则引用（%s），请先在路由规则页改绑后再删除",
		e.Receiver, len(e.Routes), strings.Join(e.Routes, "、"))
}

// DeleteChannel 删除通知渠道（GORM 软删除）；不存在返回 ErrChannelNotFound。
//
// 2026-10-22：删除前检查路由引用。渠道的 receiver 名恒为 notify-<id>；若当前生效/待确认
// 路由树仍引用它，删除会让下一次生成的 alertmanager.yml 出现悬空 receiver（amtool 校验失败），
// 因此拒绝删除并返回 ErrChannelInUse，要求用户先改路由。
func DeleteChannel(db *gorm.DB, id uint) error {
	ch, err := GetChannel(db, id)
	if err != nil {
		return err
	}
	refs, err := route.ReferencedReceiverNames(db)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrChannelReferenceCheckFailed, err)
	}
	if routes := refs[ch.ReceiverName()]; len(routes) > 0 {
		return &ErrChannelInUse{Receiver: ch.ReceiverName(), Routes: routes}
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
	// DefaultTemplateID 绑定的通知模板 ID（null/缺省 = 用内置默认模板）；非敏感字段，直接回显。
	DefaultTemplateID *uint `json:"default_template_id,omitempty"`
	// ReceiverName 是渠道在 alertmanager.yml `receivers:` 段中的稳定接收人名（恒为 notify-<id>，
	// 与 M09 生成器同源）。非敏感字段，直接回显，供前端路由页把 notify-<id> 映射为渠道中文名。
	ReceiverName string `json:"receiver_name"`
	// RouteReferenceCount 是当前生效 / 待确认路由树中引用该渠道 receiver 的节点数。
	// 0 = 渠道未被任何路由使用（不会物化进 alertmanager.yml，也不会有告警送达）；
	// >0 = 正在被路由使用，删除会被后端拒绝（需先去路由页改绑）。
	RouteReferenceCount int64  `json:"route_reference_count"`
	CreatedAt           string `json:"created_at"`
}

// ToChannelView 将渠道转换为脱敏响应视图。
func ToChannelView(ch *models.NotifyChannel) ChannelView {
	return ChannelView{
		ID:                strconv.FormatUint(uint64(ch.ID), 10),
		Name:              ch.Name,
		Type:              string(ch.Type),
		WebhookURL:        maskWebhookURL(ch.WebhookURL),
		SecretSet:         ch.Secret != "",
		DefaultTemplateID: ch.DefaultTemplateID,
		ReceiverName:      ch.ReceiverName(),
		CreatedAt:         ch.CreatedAt.Format(time.RFC3339),
	}
}

// toChannelViewWithRouteRefs 在基础视图上补充「被多少条路由引用」。
// refs 为 receiver 名 → 引用它的路由展示名列表；为空 / 读取失败时计 0（仅影响展示）。
func toChannelViewWithRouteRefs(ch *models.NotifyChannel, refs map[string][]string) ChannelView {
	v := ToChannelView(ch)
	v.RouteReferenceCount = int64(len(refs[v.ReceiverName]))
	return v
}

// maskWebhookURL 脱敏出站地址：保留 scheme://host，路径与查询（含 token）以 /*** 替代。
func maskWebhookURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "***"
	}
	return u.Scheme + "://" + u.Host + "/***"
}