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
// queue_backlog_bytes / remote_write_queue_size / hostname / ip / components /
// config_apply_error + config_apply_failed_version（D-1，读 deployer 最近一次应用失败状态；
// 无失败时为空，omitempty 不产出键）。
// 抽为纯函数便于单测（T11-15 装配 helper 测试）。
func buildHeartbeatRequest(
	cfg *config.Config,
	configVersion string,
	queueBacklogBytes int64,
	remoteWriteQueueSize int,
	hostname, ip string,
	components []contract.Component,
	dep *deployer.Deployer,
) contract.HeartbeatRequest {
	var applyState deployer.ApplyState
	if dep != nil {
		applyState = dep.ApplyState()
	}
	return contract.HeartbeatRequest{
		NetworkDomainID:          cfg.NetworkDomainID,
		AgentType:                cfg.AgentType,
		Version:                  cfg.Version,
		ConfigVersion:            configVersion,
		QueueBacklogBytes:        queueBacklogBytes,
		RemoteWriteQueueSize:     remoteWriteQueueSize,
		Hostname:                 hostname,
		Ip:                       ip,
		Components:               components,
		ConfigApplyError:         applyState.Error,
		ConfigApplyFailedVersion: applyState.Version,
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

// Snapshot 返回一次心跳所需的运行态快照。QueueBacklogBytes 取自本机 vmagent
// /metrics 的回传积压（F-39：max 内存缓冲 vmagent_remotewrite_pending_data_bytes /
// 磁盘持久队列 vm_persistentqueue_bytes_pending；2026-10-09 接入，此前恒 0，导致
// 节点状态页「回传积压」永远为空、用户无法区分「程序坏了」与「积压自愈中」）。
// remote_write_queue 并发分片数按网域默认常量上报（PRD §6.4.1）。
func (r *runtimeProvider) Snapshot() puller.RuntimeSnapshot {
	version := ""
	applyState := deployer.ApplyState{}
	if r.deployer != nil {
		version = r.deployer.CurrentVersion()
		// 最近一次应用失败状态（D-1）：随心跳上报，中心据此判 out_of_sync 成因 apply_failed。
		applyState = r.deployer.ApplyState()
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
	// F-17 补齐：读取本机vmagent /metrics，一次请求同时取remote_write 失败原因与
	// **待发送积压字节数**（用户诉求 2026-10-09：界面「已下发未采到」时需让用户
	// 区分「程序坏了」与「只是积压自愈中」）。采集失败降级（积压 0 + 无错误摘要），
	// 绝不把「采集不到」误报成「正常」，亦不阻断心跳。
	// F-39（2026-10-10）：积压改用 BacklogBytes()（max 内存缓冲 / 磁盘持久队列），
	// 并透传累计丢块+丢包、累计重试——2026-09-30 实测 530MB 积压全在持久队列、
	// 内存缓冲近 0，仅凭 PendingBytes 会把大积压误报成正常。
	rwStats := vmRemoteWriteStats{}
	if r.targetBaseURL != "" {
		rwStats = fetchVMAgentRemoteWriteStats(context.Background(), newVMTargetsClient(), r.targetBaseURL, r.warnf)
	}
	// F-42：读取当前生效配置目录 metadata.json 的回传参数指纹随心跳上报，供中心
	// 比对网域参数（remote_write_url / max_disk_usage_per_url）变更后强制拉包。
	// 未应用过配置 / deployer 未装配时为空。
	var metaRWURL, metaMaxDisk string
	if r.deployer != nil {
		cm := r.deployer.CurrentMetadata()
		metaRWURL = cm.RemoteWriteURL
		metaMaxDisk = cm.MaxDiskUsagePerURL
	}
	return puller.RuntimeSnapshot{
		AgentVersion:               r.cfg.Version,
		ConfigVersion:              version,
		QueueBacklogBytes:          rwStats.BacklogBytes(),
		RemoteWriteQueueSize:       rwQueue,
		Hostname:                   r.hostname,
		Ip:                         r.ip,
		Components:                 comps,
		Targets:                    targets,
		ConfigApplyError:           applyState.Error,
		ConfigApplyFailedVersion:   applyState.Version,
		RemoteWriteLastError:       rwStats.LastError,
		RemoteWriteDroppedTotal:    rwStats.DroppedTotal,
		RemoteWriteRetriesTotal:    rwStats.RetriesTotal,
		MetadataRemoteWriteURL:     metaRWURL,
		MetadataMaxDiskUsagePerURL: metaMaxDisk,
	}
}

// warnf 写 WARN 日志；logger 未初始化（测试/装配缺省）时静默。
func (r *runtimeProvider) warnf(format string, args ...any) {
	if r.logger != nil {
		r.logger.Warnf(format, args...)
	}
}
