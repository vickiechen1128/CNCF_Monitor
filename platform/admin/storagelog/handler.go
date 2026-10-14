package storagelog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
)

// Options 配置存储与日志管理路由的运行时依赖。
type Options struct {
	// EnvFile 是保留策略 env 文件路径（页面保存写入；Makefile run-prometheus 与
	// 交付包 start.sh 启动时读取，重启 Prometheus 后生效）。
	EnvFile string
	// PromURL 是中心 Prometheus 基址，用于读 /api/v1/status/flags 取运行时参数。
	// serveFlags 无 admin-api 门禁（api.go serveFlags 直接返回 flagsMap）。
	PromURL *url.URL
}

// RegisterRoutes 挂载 M06「存储与日志管理」端点（F-41），调用方传 admin 组
//（已挂 RequireAdmin）：
//   - GET  /storage-logs          保留策略期望值/运行时值 + 磁盘占用 + 日志轮转展示
//   - PUT  /storage-logs/retention 校验并写 env 文件（不重启 Prometheus，见决策 64）
func RegisterRoutes(admin *gin.RouterGroup, opts Options) {
	h := &Handler{opts: opts, client: &http.Client{Timeout: 3 * time.Second}}
	admin.GET("/storage-logs", h.GetOverview)
	admin.PUT("/storage-logs/retention", h.UpdateRetention)
}

// Handler 适配存储与日志管理的读写到 HTTP，统一响应信封。
type Handler struct {
	opts   Options
	client *http.Client
}

// retentionState 是 TSDB 保留策略的「期望值 vs 运行时值」比对状态。
type retentionState struct {
	// Desired 为 env 文件期望值；env 文件不存在时回落运行时值（source=runtime_default）。
	Desired *RetentionValues `json:"desired"`
	// Runtime 取自 Prometheus /api/v1/status/flags（Prometheus 不可用时为 nil）。
	Runtime         *RetentionValues `json:"runtime"`
	Source          string           `json:"source"` // env_file | runtime_default
	EnvFile         string           `json:"env_file"`
	EnvFileExists   bool             `json:"env_file_exists"`
	RuntimeAvailable bool            `json:"runtime_available"`
	// PendingRestart 仅在 env 文件存在且运行时可取且归一化比对不同时为 true。
	PendingRestart bool `json:"pending_restart"`
}

// diskInfo 是单个目录的磁盘占用只读展示。
type diskInfo struct {
	Label        string  `json:"label"`
	Path         string  `json:"path,omitempty"`
	TotalBytes   uint64  `json:"total_bytes"`
	UsedBytes    uint64  `json:"used_bytes"`
	FreeBytes    uint64  `json:"free_bytes"`
	UsagePercent float64 `json:"usage_percent"`
	Error        string  `json:"error,omitempty"`
}

// logRotationInfo 是运行日志轮转策略展示（免重启信息，与 TSDB 保留策略分开展示）。
type logRotationInfo struct {
	Mechanism  string `json:"mechanism"` // logrotate | journald | none
	Active     bool   `json:"active"`    // 配置是否已实际安装生效
	ConfigPath string `json:"config_path,omitempty"`
	Content    string `json:"content,omitempty"`
	Summary    string `json:"summary"`
}

// overviewResponse 是 GET /storage-logs 的响应体。
type overviewResponse struct {
	Retention   retentionState    `json:"retention"`
	Disks       []diskInfo        `json:"disks"`
	LogRotation logRotationInfo   `json:"log_rotation"`
}

// updateRetentionRequest 是 PUT /storage-logs/retention 的请求体（两项均必填，
// 表单整单保存）。
type updateRetentionRequest struct {
	Time string `json:"time"`
	Size string `json:"size"`
}

// GetOverview handles GET /api/v2/platform/storage-logs。Prometheus 不可用不构成
// 请求失败：runtime_available=false 降级返回 env 侧信息。
func (h *Handler) GetOverview(c *gin.Context) {
	ov, err := h.overview(c.Request.Context())
	if err != nil {
		response.InternalServerError(c, err)
		return
	}
	response.OK(c, ov)
}

