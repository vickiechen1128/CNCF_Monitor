import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  message,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { DownloadOutlined, EyeOutlined, FileExcelOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { EllipsisText } from '../components/EllipsisText'
import {
  RESOURCE_TYPE_MAP,
  STATUS_MAP,
  mockImportHistory,
  mockStatusMappingConfig,
} from '../mocks/module-07'
import type { ImportError, ImportHistory, ResourceCategory } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

export default function ImportHistoryPage() {
  const [filterType, setFilterType] = useState<ResourceCategory | 'all'>('all')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportRecord, setReportRecord] = useState<ImportHistory | null>(null)

  const filteredData = useMemo(() => {
    if (filterType === 'all') return mockImportHistory
    return mockImportHistory.filter((item) => item.resource_category === filterType)
  }, [filterType])

  const openReport = (record: ImportHistory) => {
    setReportRecord(record)
    setReportOpen(true)
  }

  const errorColumns: TableProps<ImportError>['columns'] = [
    { title: '行号', dataIndex: 'row', key: 'row', width: 80 },
    {
      title: '资源类别',
      dataIndex: 'resource_category',
      key: 'resource_category',
      width: 110,
      render: (v: ResourceCategory) => <Tag>{RESOURCE_TYPE_MAP[v]}</Tag>,
    },
    { title: '字段', dataIndex: 'field', key: 'field', width: 150 },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      render: (v: string) => (v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : '(空)'),
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string) => (v ? <EllipsisText maxWidth={260}>{v}</EllipsisText> : '-'),
    },
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
      title: '资源类别',
      dataIndex: 'resource_category',
      key: 'resource_category',
      render: (value: ResourceCategory) => <Tag>{RESOURCE_TYPE_MAP[value]}</Tag>,
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
        message="Excel 导入说明"
        description={
          <Space direction="vertical" size={6}>
            <Text style={{ fontSize: 13 }}>
              • 状态映射为系统规则，Excel 导入时状态列中文值自动转换为系统状态，本页只读展示：
            </Text>
            <Space wrap size={[8, 4]}>
              {mockStatusMappingConfig.rules.map((rule) => (
                <Tag key={rule.id} style={{ fontSize: 12 }}>
                  {rule.source_status} → {STATUS_MAP[rule.target_status]}
                  {rule.is_builtin && ' [内置]'}
                </Tag>
              ))}
            </Space>
            <Text style={{ fontSize: 13 }}>
              • 导入模板由后端生成静态 xlsx，内置「取值说明 sheet」列出网域 / 业务 / 枚举列合法值。
            </Text>
            <Text style={{ fontSize: 13 }}>
              • 导入为 upsert 语义，不删除 Excel 中消失的行；批量下线请将目标行状态置「已停止」后导入。
            </Text>
          </Space>
        }
      />
      <Card className="page-card">
        <FilterBar>
          <FilterItem label="资源类别" width={220}>
            <Select
              value={filterType}
              onChange={(value) => setFilterType(value as ResourceCategory | 'all')}
              style={{ width: 160 }}
            >
              <Option value="all">全部</Option>
              {RESOURCE_TYPES.map((type) => (
                <Option key={type} value={type}>
                  {RESOURCE_TYPE_MAP[type]}
                </Option>
              ))}
            </Select>
          </FilterItem>
        </FilterBar>
        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          <Button icon={<DownloadOutlined />}>导出记录</Button>
        </div>

        <Table
          rowKey="import_id"
          dataSource={filteredData}
          columns={columns}
          pagination={{ pageSize: 5 }}
          locale={{
            emptyText: (
              <Space direction="vertical" align="center" style={{ padding: 24 }}>
                <Text type="secondary">暂无导入记录</Text>
                <Space>
                  <Button icon={<DownloadOutlined />} onClick={() => message.info('下载模板：由后端生成的静态 xlsx（内置取值说明 sheet）')}>下载模板</Button>
                  <Button type="primary" icon={<FileExcelOutlined />} onClick={() => message.info('上传 Excel 的入口位于资源列表「Excel 导入」')}>上传 Excel</Button>
                </Space>
              </Space>
            ),
          }}
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
