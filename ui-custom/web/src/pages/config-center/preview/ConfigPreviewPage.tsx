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
import { formatLocalTime } from '../configCenterConstants'
import { shortChecksum } from '../../../utils/shortChecksum'
import { triggerBlobDownload } from '../../../utils/triggerBlobDownload'
import { getStoredUser, isApiError } from '../../../api/client'
import { configArtifactApi } from '../../../api/configCenter'
import { SnapshotDetailDrawer } from './SnapshotDetailDrawer'
import {
  ARTIFACT_TYPE_COLOR,
  ARTIFACT_TYPE_LABEL,
  SNAPSHOT_GENERATOR_LABEL,
  SNAPSHOT_STATUS_COLOR,
  SNAPSHOT_STATUS_LABEL,
} from './snapshotHelpers'
import { useConfigArtifacts } from './useConfigArtifacts'

const { Text } = Typography

type StatusFilter = SnapshotValidationStatus | 'all'
type TypeFilter = ConfigArtifactType | 'all'

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部校验状态' },
  { value: 'passed', label: '成功' },
  { value: 'failed', label: '失败' },
]

const TYPE_FILTER_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: '全部产物类型' },
  { value: 'domain', label: '采集配置' },
  { value: 'center', label: '中心规则' },
  { value: 'alertmanager', label: '告警配置' },
]

const DEFAULT_PAGE_SIZE = 20

/**
 * 统一配置产物历史页（Module_09 SRS v1.5 FR-13 / FR-13.1 / FR-13.2）。
 *
 * 三类产物同页：网域采集配置、中心规则、告警配置；只读，无下发 / 回滚。
 * admin 可在详情抽屉预览内容并导出可直接落盘的配置包/文件，也可导出中心一体化恢复包。
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
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [detail, setDetail] = useState<ConfigSnapshotHistoryRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const isAdmin = getStoredUser()?.role === 'admin'

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      const rowType = row.artifact_type ?? 'domain'
      if (typeFilter !== 'all' && rowType !== typeFilter) return false
      if (statusFilter !== 'all' && row.validation_status !== statusFilter) return false
      if (normalizedKeyword) {
        const versionMatched = row.version.toLowerCase().includes(normalizedKeyword)
        const checksumMatched = (row.checksum ?? '').toLowerCase().includes(normalizedKeyword)
        if (!versionMatched && !checksumMatched) return false
      }
      return true
    })
  }, [rows, typeFilter, statusFilter, keyword])

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
      message.success('中心一体化恢复包已开始下载')
    } catch (e) {
      if (isApiError(e) && e.code === 401) {
        message.error('登录已过期，请重新登录后再下载')
      } else if (isApiError(e) && (e.code === 403 || e.errorType === 'forbidden')) {
        message.error('当前账号无导出中心恢复包的权限，请联系管理员开通')
      } else {
        message.error(e instanceof Error ? e.message : '中心恢复包导出失败，请稍后重试')
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
        <Tooltip title={record.network_domain_id || '平台级产物'}>
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
      title: '校验状态',
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
        isCurrent ? <Tag color="success">当前生效</Tag> : <Text type="secondary">-</Text>,
    },
    {
      title: '生成来源',
      dataIndex: 'generated_by',
      key: 'generated_by',
      width: 150,
      render: (generatedBy: string) => (
        <Text>{SNAPSHOT_GENERATOR_LABEL[generatedBy] ?? generatedBy ?? '-'}</Text>
      ),
    },
    {
      title: '校验值',
      dataIndex: 'checksum',
      key: 'checksum',
      width: 180,
      render: (checksum: string) => (
        <Tooltip title={checksum || '-'}>
          <Text code>{shortChecksum(checksum)}</Text>
        </Tooltip>
      ),
    },
    {
      title: '生成时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (createdAt: string) => <Text type="secondary">{formatLocalTime(createdAt)}</Text>,
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
    if (domainError) return '网域列表加载失败，请点击上方「重新加载」重试'
    if (rows.length > 0 && filteredRows.length === 0) return '没有匹配的配置产物'
    if (domainFilter) return '该网域暂无采集配置快照'
    if (domains.length === 0) return '暂无配置产物（尚未纳管网域，或中心规则/告警配置尚未生成）'
    return '暂无配置产物'
  })()

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="配置产物加载失败，请稍后重试"
            description={error}
            action={
              <Button size="small" onClick={reload}>
                重新加载
              </Button>
            }
          />
        )}
        {domainError && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="网域列表加载失败"
            description="无法获取已纳管网域，快照列表可能不完整。"
            action={
              <Button size="small" onClick={reload}>
                重新加载
              </Button>
            }
          />
        )}
        {partialErrors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={`部分网域快照加载失败（${partialErrors.length} 个）`}
            description={
              <Space direction="vertical" size={2}>
                {partialErrors.map((failure) => (
                  <span key={failure.domain_id}>
                    {failure.network_domain_name}（{failure.domain_id}）：{failure.message}
                  </span>
                ))}
              </Space>
            }
          />
        )}

        <Card
          title="配置产物历史"
          extra={
            <Space>
              {isAdmin && (
                <Tooltip title="导出中心侧一体化恢复包（Prometheus / rules / Alertmanager / targets）">
                  <Button icon={<DownloadOutlined />} onClick={() => void handleRecoveryBundle()}>
                    导出中心恢复包
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="重新加载网域与配置产物列表">
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
            message="网域采集配置、中心规则、告警配置三类产物按生成时间倒序展示；历史只读，不提供下发或回滚。admin 可在详情中预览内容并导出可直接落盘的配置包/文件；告警配置由 M08 提供，M08 不可用时该类型不展示。"
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
            <Input
              allowClear
              placeholder="搜索版本或校验值"
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
