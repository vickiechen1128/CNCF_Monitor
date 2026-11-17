import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Empty,
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
import type { ConfigSnapshot } from '../../../types/config-center'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { MainLayout } from '../../../layouts/MainLayout'
import { formatLocalTime } from '../configCenterConstants'
import { shortChecksum } from '../../../utils/shortChecksum'
import { SnapshotDetailDrawer } from './SnapshotDetailDrawer'
import {
  SNAPSHOT_GENERATOR_LABEL,
  SNAPSHOT_STATUS_COLOR,
  SNAPSHOT_STATUS_LABEL,
} from './snapshotHelpers'
import { useConfigSnapshots } from './useConfigSnapshots'

const { Text } = Typography

/**
 * 配置快照页（原「配置变更确认」页，Module_09 v3 契约 §4）。
 *
 * v3 删除草稿 / 人工确认 / 重校 / 废弃 / 回滚：配置变更即自动同步，快照为自动生成的历史记录。
 * 本页只读：选择网域 → 查看该网域快照列表 → 点行查看详情（校验归因 + 校验明细），
 * admin 可在详情抽屉下载快照内容。
 * 覆盖：加载 / 空态 / 网域列表失败 / 接口错误 / 权限不足。
 */
export function ConfigPreviewPage() {
  const {
    snapshots,
    loading,
    error,
    permissionDenied,
    domains,
    domainsLoading,
    domainError,
    domainId,
    setDomainId,
    reload,
  } = useConfigSnapshots()
  const [detail, setDetail] = useState<ConfigSnapshot | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const domainName = useMemo(
    () => domains.find((d) => d.id === domainId)?.name,
    [domains, domainId],
  )

  const openDetail = (record: ConfigSnapshot) => {
    setDetail(record)
    setDetailOpen(true)
  }

  const columns: ColumnsType<ConfigSnapshot> = [
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      fixed: 'left',
      width: 180,
      render: (version: string) => <Text code>{version}</Text>,
    },
    {
      title: '校验状态',
      dataIndex: 'validation_status',
      key: 'validation_status',
      width: 100,
      render: (status: ConfigSnapshot['validation_status']) => (
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
      render: (_: unknown, record: ConfigSnapshot) => (
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
          <Card
            title="配置快照"
            extra={
              <Space wrap>
                <Select
                  placeholder="选择网域"
                  style={{ minWidth: 220 }}
                  loading={domainsLoading}
                  value={domainId}
                  onChange={(value: string) => setDomainId(value)}
                  options={domains.map((d) => ({ value: d.id, label: d.name }))}
                />
                <Tooltip title="重新加载网域与快照列表">
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
              message="配置快照由系统在配置变更后自动生成，仅供历史追溯。v3 变更即自动同步，无草稿、无人工确认、无回滚。"
            />

            {domainError && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="网域列表加载失败"
                description="无法获取已纳管网域，请稍后重试。"
                action={
                  <Button size="small" onClick={reload}>
                    重新加载
                  </Button>
                }
              />
            )}
            {error && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message="快照列表加载失败，请稍后重试"
                description={error}
                action={
                  <Button size="small" onClick={reload}>
                    重新加载
                  </Button>
                }
              />
            )}

            {loading || domainsLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Text type="secondary">加载中…</Text>
              </div>
            ) : domains.length === 0 ? (
              domainError ? (
                <Empty description="网域列表加载失败，请点击上方「重新加载」重试" />
              ) : (
                <Empty description="暂无已纳管网域，请先在「网域纳管」完成纳管" />
              )
            ) : snapshots.length === 0 ? (
              <Empty description="该网域暂无配置快照" />
            ) : (
              <Table<ConfigSnapshot>
                rowKey="id"
                dataSource={snapshots}
                columns={columns}
                scroll={{ ...TABLE_SCROLL_X, x: 'max-content' }}
                pagination={{ ...TABLE_PAGINATION, total: snapshots.length }}
                onRow={(record) => ({
                  onClick: () => openDetail(record),
                  style: { cursor: 'pointer' },
                })}
              />
            )}
          </Card>
        )}

        <SnapshotDetailDrawer
          open={detailOpen}
          snapshot={detail}
          domainName={domainName}
          onClose={() => setDetailOpen(false)}
        />
      </ConfigProvider>
    </MainLayout>
  )
}
