import { useMemo, useState } from 'react'
import { Card, Table, Tag, Input, Space, Typography, Row, Col, Badge } from 'antd'
import { SearchOutlined, DatabaseOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockMetricLibrary, mockExporterTemplates } from '../mocks/module-01'
import type { MetricType } from '../mocks/module-01'

const { Title, Text } = Typography

const METRIC_TYPE_COLOR: Record<MetricType, string> = {
  counter: '#00B578',
  gauge: '#1481FD',
  histogram: '#FA8C16',
  summary: '#722ED1',
}

const METRIC_TYPE_LABEL: Record<MetricType, string> = {
  counter: 'Counter',
  gauge: 'Gauge',
  histogram: 'Histogram',
  summary: 'Summary',
}

export default function MetricLibraryPage() {
  const [search, setSearch] = useState('')

  const groupedData = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return mockExporterTemplates
      .map((tpl) => ({
        exporter: tpl,
        metrics: mockMetricLibrary.filter(
          (m) =>
            m.exporter_template_id === tpl.exporter_template_id &&
            (!keyword ||
              m.metric_name.toLowerCase().includes(keyword) ||
              m.help.toLowerCase().includes(keyword))
        ),
      }))
      .filter((group) => group.metrics.length > 0)
  }, [search])

  const columns = [
    {
      title: '指标名称',
      dataIndex: 'metric_name',
      key: 'metric_name',
      render: (value: string) => (
        <Text strong code style={{ color: '#0ECDEB' }}>
          {value}
        </Text>
      ),
    },
    {
      title: '类型',
      dataIndex: 'metric_type',
      key: 'metric_type',
      render: (value: MetricType) => (
        <Tag color={METRIC_TYPE_COLOR[value]}>{METRIC_TYPE_LABEL[value]}</Tag>
      ),
    },
    {
      title: '说明',
      dataIndex: 'help',
      key: 'help',
      ellipsis: true,
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      render: (value?: string) => value || '-',
    },
    {
      title: '标签',
      dataIndex: 'labels',
      key: 'labels',
      render: (value: string[]) => (
        <Space wrap>
          {value.map((label) => (
            <Tag key={label} color="blue" style={{ fontSize: 12 }}>
              {label}
            </Tag>
          ))}
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>指标元数据</Title>
        <Text type="secondary">按 Exporter 模板分组查看指标库</Text>
      </div>
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Space>
              <DatabaseOutlined style={{ color: '#0ECDEB', fontSize: 18 }} />
              <Text type="secondary">共 {mockMetricLibrary.length} 个指标，{mockExporterTemplates.length} 个 Exporter 模板</Text>
            </Space>
          </Col>
          <Col>
            <Input.Search
              placeholder="搜索指标名或说明"
              allowClear
              prefix={<SearchOutlined />}
              onSearch={(value) => setSearch(value)}
              style={{ width: 320 }}
            />
          </Col>
        </Row>

        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {groupedData.map((group) => (
            <Card
              key={group.exporter.exporter_template_id}
              type="inner"
              title={
                <Space>
                  <Text strong>{group.exporter.name}</Text>
                  <Tag color="cyan">v{group.exporter.version}</Tag>
                  <Badge count={group.metrics.length} style={{ backgroundColor: '#0ECDEB' }} />
                </Space>
              }
              extra={<Text type="secondary">{group.exporter.description}</Text>}
            >
              <Table
                rowKey="metric_id"
                dataSource={group.metrics}
                columns={columns}
                pagination={false}
                size="small"
              />
            </Card>
          ))}
        </Space>
      </Card>
    </MainLayout>
  )
}
