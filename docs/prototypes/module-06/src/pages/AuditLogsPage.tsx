import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Modal,
  Descriptions,
  Space,
  Select,
  DatePicker,
} from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import {
  mockAuditLogs,
  ACTION_LABELS,
  type AuditLog,
  type AuditAction,
} from '../mocks/module-06'

const { Title } = Typography
const { Option } = Select
const { RangePicker } = DatePicker

const ACTION_COLORS: Record<AuditAction, string> = {
  create: '#00B578',
  update: '#0ECDEB',
  delete: '#FF4C3A',
  login: '#86909C',
  sync: '#FA8C16',
}

export function AuditLogsPage() {
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null)
  // {v2.1} 列表筛选（PRD §11.1：审计日志支持按操作人/时间筛选，另补操作类型筛选）
  const [filterOperator, setFilterOperator] = useState('all')
  const [filterAction, setFilterAction] = useState<'all' | AuditAction>('all')
  const [filterTimeRange, setFilterTimeRange] = useState<[string, string] | null>(null)

  const operators = useMemo(
    () => Array.from(new Set(mockAuditLogs.map((l) => l.operator))),
    []
  )

  const filteredLogs = useMemo(() => {
    return mockAuditLogs.filter((l) => {
      if (filterOperator !== 'all' && l.operator !== filterOperator) return false
      if (filterAction !== 'all' && l.action !== filterAction) return false
      if (filterTimeRange) {
        const day = l.operatedAt.slice(0, 10)
        if (day < filterTimeRange[0] || day > filterTimeRange[1]) return false
      }
      return true
    })
  }, [filterOperator, filterAction, filterTimeRange])

  const columns = [
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      render: (action: AuditAction) => (
        <Tag color={ACTION_COLORS[action]}>{ACTION_LABELS[action]}</Tag>
      ),
    },
    {
      title: '资源类型',
      dataIndex: 'resourceType',
      key: 'resourceType',
    },
    {
      title: '资源 ID',
      dataIndex: 'resourceId',
      key: 'resourceId',
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
    },
    {
      title: '操作时间',
      dataIndex: 'operatedAt',
      key: 'operatedAt',
    },
    {
      title: '说明',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: '操作',
      key: 'action-column',
      render: (_: unknown, record: AuditLog) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => setSelectedLog(record)}>
          查看 Diff
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>审计日志</Title>
      </div>
      <Card className="page-card">
        <FilterBar>
          <FilterItem label="操作类型">
            <Select
              placeholder="全部操作"
              allowClear
              value={filterAction === 'all' ? undefined : filterAction}
              onChange={(v) => setFilterAction((v ?? 'all') as 'all' | AuditAction)}
              style={{ width: 140 }}
            >
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <Option key={value} value={value}>
                  {label}
                </Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="操作人">
            <Select
              placeholder="全部操作人"
              allowClear
              showSearch
              value={filterOperator === 'all' ? undefined : filterOperator}
              onChange={(v) => setFilterOperator(v ?? 'all')}
              style={{ width: 160 }}
            >
              {operators.map((o) => (
                <Option key={o} value={o}>
                  {o}
                </Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="操作时间">
            <RangePicker
              onChange={(dates) =>
                setFilterTimeRange(
                  dates && dates[0] && dates[1]
                    ? [dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')]
                    : null
                )
              }
            />
          </FilterItem>
        </FilterBar>
        <Table
          rowKey="id"
          dataSource={filteredLogs}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title="变更详情"
        open={Boolean(selectedLog)}
        onCancel={() => setSelectedLog(null)}
        footer={null}
        width={640}
      >
        {selectedLog && (
          <>
            <Descriptions bordered column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="操作">
                <Tag color={ACTION_COLORS[selectedLog.action]}>
                  {ACTION_LABELS[selectedLog.action]}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="资源">
                {selectedLog.resourceType} / {selectedLog.resourceId}
              </Descriptions.Item>
              <Descriptions.Item label="操作人">{selectedLog.operator}</Descriptions.Item>
              <Descriptions.Item label="时间">{selectedLog.operatedAt}</Descriptions.Item>
              <Descriptions.Item label="说明">{selectedLog.description}</Descriptions.Item>
            </Descriptions>
            {selectedLog.diff ? (
              <pre className="yaml-preview">{JSON.stringify(selectedLog.diff, null, 2)}</pre>
            ) : (
              <Space>
                <Tag>无 Diff 数据</Tag>
              </Space>
            )}
          </>
        )}
      </Modal>
    </MainLayout>
  )
}
