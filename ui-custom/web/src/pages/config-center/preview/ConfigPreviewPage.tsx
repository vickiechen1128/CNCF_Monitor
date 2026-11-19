import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import config from 'antd/locale/zh_CN'
import type { ColumnsType } from 'antd/es/table'
import { DownloadOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import type {
  ConfigArtifactType,
  ConfigSnapshotHistoryRow,
  SnapshotValidationStatus,
} from '../../../types/config-center'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { MainLayout } from '../../../layouts/MainLayout'
import { formatLocalDate, formatLocalTime } from '../configCenterConstants'
import { triggerBlobDownload } from '../../../utils/triggerBlobDownload'
import { getStoredUser, isApiError } from '../../../api/client'
import { configArtifactApi } from '../../../api/configCenter'
import { SnapshotDetailDrawer } from './SnapshotDetailDrawer'
import {
  ARTIFACT_TYPE_COLOR,
  ARTIFACT_TYPE_LABEL,
  SNAPSHOT_GENERATOR_LABEL,
  SNAPSHOT_RETENTION_TIP,
  SNAPSHOT_STATUS_COLOR,
  SNAPSHOT_STATUS_LABEL,
} from './snapshotHelpers'
import { useConfigArtifacts } from './useConfigArtifacts'

const { Text } = Typography

type StatusFilter = SnapshotValidationStatus | 'all'
type TypeFilter = ConfigArtifactType | 'all'

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'passed', label: '成功' },
  { value: 'failed', label: '失败' },
]

const TYPE_FILTER_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'domain', label: '采集配置' },
  { value: 'center', label: '中心规则' },
  { value: 'alertmanager', label: '告警配置' },
]

const DEFAULT_PAGE_SIZE = 20

/**
 * 配置备份历史页（Module_09 SRS v1.7 FR-13 / FR-13.1 / FR-13.2）。
 *
 * 三类配置同页：网域采集配置、中心规则、告警配置；按自然日保留最近 30 天，
 * 每天最多一份成功版本。用户可按日期筛选；历史只读，无下发 / 回滚。
 */
