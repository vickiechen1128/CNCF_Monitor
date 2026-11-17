package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// AMAlert is one alert as returned by Alertmanager's v2 API.
type AMAlert struct {
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    time.Time         `json:"startsAt"`
	EndsAt      time.Time         `json:"endsAt"`
	Status struct {
		State       string   `json:"state"`
		SilencedBy  []string `json:"silencedBy"`
		InhibitedBy []string `json:"inhibitedBy"`
	} `json:"status"`
	Fingerprint string `json:"fingerprint"`
}

// FingerprintKey returns the payload fingerprint or a stable label digest.
func (a AMAlert) FingerprintKey() string {
	if a.Fingerprint != "" {
		return a.Fingerprint
	}
	keys := make([]string, 0, len(a.Labels))
	for key := range a.Labels {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteString("=")
		builder.WriteString(a.Labels[key])
		builder.WriteString(";")
	}
	sum := sha256.Sum256([]byte(builder.String()))
	return hex.EncodeToString(sum[:8])
}

// toWebhookAlert adapts the v2 shape onto the webhook-ingest shape.
func (a AMAlert) toWebhookAlert() WebhookAlert {
	return WebhookAlert{
		Status: a.Status.State, Labels: a.Labels, Annotations: a.Annotations,
		StartsAt: a.StartsAt, EndsAt: a.EndsAt, Fingerprint: a.FingerprintKey(),
	}
}

// AMClient is the Alertmanager v2 HTTP client used for alerts, silences and the
// manual reload path.
type AMClient struct {
	base   *url.URL
	client *http.Client
}

// NewAMClient builds a client for the Alertmanager base URL.
func NewAMClient(base *url.URL) *AMClient {
	return &AMClient{base: base, client: &http.Client{Timeout: 5 * time.Second}}
}

// ActiveAlerts lists active alerts (FR-22/FR-26).
func (c *AMClient) ActiveAlerts(ctx context.Context) ([]AMAlert, error) {
	var alerts []AMAlert
	if err := c.getJSON(ctx, "/api/v2/alerts?active=true&silenced=true&inhibited=true", &alerts); err != nil {
		return nil, err
	}
	return alerts, nil
}

// ListSilences proxies GET /api/v2/silences (FR-16).
func (c *AMClient) ListSilences(ctx context.Context) ([]domain.Silence, error) {
	var payload []struct {
		ID        string `json:"id"`
		Matchers  []struct {
			Name    string `json:"name"`
			Value   string `json:"value"`
			IsRegex bool   `json:"isRegex"`
		} `json:"matchers"`
		StartsAt  time.Time `json:"startsAt"`
		EndsAt    time.Time `json:"endsAt"`
		CreatedBy string    `json:"createdBy"`
		Comment   string    `json:"comment"`
		Status    struct {
			State string `json:"state"`
		} `json:"status"`
	}
	if err := c.getJSON(ctx, "/api/v2/silences", &payload); err != nil {
		return nil, err
	}
	out := make([]domain.Silence, 0, len(payload))
	for _, item := range payload {
		silence := domain.Silence{
			ID: item.ID, StartsAt: item.StartsAt, EndsAt: item.EndsAt,
			CreatedBy: item.CreatedBy, Comment: item.Comment, Status: item.Status.State,
		}
		for _, matcher := range item.Matchers {
			silence.Matchers = append(silence.Matchers, domain.Matcher{
				Name: matcher.Name, Value: matcher.Value, IsRegex: matcher.IsRegex,
			})
		}
		out = append(out, silence)
	}
	return out, nil
}

// CreateSilence posts a new silence and returns its id.
func (c *AMClient) CreateSilence(ctx context.Context, silence domain.Silence) (string, error) {
	body := map[string]any{
		"matchers":  toAMMatchers(silence.Matchers),
		"startsAt":  silence.StartsAt.UTC().Format(time.RFC3339),
		"endsAt":    silence.EndsAt.UTC().Format(time.RFC3339),
		"createdBy": silence.CreatedBy,
		"comment":   silence.Comment,
	}
	var response struct {
		SilenceID string `json:"silenceID"`
	}
	if err := c.postJSON(ctx, "/api/v2/silences", body, &response); err != nil {
		return "", err
	}
	return response.SilenceID, nil
}

// DeleteSilence deletes a silence by id.
func (c *AMClient) DeleteSilence(ctx context.Context, id string) error {
	target := c.base.ResolveReference(&url.URL{Path: "/api/v2/silence/" + url.PathEscape(id)})
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, target.String(), nil)
	if err != nil {
		return fmt.Errorf("build delete silence request: %w", err)
	}
	return c.do(req, nil)
}

func toAMMatchers(matchers []domain.Matcher) []map[string]any {
	out := make([]map[string]any, 0, len(matchers))
	for _, matcher := range matchers {
		out = append(out, map[string]any{
			"name": matcher.Name, "value": matcher.Value, "isRegex": matcher.IsRegex,
		})
	}
	return out
}

func (c *AMClient) getJSON(ctx context.Context, path string, dest any) error {
	target := c.base.ResolveReference(&url.URL{Path: path})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return fmt.Errorf("build alertmanager request: %w", err)
	}
	return c.do(req, dest)
}

func (c *AMClient) postJSON(ctx context.Context, path string, body any, dest any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal alertmanager request: %w", err)
	}
	target := c.base.ResolveReference(&url.URL{Path: path})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("build alertmanager request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, dest)
}

func (c *AMClient) do(req *http.Request, dest any) error {
	resp, err := c.client.Do(req)
	if err != nil {
		return &domain.UpstreamError{Message: "Alertmanager 不可达", Err: err}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &domain.UpstreamError{
			Message: fmt.Sprintf("Alertmanager 返回 %d", resp.StatusCode),
			Err:     fmt.Errorf("%s", strings.TrimSpace(string(raw))),
		}
	}
	if dest == nil || len(raw) == 0 {
		return nil
	}
	if err := json.Unmarshal(raw, dest); err != nil {
		return fmt.Errorf("decode alertmanager response: %w", err)
	}
	return nil
}
