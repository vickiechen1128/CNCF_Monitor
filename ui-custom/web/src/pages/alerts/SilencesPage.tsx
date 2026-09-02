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
  Empty,
  Modal,
  Space,
  Table,
  Select,
  Input,
  Tag,
  Typography,
} from 'antd'
import { BellOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import type { Silence, SilenceStatus } from '../../types/alertmanager'
import { useSilences } from './useSilences'
import { CreateSilenceDrawer, type CreateSilenceDrawerProps } from './CreateSilenceDrawer'
import { silenceStatusColor, silenceStatusLabel } from './alertmanagerConstants'
import { formatMatchers } from './alertmanagerConstants'

const { Text, Title } = Typography

export function SilencesPage() {
  const { message } = App.useApp()
  const { silences, total, loading, error, permissionDenied, reload, create, remove } = useSilences()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSeq, setDrawerSeq] = useState(0)
  const [kw, setKw] = useState('')
  const [status, setStatus] = useState<SilenceStatus | 'all'>('all')

  const openCreate = () => {
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  const filtered = silences.filter((s) => {
    if (status !== 'all' && s.status !== status) return false
    if (kw.trim()) {
      const haystack = `${formatMatchers(s.matchers)} ${s.comment} ${s.created_by ?? ''}`.toLowerCase()
      if (!haystack.includes(kw.trim().toLowerCase())) return false
    }
    return true
  })

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
      render: (v: string) => <Text>{v}</Text>,
    },
    {
      title: '失效时间',
      dataIndex: 'ends_at',
      key: 'ends_at',
      width: 180,
      render: (v: string) => <Text>{v}</Text>,
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
      <Card>
        <Empty description="当前账号无此页面查看权限" />
      </Card>
    )
  }

  return (
    <div>
      <div className="page-header">
        <Title level={4} style={{ margin: 0 }}>
          静默管理
        </Title>
        <Text type="secondary">创建主动静默，屏蔽特定告警的通知；本操作即时生效，不影响配置下发</Text>
      </div>

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

      <Card className="page-card">
        <FilterBar>
          <FilterItem label="静默状态">
            <Select
              style={{ width: 160 }}
              value={status}
              onChange={setStatus}
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
              onChange={(e) => setKw(e.target.value)}
              allowClear
            />
          </FilterItem>
        </FilterBar>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <Space size={8}>
            <BellOutlined />
            <Text>主动静默</Text>
            <Tag color="processing">即时生效</Tag>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            创建静默
          </Button>
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
          pagination={{ ...TABLE_PAGINATION, total }}
        />
      </Card>

      <CreateSilenceDrawer
        key={`${drawerSeq}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  )
}