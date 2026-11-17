package apply

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// HTTPReloader calls the Alertmanager lifecycle endpoints.
type HTTPReloader struct {
	base   *url.URL
	client *http.Client
}

// NewHTTPReloader builds a reloader for the given Alertmanager base URL.
func NewHTTPReloader(base *url.URL) *HTTPReloader {
	return &HTTPReloader{
		base:   base,
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

// Reload triggers POST /-/reload.
func (r *HTTPReloader) Reload(ctx context.Context) error {
	return r.post(ctx, "/-/reload")
}

// Verify probes GET /-/healthy after a reload.
func (r *HTTPReloader) Verify(ctx context.Context) error {
	target := r.base.ResolveReference(&url.URL{Path: "/-/healthy"})
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return fmt.Errorf("build healthy request: %w", err)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("alertmanager health check: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("alertmanager health check: status %d", resp.StatusCode)
	}
	return nil
}

func (r *HTTPReloader) post(ctx context.Context, path string) error {
	target := r.base.ResolveReference(&url.URL{Path: path})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), nil)
	if err != nil {
		return fmt.Errorf("build reload request: %w", err)
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("alertmanager reload: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("alertmanager reload: status %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}
