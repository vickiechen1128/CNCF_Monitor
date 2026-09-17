/**
 * 静默管理页（决策 59 静默 API 直调，即时生效，不进 M09 变更单）。
 * 能力：创建 / 列表 / 按状态区分的行内操作（用户确认 2026-09-11，方案 A+B）：
 *  - AM v2 API 无「提前结束」端点，删除即提前结束（Grafana Expire 同为 DELETE），
 *    因此操作按钮按状态改文案消除歧义：生效中=「结束静默」/ 待生效=「取消静默」/ 已过期=「删除」；
 *  - 失效时间列增加剩余时长副行（B）：剩余 X / X 后生效 / 已结束，强化静默有时效的心智；
 * 决策 56 授权提示「静默影响当前授权网域」收敛到页头一句话与创建抽屉内折叠栏；
 * 越权创建被拒展示服务端错误；覆盖加载 / 空态 / 接口错误 / 权限不足。
 */
import { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Modal,
  Table,
  Select,
  Input,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { PlusOutlined, DeleteOutlined, StopOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { Silence, SilenceStatus } from '../../types/alertmanager'
import { useSilences } from './useSilences'
import { CreateSilenceDrawer, type CreateSilenceDrawerProps } from './CreateSilenceDrawer'
import { silenceStatusColor, silenceStatusLabel } from './alertmanagerConstants'
import { formatMatchers } from './alertmanagerConstants'

const { Text } = Typography

/** 生效/失效时间展示：UTC ISO 转本地可读串（复用全仓既时区展示约定，不引入新依赖） */
function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-'
}

/** 时长口语化：分 → 小时 → 天（分钟级精度足够，不引入 dayjs duration 依赖） */
function humanizeDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '不足 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} 小时`
  return `${Math.floor(hours / 24)} 天`
}

/** 失效时间列副行（方案 B）：按状态给出相对时间，提示静默有时效、可提前干预 */
function remainingText(r: Silence): string {
  if (r.status === 'active') {
    const ms = new Date(r.ends_at).getTime() - Date.now()
    return ms <= 0 ? '已到期' : `剩余 ${humanizeDuration(ms)}`
  }
  if (r.status === 'pending') {
    const ms = new Date(r.starts_at).getTime() - Date.now()
    return ms <= 0 ? '即将生效' : `${humanizeDuration(ms)} 后生效`
  }
  return '已结束'
}

/**
 * 行内操作文案与确认弹窗（方案 A）：AM 语义上删除 = 提前结束，
 * 但用户语言须按状态区分——结束/取消传达「恢复通知」，删除仅是清理过期记录。
 */
const ACTION_META: Record<SilenceStatus, {
  label: string
  tooltip: string
  confirmTitle: string
  confirmContent: string
  toast: string
  icon: typeof DeleteOutlined
}> = {
  active: {
    label: '结束静默',
    tooltip: '结束后相关告警将立即恢复通知',
    confirmTitle: '结束这条静默',
    confirmContent: '结束后将立即停止静默，相关告警恢复通知。该操作不可恢复。',
    toast: '静默已结束，相关告警已恢复通知',
    icon: StopOutlined,
  },
  pending: {
    label: '取消静默',
    tooltip: '取消后该静默不会生效',
    confirmTitle: '取消这条静默',
    confirmContent: '取消后该静默不会生效，不会屏蔽任何通知。',
    toast: '静默已取消',
    icon: StopOutlined,
  },
  expired: {
    label: '删除',
    tooltip: '清理已过期的静默记录，不影响当前通知',
    confirmTitle: '删除这条静默记录',
    confirmContent: '该静默已过期，删除仅清理记录，不影响任何当前通知。',
    toast: '静默记录已删除',
    icon: DeleteOutlined,
  },
}

