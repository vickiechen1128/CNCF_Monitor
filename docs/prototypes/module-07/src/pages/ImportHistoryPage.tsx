import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Row,
  Col,
} from 'antd'
import type { TableProps } from 'antd'
import { DownloadOutlined, EyeOutlined, FileExcelOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  RESOURCE_TYPE_MAP,
  STATUS_MAP,
  STATUS_MAPPING_RULES,
  mockImportHistory,
} from '../mocks/module-07'
import type { ImportError, ImportHistory, ResourceType } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']

export default function ImportHistoryPage() {
  const [filterType, setFilterType] = useState<ResourceType | 'all'>('all')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportRecord, setReportRecord] = useState<ImportHistory | null>(null)

  const filteredData = useMemo(() => {
    if (filterType === 'all') return mockImportHistory
    return mockImportHistory.filter((item) => item.resource_type === filterType)
  }, [filterType])

  const openReport = (record: ImportHistory) => {
    setReportRecord(record)
    setReportOpen(true)
  }

  const errorColumns: TableProps<ImportError>['columns'] = [
    { title: '行号', dataIndex: 'row', key: 'row', width: 80 },
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      width: 110,
      render: (v: ResourceType) => <Tag>{RESOURCE_TYPE_MAP[v]}</Tag>,
    },
    { title: '字段', dataIndex: 'field', key: 'field', width: 150 },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      render: (v: string) => (v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : '(空)'),
    },
    { title: '原因', dataIndex: 'reason', key: 'reason' },
  ]

  const columns: TableProps<ImportHistory>['columns'] = [
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
    { title: '总数', dataIndex: 'total', key: 'total' },
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
    { title: '导入时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: ImportHistory) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => openReport(record)}>
          查看
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>导入记录</Title>
        <Text type="secondary">查看 Excel 批量导入资源的历史记录与错误报告</Text>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="状态映射字典：Excel 中文状态自动映射为运行中 / 已停止 / 维护中"
        description={
          <Space wrap size={[8, 8]}>
            {STATUS_MAPPING_RULES.map((rule) => (
              <Tag key={rule.target}>
                {rule.source.join(' / ')} → {STATUS_MAP[rule.target]}
              </Tag>
            ))}
          </Space>
        }
      />
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

      {/* 错误报告详情（PRD 7.3） */}
      <Modal
        title={`错误报告 - ${reportRecord?.filename ?? ''}`}
        open={reportOpen}
        onCancel={() => setReportOpen(false)}
        footer={
          <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={() => setReportOpen(false)}>
            关闭
          </Button>
        }
        width={760}
      >
        {reportRecord && (
          <>
            <Descriptions
              column={3}
              size="small"
              style={{ marginBottom: 16 }}
              items={[
                { key: 'total', label: '总数', children: reportRecord.total },
                { key: 'success', label: '成功', children: <Text style={{ color: '#00B578' }}>{reportRecord.success}</Text> },
                { key: 'failed', label: '失败', children: <Text style={{ color: reportRecord.failed > 0 ? '#FF4C3A' : '#86909C' }}>{reportRecord.failed}</Text> },
              ]}
            />
            <Table
              size="small"
              rowKey={(r) => `${r.row}-${r.field}`}
              dataSource={reportRecord.errors}
              columns={errorColumns}
              pagination={false}
              locale={{ emptyText: '导入无错误' }}
            />
          </>
        )}
      </Modal>
    </MainLayout>
  )
}