export function ConfigPreviewPage() {
  const [searchParams] = useSearchParams()
  // 深链预筛（采集节点状态页「查看下发」等入口带 ?network_domain=<id>）
  const initialDomainId = searchParams.get('network_domain') ?? undefined
  const {
    rows,
    loading,
    error,
    permissionDenied,
    partialErrors,
    domains,
    domainsLoading,
    domainError,
    domainFilter,
    setDomainFilter,
    reload,
  } = useConfigArtifacts({ initialDomainId })

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [dateFilter, setDateFilter] = useState<string | undefined>()
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [detail, setDetail] = useState<ConfigSnapshotHistoryRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const isAdmin = getStoredUser()?.role === 'admin'

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    const selectedDate = dateFilter ?? ''
    return rows.filter((row) => {
      const rowType = row.artifact_type ?? 'domain'
      if (typeFilter !== 'all' && rowType !== typeFilter) return false
      if (statusFilter !== 'all' && row.validation_status !== statusFilter) return false
      if (selectedDate && formatLocalDate(row.created_at) !== selectedDate) return false
      if (normalizedKeyword) {
        const versionMatched = row.version.toLowerCase().includes(normalizedKeyword)
        const dateMatched = formatLocalDate(row.created_at).includes(normalizedKeyword)
        if (!versionMatched && !dateMatched) return false
      }
      return true
    })
  }, [rows, typeFilter, statusFilter, dateFilter, keyword])

  const dateOptions = useMemo(() => {
    const dates = new Set(
      rows.map((row) => formatLocalDate(row.created_at)).filter((date) => date !== '-'),
    )
    return [...dates].sort().reverse().map((date) => ({ value: date, label: date }))
  }, [rows])

  const maxPage = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, maxPage)

  const openDetail = (record: ConfigSnapshotHistoryRow) => {
    setDetail(record)
    setDetailOpen(true)
  }

  const handleRecoveryBundle = async () => {
    try {
      const { blob, filename } = await configArtifactApi.recoveryBundle()
      triggerBlobDownload(blob, filename)
      message.success('恢复包已开始下载')
    } catch (e) {
      if (isApiError(e) && e.code === 401) {
        message.error('登录已过期，请重新登录后再下载')
      } else if (isApiError(e) && (e.code === 403 || e.errorType === 'forbidden')) {
        message.error('当前账号不能下载恢复包，请联系管理员开通权限')
      } else {
        message.error('恢复包下载失败，请稍后重试')
      }
    }
  }

  const columns: ColumnsType<ConfigSnapshotHistoryRow> = [
    {
      title: '类型',
      dataIndex: 'artifact_type',
      key: 'artifact_type',
      width: 110,
      fixed: 'left',
      render: (value: ConfigArtifactType | undefined) => {
        const type = value ?? 'domain'
        return <Tag color={ARTIFACT_TYPE_COLOR[type]}>{ARTIFACT_TYPE_LABEL[type]}</Tag>
      },
    },
    {
      title: '网域 / 范围',
      dataIndex: 'network_domain_name',
      key: 'network_domain_name',
      fixed: 'left',
      width: 160,
      render: (name: string, record: ConfigSnapshotHistoryRow) => (
        <Tooltip title={record.network_domain_id || '平台配置'}>
          <Text>{name || record.network_domain_id || '中心'}</Text>
        </Tooltip>
      ),
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 180,
      render: (version: string) => <Text code>{version}</Text>,
    },
    {
      title: '配置日期',
      dataIndex: 'created_at',
      key: 'config_date',
      width: 120,
      render: (createdAt: string) => <Text>{formatLocalDate(createdAt)}</Text>,
    },
    {
      title: '生成时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (createdAt: string) => <Text type="secondary">{formatLocalTime(createdAt)}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'validation_status',
      key: 'validation_status',
      width: 100,
      render: (status: ConfigSnapshotHistoryRow['validation_status']) => (
        <Tag color={SNAPSHOT_STATUS_COLOR[status]}>{SNAPSHOT_STATUS_LABEL[status]}</Tag>
      ),
    },
    {
      title: '当前版本',
      dataIndex: 'is_current',
      key: 'is_current',
      width: 110,
      render: (isCurrent: boolean) =>
        isCurrent ? <Tag color="success">当前使用</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '生成来源',
      dataIndex: 'generated_by',
      key: 'generated_by',
      width: 150,
      render: (generatedBy: string) => (
        <Text>{SNAPSHOT_GENERATOR_LABEL[generatedBy] ?? generatedBy ?? '系统自动生成'}</Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 90,
      render: (_: unknown, record: ConfigSnapshotHistoryRow) => (
        <Button
          size="small"
          type="link"
          icon={<EyeOutlined />}
          onClick={(event) => {
            event.stopPropagation()
            openDetail(record)
          }}
        >
          详情
        </Button>
      ),
    },
  ]

  if (permissionDenied) {
    return (
      <MainLayout>
        <ConfigProvider locale={config}>
          <Card>
            <Empty description="当前账号无此页面查看权限" />
          </Card>
        </ConfigProvider>
      </MainLayout>
    )
  }

  const emptyText = (() => {
    if (loading) return '加载中…'
    if (domainError) return '网域信息暂时无法读取，请点击上方「刷新」重试'
    if (dateFilter && rows.length > 0 && filteredRows.length === 0) return '所选日期没有配置备份'
    if (rows.length > 0 && filteredRows.length === 0) return '没有符合条件的配置备份'
    if (domainFilter) return '该网域暂无配置备份'
    if (domains.length === 0) return '暂无配置备份（尚未接入网域，或还没有生成配置）'
    return '暂无配置备份'
  })()

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="配置列表暂时加载失败"
            description="请点击「刷新」重试；如果一直失败，请联系管理员。"
            action={
              <Button size="small" onClick={reload}>
                刷新
              </Button>
            }
          />
        )}
        {domainError && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="网域信息暂时无法读取"
            description="配置列表可能不完整，请点击「刷新」重试。"
            action={
              <Button size="small" onClick={reload}>
                刷新
              </Button>
            }
          />
        )}
        {partialErrors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={`部分网域的配置暂时无法读取（${partialErrors.length} 个）`}
            description={
              <Space direction="vertical" size={2}>
                {partialErrors.map((failure) => (
                  <span key={failure.domain_id}>
                    {failure.network_domain_name}：请稍后刷新重试。
                  </span>
                ))}
              </Space>
            }
          />
        )}

        <Card
          title={
            <Space>
              配置备份历史
              <Tag color="blue">仅保留最近 30 天</Tag>
            </Space>
          }
          extra={
            <Space>
              {isAdmin && (
                <Tooltip title="下载当前所有配置的恢复包，平台故障时可用来恢复。">
                  <Button icon={<DownloadOutlined />} onClick={() => void handleRecoveryBundle()}>
                    下载恢复包
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="重新加载配置列表">
                <Button icon={<ReloadOutlined />} onClick={reload}>
                  刷新
                </Button>
              </Tooltip>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="按日期查看每天生成的配置备份"
            description={
              <>
                {SNAPSHOT_RETENTION_TIP}
                同一天多次修改只保留最后一次成功生成的版本。历史配置只能查看和下载，不能用来回滚。
              </>
            }
          />

          <Space wrap style={{ marginBottom: 16 }}>
            <Select
              allowClear
              placeholder="全部网域"
              style={{ minWidth: 200 }}
              loading={domainsLoading}
              value={domainFilter}
              onChange={(value: string | undefined) => {
                setDomainFilter(value)
                setPage(1)
              }}
              options={domains.map((d) => ({ value: d.id, label: d.name }))}
            />
            <Select<StatusFilter>
              style={{ width: 150 }}
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value)
                setPage(1)
              }}
              options={STATUS_FILTER_OPTIONS}
            />
            <Select<TypeFilter>
              style={{ width: 150 }}
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(value)
                setPage(1)
              }}
              options={TYPE_FILTER_OPTIONS}
            />
            <Select
              allowClear
              placeholder="全部日期"
              style={{ width: 160 }}
              value={dateFilter}
              onChange={(value: string | undefined) => {
                setDateFilter(value)
                setPage(1)
              }}
              options={dateOptions}
            />
            <Input
              allowClear
              placeholder="搜索版本或日期"
              style={{ width: 240 }}
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
            />
          </Space>

          <Table<ConfigSnapshotHistoryRow>
            rowKey={(record) => `${record.artifact_type ?? 'domain'}-${record.id}`}
            size="small"
            loading={loading}
            dataSource={filteredRows}
            columns={columns}
            scroll={{ ...TABLE_SCROLL_X, x: 'max-content' }}
            pagination={{
              ...TABLE_PAGINATION,
              current: currentPage,
              pageSize,
              total: filteredRows.length,
              onChange: (nextPage, nextPageSize) => {
                setPage(nextPage)
                setPageSize(nextPageSize)
              },
            }}
            onRow={(record) => ({
              onClick: () => openDetail(record),
              style: { cursor: 'pointer' },
            })}
            locale={{
              emptyText: (
                <Empty description={emptyText} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ),
            }}
          />
        </Card>

        <SnapshotDetailDrawer
          open={detailOpen}
          snapshot={detail}
          domainName={detail?.network_domain_name}
          onClose={() => setDetailOpen(false)}
        />
      </ConfigProvider>
    </MainLayout>
  )
}

export default ConfigPreviewPage
