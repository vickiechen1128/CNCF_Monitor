package notify

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"text/template"
	"time"

	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
)

// ErrRenderEmpty 模板渲染结果为空（如模板仅含 {{ define }} 却未在根处调用）。
var ErrRenderEmpty = errors.New("模板未产出内容（若使用 {{ define }}，请在模板根处用 {{ template \"名\" . }} 调用）")

// DefaultRenderLocation 是通知渲染的默认显示时区（东八区，固定偏移）。使用固定
// 偏移而非 LoadLocation，保证渲染不依赖宿主机时区/tzdata（对齐设计提案 §3.3.6
// 「UTC → 东八区固定偏移硬编码」坑的平台侧统一收敛）。
var DefaultRenderLocation = time.FixedZone("UTC+8", 8*60*60)

// renderTimeLayout 是模板内本地化时间字段的格式（含时区偏移，避免歧义）。
const renderTimeLayout = "2006-01-02 15:04:05 -07:00"

// amWebhookPayload 是 Alertmanager 原生 webhook JSON 投递体（webhook_configs）。
type amWebhookPayload struct {
	Version           string            `json:"version"`
	GroupKey          string            `json:"groupKey"`
	Status            string            `json:"status"`
	Receiver          string            `json:"receiver"`
	GroupLabels       map[string]string `json:"groupLabels"`
	CommonLabels      map[string]string `json:"commonLabels"`
	CommonAnnotations map[string]string `json:"commonAnnotations"`
	ExternalURL       string            `json:"externalURL"`
	Alerts            []amWebhookAlert  `json:"alerts"`
}

// amWebhookAlert 是 AM webhook 载荷中的单条告警。
type amWebhookAlert struct {
	Status       string            `json:"status"`
	Labels       map[string]string `json:"labels"`
	Annotations  map[string]string `json:"annotations"`
	StartsAt     time.Time         `json:"startsAt"`
	EndsAt       time.Time         `json:"endsAt"`
	GeneratorURL string            `json:"generatorURL"`
	Fingerprint  string            `json:"fingerprint"`
}

// RenderAlert 是模板渲染视图中的单条告警：在原生字段之外额外提供已本地化的
// StartsAtLocal / EndsAtLocal（按渲染时区格式化），供模板直接展示。
type RenderAlert struct {
	Status        string
	Labels        map[string]string
	Annotations   map[string]string
	StartsAt      time.Time
	EndsAt        time.Time
	StartsAtLocal string
	EndsAtLocal   string
	GeneratorURL  string
	Fingerprint   string
}

// RenderData 是通知模板的渲染根上下文（模板中通过 .Status / .Alerts 访问）。
type RenderData struct {
	Version           string
	GroupKey          string
	Status            string
	Receiver          string
	GroupLabels       map[string]string
	CommonLabels      map[string]string
	CommonAnnotations map[string]string
	ExternalURL       string
	Alerts            []RenderAlert
}

// decodeWebhook 解码 AM 原生 webhook JSON 载荷。
func decodeWebhook(raw []byte) (amWebhookPayload, error) {
	var p amWebhookPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return amWebhookPayload{}, fmt.Errorf("decode alertmanager webhook payload: %w", err)
	}
	return p, nil
}

// buildRenderData 将 AM 载荷转换为模板渲染上下文，时间字段按 loc 本地化。
func buildRenderData(p amWebhookPayload, loc *time.Location) RenderData {
	if loc == nil {
		loc = DefaultRenderLocation
	}
	alerts := make([]RenderAlert, 0, len(p.Alerts))
	for _, a := range p.Alerts {
		alerts = append(alerts, RenderAlert{
			Status:        a.Status,
			Labels:        a.Labels,
			Annotations:   a.Annotations,
			StartsAt:      a.StartsAt,
			EndsAt:        a.EndsAt,
			StartsAtLocal: formatLocal(a.StartsAt, loc),
			EndsAtLocal:   formatLocal(a.EndsAt, loc),
			GeneratorURL:  a.GeneratorURL,
			Fingerprint:   a.Fingerprint,
		})
	}
	return RenderData{
		Version:           p.Version,
		GroupKey:          p.GroupKey,
		Status:            p.Status,
		Receiver:          p.Receiver,
		GroupLabels:       p.GroupLabels,
		CommonLabels:      p.CommonLabels,
		CommonAnnotations: p.CommonAnnotations,
		ExternalURL:       p.ExternalURL,
		Alerts:            alerts,
	}
}

// formatLocal 按渲染时区格式化时间；零值时间返回空串（如未恢复的告警 EndsAt）。
func formatLocal(t time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	return t.In(loc).Format(renderTimeLayout)
}

// Render 按模板渲染 AM 载荷为出站请求体。模板根内容渲染结果即为出站 body；
// 校验与渲染共用 config.TemplateFuncs()（「校验即渲染」口径一致）。
// 渲染结果为空（如模板仅含 {{ define }} 却未在根处调用）返回 ErrRenderEmpty，
// 避免静默发送空体。
func Render(templateContent string, payload amWebhookPayload, loc *time.Location) ([]byte, error) {
	tpl, err := template.New("notify").Funcs(config.TemplateFuncs()).Parse(templateContent)
	if err != nil {
		return nil, fmt.Errorf("parse notify template: %w", err)
	}
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, buildRenderData(payload, loc)); err != nil {
		return nil, fmt.Errorf("render notify template: %w", err)
	}
	if len(bytes.TrimSpace(buf.Bytes())) == 0 {
		return nil, ErrRenderEmpty
	}
	return buf.Bytes(), nil
}