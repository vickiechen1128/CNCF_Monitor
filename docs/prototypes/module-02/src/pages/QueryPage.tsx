import { useState } from 'react'
import { Card, Input, Button, Table, Tabs, Select, Space, Tag, Empty, message } from 'antd'
import { HistoryOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { queryEnvelope, queryTemplates, type QueryRecord } from '../mocks/module-02'

export function QueryPage() {
  const [expr, setExpr] = useState('node_cpu_seconds_total{mode="idle"}')
  const [activeTab, setActiveTab] = useState('table')

  const dataSource = queryEnvelope.data.result as QueryRecord[]

  const columns = [
    { title: '指标名', dataIndex: ['metric', '__name__'], key: '__name__' },
    { title: '实例', dataIndex: ['metric', 'instance'], key: 'instance' },
    { title: '模式', dataIndex: ['metric', 'mode'], key: 'mode' },
    { title: '网域', dataIndex: ['metric', 'network_domain'], key: 'network_domain' },
    { title: '来源类型', dataIndex: ['metric', 'source_type'], key: 'source_type' },
    {
      title: '数值',
      key: 'value',
      render: (_: unknown, record: QueryRecord) => {
        const last = record.values[record.values.length - 1]
        return last ? last[1] : '-'
      },
    },
  ]

  const handleExecute = () => {
    message.success('查询已执行（原型演示，使用本地 mock 数据）')
  }

  const handleTemplateSelect = (value: string) => {
    setExpr(value)
  }

  return (
    <MainLayout>
      <Card title="PromQL 查询中心">
        <Space direction="vertical" size="large" style={{ display: 'flex' }}>
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
            />
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecute}>
              执行查询
            </Button>
          </Space.Compact>

          <Space>
            <HistoryOutlined style={{ color: '#86909C' }} />
            <span className="text-secondary">常用模板：</span>
            <Select
              placeholder="选择查询模板"
              style={{ width: 320 }}
              options={queryTemplates.map((q) => ({ value: q.expr, label: q.name }))}
              onChange={handleTemplateSelect}
              allowClear
            />
          </Space>

          <Space wrap>
            <span className="text-secondary">Meta 信息：</span>
            <Tag color="blue">data_source: {queryEnvelope.meta.data_source}</Tag>
            <Tag>freshness_at: {queryEnvelope.meta.freshness_at}</Tag>
            <Tag color="purple">network_domain: {queryEnvelope.meta.network_domain}</Tag>
          </Space>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: 'table',
                label: '表格',
                children: (
                  <Table<QueryRecord>
                    dataSource={dataSource}
                    rowKey={(record) => JSON.stringify(record.metric)}
                    columns={columns}
                    size="small"
                    pagination={{ pageSize: 10 }}
                  />
                ),
              },
              {
                key: 'json',
                label: 'JSON',
                children: (
                  <pre className="yaml-preview" style={{ margin: 0, maxHeight: 480, overflow: 'auto' }}>
                    {JSON.stringify(queryEnvelope, null, 2)}
                  </pre>
                ),
              },
              {
                key: 'chart',
                label: '简单折线',
                children: (
                  <Empty description="简单折线占位：集成图表库后可渲染时序曲线">
                    <div style={{ height: 200, background: '#F7F8FA', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="text-tertiary">时序图表占位区域</span>
                    </div>
                  </Empty>
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
