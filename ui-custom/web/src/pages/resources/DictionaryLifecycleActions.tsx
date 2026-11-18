import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Empty,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { dictionaryAuditApi } from '../../api/resources'
import type { DictionaryAuditLog, DictionaryStatus } from '../../types/resource'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import {
  DICTIONARY_STATUS_BADGE,
  DICTIONARY_STATUS_LABEL,
  isDictionaryTerminal,
} from './dictionaryLifecycle'

const { Text } = Typography

/**
 * 字典生命周期共享 UI（M07 SRS v2.0 §3.4 / §5.7 / NFR-21）
 *
 * 业务 / 应用 / 平台 / 云 / 区域类型五本字典共用同一套四态文案与撤销 / 合并交互，
 * 避免按页复制导致「删除 / 下线 / 作废」等口径漂移。
 *
 * - 编码一经引用永不物理删除、永不复用；
 * - 零引用条目可撤销（终态）；
 * - 有引用条目只能停用或合并（合并为终态）。
 */

/** 四态状态徽标；已合并时展示 `已合并 → 目标编码`。 */
export function DictionaryStatusBadge({
  status,
  mergedInto,
}: {
  status?: DictionaryStatus
  mergedInto?: string
}) {
  const resolved = status ?? 'enabled'
  const text =
    resolved === 'merged' && mergedInto
      ? `已合并 → ${mergedInto}`
      : DICTIONARY_STATUS_LABEL[resolved] ?? DICTIONARY_STATUS_LABEL.disabled
  return <Badge status={DICTIONARY_STATUS_BADGE[resolved] ?? 'default'} text={text} />
}

interface DictionaryRevokeButtonProps {
  /** 展示名（确认文案用） */
  name: string
  status: DictionaryStatus
  referenceCount: number
  onRevoke: () => Promise<unknown>
  onDone: () => void
}

/**
 * 零引用撤销入口（FR-26）。
 *
 * 有引用时按钮禁用并用 Tooltip 说明下一步：先停用或合并。
 * 撤销前二次确认，明确「编码永久保留、不可重新登记」。
 */
export function DictionaryRevokeButton({
  name,
  status,
  referenceCount,
  onRevoke,
  onDone,
}: DictionaryRevokeButtonProps) {
  const [loading, setLoading] = useState(false)
  if (isDictionaryTerminal(status)) return null

  const blocked = referenceCount > 0
  const button = (
    <Button type="link" size="small" danger disabled={blocked} loading={loading}>
      撤销
    </Button>
  )

  if (blocked) {
    return <Tooltip title={`仍有 ${referenceCount} 处引用，请先停用或合并`}>{button}</Tooltip>
  }

  const handleRevoke = async () => {
    setLoading(true)
    try {
      await onRevoke()
      message.success(`「${name}」已撤销，编码将永久保留`)
      onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '撤销失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Popconfirm
      title={`撤销「${name}」？`}
      description="撤销后编码永久保留、不可重新登记；历史监控数据不受影响。此操作不可逆。"
      okText="确认撤销"
      okButtonProps={{ danger: true }}
      cancelText="取消"
      onConfirm={() => void handleRevoke()}
    >
      {button}
    </Popconfirm>
  )
}

export interface DictionaryMergeOption {
  code: string
  name: string
}

interface DictionaryMergeButtonProps {
  name: string
  status: DictionaryStatus
  /** 源条目将被迁移的引用数（用于影响预览） */
  referenceCount: number
  /** 同类型、启用中、非自身的候选目标 */
  options: DictionaryMergeOption[]
  onMerge: (targetCode: string) => Promise<unknown>
  onDone: () => void
}

/**
 * 错建 / 重码合并入口（FR-27）。
 *
 * 弹窗内展示影响预览与历史数据提示；合并成功后源条目转为终态。
 */
export function DictionaryMergeButton({
  name,
  status,
  referenceCount,
  options,
  onMerge,
  onDone,
}: DictionaryMergeButtonProps) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  if (isDictionaryTerminal(status)) return null

  const disabled = options.length === 0
  const trigger = (
    <Button type="link" size="small" disabled={disabled} onClick={() => setOpen(true)}>
      合并
    </Button>
  )

  const handleMerge = async () => {
    if (!target) {
      message.warning('请选择合并目标')
      return
    }
    setSubmitting(true)
    try {
      await onMerge(target)
      message.success(`「${name}」已合并至「${target}」`)
      setOpen(false)
      setTarget(undefined)
      onDone()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '合并失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {disabled ? <Tooltip title="暂无可合并的启用条目">{trigger}</Tooltip> : trigger}
      <Modal
        title={`合并「${name}」`}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleMerge()}
        okText="确认合并"
        okButtonProps={{ danger: true, disabled: !target }}
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          message="合并会迁移引用，历史监控数据不追溯改写"
          description={`源编码「${name}」的 ${referenceCount} 处引用将在同一事务内迁移到目标条目；源编码保留为「已合并」别名，不可再使用。计数器类指标在合并点可能出现不连续。`}
          style={{ marginBottom: 16 }}
        />
        <Select
          style={{ width: '100%' }}
          placeholder="选择同类型、启用中的目标条目"
          aria-label="合并目标"
          value={target}
          onChange={setTarget}
          showSearch
          optionFilterProp="label"
          options={options.map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))}
        />
      </Modal>
    </>
  )
}

