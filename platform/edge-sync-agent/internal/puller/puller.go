package puller

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/client"
	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/token"
)

// RuntimeSnapshot 描述本节点一次心跳要上报的运行态（采集器/WAL 实际值由进程守护在
// T11-14 接入，本包通过 RuntimeProvider 抽象注入）。
type RuntimeSnapshot struct {
	AgentVersion         string
	ConfigVersion        string
	QueueBacklogBytes    int64
	RemoteWriteQueueSize int
	Hostname             string
	Ip                   string
	Components           []contract.Component
	// Targets 是边缘 vmagent 本地 target 抓取快照（方案 B），随心跳上报中心。
	Targets []contract.EdgeTargetSnapshot
	// 最近一次配置应用失败原因与失败版本（D-1）；应用成功时为空（心跳 omitempty 不产出键）。
	ConfigApplyError         string
	ConfigApplyFailedVersion string
	// RemoteWriteLastError 是本机 vmagent remote_write 最近失败原因摘要（F-17 补齐）。
	// 无失败时为空（心跳 omitempty 不产出键）。中心据此可观测边缘上报是否失败——
	// 此前该字段契约单向定义、恒空，边缘 up 未落中心时中心侧零线索。
	RemoteWriteLastError string
	// RemoteWriteDroppedTotal 是累计丢块+丢包总数（F-39，counter 求和）；非零即发生过
	// 数据丢失。随心跳上报，中心节点状态页直接展示。
	RemoteWriteDroppedTotal int64
	// RemoteWriteRetriesTotal 是累计发送重试次数（F-39，counter 求和）；增速高即
	// 链路不稳信号。
	RemoteWriteRetriesTotal int64
	// MetadataRemoteWriteURL / MetadataMaxDiskUsagePerURL 是当前生效配置目录
	// metadata.json 的回传参数指纹（F-42），随心跳上报供中心比对网域参数变更。
	// 未应用过配置时为空。
	MetadataRemoteWriteURL     string
	MetadataMaxDiskUsagePerURL string
}

// RuntimeProvider 提供当前运行态快照。
type RuntimeProvider interface {
	Snapshot() RuntimeSnapshot
}

// Deployer 消费校验通过的配置包（T11-13 接入原子替换/reload）。本轮由 puller 保留。
type Deployer interface {
	// Apply 应用校验通过的配置包。返回 error 时配置不落盘为本轮生效。
	Apply(ctx context.Context, zipBytes []byte, meta *contract.Metadata) error
}

// Puller 驱动心跳-拉包主循环。
type Puller struct {
	cfg     *config.Config
	token   *token.Store
	client  *client.Client
	runtime RuntimeProvider
	deploy  Deployer
	logger  *logger.Logger
	// lastValid 保留最后一份通过校验的配置（§6.4 条目 2/6），checksum 失败或断网时继续沿用。
	lastValid         []byte
	lastValidMetadata *contract.Metadata

	// F-42 人工重启指令：onRestart 为执行回调（复位 supervisor 守护状态 + 无条件滚动
	// 重启 vmagent 采集子进程），nil 表示未装配（仅推进 seq 不执行）；restartStatePath
	// 为已执行 seq 的持久化文件（agent 重启后据此恢复，避免重复执行）；executedRestartSeq
	// 是本地已执行的 vm_agent_restart_seq（内存 + 磁盘）。
	onRestart          func() error
	restartStatePath   string
	executedRestartSeq int64
}

// NewPuller 构造 Puller。deploy 可为 nil（T11-13 接入前仅保留，不落盘）；
// onRestart 可为 nil（人工重启指令回调，F-42）；restartStatePath 为已执行重启指令
// seq 的持久化文件路径（空串则仅内存保留，agent 重启后会重复执行一次幂等滚动重启）。
func NewPuller(cfg *config.Config, tok *token.Store, cli *client.Client, runtime RuntimeProvider, deploy Deployer, logg *logger.Logger, onRestart func() error, restartStatePath string) *Puller {
	if runtime == nil {
		runtime = staticRuntime{}
	}
	p := &Puller{
		cfg:              cfg,
		token:            tok,
		client:           cli,
		runtime:          runtime,
		deploy:           deploy,
		logger:           logg,
		onRestart:        onRestart,
		restartStatePath: restartStatePath,
	}
	p.loadRestartState()
	return p
}

