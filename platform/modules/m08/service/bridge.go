package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// BridgeService renders notifications and forwards them to the channel target
// (FR-12). Webhook channels get the raw Alertmanager payload; IM channels get a
// rendered, optionally signed text message.
type BridgeService struct {
	channels  repository.ChannelRepository
	templates repository.TemplateRepository
	client    *http.Client
	now       func() time.Time
}

// NewBridgeService constructs the bridge.
func NewBridgeService(channels repository.ChannelRepository, templates repository.TemplateRepository) *BridgeService {
	return &BridgeService{channels: channels, templates: templates,
		client: &http.Client{Timeout: 10 * time.Second},
		now:    func() time.Time { return time.Now().UTC() }}
}

// Notify delivers one Alertmanager notification to the referenced channel.
// raw is the original webhook body for custom webhook channels.
func (s *BridgeService) Notify(ctx context.Context, channelID string, payload WebhookPayload, raw []byte) error {
	channel, err := s.channels.Get(ctx, channelID)
	if err != nil {
		return err
	}
	if channel.Type == domain.ChannelTypeWebhook {
		if len(raw) == 0 {
			return fmt.Errorf("bridge: raw payload is empty")
		}
		return s.post(ctx, channel, raw, "application/json")
	}
	content, err := s.render(ctx, channel, payload)
	if err != nil {
		return err
	}
	body, contentType, err := imRequest(channel, content)
	if err != nil {
		return err
	}
	target := channel.WebhookURL
	if channel.Type == domain.ChannelTypeDingtalk && channel.SignEnabled {
		target, err = signDingtalk(target, channel.Secret, s.now())
		if err != nil {
			return err
		}
	}
	return s.postURL(ctx, target, body, contentType)
}

type renderAlert struct {
	Status      string            `json:"status"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    string            `json:"starts_at"`
	EndsAt      string            `json:"ends_at"`
}

type renderView struct {
	Status            string            `json:"status"`
	Receiver          string            `json:"receiver"`
	Alerts            []renderAlert     `json:"alerts"`
	CommonLabels      map[string]string `json:"common_labels"`
	CommonAnnotations map[string]string `json:"common_annotations"`
	GroupLabels       map[string]string `json:"group_labels"`
}

func (s *BridgeService) render(ctx context.Context, channel *domain.Channel, payload WebhookPayload) (string, error) {
	tmpl, err := s.templateFor(ctx, channel)
	if err != nil {
		return "", err
	}
	parsed, err := template.New("m08-notify").Funcs(domain.TemplateFuncMap()).Parse(tmpl.Content)
	if err != nil {
		return "", fmt.Errorf("bridge: parse template %q: %w", tmpl.Name, err)
	}
	view := renderView{
		Status: payload.Status, Receiver: payload.Receiver,
		CommonLabels: payload.CommonLabels, CommonAnnotations: payload.CommonAnnotations,
		GroupLabels: payload.GroupLabels,
	}
	for _, alert := range payload.Alerts {
		view.Alerts = append(view.Alerts, renderAlert{
			Status: alert.Status, Labels: alert.Labels, Annotations: alert.Annotations,
			StartsAt: alert.StartsAt.Format(time.RFC3339), EndsAt: alert.EndsAt.Format(time.RFC3339),
		})
	}
	var buf bytes.Buffer
	if err := parsed.Execute(&buf, view); err != nil {
		return "", fmt.Errorf("bridge: render template %q: %w", tmpl.Name, err)
	}
	return strings.TrimSpace(buf.String()), nil
}

// templateFor resolves the bound template, falling back to the built-in one of
// the same channel type.
func (s *BridgeService) templateFor(ctx context.Context, channel *domain.Channel) (*domain.Template, error) {
	if channel.TemplateID != nil && *channel.TemplateID != "" {
		return s.templates.Get(ctx, *channel.TemplateID)
	}
	all, err := s.templates.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ChannelType == channel.Type && all[i].Builtin {
			return all[i], nil
		}
	}
	return nil, fmt.Errorf("bridge: no template available for channel type %q", channel.Type)
}

func imRequest(channel *domain.Channel, content string) ([]byte, string, error) {
	var body map[string]any
	switch channel.Type {
	case domain.ChannelTypeFeishu:
		body = map[string]any{"msg_type": "text", "content": map[string]string{"text": content}}
	case domain.ChannelTypeWecom:
		body = map[string]any{"msgtype": "text", "text": map[string]string{"content": content}}
	case domain.ChannelTypeDingtalk:
		body = map[string]any{"msgtype": "text", "text": map[string]string{"content": content}}
	default:
		return nil, "", fmt.Errorf("bridge: unsupported channel type %q", channel.Type)
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, "", fmt.Errorf("bridge: marshal payload: %w", err)
	}
	return raw, "application/json", nil
}

// signDingtalk appends timestamp + HMAC-SHA256 signature query parameters.
func signDingtalk(target, secret string, now time.Time) (string, error) {
	u, err := url.Parse(target)
	if err != nil {
		return "", fmt.Errorf("bridge: invalid dingtalk url: %w", err)
	}
	timestamp := strconv.FormatInt(now.UnixMilli(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "\n" + secret))
	sign := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	query := u.Query()
	query.Set("timestamp", timestamp)
	query.Set("sign", sign)
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func (s *BridgeService) post(ctx context.Context, channel *domain.Channel, body []byte, contentType string) error {
	return s.postURL(ctx, channel.WebhookURL, body, contentType)
}

func (s *BridgeService) postURL(ctx context.Context, target string, body []byte, contentType string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("bridge: build request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := s.client.Do(req)
	if err != nil {
		return &domain.UpstreamError{Message: "通知投递失败", Err: err}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &domain.UpstreamError{
			Message: fmt.Sprintf("通知投递失败：目标返回 %d", resp.StatusCode),
		}
	}
	return nil
}
