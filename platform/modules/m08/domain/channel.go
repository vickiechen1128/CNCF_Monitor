package domain

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ErrWebhookInvalid is returned for an unusable outbound webhook target.
var ErrWebhookInvalid = NewValidationError("webhook_url", "Webhook 地址非法：仅允许 http/https 且 host 非空")

// Channel is a notification channel (FR-09). Channel secrets are stored in
// plaintext for now (D45) and must never leave the service layer.
type Channel struct {
	ID         string
	Name       string
	Type       ChannelType
	WebhookURL string
	Secret     string
	SignEnabled bool
	TemplateID *string
	CreatedAt  string
	UpdatedAt  string
}

// ReceiverName returns the stable Alertmanager receiver name for this channel:
// `notify-<id>` (id never changes, so renaming a channel cannot break routes).
func (c Channel) ReceiverName() string { return "notify-" + c.ID }

// ValidateChannel validates a channel payload. allowPrivate relaxes the SSRF
// guard for explicitly whitelisted internal targets (NFR-07).
func ValidateChannel(c *Channel, allowPrivate bool) []ValidationIssue {
	var issues []ValidationIssue
	if strings.TrimSpace(c.Name) == "" {
		issues = append(issues, ValidationIssue{Field: "name", Message: "渠道名称不能为空"})
	}
	if !IsValidChannelType(c.Type) {
		issues = append(issues, ValidationIssue{
			Field: "channel_type",
			Message: fmt.Sprintf("渠道类型 %q 非法：必须是 feishu / dingtalk / wecom / webhook", c.Type),
		})
	}
	if err := ValidateWebhookURL(c.WebhookURL, allowPrivate); err != nil {
		issues = append(issues, ValidationIssue{Field: "webhook_url", Message: err.Error()})
	}
	if c.SignEnabled && strings.TrimSpace(c.Secret) == "" {
		issues = append(issues, ValidationIssue{Field: "secret", Message: "启用加签时必须填写加签密钥"})
	}
	if c.Type == ChannelTypeWebhook && c.TemplateID != nil && *c.TemplateID != "" {
		issues = append(issues, ValidationIssue{Field: "template_id", Message: "自定义 Webhook 不允许绑定通知模板"})
	}
	if IsIM(c.Type) && (c.TemplateID == nil || strings.TrimSpace(*c.TemplateID) == "") {
		issues = append(issues, ValidationIssue{Field: "template_id", Message: "IM 类渠道必须绑定一个通知模板"})
	}
	return issues
}

// ValidateWebhookURL validates an outbound target: http/https with a host, and
// by default no loopback / private / link-local / unspecified literal address.
// Hostnames are not resolved here (validation must not perform egress); the
// egress layer is expected to enforce the same policy.
func ValidateWebhookURL(raw string, allowPrivate bool) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return ErrWebhookInvalid
	}
	if allowPrivate {
		return nil
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if host == "localhost" || host == "metadata.google.internal" {
		return ErrWebhookInvalid
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return ErrWebhookInvalid
		}
	}
	return nil
}
