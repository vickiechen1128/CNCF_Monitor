package main

import (
	"context"

	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/deployer"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/puller"
	"github.com/metriccenter/platform/edge-sync-agent/internal/supervisor"
)

// buildHeartbeatRequest 组装心跳上报体，字段严格对齐中心 edge 协议（PRD §6.2 与
// platform/edge heartbeat 约定）：net_domain_id / agent_type / version / config_version /
// queue_backlog_bytes / remote_write_queue_size / hostname / ip / components。
// 抽为纯函数便于单测（T11-15 装配 helper 测试）。
func buildHeartbeatRequest(
	cfg *config.Config,
	configVersion string,
	queueBacklogBytes int64,
	remoteWriteQueueSize int,
	hostname, ip string,
	components []contract.Component,
) contract.HeartbeatRequest {
	return contract.HeartbeatRequest{
		NetworkDomainID:      cfg.NetworkDomainID,
		AgentType:            cfg.AgentType,
		Version:              cfg.Version,
		ConfigVersion:        configVersion,
		QueueBacklogBytes:    queueBacklogBytes,
		RemoteWriteQueueSize: remoteWriteQueueSize,
		Hostname:             hostname,
		Ip:                   ip,
		Components:           components,
	}
}

// runtimeProvider 实现 puller.RuntimeProvider：为每次心跳组装当前运行态（部署版本、
// 配置版本、WAL/queue 参数、主机身份、supervisor 上报的组件状态与 vmagent 本地
// target 快照）。
type runtimeProvider struct {
	cfg      *config.Config
	deployer *deployer.Deployer
	sv       *supervisor.Supervisor
	hostname string
	ip       string
	logger   *logger.Logger
	// targetBaseURL 本机 vmagent HTTP 监听地址（http://host:port），用于读取
	// /api/v1/targets 快照（方案 B）。为空时不采集 targets。
	targetBaseURL string
}

// Snapshot 返回一次心跳所需的运行态快照。WAL 积压量当前无实时采集器读数，取 0；
// remote_write 队列并发分片数按网域默认常量上报（PRD §6.4.1）。
func (r *runtimeProvider) Snapshot() puller.RuntimeSnapshot {
	version := ""
	if r.deployer != nil {
		version = r.deployer.CurrentVersion()
	}
	rwQueue := 0
	if r.cfg != nil {
		rwQueue = r.cfg.RWQueueMaxShards
	}
	comps := []contract.Component{}
	if r.sv != nil {
		comps = r.sv.Snapshot()
	}
	// 方案 B：读取本机 vmagent /api/v1/targets 快照随心跳上报；采集失败由
	// fetchVMAgentTargets 降级为空并 WARN，不阻断心跳。
	targets := []contract.EdgeTargetSnapshot{}
	if r.targetBaseURL != "" {
		targets = fetchVMAgentTargets(context.Background(), newVMTargetsClient(), r.targetBaseURL, r.warnf)
	}
	return puller.RuntimeSnapshot{
		AgentVersion:         r.cfg.Version,
		ConfigVersion:        version,
		QueueBacklogBytes:    0,
		RemoteWriteQueueSize: rwQueue,
		Hostname:             r.hostname,
		Ip:                   r.ip,
		Components:           comps,
		Targets:              targets,
	}
}

// warnf 写 WARN 日志；logger 未初始化（测试/装配缺省）时静默。
func (r *runtimeProvider) warnf(format string, args ...any) {
	if r.logger != nil {
		r.logger.Warnf(format, args...)
	}
}
