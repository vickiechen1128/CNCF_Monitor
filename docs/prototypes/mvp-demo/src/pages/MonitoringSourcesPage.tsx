import { Card, Table, Tabs, Tag, Button, Space, Descriptions, Statistic, Row, Col, Input } from 'antd'
import { PlusOutlined, CopyOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { monitoringSources, ingestionStats } from '../mocks/monitoringSources'

const statusColor = {
  online: 'green',
  offline: 'red',
  disabled: 'default',
  unknown: 'orange',
}

const sourceTypeLabel: Record<string, string> = {
  edge_agent: 'Edge Agent',
  external_prometheus: '外部 Prometheus',
  zabbix: 'Zabbix',
  cloud_monitor: '云监控',
  opentelemetry: 'OpenTelemetry',
}

export function MonitoringSourcesPage() {
  const remoteWriteSnippet = (sourceId: string, token: string) => `remote_write:
  - url: "https://metriccenter.example.com/api/v2/ingest/prometheus/${sourceId}"
    bearer_token: "${token}"
    queue_config:
      capacity: 10000
      max_samples_per_send: 2000
      max_shards: 10
      retry_on_rate_limit: true`

  return (
    <MainLayout>
      <Card title="监控源登记册与异构接入" extra={<Tag color="purple">集成模式</Tag>}>
        <Tabs
          items={[
            {
              key: 'sources',
              label: '监控源列表',
              children: (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <Button type="primary" icon={<PlusOutlined />}>注册监控源</Button>
                  </div>
                  <Table
                    dataSource={monitoringSources}
                    rowKey="id"
                    size="small"
                    expandable={{
                      expandedRowRender: (record) => (
                        <Descriptions bordered size="small" column={2}>
                          <Descriptions.Item label="接入方式">{record.ingest_method}</Descriptions.Item>
                          <Descriptions.Item label="接入端点">{record.ingest_endpoint}</Descriptions.Item>
                          <Descriptions.Item label="认证类型">{record.auth_type}</Descriptions.Item>
                          <Descriptions.Item label="Remote Write URL">{record.remote_write_url}</Descriptions.Item>
                          <Descriptions.Item label="附加标签">{JSON.stringify(record.labels)}</Descriptions.Item>
                          <Descriptions.Item label="最后错误">{record.last_error || '无'}</Descriptions.Item>
                          {record.source_type === 'external_prometheus' && (
                            <Descriptions.Item label="remote_write 配置" span={2}>
                              <Input.TextArea
                                rows={6}
                                value={remoteWriteSnippet(record.id, record.auth_config.token || '')}
                                readOnly
                                style={{ fontFamily: 'monospace' }}
                              />
                              <Button size="small" icon={<CopyOutlined />} style={{ marginTop: 8 }}>复制配置</Button>
                            </Descriptions.Item>
                          )}
                        </Descriptions>
                      ),
                    }}
                    columns={[
                      { title: '监控源', dataIndex: 'name', key: 'name' },
                      {
                        title: '类型',
                        dataIndex: 'source_type',
                        key: 'source_type',
                        render: (type: string) => <Tag>{sourceTypeLabel[type] || type}</Tag>,
                      },
                      { title: '归属网域', dataIndex: 'network_domain_id', key: 'network_domain_id' },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        key: 'status',
                        render: (status: keyof typeof statusColor) => <Tag color={statusColor[status]}>{status}</Tag>,
                      },
                      { title: '最后活跃', dataIndex: 'last_heartbeat', key: 'last_heartbeat' },
                      {
                        title: '操作',
                        key: 'action',
                        render: () => (
                          <Space>
                            <Button size="small">编辑</Button>
                            <Button size="small">重置 Token</Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: 'stats',
              label: '接入统计',
              children: (
                <>
                  <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                    <Col span={6}>
                      <Card><Statistic title="总样本/秒" value={ingestionStats.reduce((sum, s) => sum + s.samples_per_second, 0).toFixed(0)} /></Card>
                    </Col>
                    <Col span={6}>
                      <Card><Statistic title="总请求/分" value={ingestionStats.reduce((sum, s) => sum + s.requests_per_minute, 0)} /></Card>
                    </Col>
                    <Col span={6}>
                      <Card><Statistic title="平均错误率" value={(ingestionStats.reduce((sum, s) => sum + s.error_rate, 0) / ingestionStats.length * 100).toFixed(2)} suffix="%" /></Card>
                    </Col>
                    <Col span={6}>
                      <Card><Statistic title="监控源总数" value={monitoringSources.length} /></Card>
                    </Col>
                  </Row>
                  <Table
                    dataSource={ingestionStats}
                    rowKey="source_id"
                    size="small"
                    columns={[
                      { title: 'Source ID', dataIndex: 'source_id', key: 'source_id' },
                      { title: '网域', dataIndex: 'network_domain_id', key: 'network_domain_id' },
                      { title: '样本/秒', dataIndex: 'samples_per_second', key: 'samples_per_second' },
                      { title: '请求/分', dataIndex: 'requests_per_minute', key: 'requests_per_minute' },
                      {
                        title: '错误率',
                        dataIndex: 'error_rate',
                        key: 'error_rate',
                        render: (v: number) => <Tag color={v > 0.01 ? 'red' : 'green'}>{(v * 100).toFixed(2)}%</Tag>,
                      },
                      { title: '最近样本时间', dataIndex: 'last_sample_timestamp', key: 'last_sample_timestamp' },
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

export default MonitoringSourcesPage
