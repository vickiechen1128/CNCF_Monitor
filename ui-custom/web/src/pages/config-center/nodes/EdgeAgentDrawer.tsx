import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Descriptions, Drawer, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AgentView, EdgeComponent } from '../../../types/edge'
import type { EdgePackage } from '../../../types/config-center'
import { edgePackageApi } from '../../../api/edgePackages'
import { EllipsisText } from '../../../components/EllipsisText'
import { formatLocalTime, formatRelativeTime } from '../configCenterConstants'
import {
  HIGH_RISK_COMPONENT_STATUS,
  agentStatusBadgeStatus,
  agentStatusLabel,
  channelStatusBadge,
  channelStatusLabel,
  compareVersions,
  componentStatusColor,
  componentStatusLabel,
  componentTypeLabel,
  configSyncDisplayBadgeStatus,
  configSyncDisplayLabel,
  formatBacklogAge,
  formatBacklogBytes,
  formatBacklogGrowth,
  formatSampleLag,
  isConfigSyncApplyFailed,
  outOfSyncCauseAction,
  outOfSyncCauseHint,
  sampleLagSeverity,
} from './edgeConstants'

const { Text } = Typography

/** 版本差异可升级判定：组件版本 < 离线包内 vmagent 组件最新版本（同 namespace 比较） */
function isUpgradeNeeded(componentVersion: string | undefined, latestCollector: string | null): boolean {
  if (!componentVersion || !latestCollector) return false
  return compareVersions(componentVersion, latestCollector) < 0
}

interface EdgeAgentDrawerProps {
  open: boolean
  agent: AgentView | null
  onClose: () => void
}

/**
 * 采集节点详情抽屉（M11 §3.2 节点/组件级诊断）。
 * - 顶部高危横幅：含 crash_loop / restarting 组件时告警；
 * - 节点 Overview（Descriptions）+ 回传积压展示；
 * - 组件清单表：type/status/version/config_version/restart_count/last_restart_at/last_error；
 * - 可升级提示：对比离线包清单 latest 与组件/Agent 版本。
 * forceRender：内容常驻挂载，避免懒挂载吞值。
 */