export function SilencesPage() {
  const { message } = App.useApp()
  const [page, setPage] = useState(1)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSeq, setDrawerSeq] = useState(0)
  const [kw, setKw] = useState('')
  const [status, setStatus] = useState<SilenceStatus | 'all'>('all')

  // 服务端真实分页 + 筛选（契约 §1.4/§4）：page/page_size 透传后端，total 为真实总数；
  // status=active 透传服务端 `active=true` 过滤活跃静默。
  const { silences, total, loading, error, permissionDenied, reload, create, remove } = useSilences({
    page,
    page_size: TABLE_PAGINATION.pageSize,
    active: status === 'active',
  })

  // 关键词 / pending / expired：契约未提供服务端过滤参数，保守处理为在已加载页内做客户端过滤，
  // 切换这些筛选时回到第 1 页重新请求，避免跨分页越界（MVP 数据量小可接受）。
  const filtered = silences.filter((s) => {
    if (status !== 'all' && status !== 'active' && s.status !== status) return false
    if (kw.trim()) {
      const haystack = `${formatMatchers(s.matchers)} ${s.comment} ${s.created_by ?? ''}`.toLowerCase()
      if (!haystack.includes(kw.trim().toLowerCase())) return false
    }
    return true
  })
  // active 由服务端过滤、无额外条件时直接采用真实总数；客户端过滤时以过滤后条数驱动 total 避免翻页越界
  const usingClientFilter = kw.trim() !== '' || (status !== 'all' && status !== 'active')
  const tableTotal = usingClientFilter ? filtered.length : total

  const changeStatus = (v: SilenceStatus | 'all') => {
    setStatus(v)
    setPage(1)
  }

  const changeKw = (v: string) => {
    setKw(v)
    setPage(1)
  }

  const openCreate = () => {
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  // 成功 toast 由 CreateSilenceDrawer 内部统一弹出（此处再弹一次会双重提示）。
  const handleCreate: CreateSilenceDrawerProps['onSubmit'] = async (payload) => {
    await create(payload)
  }

  const handleAction = (silence: Silence) => {
    const meta = ACTION_META[silence.status]
    Modal.confirm({
      title: `${meta.confirmTitle}（${silence.id}）？`,
      content: meta.confirmContent,
      okText: meta.label,
      cancelText: '关闭',
      okButtonProps: { danger: true },
      async onOk() {
        await remove(silence.id)
        message.success(meta.toast)
        reload()
      },
    })
  }

  const columns: ColumnsType<Silence> = [
    {
      title: '匹配条件',
      dataIndex: 'matchers',
      key: 'matchers',
      width: 260,
      render: (m: Silence['matchers']) => <EllipsisText maxWidth={240}>{formatMatchers(m)}</EllipsisText>,
    },
    {
      title: '生效时间',
      dataIndex: 'starts_at',
      key: 'starts_at',
      width: 180,
      render: (v: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: '失效时间',
      dataIndex: 'ends_at',
      key: 'ends_at',
      width: 180,
      // 方案 B：相对时长副行——剩余 X / X 后生效 / 已结束
      render: (v: string, r: Silence) => (
        <div>
          <Text>{formatTime(v)}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>{remainingText(r)}</Text>
        </div>
      ),
    },
    {
      title: '原因',
      dataIndex: 'comment',
      key: 'comment',
      width: 200,
      render: (v: string) => <EllipsisText maxWidth={190}>{v}</EllipsisText>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: SilenceStatus) => <Tag color={silenceStatusColor[v]}>{silenceStatusLabel[v]}</Tag>,
    },
    {
      title: '创建人',
      dataIndex: 'created_by',
      key: 'created_by',
      width: 130,
      render: (v?: string) => <Text>{v ?? '-'}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      fixed: 'right',
      // 方案 A：按钮按状态改文案消除「删除」歧义（AM 语义删除=提前结束，见 ACTION_META 注释）
      render: (_: unknown, r: Silence) => {
        const meta = ACTION_META[r.status]
        const Icon = meta.icon
        return (
          <Tooltip title={meta.tooltip}>
            <Button size="small" type="link" danger icon={<Icon />} onClick={() => handleAction(r)}>
              {meta.label}
            </Button>
          </Tooltip>
        )
      },
    },
  ]

  if (permissionDenied) {
    return (
      <MainLayout>
        <Card>
          <Empty description="当前账号无此页面查看权限" />
        </Card>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title="静默管理"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              创建静默
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Text type="secondary">创建主动静默，屏蔽特定告警的通知；本操作即时生效，不影响配置下发</Text>
        </Card>

        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="静默列表加载失败，请稍后重试"
            description={error}
            action={<Button size="small" onClick={reload}>重新加载</Button>}
          />
        )}

        <Card>
          <FilterBar>
            <FilterItem label="静默状态">
              <Select
                style={{ width: 160 }}
                value={status}
                onChange={changeStatus}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'active', label: '生效中' },
                  { value: 'pending', label: '待生效' },
                  { value: 'expired', label: '已过期' },
                ]}
              />
            </FilterItem>
            <FilterItem label="关键词">
              <Input
                style={{ width: 240 }}
                placeholder="匹配条件 / 原因 / 创建人"
                value={kw}
                onChange={(e) => changeKw(e.target.value)}
                allowClear
              />
            </FilterItem>
          </FilterBar>

          <Table<Silence>
            rowKey="id"
            dataSource={filtered}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            pagination={{
              ...TABLE_PAGINATION,
              current: page,
              total: tableTotal,
              onChange: (p) => setPage(p),
            }}
          />
        </Card>

        <CreateSilenceDrawer
          key={`${drawerSeq}`}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onSubmit={handleCreate}
        />
      </ConfigProvider>
    </MainLayout>
  )
}