// staticRuntime 默认运行态提供者（无实际守护时返回空组件）。
type staticRuntime struct{}

func (staticRuntime) Snapshot() RuntimeSnapshot { return RuntimeSnapshot{} }

// Run 每 HeartbeatInterval（默认 30s）执行一轮心跳-拉包，直到 ctx 取消。
func (p *Puller) Run(ctx context.Context) {
	interval := p.cfg.HeartbeatInterval
	if interval <= 0 {
		interval = config.DefaultHeartbeatInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	p.RunOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.RunOnce(ctx)
		}
	}
}

// RunOnce 执行单轮心跳-拉包。
func (p *Puller) RunOnce(ctx context.Context) error {
	hb := p.buildHeartbeat()
	resp, err := p.client.Heartbeat(ctx, hb)
	if err != nil {
		if errors.Is(err, client.Errauth) {
			downgraded := p.handleAuth(ctx)
			p.warnf("心跳鉴权失败(401)，降频=%v", downgraded)
			return err
		}
		// 网络/服务异常：保留最后有效配置继续（§6.4 条目 6），本轮不拉包。
		p.warnf("心跳失败，保留最后有效配置继续采集: %v", err)
		return err
	}

	// F-42 人工重启指令：seq 判定 + 幂等执行。失败不落盘（seq 不推进），下轮心跳
	// 自动重试；不阻断本轮拉包。
	if err := p.handleRestartCommand(resp); err != nil {
		p.warnf("处理重启采集进程指令失败（seq=%d），将在下轮心跳重试: %v", resp.VMAgentRestartSeq, err)
	}

	if !resp.ConfigChanged && !resp.ParamsChanged {
		return nil
	}
	if resp.ConfigDownloadURL == "" {
		return nil
	}
	p.infof("准备拉取配置包: config_changed=%v params_changed=%v", resp.ConfigChanged, resp.ParamsChanged)
	return p.pullAndVerify(ctx, resp.ConfigDownloadURL)
}

// restartState 是重启指令执行状态的持久化结构（F-42，落 <configRoot>/restart-state.json）。
type restartState struct {
	ExecutedVMAgentRestartSeq int64 `json:"executed_vm_agent_restart_seq"`
}

// handleRestartCommand 处理心跳响应携带的人工重启指令（F-42）：中心递增的
// vm_agent_restart_seq 大于本地已执行 seq 时执行回调（复位守护状态 + 滚动重启
// vmagent 采集子进程），成功后更新内存 seq 并落盘；失败不落盘由调用方告警、下轮
// 心跳重试。幂等：重复心跳（seq 未再递增）不会重复执行。
func (p *Puller) handleRestartCommand(resp *contract.HeartbeatResponse) error {
	if resp.VMAgentRestartSeq <= p.executedRestartSeq {
		return nil
	}
	if p.onRestart == nil {
		// 未装配回调（老版本装配）也推进 seq，避免每轮心跳重复判定。
		p.setExecutedRestartSeq(resp.VMAgentRestartSeq)
		return nil
	}
	p.infof("收到重启采集进程指令: seq=%d（本地已执行 %d），开始滚动重启 vmagent", resp.VMAgentRestartSeq, p.executedRestartSeq)
	if err := p.onRestart(); err != nil {
		return err
	}
	p.setExecutedRestartSeq(resp.VMAgentRestartSeq)
	p.infof("重启采集进程指令执行完成: seq=%d", resp.VMAgentRestartSeq)
	return nil
}

// setExecutedRestartSeq 更新内存 seq 并持久化。落盘失败仅告警不回滚：内存值已推进，
// agent 进程存活期内不会重复执行；agent 重启后若恰逢落盘失败会多执行一次幂等滚动
// 重启（无害，仅多一次进程重启）。
func (p *Puller) setExecutedRestartSeq(seq int64) {
	p.executedRestartSeq = seq
	if p.restartStatePath == "" {
		return
	}
	b, err := json.Marshal(&restartState{ExecutedVMAgentRestartSeq: seq})
	if err != nil {
		p.warnf("序列化重启指令状态失败: %v", err)
		return
	}
	if err := os.WriteFile(p.restartStatePath, b, 0o644); err != nil {
		p.warnf("持久化重启指令状态失败: %v", err)
	}
}

