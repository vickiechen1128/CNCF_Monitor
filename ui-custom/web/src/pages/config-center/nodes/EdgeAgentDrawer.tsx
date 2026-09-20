import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Badge, Button, Descriptions, Drawer, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AgentView, EdgeComponent } from '../../../types/edge'
import { edgePackageApi } from '../../../api/edgePackages'
import {
  HIGH_RISK_COMPONENT_STATUS,
  agentStatusBadgeStatus,
  agentStatusLabel,
  componentStatusColor,
  componentStatusLabel,
  componentTypeLabel,
  configSyncStatusBadgeStatus,
  configSyncStatusLabel,
  formatBacklogBytes,
  latestPackageVersion,
  outOfSyncCauseAction,
  outOfSyncCauseHint,
} from './edgeConstants'

const { Text } = Typography

/** 版本差异可升级判定结果 */
function getUpgradeHint(componentVersion: string, latest: string | null): boolean {
  if (!latest || !componentVersion) return false
  const toNum = (v: string) => Number(v.replace(/^v/, '').replace(/\./g, '')) || 0
  return toNum(latest) > toNum(componentVersion)
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
  const [latestVersion, setLatestVersion] = useState<string | null>(null)

  // 拉取离线包清单做「可升级」判定（异步回调内 setState）；失败静默，不阻塞抽屉
  useEffect(() => {
    let cancelled = false
    edgePackageApi
      .list()
      .then((res) => {
        if (cancelled) return
        const pkgs = Array.isArray(res.data) ? (res.data as Array<{ version: string }>) : (res.data as { packages?: Array<{ version: string }> } | undefined)?.packages ?? []
        setLatestVersion(latestPackageVersion(pkgs.map((p) => p.version)))
      })
      .catch(() => {
        if (!cancelled) setLatestVersion(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!agent) return null

  const highRiskComponents = (agent.components ?? []).filter((c) => HIGH_RISK_COMPONENT_STATUS.includes(c.status))
  const needsUpgrade = (version?: string) => getUpgradeHint(version ?? '', latestVersion ?? '')

  const handleCauseAction = (cause: keyof typeof outOfSyncCauseAction) => {
    const action = outOfSyncCauseAction[cause]
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
      render: (v?: string) => v || '-',
    },
    {
      title: '最近错误',
      dataIndex: 'last_error',
      key: 'last_error',
      render: (v?: string) => (v ? <Text type="danger">{v}</Text> : '-'),
    },
  ]

  const cause = agent.out_of_sync_cause
  const causeAction = cause ? outOfSyncCauseAction[cause] : null

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
          <Badge
            status={configSyncStatusBadgeStatus[agent.config_sync_status ?? 'unknown']}
            text={configSyncStatusLabel[agent.config_sync_status ?? 'unknown']}
          />{' '}
          {cause && <Text type="secondary" style={{ fontSize: 12 }}>{outOfSyncCauseHint[cause]}</Text>}
        </Descriptions.Item>
        {causeAction && (
          <Descriptions.Item label="同步引导">
            <Button size="small" type="link" onClick={() => handleCauseAction(cause)}>
              {causeAction.text}
            </Button>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="回传积压">{formatBacklogBytes(agent.queue_backlog_bytes)}</Descriptions.Item>
        <Descriptions.Item label="心跳 RTT">{agent.heartbeat_rtt_ms != null ? `${agent.heartbeat_rtt_ms} ms` : '-'}</Descriptions.Item>
        <Descriptions.Item label="最近错误">
          {agent.last_error ? <Text type="danger">{agent.last_error}</Text> : '-'}
        </Descriptions.Item>
      </Descriptions>

      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        组件清单{needsUpgrade(agent.collector_version) && (
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