/**
 * 通知渠道管理页（PL-3 通知渲染桥，2026-09-28；Module_08 告警收敛与通知管理）。
 * 能力：机器人渠道（飞书 / 钉钉 / 企业微信）列表 / 新增 / 编辑 / 删除；
 * 已启用渠道由平台在下发配置时自动写入 alertmanager.yml 的 receivers（B 路线：配置即生效，
 * 无需手工复制片段）；「接收人配置」片段仅在用户手写自定义 receiver 时作参考。
 * webhook 地址脱敏展示、签名密钥仅告知是否已设置（secret 永不回显）。
 * 覆盖页面状态：加载 / 空态 / 接口错误 / 权限不足。
 * 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
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
  Tag,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { Link } from 'react-router-dom'
import { EditOutlined, DeleteOutlined, PlusOutlined, SnippetsOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { CreateNotifyChannelPayload, NotifyChannel, UpdateNotifyChannelPayload } from '../../types/alertmanager'
import { useNotifyChannels } from './useNotifyChannels'
import { NotifyChannelDrawer } from './NotifyChannelDrawer'
import { ReceiverSnippetDrawer } from './ReceiverSnippetDrawer'
import {
  ALERT_CONFIG_PATH,
  notifyChannelTypeColor,
  notifyChannelTypeLabel,
} from './alertmanagerConstants'

const { Text } = Typography

/** 创建时间展示：RFC3339 → 本地可读串（沿用 M08 既有约定，不引入新依赖） */
function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-'
}

export function NotifyChannelsPage() {
  const { message } = App.useApp()
  const { channels, loading, error, permissionDenied, reload, create, update, remove } = useNotifyChannels()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSeq, setDrawerSeq] = useState(0)
  const [editing, setEditing] = useState<NotifyChannel | null>(null)
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [snippetSeq, setSnippetSeq] = useState(0)
  const [snippetChannel, setSnippetChannel] = useState<NotifyChannel | null>(null)

  const openCreate = () => {
    setEditing(null)
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  const openEdit = (record: NotifyChannel) => {
    setEditing(record)
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  /** 打开「接收人配置」抽屉：每次打开都换 key 重挂，避免上一条渠道的片段残留 */
  const openSnippet = (record: NotifyChannel) => {
    setSnippetChannel(record)
    setSnippetSeq((s) => s + 1)
    setSnippetOpen(true)
  }

  const handleDelete = (record: NotifyChannel) => {
    Modal.confirm({
      title: `删除通知渠道「${record.name}」？`,
      content: '删除后，引用该渠道的告警分派将无法送达；下一次配置变更会同步移除其接收人；该操作不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      async onOk() {
        await remove(record.id)
        message.success('通知渠道已删除')
        reload()
      },
    })
  }

  const columns: ColumnsType<NotifyChannel> = [
    {
      title: '渠道名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      fixed: 'left',
      render: (v: string) => <EllipsisText maxWidth={160}>{v}</EllipsisText>,
    },
    {
      title: '渠道类型',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (v: NotifyChannel['type']) => <Tag color={notifyChannelTypeColor[v]}>{notifyChannelTypeLabel[v]}</Tag>,
    },
    {
      title: '机器人 Webhook',
      dataIndex: 'webhook_url',
      key: 'webhook_url',
      width: 260,
      // 响应已脱敏（scheme://host/***），原值不回显
      render: (v: string) => <EllipsisText maxWidth={240}>{v}</EllipsisText>,
    },
    {
      title: '签名密钥',
      dataIndex: 'secret_set',
      key: 'secret_set',
      width: 100,
      render: (v: boolean) =>
        v ? <Tag color="processing">已设置</Tag> : <Text type="secondary">未设置</Text>,
    },
    {
      title: '启用状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (v: boolean) =>
        v ? <Tag color="success">启用</Tag> : <Tag color="default">停用</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (v?: string) => <Text type="secondary">{formatTime(v)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      // T08-F15：新增「接收人配置」后操作列共 3 个带图标文字按钮，210 会挤压换行撑高行高，放宽到 240
      width: 240,
      fixed: 'right',
      render: (_: unknown, r: NotifyChannel) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<SnippetsOutlined />} onClick={() => openSnippet(r)}>
            接收人配置
          </Button>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>
            删除
          </Button>
        </Space>
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
          title="通知渠道"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增渠道
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Text type="secondary">
            登记告警送达的机器人渠道（飞书 / 钉钉 / 企业微信）；告警分派只引用渠道 ID，真实地址仅平台侧存储、列表脱敏展示
          </Text>
          <br />
          <Text type="secondary">
            本页是告警接收人的来源：已启用的渠道会被平台在下发配置时自动写入
            <Link to={ALERT_CONFIG_PATH}>「告警配置」</Link>
            所用 alertmanager.yml 的 receivers（配置即生效），无需手工复制片段；停用或删除渠道后，下一次配置变更会同步移除。需要自定义接收人时，可点「接收人配置」查看该渠道的片段作参考。
          </Text>
        </Card>

        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="通知渠道加载失败，请稍后重试"
            description={error}
            action={<Button size="small" onClick={reload}>重新加载</Button>}
          />
        )}

        <Card>
          <Table<NotifyChannel>
            rowKey="id"
            dataSource={channels}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            pagination={TABLE_PAGINATION}
          />
        </Card>

        <NotifyChannelDrawer
          key={`${drawerSeq}`}
          open={drawerOpen}
          record={editing}
          onClose={() => setDrawerOpen(false)}
          onCreate={async (payload: CreateNotifyChannelPayload) => {
            await create(payload)
          }}
          onUpdate={async (id: string, payload: UpdateNotifyChannelPayload) => {
            await update(id, payload)
          }}
        />

        <ReceiverSnippetDrawer
          key={`snippet-${snippetSeq}`}
          open={snippetOpen}
          channel={snippetChannel}
          onClose={() => setSnippetOpen(false)}
        />
      </ConfigProvider>
    </MainLayout>
  )
}