// loadRestartState 构造时从磁盘恢复已执行的重启指令 seq（文件缺失/损坏按 0 处理，
// 下轮心跳按中心最新 seq 幂等补执行）。
func (p *Puller) loadRestartState() {
	if p.restartStatePath == "" {
		return
	}
	b, err := os.ReadFile(p.restartStatePath)
	if err != nil {
		return
	}
	var st restartState
	if err := json.Unmarshal(b, &st); err != nil {
		p.warnf("解析重启指令状态文件失败，按 0 处理: %v", err)
		return
	}
	p.executedRestartSeq = st.ExecutedVMAgentRestartSeq
}

// buildHeartbeat 由 RuntimeSnapshot 组装心跳请求。
func (p *Puller) buildHeartbeat() contract.HeartbeatRequest {
	rs := p.runtime.Snapshot()
	return contract.HeartbeatRequest{
		NetworkDomainID:            p.cfg.NetworkDomainID,
		AgentType:                  p.cfg.AgentType,
		Version:                    rs.AgentVersion,
		ConfigVersion:              rs.ConfigVersion,
		QueueBacklogBytes:          rs.QueueBacklogBytes,
		RemoteWriteQueueSize:       rs.RemoteWriteQueueSize,
		Hostname:                   rs.Hostname,
		Ip:                         rs.Ip,
		Components:                 rs.Components,
		Targets:                    rs.Targets,
		ConfigApplyError:           rs.ConfigApplyError,
		ConfigApplyFailedVersion:   rs.ConfigApplyFailedVersion,
		RemoteWriteLastError:       rs.RemoteWriteLastError,
		RemoteWriteDroppedTotal:    rs.RemoteWriteDroppedTotal,
		RemoteWriteRetriesTotal:    rs.RemoteWriteRetriesTotal,
		MetadataRemoteWriteURL:     rs.MetadataRemoteWriteURL,
		MetadataMaxDiskUsagePerURL: rs.MetadataMaxDiskUsagePerURL,
	}
}

// pullAndVerify 拉取配置包并校验 checksum；校验通过才交 deployer / 作为 lastValid。
func (p *Puller) pullAndVerify(ctx context.Context, url string) error {
	zipBytes, err := p.client.PullConfig(ctx, url)
	if err != nil {
		if errors.Is(err, client.Errauth) {
			p.handleAuth(ctx)
			return err
		}
		// 断网/拉取失败：保留最后有效配置（§6.4 条目 6）。
		p.warnf("拉取配置失败，保留最后有效配置: %v", err)
		return err
	}

	meta, err := VerifyChecksum(zipBytes)
	if err != nil {
		// checksum 校验失败：记录错误、保留最后一份有效配置、不进入解压（§6.4 条目 2）。
		p.warnf("配置包 checksum 校验失败，保留最后有效配置: %v", err)
		return err
	}

	// 校验通过：更新 lastValid（无论是否 deploy）。
	p.lastValid = zipBytes
	p.lastValidMetadata = meta

	if p.deploy != nil {
		if err := p.deploy.Apply(ctx, zipBytes, meta); err != nil {
			p.warnf("应用配置失败，保留已校验配置: %v", err)
			return err
		}
	}
	p.infof("配置包校验通过并应用: config_version=%s", meta.ConfigVersion)
	return nil
}

// handleAuth 进入 401 退避降频，返回是否降频。
func (p *Puller) handleAuth(ctx context.Context) bool {
	_, downgraded := p.client.WaitAuthBackoff(ctx)
	return downgraded
}

// LastValidConfig 返回最近校验通过的配置字节（测试/部署读）。
func (p *Puller) LastValidConfig() []byte               { return p.lastValid }
func (p *Puller) LastValidMetadata() *contract.Metadata { return p.lastValidMetadata }

func (p *Puller) infof(f string, a ...any) { p.logger.Infof(f, a...) }
func (p *Puller) warnf(f string, a ...any) { p.logger.Warnf(f, a...) }
