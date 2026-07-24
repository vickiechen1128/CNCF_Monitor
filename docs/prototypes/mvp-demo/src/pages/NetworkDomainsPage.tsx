import { Card, Table, Tabs, Tag, Button, Space, Descriptions, Statistic, Row, Col } from 'antd'
import { PlusOutlined, ReloadOutlined, SafetyOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { networkDomains, edgeAgents } from '../mocks/networkDomains'

const statusColor = {
  online: 'green',
  offline: 'red',
  unknown: 'default',
}

const syncStatusColor = {
  in_sync: 'green',
  out_of_sync: 'orange',
  unknown: 'default',
}

export function NetworkDomainsPage() {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  return (
    <MainLayout>
      <Card title="网域与边缘 Agent 管理" extra={<Tag color="blue">多站点模式</Tag>}>
        <Tabs
          items={[
            {
              key: 'domains',
              label: '网域列表',
              children: (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />}>注册网域</Button>
                  </div>
                  <Table
                    dataSource={networkDomains}
                    rowKey="id"
                    size="small"
                    expandable={{
                      expandedRowRender: (record) => (
                        <Descriptions bordered size="small" column={2}>
                          <Descriptions.Item label="Token">{record.token}</Descriptions.Item>
                          <Descriptions.Item label="Remote Write URL">{record.remote_write_url}</Descriptions.Item>
                          <Descriptions.Item label="描述">{record.description}</Descriptions.Item>
                          <Descriptions.Item label="Agent 版本">{record.agent_version}</Descriptions.Item>
                          <Descriptions.Item label="创建时间">{record.created_at}</Descriptions.Item>
                          <Descriptions.Item label="更新时间">{record.updated_at}</Descriptions.Item>
                        </Descriptions>
                      ),
                    }}
                    columns={[
                      { title: '网域 ID', dataIndex: 'id', key: 'id' },
                      { title: '网域名称', dataIndex: 'name', key: 'name' },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        key: 'status',
                        render: (status: keyof typeof statusColor) => <Tag color={statusColor[status]}>{status}</Tag>,
                      },
                      {
                        title: 'Agent 类型',
                        dataIndex: 'agent_type',
                        key: 'agent_type',
                        render: (type: string) => <Tag>{type}</Tag>,
                      },
                      { title: '最后心跳', dataIndex: 'last_heartbeat', key: 'last_heartbeat' },
                      {
                        title: '操作',
                        key: 'action',
                        render: () => (
                          <Space>
                            <Button size="small" icon={<ReloadOutlined />}>重置 Token</Button>
                            <Button size="small" icon={<SafetyOutlined />}>证书</Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'edge-agents',
              label: '边缘 Agent 诊断',
              children: (
                <>
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col span={6}>
                      <Card><Statistic title="在线 Agent" value={edgeAgents.filter((a) => a.status === 'online').length} /></Card>
                    </Col>
                    <Col span={6}>
                      <Card><Statistic title="离线 Agent" value={edgeAgents.filter((a) => a.status === 'offline').length} valueStyle={{ color: '#cf1322' }} /></Card>
                    </Col>
                    <Col span={6}>
                      <Card><Statistic title="配置不同步" value={edgeAgents.filter((a) => a.config_sync_status === 'out_of_sync').length} /></Card>
                    </Col>
                    <Col span={6}>
                      <Card><Statistic title="总 WAL 积压" value={formatBytes(edgeAgents.reduce((sum, a) => sum + a.wal_backlog_bytes, 0))} /></Card>
                    </Col>
                  </Row>
                  <Table
                    dataSource={edgeAgents}
                    rowKey="id"
                    size="small"
                    expandable={{
                      expandedRowRender: (record) => (
                        <Descriptions bordered size="small" column={2}>
                          <Descriptions.Item label="Agent ID">{record.id}</Descriptions.Item>
                          <Descriptions.Item label="主机名">{record.hostname}</Descriptions.Item>
                          <Descriptions.Item label="Remote Write URL">{record.remote_write_url}</Descriptions.Item>
                          <Descriptions.Item label="最后配置拉取">{record.last_config_pull}</Descriptions.Item>
                          <Descriptions.Item label="最后错误">{record.last_error || '无'}</Descriptions.Item>
                          <Descriptions.Item label="创建时间">{record.created_at}</Descriptions.Item>
                        </Descriptions>
                      ),
                    }}
                    columns={[
                      { title: 'Agent ID', dataIndex: 'id', key: 'id' },
                      { title: '所属网域', dataIndex: 'network_domain_id', key: 'network_domain_id' },
                      {
                        title: '在线状态',
                        dataIndex: 'status',
                        key: 'status',
                        render: (status: keyof typeof statusColor) => <Tag color={statusColor[status]}>{status}</Tag>,
                      },
                      { title: '版本', dataIndex: 'version', key: 'version' },
                      { title: '心跳 RTT', dataIndex: 'heartbeat_rtt_ms', key: 'heartbeat_rtt_ms', render: (v: number) => `${v} ms` },
                      {
                        title: '配置同步',
                        dataIndex: 'config_sync_status',
                        key: 'config_sync_status',
                        render: (status: keyof typeof syncStatusColor) => <Tag color={syncStatusColor[status]}>{status}</Tag>,
                      },
                      { title: 'WAL 积压', dataIndex: 'wal_backlog_bytes', key: 'wal_backlog_bytes', render: formatBytes },
                      { title: '最后心跳', dataIndex: 'last_heartbeat', key: 'last_heartbeat' },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

export default NetworkDomainsPage
