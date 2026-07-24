import { Card, Table, Tag, Descriptions, Alert, Space } from 'antd'
import { MainLayout } from '../layouts/MainLayout'
import { alerts } from '../mocks/alerts'

const severityColor = {
  critical: 'red',
  warning: 'orange',
  info: 'blue',
}

export function AlertsPage() {
  const inhibitedCount = alerts.filter((a) => a.inhibited).length

  return (
    <MainLayout>
      <Card title="告警状态">
        {inhibitedCount > 0 && (
          <Alert
            message={`当前有 ${inhibitedCount} 条告警因网域离线被自动抑制（如 EdgeSiteOffline 触发后，该网域内 up/down 类告警不再重复通知）`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Table
          dataSource={alerts}
          rowKey="id"
          size="small"
          expandable={{
            expandedRowRender: (record) => (
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="详细描述">{record.description}</Descriptions.Item>
                <Descriptions.Item label="触发时间">{record.firedAt}</Descriptions.Item>
                <Descriptions.Item label="求值范围">{record.scope}</Descriptions.Item>
                <Descriptions.Item label="可抑制">{record.inhibitable ? '是' : '否'}</Descriptions.Item>
                {Object.entries(record.labels).map(([key, value]) => (
                  <Descriptions.Item key={key} label={key}>
                    {value}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ),
          }}
          columns={[
            { title: '告警名', dataIndex: 'name', key: 'name' },
            {
              title: '级别',
              dataIndex: 'severity',
              key: 'severity',
              render: (severity: keyof typeof severityColor) => (
                <Tag color={severityColor[severity]}>{severity}</Tag>
              ),
            },
            { title: '网域', dataIndex: 'network_domain_id', key: 'network_domain_id' },
            { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
            {
              title: '抑制状态',
              key: 'inhibition',
              render: (_: unknown, record: typeof alerts[0]) => (
                <Space>
                  {record.inhibited && <Tag color="orange">已抑制</Tag>}
                  {record.inhibitable && !record.inhibited && <Tag color="blue">可抑制</Tag>}
                  {!record.inhibitable && <Tag>不可抑制</Tag>}
                </Space>
              ),
            },
            { title: '触发时间', dataIndex: 'firedAt', key: 'firedAt' },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

export default AlertsPage