// UpdateRetention handles PUT /api/v2/platform/storage-logs/retention：
// 校验 → 写 env 文件 → 回传最新比对状态（pending_restart=true，提示重启生效）。
func (h *Handler) UpdateRetention(c *gin.Context) {
	var req updateRetentionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request payload: %w", err))
		return
	}
	if req.Time == "" || req.Size == "" {
		response.BadRequest(c, fmt.Errorf("保留时长与保留容量均为必填项"))
		return
	}
	if err := ValidateRetentionTime(req.Time); err != nil {
		response.BadRequest(c, err)
		return
	}
	if err := ValidateRetentionSize(req.Size); err != nil {
		response.BadRequest(c, err)
		return
	}
	if err := writeRetentionPolicy(h.opts.EnvFile, RetentionValues{Time: req.Time, Size: req.Size}); err != nil {
		response.InternalServerError(c, err)
		return
	}
	ov, err := h.overview(c.Request.Context())
	if err != nil {
		response.InternalServerError(c, err)
		return
	}
	response.OK(c, ov)
}

// overview 汇总保留策略状态、磁盘占用与日志轮转展示。
func (h *Handler) overview(ctx context.Context) (*overviewResponse, error) {
	desired, found, err := readRetentionPolicy(h.opts.EnvFile)
	if err != nil {
		return nil, err
	}
	envPath := h.opts.EnvFile
	if abs, absErr := filepath.Abs(envPath); absErr == nil {
		envPath = abs
	}

	flags, tsdbPath, rtOK := h.fetchRuntimeFlags(ctx)

	ret := retentionState{
		Source:          "runtime_default",
		EnvFile:         envPath,
		EnvFileExists:   found,
		RuntimeAvailable: rtOK,
	}
	if rtOK {
		f := flags
		ret.Runtime = &f
	}
	switch {
	case found:
		ret.Desired = &desired
		ret.Source = "env_file"
		if rtOK {
			ret.PendingRestart = !valuesEqual(desired, flags)
		}
	case rtOK:
		f := flags
		ret.Desired = &f
	}

	return &overviewResponse{
		Retention:   ret,
		Disks:       h.diskEntries(tsdbPath, rtOK),
		LogRotation: detectLogRotation(),
	}, nil
}

// fetchRuntimeFlags 读 Prometheus /api/v1/status/flags 提取保留策略与 TSDB 路径；
// 不可达 / 响应异常时返回 ok=false（调用方降级，不视为请求错误）。
func (h *Handler) fetchRuntimeFlags(ctx context.Context) (vals RetentionValues, tsdbPath string, ok bool) {
	if h.opts.PromURL == nil {
		return vals, "", false
	}
	u := *h.opts.PromURL
	u.Path = path.Join(u.Path, "/api/v1/status/flags")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return vals, "", false
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return vals, "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return vals, "", false
	}
	var payload struct {
		Status string            `json:"status"`
		Data   map[string]string `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return vals, "", false
	}
	if payload.Status != "success" || len(payload.Data) == 0 {
		return vals, "", false
	}
	vals.Time = payload.Data["storage.tsdb.retention.time"]
	vals.Size = payload.Data["storage.tsdb.retention.size"]
	return vals, payload.Data["storage.tsdb.path"], true
}

// diskEntries 组装磁盘占用条目：TSDB 目录取自运行时 flags（Prometheus 未运行时
// 给占位错误行）；日志目录取 LOG_ROOT 环境变量（交付包 start.sh 注入，开发态未
// 配置则不出现该行）。
func (h *Handler) diskEntries(tsdbPath string, rtOK bool) []diskInfo {
	disks := make([]diskInfo, 0, 2)
	switch {
	case tsdbPath != "":
		disks = append(disks, newDiskInfo("TSDB 数据目录", tsdbPath))
	case !rtOK:
		disks = append(disks, diskInfo{Label: "TSDB 数据目录", Error: "无法获取（Prometheus 未运行）"})
	}
	if logRoot := os.Getenv("LOG_ROOT"); logRoot != "" {
		disks = append(disks, newDiskInfo("日志目录", logRoot))
	}
	return disks
}

func newDiskInfo(label, dirPath string) diskInfo {
	total, used, free, err := diskUsage(dirPath)
	if err != nil {
		return diskInfo{Label: label, Path: dirPath, Error: err.Error()}
	}
	info := diskInfo{
		Label:      label,
		Path:       dirPath,
		TotalBytes: total,
		UsedBytes:  used,
		FreeBytes:  free,
	}
	if total > 0 {
		info.UsagePercent = float64(used) / float64(total) * 100
	}
	return info
}
