// vmtargets.go 属于 edge-sync-agent 主程序（Module_11）。
//
// 方案 B（F-11）：边缘 vmagent 本地 /api/v1/targets 快照随心跳上报中心，补齐中心
// /api/v1/targets 对边缘 domain 恒空、无法排障（lastScrape/lastError/scrapeDuration
// 等抓取详情唯一栖息地）的缺口。本文件实现从本机 vmagent HTTP 接口（默认
// 127.0.0.1:8429）抓取并解析 active target 快照。采集失败应对心跳降级，绝不阻断。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
)

// defaultVMAgentTargetsAddr 是 vmagent 本机 HTTP 监听默认地址（决策 88：采集器统一
// 为 vmagent，默认 8429）。可用环境变量 EDGE_COLLECTOR_ADDR 覆写。
const defaultVMAgentTargetsAddr = "127.0.0.1:8429"

// vmTargetsPath 是 vmagent /api/v1/targets 接口路径；state=active 仅返回抓取目标。
const vmTargetsPath = "/api/v1/targets?state=active"

// errVMTargetsStatus 表示 vmagent targets 接口返回非 success 状态。
var errVMTargetsStatus = errors.New("vmagent targets: non-success status")

// vmTargetResp 对齐 vmagent /api/v1/targets 响应（data.activeTargets[]）。
type vmTargetResp struct {
	Status string           `json:"status"`
	Data   vmTargetRespData `json:"data"`
}

// vmTargetRespData 承载 activeTargets 数组。
type vmTargetRespData struct {
	ActiveTargets []vmTarget `json:"activeTargets"`
}

// vmTarget 描述一个抓取目标：labels（job/instance/resource_id 等标签）+ 顶层抓取详情
// （health / lastScrape / lastError / lastScrapeDuration）。
type vmTarget struct {
	Labels             map[string]string `json:"labels"`
	Health             string            `json:"health"`
	LastScrape         string            `json:"lastScrape"`
	LastError          string            `json:"lastError"`
	LastScrapeDuration float64           `json:"lastScrapeDuration"`
}

// parseEdgeTargets 解析 vmagent /api/v1/targets 响应的 activeTargets 为契约快照列表。
// job/instance/resource_id 取自 labels（resource_id 缺失时置空）；lastScrape/
// lastError/lastScrapeDuration 取对应顶层字段，映射到契约 scrape_duration_seconds。
func parseEdgeTargets(b []byte) ([]contract.EdgeTargetSnapshot, error) {
	var resp vmTargetResp
	if err := json.Unmarshal(b, &resp); err != nil {
		return nil, fmt.Errorf("vmagent targets: decode: %w", err)
	}
	if resp.Status != "success" {
		return nil, fmt.Errorf("%w: %s", errVMTargetsStatus, resp.Status)
	}
	targets := make([]contract.EdgeTargetSnapshot, 0, len(resp.Data.ActiveTargets))
	for _, t := range resp.Data.ActiveTargets {
		targets = append(targets, contract.EdgeTargetSnapshot{
			Job:                   t.Labels["job"],
			Instance:              t.Labels["instance"],
			ResourceID:            t.Labels["resource_id"],
			Health:                t.Health,
			LastScrape:            t.LastScrape,
			LastError:             t.LastError,
			ScrapeDurationSeconds: t.LastScrapeDuration,
		})
	}
	return targets, nil
}

// fetchVMAgentTargets 抓取并解析本机 vmagent 本地 target 快照。采集失败（网络、非 200、
// 解析错误）一律降级为 nil 返回并显式 WARN，绝不阻断心跳（backend-developer：错误处理
// 显式，但采集失败不阻断心跳）。warnf 可为 nil。
func fetchVMAgentTargets(ctx context.Context, cli *http.Client, baseURL string, warnf func(format string, args ...any)) []contract.EdgeTargetSnapshot {
	warn := warnf
	if warn == nil {
		warn = func(string, ...any) {}
	}
	url := strings.TrimRight(baseURL, "/") + vmTargetsPath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		warn("vmagent targets: build req: %v", err)
		return nil
	}
	resp, err := cli.Do(req)
	if err != nil {
		warn("vmagent targets: fetch %s: %v", url, err)
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		warn("vmagent targets: http %d from %s", resp.StatusCode, url)
		return nil
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		warn("vmagent targets: read body: %v", err)
		return nil
	}
	targets, err := parseEdgeTargets(body)
	if err != nil {
		warn("vmagent targets: parse: %v", err)
		return nil
	}
	return targets
}

// newVMTargetsClient 返回抓取 vmagent 本机接口的短超时 HTTP 客户端。
func newVMTargetsClient() *http.Client { return &http.Client{Timeout: 3 * time.Second} }
