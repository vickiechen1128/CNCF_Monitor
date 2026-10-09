// vmremote.go 属于 edge-sync-agent 主程序（Module_11）。
//
// F-17 补齐（可观测性）：本文件读取本机 vmagent /metrics 的 remote_write 相关指标，
// 推导「remote_write 最近一次失败原因」并随心跳上报中心（契约字段
// remote_write_last_error）。中心 HeartbeatRequest 早已定义该字段并落库
// edge_heartbeats，但 Agent 侧此前从未定义/发送 → 恒空 → 边缘 remote_write 失败时
// 中心侧完全无感（本次实测：边缘 up 长期未落中心，中心侧零失败线索，只能靠外部探测
// 定位）。接通后，失败原因随心跳直达中心。
//
// 关键设计：
//   - 数据源为 vmagent **本机 127.0.0.1:8429/metrics**（不依赖中心），零网络出站；
//   - vmagent 的 remote_write 失败以 Prometheus 计数器暴露（vmagent_remote_write_*
//     系列，见 upstream/vmagent），本文件解析这些计数器的「是否 > 0」并拼摘要；
//   - 采集失败（网络/非200/解析错）一律降级为空字符串 + WARN，绝不阻断心跳
//     （与 fetchVMAgentTargets 同一错误处理纪律）。
package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// vmMetricsPath 是 vmagent 本机 Prometheus 指标暴露路径（决策 88：采集器统一 vmagent，
// 默认监听 8429，与 /api/v1/targets 同一 HTTP 端口）。
const vmMetricsPath = "/metrics"

// remote_write 失败信号取自 vmagent **实际暴露**的指标名（核对
// upstream/victoria-metrics/app/vmagent/remotewrite/*.go 的 RegisterMetric 字面量，
// 注意是 remotewrite 连写、无「remote_write」下划线）：
//
//   - vmagent_remotewrite_errors_total          发送错误总数
//   - vmagent_remotewrite_push_failures_total推送失败总数
//   - vmagent_remotewrite_retries_count_total  重试总数
//
// 三个指标任一 > 0 即视为「发生过remote_write 失败」；成功态全为 0。
const (
	metricRWErrors    = "vmagent_remotewrite_errors_total"
	metricRWPushFails = "vmagent_remotewrite_push_failures_total"
	metricRWRetries   = "vmagent_remotewrite_retries_count_total"
)

// metricRWPendingBytes 是 vmagent 磁盘持久队列中**待发送**的字节数（gauge，带
// {path=..., url=...} label，多队列分片）。它是「回传积压」的唯一真值来源：
// 用户可见的 40.9GB 积压即此值。
//
// 用途（用户诉求 2026-10-09）：界面上「已下发未采到」时，用户需要区分
// **「程序/配置坏了」**与**「只是数据在排队、正在补发」**——后者是自愈中，
// 不该被当成故障排查。故把该值随心跳上报，让节点状态页直接显示积压量。
const metricRWPendingBytes = "vmagent_remotewrite_pending_data_bytes"

// vmRemoteWriteStats 是一次 /metrics 采集得到的 remote_write 运行态摘要。
type vmRemoteWriteStats struct {
	// LastError 为失败原因摘要；无失败时为空串（心跳 omitempty 不产出键）。
	LastError string
	// PendingBytes 为待发送积压字节数；指标缺失时为 0。
	PendingBytes int64
	// OK 表示本次采集是否成功（false 时两项均不可信，调用方应降级）。
	OK bool
}

