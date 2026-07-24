import { Card, Input, Button, Table, Tabs, Select, Space, Tag } from 'antd'
import { useState } from 'react'
import { SearchOutlined, HistoryOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { queryResult, savedQueries, labelSuggestions } from '../mocks/query'

export function QueryPage() {
  const [expr, setExpr] = useState('node_cpu_seconds_total{mode="idle"}')

  interface QueryRecord {
    metric: Record<string, string>
    values: [number, string][]
  }

  const columns = [
    { title: '指标名', dataIndex: ['metric', '__name__'], key: '__name__' },
    { title: '实例', dataIndex: ['metric', 'instance'], key: 'instance' },
    { title: '模式', dataIndex: ['metric', 'mode'], key: 'mode' },
    { title: '网域', dataIndex: ['metric', 'network_domain'], key: 'network_domain' },
    { title: '来源类型', dataIndex: ['metric', 'source_type'], key: 'source_type' },
    {
      title: '数值',
      key: 'value',
      render: (_: unknown, record: QueryRecord) => record.values[record.values.length - 1][1],
    },
  ]

  return (
    <MainLayout>
      <Card title="指标查询中心">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Select
              defaultValue="instant"
              style={{ width: 120 }}
              options={[
                { value: 'instant', label: 'Instant' },
                { value: 'range', label: 'Range' },
              ]}
            />
            <Input
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder="输入 PromQL 表达式"
              suffix={
                <Select
                  placeholder="指标建议"
                  style={{ width: 200 }}
                  options={labelSuggestions.map((s) => ({ value: s, label: s }))}
                  onChange={(value) => setExpr(value)}
                />
              }
            />
            <Button type="primary" icon={<SearchOutlined />}>查询</Button>
          </Space.Compact>

          <Tabs
            items={[
              {
                key: 'result',
                label: '查询结果',
                children: (
                  <Table<QueryRecord>
                    dataSource={queryResult.data.result as QueryRecord[]}
                    rowKey={(record) => JSON.stringify(record.metric)}
                    columns={columns}
                    size="small"
                  />
                ),
              },
              {
                key: 'saved',
                label: (
                  <span>
                    <HistoryOutlined /> 常用查询
                  </span>
                ),
                children: (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {savedQueries.map((q) => (
                      <Card key={q.id} size="small" title={q.name}>
                        <Tag color="blue">{q.expr}</Tag>
                      </Card>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        </Space>
      </Card>
    </MainLayout>
  )
}

export default QueryPage