export function EdgeAgentDrawer({ open, agent, onClose }: EdgeAgentDrawerProps) {
  const navigate = useNavigate()
  const [packages, setPackages] = useState<EdgePackage[]>([])

  // 拉取离线包清单做「可升级」判定（异步回调内 setState）；失败静默，不阻塞抽屉
  useEffect(() => {
    let cancelled = false
    edgePackageApi
      .list()
      .then((res) => {
        if (cancelled) return
        setPackages(res.data ?? [])
      })
      .catch(() => {
        if (!cancelled) setPackages([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 离线包内 vmagent 组件最新版本（与节点 collector_version 同 namespace 比较，避免跨空间误判）
  const latestCollectorVersion = useMemo(() => {
    const versions: string[] = []
    for (const pkg of packages) {
      const core = pkg.components.find((c) => c.name === 'vmagent')
      if (core?.version) versions.push(core.version)
    }
    return versions.length === 0
      ? null
      : versions.reduce((a, b) => (compareVersions(a, b) > 0 ? a : b))
  }, [packages])

  if (!agent) return null

  const highRiskComponents = (agent.components ?? []).filter((c) => HIGH_RISK_COMPONENT_STATUS.includes(c.status))
  const needsUpgrade = isUpgradeNeeded(agent.collector_version ?? '', latestCollectorVersion)

  const handleCauseAction = (cause: keyof typeof outOfSyncCauseAction | undefined) => {
    const action = cause ? outOfSyncCauseAction[cause] : null
    if (action && action.target) {
      navigate(action.target)
      onClose()
    } else if (action) {
      message.success('已触发重新同步，待 Agent 下次心跳拉取生效')
    }
  }

  const columns: ColumnsType<EdgeComponent> = [
    {
      title: '组件类型',
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (t: EdgeComponent['type'], rec) => (
        <Text>
          {componentTypeLabel[t] ?? t}
          <Text type="secondary" style={{ fontSize: 12 }}>（{rec.name}）</Text>
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: EdgeComponent['status']) => (
        <Tag color={componentStatusColor[s]}>{componentStatusLabel[s] ?? s}</Tag>
      ),
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 130,
      render: (v?: string) => v || '-',
    },
    {
      title: '配置版本',
      dataIndex: 'config_version',
      key: 'config_version',
      width: 150,
      render: (v?: string) => v || '-',
    },
    {
      title: '重启次数',
      dataIndex: 'restart_count',
      key: 'restart_count',
      width: 100,
      render: (v?: number) => v ?? '-',
    },
    {
      title: '最近重启',
      dataIndex: 'last_restart_at',
      key: 'last_restart_at',
      width: 170,
      // 用 formatLocalTime 转本地可读时间，避免原始 ISO（T/Z/纳秒）截断成零碎字符
      render: (v?: string) => formatLocalTime(v),
    },
    {
      title: '最近错误',
      dataIndex: 'last_error',
      key: 'last_error',
      width: 220,
      // long 错误文本用 EllipsisText 截断 + 悬浮全文，避免窄列硬折行/竖排撑爆行高
      render: (v?: string) => (v ? <EllipsisText type="danger" maxWidth={200}>{v}</EllipsisText> : '-'),
    },
  ]

  const cause = agent.out_of_sync_cause
  const causeAction = cause ? outOfSyncCauseAction[cause] : null
  const syncStatus = agent.config_sync_status ?? 'unknown'
  // 配置应用失败（D-2）：apply_failed 成因或已上报失败原因时展示「配置应用」诊断行；
  // 该行自带「查看下发」按钮，故 apply_failed 时不再渲染通用「同步引导」行（避免重复按钮）。
  const applyFailed = isConfigSyncApplyFailed(syncStatus, cause)
  const showApplyError = applyFailed || !!agent.config_apply_error

  return (
    <Drawer
      title={`节点详情 · ${agent.hostname}`}
      placement="right"
      width={760}
      open={open}
      onClose={onClose}
      // forceRender 替代 destroyOnHidden：Drawer 首次打开时内容惰性挂载会吞掉已获取的异步状态
      forceRender
    >
      {highRiskComponents.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="检测到高风险组件状态"
          description={`以下组件处于 ${highRiskComponents.map((c) => componentStatusLabel[c.status]).join(' / ')}：${highRiskComponents.map((c) => c.name).join('、')}`}
        />
      )}

      <Descriptions column={1} size="small" bordered title="节点概览" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="主机名">{agent.hostname}</Descriptions.Item>
        <Descriptions.Item label="IP">{agent.ip || '-'}</Descriptions.Item>
        <Descriptions.Item label="归属网域">{agent.network_domain_id}</Descriptions.Item>
        <Descriptions.Item label="节点状态">
          <Badge status={agentStatusBadgeStatus[agent.status]} text={agentStatusLabel[agent.status]} />
        </Descriptions.Item>
        <Descriptions.Item label="Agent 版本">{agent.version || '-'}</Descriptions.Item>
        <Descriptions.Item label="配置同步">
          {/* pull_pending（已确认下发、待心跳拉取）展示「同步中」，其余 out_of_sync 仍「未同步」（F-16） */}
          <Badge
            status={configSyncDisplayBadgeStatus(syncStatus, cause)}
            text={configSyncDisplayLabel(syncStatus, cause)}
          />{' '}
          {cause && <Text type="secondary" style={{ fontSize: 12 }}>{outOfSyncCauseHint[cause]}</Text>}
        </Descriptions.Item>
        {/* 最后配置拉取：为「同步中」提供时限佐证（长时间未拉取可据此识别），无观测到拉取时展示 '-' */}
        <Descriptions.Item label="最后配置拉取">
          {agent.last_config_pull ? formatRelativeTime(agent.last_config_pull) : '-'}
        </Descriptions.Item>
        {showApplyError && (
          <Descriptions.Item label="配置应用">
            {agent.config_apply_error ? (
              <Text type="danger">{agent.config_apply_error}</Text>
            ) : (
              <Text type="danger">Agent 应用最新配置失败，已回滚至上一可用版本</Text>
            )}
            {agent.config_apply_failed_version && (
              <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
                （失败版本 {agent.config_apply_failed_version}）
              </Text>
            )}
            <Button
              size="small"
              type="link"
              onClick={() => {
                navigate('/deployments')
                onClose()
              }}
            >
              查看下发
            </Button>
          </Descriptions.Item>
        )}
        {causeAction && !applyFailed && (
          <Descriptions.Item label="同步引导">
            <Button size="small" type="link" onClick={() => handleCauseAction(cause)}>
              {causeAction.text}
            </Button>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="回传积压">
          <Space size={6}>
            <span>{formatBacklogBytes(agent.queue_backlog_bytes)}</span>
            {channelStatusLabel(agent.channel_status) && channelStatusBadge(agent.channel_status) && (
              <Badge
                status={channelStatusBadge(agent.channel_status)!}
                text={channelStatusLabel(agent.channel_status)}
              />
            )}
          </Space>
        </Descriptions.Item>
        {/* F-40 延展①：积压数据龄 = 当前积压 ÷ 近期增速（相邻心跳差分）；同时展示增速（心跳中的积压增长趋势） */}
        <Descriptions.Item label="积压数据龄">
          {(() => {
            const text = formatBacklogAge(agent.backlog_age_seconds)
            if (text === '-') return <Text type="secondary">无数据（30 分钟内心跳不足、积压未上涨或心跳过期）</Text>
            const growth = formatBacklogGrowth(agent.backlog_growth_bytes_per_sec)
            return (
              <Text>
                {text}
                <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
                  近期增速 {growth}，按此速率攒满当前积压所需时长
                </Text>
              </Text>
            )
          })()}
        </Descriptions.Item>
        {/* F-40 延展：中心视角该网域样本距今的 p95 分位（端到端回传延迟，保守口径），与回传积压交叉定位 */}
        <Descriptions.Item label="回传延迟">
          {(() => {
            const text = formatSampleLag(agent.remote_write_lag_seconds)
            if (text === '-') return <Text type="secondary">无数据（24h 内无样本或中心 Prom 不可用）</Text>
            const severity = sampleLagSeverity(agent.remote_write_lag_seconds)
            if (severity === 'danger') return <Text type="danger">{text}</Text>
            if (severity === 'warning') return <Text type="warning">{text}</Text>
            return text
          })()}
        </Descriptions.Item>
        {/* F-39：累计丢块/丢包与累计重试。丢块非零即发生过数据丢失（红色醒目）；重试仅在不为 0 时展示，
            避免常态 0 行噪声。累计值不随离线清零，离线后仍可据此排障。 */}
        <Descriptions.Item label="累计丢块/丢包">
          {agent.remote_write_dropped_total ? (
            <Text type="danger">
              {agent.remote_write_dropped_total}
              <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
                非零表示回传链路曾丢弃数据（磁盘队列满或发送超限）
              </Text>
            </Text>
          ) : (
            '-'
          )}
        </Descriptions.Item>
        {agent.remote_write_retries_total ? (
          <Descriptions.Item label="累计发送重试">
            <Text type="warning">{agent.remote_write_retries_total}</Text>
            <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
              重试持续增长说明回传通道不稳（带宽不足/网络抖动）
            </Text>
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label="回传错误">
          {agent.remote_write_last_error ? <Text type="danger">{agent.remote_write_last_error}</Text> : '-'}
        </Descriptions.Item>
        {/* F-42：当前生效回传参数（节点配置包 metadata.json 落盘值，随心跳上报落库）。
            空 = 尚未随配置包下发生效，agent 按 env > 内置兜底（2GB）解析。 */}
        <Descriptions.Item label="生效回传地址">
          {agent.metadata_remote_write_url ? (
            <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>{agent.metadata_remote_write_url}</Text>
          ) : (
            <Text type="secondary">未下发（agent 按 env / center_endpoint 推导）</Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="生效积压磁盘上限">
          {agent.metadata_max_disk_usage_per_url ? (
            <Text code style={{ fontSize: 12 }}>{agent.metadata_max_disk_usage_per_url}</Text>
          ) : (
            <Text type="secondary">未下发（agent 内置兜底 2GB）</Text>
          )}
        </Descriptions.Item>
        {/* F-42：最近一次人工重启采集进程留痕（无记录不展示，避免噪声行） */}
        {(agent.restart_requested_by || agent.restart_requested_at) && (
          <Descriptions.Item label="最近人工重启">
            {agent.restart_requested_at ? formatLocalTime(agent.restart_requested_at) : '-'}
            {agent.restart_requested_by && (
              <Text type="secondary" style={{ fontSize: 12, marginInlineStart: 8 }}>
                由 {agent.restart_requested_by} 发起
              </Text>
            )}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="最后心跳">
          {agent.last_heartbeat ? formatRelativeTime(agent.last_heartbeat) : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="心跳 RTT">{agent.heartbeat_rtt_ms != null ? `${agent.heartbeat_rtt_ms} ms` : '-'}</Descriptions.Item>
        <Descriptions.Item label="最近错误">
          {agent.last_error ? <Text type="danger">{agent.last_error}</Text> : '-'}
        </Descriptions.Item>
      </Descriptions>

      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        组件清单{needsUpgrade && (
          <Tag color="orange" style={{ marginInlineStart: 8 }}>可升级</Tag>
        )}
      </Text>
      <Table<EdgeComponent>
        rowKey={(r) => `${r.type}-${r.name}`}
        size="small"
        columns={columns}
        dataSource={agent.components ?? []}
        pagination={false}
        locale={{ emptyText: '无组件信息' }}
      />
    </Drawer>
  )
}

export default EdgeAgentDrawer