// fetchVMAgentRemoteWriteStats 抓取并解析本机 vmagent /metrics，**一次请求**同时得出
// remote_write 失败摘要与待发送积压字节数（避免每心跳两次 HTTP）。
//
// 降级纪律（与 fetchVMAgentTargets 一致）：网络/非 200/解析失败 → OK=false，
// 调用方须按"采集不到"处理（积压 0 + 无错误摘要），**绝不能把采集失败误报成
// "无积压且正常"**，也不阻断心跳。
func fetchVMAgentRemoteWriteStats(ctx context.Context, cli *http.Client, baseURL string, warnf func(format string, args ...any)) vmRemoteWriteStats {
	warn := warnf
	if warn == nil {
		warn = func(string, ...any) {}
	}
	fail := func(format string, args ...any) vmRemoteWriteStats {
		warn(format, args...)
		return vmRemoteWriteStats{}
	}

	url := strings.TrimRight(baseURL, "/") + vmMetricsPath
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fail("vmagent remote_write: build req: %v", err)
	}
	resp, err := cli.Do(req)
	if err != nil {
		return fail("vmagent remote_write: fetch %s: %v", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fail("vmagent remote_write: http %d from %s", resp.StatusCode, url)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fail("vmagent remote_write: read body: %v", err)
	}

	text := string(body)
	// 积压：带label 的分片行（多队列），取**最大值**而非累加——各队列分片独立存储，
	// 累加会重复计数，max 给出真实积压量下界。
	pending, pendingFound := parsePromGauge(text, metricRWPendingBytes)

	errTotal, errFound := parsePromGauge(text, metricRWErrors)
	pushFails, pushFound := parsePromGauge(text, metricRWPushFails)
	retries, _ := parsePromGauge(text, metricRWRetries)

	// 三个失败信号与积压信号**全部缺失**（老版本 vmagent / 指标路径变更）→ 本次
	// 采集无法判定任何运行态，置 OK=false，**绝不能把「采集不到」默认为「无积压且
	// 正常」**（用户诉求：界面须能区分「程序坏了」与「只是积压自愈中」，若此处谎报
	// 正常，界面会误导排查方向）。
	if !errFound && !pushFound && !pendingFound {
		warn("vmagent remote_write: 未找到任何 remote_write 指标（vmagent 版本不匹配？）")
		return vmRemoteWriteStats{}
	}

	stats := vmRemoteWriteStats{PendingBytes: int64(pending), OK: true}

	// 失败信号缺失时只影响错误摘要，不影响积压上报（两者相互独立）。
	if errFound || pushFound {
		if errTotal > 0 || pushFails > 0 {
			stats.LastError = fmt.Sprintf("remote_write_failed: %s=%g %s=%g %s=%g（vmagent /metrics）",
				metricRWErrors, errTotal, metricRWPushFails, pushFails, metricRWRetries, retries)
		}
	}
	return stats
}

// parsePromGauge 解析 Prometheus gauge 的值，**同时支持无 label 与带 label 两种形态**：
//
//   - 无 label：vmagent_remotewrite_retries_count_total 7
//   - 带 label：vmagent_remotewrite_pending_data_bytes{path="...",url="..."} 43915725039
//
// 用于 pending_data_bytes —— 它带 {path,url} label（多队列分片），且各分片是
// **独立存储**，故取**最大值**作为积压量下界，而非累加（累加会重复计数）。
// 指标不存在或格式异常返回 found=false。
func parsePromGauge(body, metric string) (float64, bool) {
	max := 0.0
	found := false
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		rest, ok := cutMetricLine(line, metric)
		if !ok {
			continue
		}
		v, ok := parsePromValue(rest)
		if !ok {
			continue
		}
		found = true
		if v > max {
			max = v
		}
	}
	return max, found
}

// cutMetricLine 从一行指标文本中切出「指标名之后」的部分。同时接受 `name value` 与
// `name{labels} value` 两种形态；不匹配返回 ok=false。
func cutMetricLine(line, metric string) (string, bool) {
	if rest, ok := strings.CutPrefix(line, metric+" "); ok {
		return rest, true
	}
	if rest, ok := strings.CutPrefix(line, metric+"{"); ok {
		// 跳过 {...} label 块：从第一个 '{' 之后的第一个 '}' 起算。
		if i := strings.Index(rest, "}"); i >= 0 {
			return strings.TrimSpace(rest[i+1:]), true
		}
	}
	return "", false
}

// parsePromValue 解析指标行的值部分（形如 "43915725039" 或 "1.5e+07"）。
func parsePromValue(rest string) (float64, bool) {
	fields := strings.Fields(rest)
	if len(fields) == 0 {
		return 0, false
	}
	var v float64
	if _, err := fmt.Sscanf(fields[0], "%g", &v); err != nil {
		return 0, false
	}
	return v, true
}
