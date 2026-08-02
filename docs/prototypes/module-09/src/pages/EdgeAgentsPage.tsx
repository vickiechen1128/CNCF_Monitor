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
              render: (status: ConfigSyncStatus) => <Tag color={syncStatusColor[status]}>{status}</Tag>,
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
      </Card>
    </MainLayout>
  )
}

export default EdgeAgentsPage
