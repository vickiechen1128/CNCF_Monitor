import { useMemo, useState } from 'react'
import { Card, Switch, Table, Tag, Typography } from 'antd'
import { MainLayout } from '../layouts/MainLayout'
import { type NormalizationRule, mockNormalizationRules } from '../mocks/module-10'

const { Title } = Typography

export default function NormalizationPage() {
  const [rules, setRules] = useState<NormalizationRule[]>(mockNormalizationRules)

  const columns = useMemo(
    () => [
      {
        title: '源标签',
        dataIndex: 'source_label',
        key: 'source_label',
        render: (value: string) => <Tag color="#1481FD">{value}</Tag>,
      },
      {
        title: '目标标签',
        dataIndex: 'target_label',
        key: 'target_label',
        render: (value: string) => <Tag color="#0ECDEB">{value}</Tag>,
      },
      {
        title: '优先级',
        dataIndex: 'priority',
        key: 'priority',
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        key: 'enabled',
        render: (_enabled: boolean, record: NormalizationRule) => (
          <Switch
            checked={record.enabled}
            onChange={(checked) => {
              setRules((prev) =>
                prev.map((r) => (r.id === record.id ? { ...r, enabled: checked } : r))
              )
            }}
          />
        ),
      },
    ],
    []
  )

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>标签归一化</Title>
      </div>
      <Card className="page-card">
        <Table
          rowKey="id"
          dataSource={rules}
          columns={columns}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </MainLayout>
  )
}
