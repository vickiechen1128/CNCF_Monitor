import { useMemo, useState } from 'react'
import { Card, Table, Button, Tag, Space, Typography, Row, Col, Progress, Select } from 'antd'
import { DownloadOutlined, FileExcelOutlined, EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockImportHistory, RESOURCE_TYPE_MAP } from '../mocks/module-07'
import type { ImportHistory, ResourceType } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']

export default function ImportHistoryPage() {
  const [filterType, setFilterType] = useState<ResourceType | 'all'>('all')

  const filteredData = useMemo(() => {
    if (filterType === 'all') return mockImportHistory
    return mockImportHistory.filter((item) => item.resource_type === filterType)
  }, [filterType])

  const columns = [
    {
      title: '导入文件名',
      dataIndex: 'filename',
      key: 'filename',
      render: (value: string) => (
        <Space>
          <FileExcelOutlined style={{ color: '#00B578' }} />
          <Text strong>{value}</Text>
        </Space>
      ),
    },
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: ResourceType) => <Tag>{RESOURCE_TYPE_MAP[value]}</Tag>,
    },
    {
      title: '总数',
      dataIndex: 'total',
      key: 'total',
    },
    {
      title: '成功 / 失败',
      key: 'result',
      render: (_: unknown, record: ImportHistory) => (
        <Space>
          <Text style={{ color: '#00B578' }}>{record.success}</Text>
          <Text type="secondary">/</Text>
          <Text style={{ color: record.failed > 0 ? '#FF4C3A' : '#86909C' }}>{record.failed}</Text>
        </Space>
      ),
    },
    {
      title: '成功率',
      key: 'progress',
      render: (_: unknown, record: ImportHistory) => {
        const percent = record.total === 0 ? 0 : Math.round((record.success / record.total) * 100)
        return (
          <Progress
            percent={percent}
            size="small"
            status={percent === 100 ? 'success' : 'exception'}
            style={{ width: 120 }}
          />
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: ImportHistory['status']) => {
        const config = {
          success: { color: '#00B578', text: '成功' },
          partial: { color: '#FA8C16', text: '部分成功' },
          failed: { color: '#FF4C3A', text: '失败' },
        }
        return <Tag color={config[value].color}>{config[value].text}</Tag>
      },
    },
    {
      title: '导入时间',
      dataIndex: 'created_at',
      key: 'created_at',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: ImportHistory) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />}>
            查看
          </Button>
          {record.error_report_url && (
            <Button type="link" icon={<DownloadOutlined />}>
              错误报告
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>导入记录</Title>
        <Text type="secondary">查看 Excel 批量导入资源的历史记录与错误报告</Text>
      </div>
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Space>
              <Text type="secondary">资源类型：</Text>
              <Select
                value={filterType}
                onChange={(value) => setFilterType(value as ResourceType | 'all')}
                style={{ width: 160 }}
              >
                <Option value="all">全部</Option>
                {RESOURCE_TYPES.map((type) => (
                  <Option key={type} value={type}>
                    {RESOURCE_TYPE_MAP[type]}
                  </Option>
                ))}
              </Select>
            </Space>
          </Col>
          <Col>
            <Button icon={<DownloadOutlined />}>导出记录</Button>
          </Col>
        </Row>

        <Table
          rowKey="import_id"
          dataSource={filteredData}
          columns={columns}
          pagination={{ pageSize: 5 }}
        />
      </Card>
    </MainLayout>
  )
}
