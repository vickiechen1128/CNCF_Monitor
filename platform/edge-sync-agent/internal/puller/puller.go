package puller

import (
	"context"
	"errors"
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
}

// NewPuller 构造 Puller。deploy 可为 nil（T11-13 接入前仅保留，不落盘）。
func NewPuller(cfg *config.Config, tok *token.Store, cli *client.Client, runtime RuntimeProvider, deploy Deployer, logg *logger.Logger) *Puller {
	if runtime == nil {
		runtime = staticRuntime{}
	}
	return &Puller{
		cfg:     cfg,
		token:   tok,
		client:  cli,
		runtime: runtime,
		deploy:  deploy,
		logger:  logg,
	}
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

	if !resp.ConfigChanged || resp.ConfigDownloadURL == "" {
		return nil
	}
	return p.pullAndVerify(ctx, resp.ConfigDownloadURL)
}

// buildHeartbeat 由 RuntimeSnapshot 组装心跳请求。
func (p *Puller) buildHeartbeat() contract.HeartbeatRequest {
	rs := p.runtime.Snapshot()
	return contract.HeartbeatRequest{
		NetworkDomainID:      p.cfg.NetworkDomainID,
		AgentType:            p.cfg.AgentType,
		Version:              rs.AgentVersion,
		ConfigVersion:        rs.ConfigVersion,
		QueueBacklogBytes:    rs.QueueBacklogBytes,
		RemoteWriteQueueSize: rs.RemoteWriteQueueSize,
		Hostname:             rs.Hostname,
		Ip:                   rs.Ip,
		Components:           rs.Components,
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
