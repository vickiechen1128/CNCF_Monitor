import { useState } from 'react'
import { Card, Input, Button, Table, Tabs, Select, Space, Tag, Empty, message, Alert, Typography, Descriptions } from 'antd'
import { HistoryOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { useTenant } from '../contexts/TenantContext'
import { queryEnvelope, queryTemplates, type QueryRecord, type DataSourceType } from '../mocks/module-02'

const { Text } = Typography

export function QueryPage() {
  const [expr, setExpr] = useState('node_cpu_seconds_total{mode="idle"}')
  const [activeTab, setActiveTab] = useState('table')
  const [dataSourceDemo, setDataSourceDemo] = useState<DataSourceType>('central_scrape')
  const { multiSiteEnabled } = useTenant()

  const dataSource = queryEnvelope.data.result as QueryRecord[]
  const allowedDomains = multiSiteEnabled ? ['default', 'gov-cloud-a'] : ['default']

  // 动态 envelope：MVP 恒 central_scrape；v0.2 演示 edge_remote_write（数据来源细化到网域）
  const displayEnvelope = {
    ...queryEnvelope,
    meta: {
      ...queryEnvelope.meta,
      data_source: dataSourceDemo,
      network_domains: allowedDomains,
    },
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
      render: (_: unknown, record: QueryRecord) => {
        const last = record.values[record.values.length - 1]
        return last ? last[1] : '-'
      },
    },
  ]

  const handleExecute = () => {
    message.success('查询已执行')
  }

  const handleTemplateSelect = (value: string) => {
    setExpr(value)
  }

  const injectedSelector = multiSiteEnabled
    ? `network_domain=~"${allowedDomains.join('|')}"`
    : `network_domain="${allowedDomains[0]}"`

  return (
    <MainLayout>
      <Card title="PromQL 查询中心">
        <Space direction="vertical" size="large" style={{ display: 'flex' }}>
          {/* 自动注入提示（PRD 5.2：系统注入 = 权限隔离） */}
          <Alert
            type="info"
            showIcon
            message={multiSiteEnabled ? '多网域场景：默认查询全部授权网域' : '单网域场景：网域注入对用户透明'}
            description={
              <Space direction="vertical" size={4}>
                <Space wrap>
                  <Text strong>自动注入：</Text>
                  <Tag color="blue">tenant_id="tenant-a"</Tag>
                  <Tag color="purple">{injectedSelector}</Tag>
                </Space>
                {multiSiteEnabled && (
                  <Text type="secondary">
                    当前查询范围覆盖 {allowedDomains.length} 个网域；可在 PromQL 中进一步使用 network_domain matcher 手动筛选（用户过滤 = 业务筛选）。
                  </Text>
                )}
              </Space>
            }
          />

          <Space.Compact style={{ width: '100%' }}>
            <Select
              defaultValue="instant"
              style={{ width: 120 }}
              options={[
                { value: 'instant', label: 'Instant' },
                { value: 'range', label: 'Range' },
              ]}
            />
            <Input value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="输入 PromQL 表达式" />
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecute}>
              执行查询
            </Button>
          </Space.Compact>

          {/* 查询辅助（PRD 3.1，v0.3 交付：指标名补全 / 标签建议 / 常用模板） */}
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
            <Tag color="orange">查询辅助 v0.3</Tag>
          </Space>

          {/* 数据来源与新鲜度演示（PRD 6.2/6.3） */}
          <Card size="small" title="响应 Envelope 与数据新鲜度">
            <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
              <Space wrap>
                <span className="text-secondary">演示数据来源：</span>
                <Select
                  value={dataSourceDemo}
                  onChange={setDataSourceDemo}
                  style={{ width: 200 }}
                  options={[
                    { value: 'central_scrape', label: 'central_scrape（MVP 默认）' },
                    { value: 'edge_remote_write', label: 'edge_remote_write（v0.2 演示）' },
                  ]}
                />
              </Space>
              {dataSourceDemo === 'edge_remote_write' && (
                <Alert
                  type="warning"
                  showIcon
                  message="数据为边缘异步写入，可能存在延迟"
                  description="v0.2：freshness_at 滞后于当前时间，UI 需区分「无数据」与「数据旧」；联动 Module_09 心跳，该网域数据已延迟约 3 分钟（WAL 积压 12MB）。"
                />
              )}
              {/* 决策 50 / v1.5：MVP envelope 最小实现口径——data_source 恒 central_scrape、network_domains 恒 ["default"]、freshness_at 取最新样本时间戳（空结果 null） */}
              <Alert
                type="info"
                showIcon
                message="MVP envelope 最小口径（决策 50 / PRD §8.2）"
                description="MVP 阶段 envelope 元数据按最小集落地：data_source 恒为 central_scrape、network_domains 恒为 [default]、freshness_at 取查询结果中最新的样本时间戳（结果为空时为 null）；v0.2 起细化到网域/多数据源，结构在 MVP 即固定，避免下游改动。"
              />
              <Descriptions
                size="small"
                column={1}
                items={[
                  {
                    key: 'ds',
                    label: 'data_source',
                    children: <Tag color={dataSourceDemo === 'central_scrape' ? 'blue' : 'orange'}>{dataSourceDemo}</Tag>,
                  },
                  { key: 'fa', label: 'freshness_at', children: displayEnvelope.meta.freshness_at },
                  {
                    key: 'nd',
                    label: 'network_domains',
                    children: (
                      <Space wrap>
                        {displayEnvelope.meta.network_domains.map((d) => (
                          <Tag key={d} color="purple">{d}</Tag>
                        ))}
                        <Text type="secondary">（MVP 单网域恒为 [default]；v1.2 由单值 network_domain 调整为数组，适配多网域）</Text>
                      </Space>
                    ),
                  },
                  {
                    key: 'sd',
                    label: 'data_source_by_domain',
                    children: (
                      <Space wrap>
                        {Object.entries(queryEnvelope.meta.data_source_by_domain ?? {}).map(([domain, src]) => (
                          <Tag key={domain}>{domain} → {src}</Tag>
                        ))}
                        <Text type="secondary">（v0.2：数据来源细化到网域维度）</Text>
                      </Space>
                    ),
                  },
                ]}
              />
            </Space>
          </Card>

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
                    {JSON.stringify(displayEnvelope, null, 2)}
                  </pre>
                ),
              },
              {
                key: 'chart',
                label: '简单折线',
                children: (
                  <Empty description="简单折线占位：集成图表库后可渲染时序曲线">
                    <div
                      style={{
                        height: 200,
                        background: '#F7F8FA',
                        borderRadius: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <span className="text-tertiary">时序图表占位区域（首页 Dashboard 数据 v0.3）</span>
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