const AUDIT_ACTION_LABEL: Record<DictionaryAuditLog['action'], string> = {
  enable: '启用',
  disable: '停用',
  revoke: '撤销',
  merge: '合并',
}

interface DictionaryAuditDrawerProps {
  dictionaryType: 'business' | 'application' | 'platform' | 'cloud' | 'zone'
  open: boolean
  onClose: () => void
}

/** 字典生命周期审计日志抽屉（FR-27 / §6.4）：只读，按字典类型查询最近动作。 */
export function DictionaryAuditDrawer({ dictionaryType, open, onClose }: DictionaryAuditDrawerProps) {
  const [logs, setLogs] = useState<DictionaryAuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    dictionaryAuditApi
      .list({ dictionary_type: dictionaryType, limit: 100 })
      .then((res) => {
        if (!cancelled) setLogs(res.data?.list ?? [])
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '变更日志加载失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, dictionaryType])

  const columns: ColumnsType<DictionaryAuditLog> = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString() : <Text type="secondary">-</Text>),
    },
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      width: 80,
      render: (v: DictionaryAuditLog['action']) => AUDIT_ACTION_LABEL[v] ?? v,
    },
    {
      title: '源编码',
      dataIndex: 'source_code',
      key: 'source_code',
      width: 160,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '目标编码',
      dataIndex: 'target_code',
      key: 'target_code',
      width: 160,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : <Text type="secondary">-</Text>),
    },
    {
      title: '迁移引用数',
      dataIndex: 'reference_count',
      key: 'reference_count',
      width: 100,
      render: (v: number) => v ?? 0,
    },
    {
      title: '操作人',
      dataIndex: 'operator',
      key: 'operator',
      width: 130,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : <Text type="secondary">-</Text>),
    },
  ]

  return (
    <Drawer title="字典变更日志" open={open} onClose={onClose} width={760} forceRender>
      <Alert
        type="info"
        showIcon
        message="仅记录撤销与合并等生命周期动作"
        description="启用 / 停用变更沿用字典自身的状态字段；撤销 / 合并写审计日志，与业务变更同一事务提交。"
        style={{ marginBottom: 16 }}
      />
      {error && (
        <Alert type="error" showIcon message="变更日志加载失败" description={error} style={{ marginBottom: 16 }} />
      )}
      <Space direction="vertical" size={0} style={{ width: '100%' }}>
        <Table<DictionaryAuditLog>
          rowKey="id"
          dataSource={logs}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无生命周期变更记录" /> }}
          pagination={{ ...TABLE_PAGINATION, showSizeChanger: false }}
        />
      </Space>
    </Drawer>
  )
}
