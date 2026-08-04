import { useMemo } from 'react'
import { Card, Table, Tag, Row, Col, Statistic, Space, Typography, Tooltip } from 'antd'
import { CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { edgeAgents, networkDomains, type NetworkDomainStatus, type ConfigSyncStatus } from '../mocks/module-09'

const { Text } = Typography

const statusConfig: Record<NetworkDomainStatus, { color: string; icon: React.ReactNode; label: string }> = {
  online: { color: 'success', icon: <CheckCircleOutlined />, label: '在线' },
  offline: { color: 'error', icon: <CloseCircleOutlined />, label: '离线' },
  unknown: { color: 'default', icon: <ExclamationCircleOutlined />, label: '未知' },
}

const syncStatusColor: Record<ConfigSyncStatus, string> = {
  in_sync: 'success',
  out_of_sync: 'warning',
  unknown: 'default',
  manual_override: 'error',
}

const syncStatusLabel: Record<ConfigSyncStatus, string> = {
  in_sync: '已同步',
  out_of_sync: '未同步',
  unknown: '未知',
  manual_override: '手工覆盖',
}

const syncStatusTip: Record<ConfigSyncStatus, string> = {
  in_sync: '中心配置版本与边缘实际生效版本一致',
  out_of_sync: '中心有更新版本或拉取/校验失败，边缘仍生效旧配置',
  unknown: '未上报配置版本（如 Agent 离线）',
  manual_override: '本地手工修改配置（PRD 3.6 兜底），平台不强制 reconcile，需人工重新确认下发',
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

export function EdgeAgentsPage() {
  const stats = useMemo(() => {
    const total = edgeAgents.length
    const online = edgeAgents.filter((a) => a.status === 'online').length
    const offline = edgeAgents.filter((a) => a.status === 'offline').length
    const outOfSync = edgeAgents.filter((a) => a.config_sync_status === 'out_of_sync').length
    const totalWal = edgeAgents.reduce((sum, a) => sum + a.wal_backlog_bytes, 0)
    return { total, online, offline, outOfSync, totalWal }
  }, [])

  const domainMap = useMemo(() => {
    return Object.fromEntries(networkDomains.map((d) => [d.id, d.name]))
  }, [])

  return (
    <MainLayout>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="Agent 总数" value={stats.total} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="在线 Agent" value={stats.online} valueStyle={{ color: '#00B578' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="配置未同步" value={stats.outOfSync} valueStyle={{ color: '#FA8C16' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="总 WAL 积压" value={formatBytes(stats.totalWal)} />
          </Card>
        </Col>
      </Row>

      <Card title="边缘 Agent 状态">
        <Table
          dataSource={edgeAgents}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'Agent ID', dataIndex: 'id', key: 'id' },
            {
              title: '所属网域',
              dataIndex: 'network_domain_id',
              key: 'network_domain_id',
              render: (id: string) => <Text>{domainMap[id] ?? id}</Text>,
            },
            {
              title: '在线状态',
              dataIndex: 'status',
              key: 'status',
              render: (status: NetworkDomainStatus) => {
                const cfg = statusConfig[status]
                return (
                  <Tag color={cfg.color} icon={cfg.icon}>
                    {cfg.label}
                  </Tag>
                )
              },
            },
            { title: '主机名', dataIndex: 'hostname', key: 'hostname' },
            { title: '版本', dataIndex: 'version', key: 'version' },
            {
              title: '心跳 RTT',
              dataIndex: 'heartbeat_rtt_ms',
              key: 'heartbeat_rtt_ms',
              render: (v: number) => `${v} ms`,
            },
            {
              title: '配置同步',
              dataIndex: 'config_sync_status',
              key: 'config_sync_status',
              render: (status: ConfigSyncStatus) => (
                <Tooltip title={syncStatusTip[status]}>
                  <Tag color={syncStatusColor[status]}>{syncStatusLabel[status]}</Tag>
                </Tooltip>
              ),
            },
            {
              title: 'WAL 积压',
              dataIndex: 'wal_backlog_bytes',
              key: 'wal_backlog_bytes',
              render: formatBytes,
            },
            { title: '最后心跳', dataIndex: 'last_heartbeat', key: 'last_heartbeat' },
            {
              title: '最后错误',
              dataIndex: 'last_error',
              key: 'last_error',
              render: (error: string) =>
                error ? (
                  <Tooltip title={error}>
                    <Text type="danger" ellipsis style={{ maxWidth: 160 }}>
                      {error}
                    </Text>
                  </Tooltip>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            {
              title: '操作',
              key: 'action',
              render: () => (
                <Space>
                  <Tooltip title="重新拉取配置（原型演示）">
                    <ReloadOutlined style={{ color: '#0ECDEB', cursor: 'pointer' }} />
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            配置同步状态说明：<Text code>in_sync</Text>=已同步（中心与边缘版本一致）；
            <Text code>out_of_sync</Text>=未同步（中心有更新版本，或边缘拉取配置包后 checksum 校验失败保留旧配置，PRD 6.3 第 4 条）；
            <Text code>manual_override</Text>=本地手工覆盖（PRD 3.6 兜底，平台不强制 reconcile）；
            <Text code>unknown</Text>=未知（未上报配置版本）。
          </Text>
        </div>
      </Card>
    </MainLayout>
  )
}

export default EdgeAgentsPage
