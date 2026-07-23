import { Card, Table, Tag, Descriptions } from 'antd'
import { MainLayout } from '../layouts/MainLayout'
import { alerts } from '../mocks/alerts'

const severityColor = {
  critical: 'red',
  warning: 'orange',
  info: 'blue',
}

export function AlertsPage() {
  return (
    <MainLayout>
      <Card title="告警状态">
        <Table
          dataSource={alerts}
          rowKey="id"
          size="small"
          expandable={{
            expandedRowRender: (record) => (
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label="详细描述">{record.description}</Descriptions.Item>
                <Descriptions.Item label="触发时间">{record.firedAt}</Descriptions.Item>
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
            { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
            { title: '触发时间', dataIndex: 'firedAt', key: 'firedAt' },
          ]}
        />
      </Card>
    </MainLayout>
  )
}

export default AlertsPage
