// Package storage implements the M06 v3 storage & log administration page:
// TSDB retention policy read/write, read-only disk usage and log rotation
// discovery. Restarting Prometheus is intentionally not offered (D64).
package storage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
)

// ErrEnvFileNotConfigured marks a deployment without a writable retention env
// path (HTTP 503, actionable message preserved by the handler).
var ErrEnvFileNotConfigured = &apierror.Error{
	Kind:    apierror.Unavailable,
	Message: "保留策略写入未配置（缺少 config.dir / prom-retention.env）；请联系运维配置后重试",
}

// Options configures the storage service.
type Options struct {
	// EnvFile is the prom-retention.env path written by the page.
	EnvFile string
	// PromURL is the center Prometheus base URL used for /api/v1/status/flags.
	PromURL *url.URL
}

// RetentionState compares the env-file desired values with runtime flags.
type RetentionState struct {
	Desired          *RetentionValues `json:"desired"`
	Runtime          *RetentionValues `json:"runtime"`
	Source           string           `json:"source"` // env_file | runtime_default
	EnvFile          string           `json:"env_file"`
	EnvFileExists    bool             `json:"env_file_exists"`
	RuntimeAvailable bool             `json:"runtime_available"`
	PendingRestart   bool             `json:"pending_restart"`
}

// DiskInfo is a read-only disk usage entry.
type DiskInfo struct {
	Label        string  `json:"label"`
	Path         string  `json:"path,omitempty"`
	TotalBytes   uint64  `json:"total_bytes"`
	UsedBytes    uint64  `json:"used_bytes"`
	FreeBytes    uint64  `json:"free_bytes"`
	UsagePercent float64 `json:"usage_percent"`
	Error        string  `json:"error,omitempty"`
}

// LogRotationInfo is a read-only log rotation discovery result.
type LogRotationInfo struct {
	Mechanism  string `json:"mechanism"` // logrotate | journald | none
	Active     bool   `json:"active"`
	ConfigPath string `json:"config_path,omitempty"`
	Content    string `json:"content,omitempty"`
	Summary    string `json:"summary"`
}

// Overview is the GET /storage-logs response body.
type Overview struct {
	Retention   RetentionState  `json:"retention"`
	Disks       []DiskInfo      `json:"disks"`
	LogRotation LogRotationInfo `json:"log_rotation"`
}

// Service reads storage state and writes the retention policy atomically.
type Service struct {
	opts   Options
	client *http.Client
}

// NewService constructs a storage service.
func NewService(opts Options) *Service {
	return &Service{opts: opts, client: &http.Client{Timeout: 3 * time.Second}}
}

// Overview assembles retention state, disk usage and log rotation.
func (s *Service) Overview(ctx context.Context) (*Overview, error) {
	desired, found, err := readDesired(s.opts.EnvFile)
	if err != nil {
		return nil, err
	}
	envPath := s.opts.EnvFile
	if envPath != "" {
		if abs, absErr := filepath.Abs(envPath); absErr == nil {
			envPath = abs
		}
	}

	flags, tsdbPath, runtimeOK := s.fetchRuntimeFlags(ctx)
	retention := RetentionState{
		Source:           "runtime_default",
		EnvFile:          envPath,
		EnvFileExists:    found,
		RuntimeAvailable: runtimeOK,
	}
	if runtimeOK {
		value := flags
		retention.Runtime = &value
	}
	switch {
	case found:
		retention.Desired = &desired
		retention.Source = "env_file"
		if runtimeOK {
			retention.PendingRestart = !valuesEqual(desired, flags)
		}
	case runtimeOK:
		value := flags
		retention.Desired = &value
	}

	return &Overview{
		Retention:   retention,
		Disks:       s.diskEntries(tsdbPath, runtimeOK),
		LogRotation: detectLogRotation(),
	}, nil
}

// UpdateRetention validates and atomically writes the env file, then returns
// the refreshed overview (pending_restart=true until Prometheus restarts).
func (s *Service) UpdateRetention(ctx context.Context, timeValue, sizeValue string) (*Overview, error) {
	timeValue = strings.TrimSpace(timeValue)
	sizeValue = strings.TrimSpace(sizeValue)
	if timeValue == "" {
		return nil, &domain.ValidationError{Field: "time", Message: "保留时长必填"}
	}
	if sizeValue == "" {
		return nil, &domain.ValidationError{Field: "size", Message: "保留容量必填"}
	}
	if err := ValidateRetentionTime(timeValue); err != nil {
		return nil, &domain.ValidationError{Field: "time", Message: err.Error()}
	}
	if err := ValidateRetentionSize(sizeValue); err != nil {
		return nil, &domain.ValidationError{Field: "size", Message: err.Error()}
	}
	if s.opts.EnvFile == "" {
		return nil, ErrEnvFileNotConfigured
	}
	if err := writeRetentionPolicy(s.opts.EnvFile, RetentionValues{Time: timeValue, Size: sizeValue}); err != nil {
		return nil, err
	}
	return s.Overview(ctx)
}

func readDesired(envFile string) (RetentionValues, bool, error) {
	if envFile == "" {
		return RetentionValues{}, false, nil
	}
	return readRetentionPolicy(envFile)
}

func (s *Service) fetchRuntimeFlags(ctx context.Context) (RetentionValues, string, bool) {
	if s.opts.PromURL == nil {
		return RetentionValues{}, "", false
	}
	u := *s.opts.PromURL
	u.Path = path.Join(u.Path, "/api/v1/status/flags")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return RetentionValues{}, "", false
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return RetentionValues{}, "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return RetentionValues{}, "", false
	}
	var payload struct {
		Status string            `json:"status"`
		Data   map[string]string `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return RetentionValues{}, "", false
	}
	if payload.Status != "success" || len(payload.Data) == 0 {
		return RetentionValues{}, "", false
	}
	values := RetentionValues{
		Time: payload.Data["storage.tsdb.retention.time"],
		Size: payload.Data["storage.tsdb.retention.size"],
	}
	return values, payload.Data["storage.tsdb.path"], true
}

func (s *Service) diskEntries(tsdbPath string, runtimeOK bool) []DiskInfo {
	disks := make([]DiskInfo, 0, 2)
	switch {
	case tsdbPath != "":
		disks = append(disks, newDiskInfo("TSDB 数据目录", tsdbPath))
	case !runtimeOK:
		disks = append(disks, DiskInfo{Label: "TSDB 数据目录", Error: "无法获取（Prometheus 未运行）"})
	}
	if logRoot := os.Getenv("LOG_ROOT"); logRoot != "" {
		disks = append(disks, newDiskInfo("日志目录", logRoot))
	}
	return disks
}

func newDiskInfo(label, dirPath string) DiskInfo {
	total, used, free, err := diskUsage(dirPath)
	if err != nil {
		return DiskInfo{Label: label, Path: dirPath, Error: err.Error()}
	}
	info := DiskInfo{Label: label, Path: dirPath, TotalBytes: total, UsedBytes: used, FreeBytes: free}
	if total > 0 {
		info.UsagePercent = float64(used) / float64(total) * 100
	}
	return info
}
