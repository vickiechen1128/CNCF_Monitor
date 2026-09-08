/**
 * 静默管理页（决策 59 静默 API 直调，即时生效，不进 M09 变更单）。
 * 能力：创建 / 列表 / 删除主动静默；决策 56 授权提示「静默影响当前授权网域」；
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
  Space,
  Table,
  Select,
  Input,
  Tag,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { BellOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
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

  const handleCreate: CreateSilenceDrawerProps['onSubmit'] = async (payload) => {
    await create(payload)
    message.success('静默创建成功，已即时生效')
  }

  const handleDelete = (silence: Silence) => {
    Modal.confirm({
      title: `删除这条静默（${silence.id}）？`,
      content: '删除后将立即停止静默，相关告警恢复通知。该操作不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      async onOk() {
        await remove(silence.id)
        message.success('静默已删除')
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
      render: (v: string) => <Text>{formatTime(v)}</Text>,
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
      render: (_: unknown, r: Silence) => (
        <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>
          删除
        </Button>
      ),
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <Space size={8}>
              <BellOutlined />
              <Text>主动静默</Text>
              <Tag color="processing">即时生效</Tag>
            </Space>
          </div>

          <Alert
            type="info"
            showIcon
            message="静默影响当前授权网域"
            description="本页创建与展示的静默均在当前登录账号授权网域范围内生效（决策 56）；越权条件会被服务端拒绝。"
            style={{ marginBottom: 16 }}
          />

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