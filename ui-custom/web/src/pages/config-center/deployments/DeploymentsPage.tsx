import { useMemo, useState } from 'react'
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
} from 'antd'
import config from 'antd/locale/zh_CN'
import type { ColumnsType } from 'antd/es/table'
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ConfigSnapshotHistoryRow } from '../../../types/config-center'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { MainLayout } from '../../../layouts/MainLayout'
import { formatLocalTime } from '../configCenterConstants'
import { shortChecksum } from '../../../utils/shortChecksum'
import { SnapshotDetailDrawer } from '../preview/SnapshotDetailDrawer'
import {
  SNAPSHOT_GENERATOR_LABEL,
  SNAPSHOT_STATUS_COLOR,
  SNAPSHOT_STATUS_LABEL,
} from '../preview/snapshotHelpers'
import { useSnapshotHistory } from './useSnapshotHistory'

const { Text } = Typography

type SnapshotStatusFilter = 'all' | 'passed' | 'failed'

/**
 * 快照历史页（原「下发记录」页，Module_09 v3 契约 §4）。
 *
 * v3 没有全局快照列表：聚合全部已纳管网域的快照后在本页展示，支持网域 / 校验状态 /
 * 关键字（版本或校验值）筛选，前端分页 20 条/页；点行或「详情」打开只读详情抽屉。
 * 无回滚 / 重试 / 下发动作；单域拉取失败不影响其他域，页头提示失败域。
 */
export function DeploymentsPage() {
  const {
    rows,
    loading,
    error,
    permissionDenied,
    partialErrors,
    domains,
    domainsLoading,
    domainError,
    reload,
  } = useSnapshotHistory()

  const [domainFilter, setDomainFilter] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<SnapshotStatusFilter>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [detail, setDetail] = useState<ConfigSnapshotHistoryRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    return rows.filter((row) => {
      if (domainFilter && row.network_domain_id !== domainFilter) return false
      if (statusFilter !== 'all' && row.validation_status !== statusFilter) return false
      if (normalizedKeyword) {
        const versionMatched = row.version.toLowerCase().includes(normalizedKeyword)
        const checksumMatched = (row.checksum ?? '').toLowerCase().includes(normalizedKeyword)
        if (!versionMatched && !checksumMatched) return false
      }
      return true
    })
  }, [rows, domainFilter, statusFilter, keyword])

  const maxPage = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, maxPage)

  const openDetail = (record: ConfigSnapshotHistoryRow) => {
    setDetail(record)
    setDetailOpen(true)
  }

  const columns: ColumnsType<ConfigSnapshotHistoryRow> = [
    {
      title: '网域',
      dataIndex: 'network_domain_name',
      key: 'network_domain_name',
      width: 160,
      render: (name: string, record: ConfigSnapshotHistoryRow) => (
        <Tooltip title={record.network_domain_id}>
          <Text>{name || record.network_domain_id}</Text>
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

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        {permissionDenied ? (
          <Card>
            <Empty description="当前账号无此页面查看权限" />
          </Card>
        ) : (
          <>
            {error && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
                message="快照历史加载失败"
                description={error}
                action={
                  <Button size="small" onClick={reload}>
                    重试
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
                description="无法获取已纳管网域，快照历史可能不完整。"
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
              title="快照历史"
              extra={
                <Tooltip title="重新加载全部网域的快照">
                  <Button icon={<ReloadOutlined />} onClick={reload}>
                    刷新
                  </Button>
                </Tooltip>
              }
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="快照由系统在配置变更后自动生成，按生成时间倒序展示；本页只读，不提供下发或回滚动作。"
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
                <Select<SnapshotStatusFilter>
                  style={{ width: 150 }}
                  value={statusFilter}
                  onChange={(value) => {
                    setStatusFilter(value)
                    setPage(1)
                  }}
                  options={[
                    { value: 'all', label: '全部校验状态' },
                    { value: 'passed', label: '成功' },
                    { value: 'failed', label: '失败' },
                  ]}
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
                rowKey={(record) => `${record.network_domain_id}-${record.id}`}
                size="small"
                scroll={TABLE_SCROLL_X}
                loading={loading}
                dataSource={filteredRows}
                columns={columns}
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
                  emptyText: loading ? (
                    '加载中…'
                  ) : domainError ? (
                    <Empty description="网域列表加载失败，请稍后重试" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : rows.length > 0 ? (
                    <Empty description="没有匹配的快照记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <Empty description="暂无配置快照" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ),
                }}
              />
            </Card>
          </>
        )}

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

export default DeploymentsPage
