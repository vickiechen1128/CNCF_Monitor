import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import {
  DownloadOutlined,
  EyeOutlined,
  FileExcelOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { importApi } from '../../api/resources'
import type { ImportError, ImportMode, ImportRecord, ResourceCategory } from '../../types/resource'
import type { Paginated } from '../../types/api'

const { Text } = Typography

/** 五类资源类别（Module_07 §5.1 / 决策 D19） */
const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP） */
const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/** 导入模式展示名（§6.1 / T07-10） */
const MODE_MAP: Record<ImportMode, string> = {
  create_only: '仅新增',
  upsert: '新增或更新',
}

/** 导入记录状态展示（§6.4，status: success / partial / failed） */
const STATUS_CONFIG: Record<ImportRecord['status'], { text: string; color: string }> = {
  success: { text: '成功', color: 'green' },
  partial: { text: '部分成功', color: 'orange' },
  failed: { text: '失败', color: 'red' },
}

interface ImportRecordsPanelProps {
  /** 空态「下载模板」引导（ResourcesPage 打开 ImportModal） */
  onDownloadTemplate?: () => void
  /** 空态「上传 Excel」引导（ResourcesPage 打开 ImportModal） */
  onUploadExcel?: () => void
}

/**
 * 导入记录面板（Module_07 §6.4/§11.1，L3 任务 T07-F5）。
 * - importApi.list 按 resource_category/status 筛选、分页（默认 20/页）；
 * - 详情 importApi.get 含 errors 明细（错误行 Table）；
 * - 状态矩阵：加载骨架屏 / 空态「暂无导入记录」+「下载模板」/「上传 Excel」引导 /
 *   接口错误 Alert「导入记录加载失败，请稍后重试」+「重新加载」（§11.1）。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md
 */
export function ImportRecordsPanel({ onDownloadTemplate, onUploadExcel }: ImportRecordsPanelProps) {
  const [data, setData] = useState<Paginated<ImportRecord>>({ list: [], total: 0, page: 1, page_size: 20 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resourceCategory, setResourceCategory] = useState<'all' | ResourceCategory>('all')
  const [status, setStatus] = useState<'all' | ImportRecord['status']>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)
  // 详情弹窗（含 errors 明细）
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState<ImportRecord | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const params: Record<string, string | number | undefined> = {
        ...(resourceCategory !== 'all' ? { resource_category: resourceCategory } : {}),
        ...(status !== 'all' ? { status } : {}),
        page,
        page_size: pageSize,
      }
      const res = await importApi.list(params)
      setData(res.data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [resourceCategory, status, page, pageSize])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const changeFilter = (next: { resource_category?: 'all' | ResourceCategory; status?: 'all' | ImportRecord['status'] }) => {
    setResourceCategory(next.resource_category ?? resourceCategory)
    setStatus(next.status ?? status)
    setPage(1)
    setLoading(true)
  }

  /** 打开详情：importApi.get 拉取含 errors 明细的完整记录 */
  const openDetail = async (record: ImportRecord) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError(null)
    setDetailRecord(null)
    try {
      const res = await importApi.get(record.id)
      setDetailRecord(res.data)
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : '详情加载失败，请稍后重试')
    } finally {
      setDetailLoading(false)
    }
  }

  /** 导入错误行表格列（§5.16.3：行号/字段/值/原因） */
  const errorColumns: ColumnsType<ImportError> = [
    { title: '行号', dataIndex: 'row', key: 'row', width: 70 },
    { title: '字段', dataIndex: 'field', key: 'field', width: 150 },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      width: 200,
      render: (v?: string) => (v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : '(空)'),
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (v?: string) => (v ? <EllipsisText maxWidth={320}>{v}</EllipsisText> : '-'),
    },
  ]

  const columns: ColumnsType<ImportRecord> = [
    {
      title: '导入时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => v || '-',
    },
    {
      title: '资源类别',
      dataIndex: 'resource_category',
      key: 'resource_category',
      width: 110,
      render: (v: ResourceCategory) => <Tag>{RESOURCE_TYPE_MAP[v] ?? v}</Tag>,
    },
    {
      title: '导入模式',
      dataIndex: 'mode',
      key: 'mode',
      width: 110,
      render: (v: ImportMode) => <Tag color={v === 'upsert' ? 'blue' : 'default'}>{MODE_MAP[v] ?? v}</Tag>,
    },
    { title: '总数', dataIndex: 'total', key: 'total', width: 70 },
    {
      title: '成功 / 失败',
      key: 'result',
      width: 110,
      render: (_: unknown, record: ImportRecord) => (
        <Space size={4}>
          <Text style={{ color: '#00B578' }}>{record.success}</Text>
          <Text type="secondary">/</Text>
          <Text style={{ color: record.failed > 0 ? '#FF4C3A' : '#86909C' }}>{record.failed}</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: ImportRecord['status']) => {
        const cfg = STATUS_CONFIG[v] ?? { text: v, color: 'default' }
        return <Tag color={cfg.color}>{cfg.text}</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 90,
      render: (_: unknown, record: ImportRecord) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
          查看
        </Button>
      ),
    },
  ]

  return (
    <>
      <FilterBar>
        <FilterItem label="资源类别" width={220}>
          <Select
            placeholder="全部"
            style={{ width: 160 }}
            value={resourceCategory}
            onChange={(v) => changeFilter({ resource_category: v as 'all' | ResourceCategory })}
          >
            <Select.Option value="all">全部</Select.Option>
            {RESOURCE_TYPES.map((type) => (
              <Select.Option key={type} value={type}>
                {RESOURCE_TYPE_MAP[type]}
              </Select.Option>
            ))}
          </Select>
        </FilterItem>
        <FilterItem label="状态" width={180}>
          <Select
            placeholder="全部"
            style={{ width: 120 }}
            value={status}
            onChange={(v) => changeFilter({ status: v as 'all' | ImportRecord['status'] })}
          >
            <Select.Option value="all">全部</Select.Option>
            <Select.Option value="success">成功</Select.Option>
            <Select.Option value="partial">部分成功</Select.Option>
            <Select.Option value="failed">失败</Select.Option>
          </Select>
        </FilterItem>
      </FilterBar>

      {error && (
        <Alert
          type="error"
          showIcon
          message="导入记录加载失败，请稍后重试"
          description={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              重新加载
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Table<ImportRecord>
        rowKey="id"
        dataSource={data.list}
        loading={loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{
          emptyText: (
            <Empty description="暂无导入记录">
              <Space>
                <Button icon={<DownloadOutlined />} onClick={onDownloadTemplate}>
                  下载模板
                </Button>
                <Button type="primary" icon={<FileExcelOutlined />} onClick={onUploadExcel}>
                  上传 Excel
                </Button>
              </Space>
            </Empty>
          ),
        }}
        pagination={{
          ...TABLE_PAGINATION,
          current: page,
          pageSize,
          total: data.total,
          onChange: (p, pz) => {
            setPage(p)
            if (pz && pz !== pageSize) setPageSize(pz)
            setLoading(true)
          },
        }}
      />

      <Modal
        title={`导入详情 - ${detailRecord?.import_no ?? ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={
          <Button type="primary" onClick={() => setDetailOpen(false)}>
            关闭
          </Button>
        }
        width={760}
      >
        {detailError && (
          <Alert type="error" showIcon message="详情加载失败" description={detailError} style={{ marginBottom: 16 }} />
        )}
        {detailLoading && !detailRecord ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : detailRecord ? (
          <>
            <Descriptions
              column={2}
              size="small"
              style={{ marginBottom: 16 }}
              items={[
                { key: 'import_no', label: '导入编号', children: detailRecord.import_no },
                {
                  key: 'resource_category',
                  label: '资源类别',
                  children: <Tag>{RESOURCE_TYPE_MAP[detailRecord.resource_category] ?? detailRecord.resource_category}</Tag>,
                },
                { key: 'mode', label: '导入模式', children: MODE_MAP[detailRecord.mode] ?? detailRecord.mode },
                { key: 'total', label: '总数', children: detailRecord.total },
                { key: 'success', label: '成功', children: detailRecord.success },
                { key: 'updated', label: '更新', children: detailRecord.updated },
                { key: 'failed', label: '失败', children: detailRecord.failed },
                {
                  key: 'status',
                  label: '状态',
                  children: <Tag color={STATUS_CONFIG[detailRecord.status]?.color}>{STATUS_CONFIG[detailRecord.status]?.text}</Tag>,
                },
                { key: 'operator', label: '操作人', children: detailRecord.operator },
                { key: 'created_at', label: '导入时间', children: detailRecord.created_at },
              ]}
            />
            <Table<ImportError>
              size="small"
              rowKey={(r) => `${r.row}-${r.field}`}
              dataSource={detailRecord.errors}
              columns={errorColumns}
              pagination={false}
              scroll={TABLE_SCROLL_X}
              locale={{ emptyText: '导入无错误' }}
            />
          </>
        ) : null}
      </Modal>
    </>
  )
}

export default ImportRecordsPanel
