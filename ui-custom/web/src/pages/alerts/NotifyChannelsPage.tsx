/**
 * 通知渠道管理页（PL-3 通知渲染桥，2026-09-28；Module_08 告警收敛与通知管理）。
 * 能力：机器人渠道（飞书 / 钉钉 / 企业微信）列表 / 新增 / 编辑 / 删除；
 * 已启用渠道由平台在下发配置时自动写入 alertmanager.yml 的 receivers（B 路线：配置即生效，
 * 无需手工复制片段）；「接收人配置」片段仅在用户手写自定义 receiver 时作参考。
 * webhook 地址脱敏展示、签名密钥仅告知是否已设置（secret 永不回显）。
 * 覆盖页面状态：加载 / 空态 / 接口错误 / 权限不足。
 * 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
 *
 * 2026-10-02 用户意见（已落地）：「平台自动生成的接收人」由告警配置页高级区迁入本页，
 * 落在表格的「平台接收人」列——它是**渠道的产物**（每个已启用渠道派生一个 receiver），
 * 只有在渠道上下文里才读得懂；原先在告警配置页以只读面板呈现，既割裂又与本页行内
 * 「接收人配置」抽屉形成「同源能力两份」。列内只给结论（接收人名 + 模板绑定 + 可用性），
 * YAML 片段明细与复制仍由行内「接收人配置」抽屉承载（单一来源，不重复）。
 */
import { useMemo, useState } from 'react'
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
  Tooltip,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { Link } from 'react-router-dom'
import { EditOutlined, DeleteOutlined, PlusOutlined, SnippetsOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { EllipsisText } from '../../components/EllipsisText'
import { PageIntro } from '../../components/PageIntro'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { CreateNotifyChannelPayload, NotifyChannel, UpdateNotifyChannelPayload } from '../../types/alertmanager'
import { useNotifyChannels } from './useNotifyChannels'
import { useDerivedReceivers, type DerivedReceiverRow } from './useDerivedReceivers'
import { useNotifyTemplates } from './useNotifyTemplates'
import { NotifyChannelDrawer } from './NotifyChannelDrawer'
import { ReceiverSnippetDrawer } from './ReceiverSnippetDrawer'
import {
  ALERT_CONFIG_PATH,
  CHANNEL_DERIVED_RECEIVER_COLUMN_TITLE,
  CHANNEL_DERIVED_RECEIVER_EMPTY,
  CHANNEL_DERIVED_RECEIVER_FORBIDDEN,
  CHANNEL_DERIVED_RECEIVER_TOKEN_MISSING,
  CHANNEL_TEMPLATE_BIND_NONE_PREFIX,
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
  // 派生接收人（平台为已启用渠道自动生成的 receiver）：原在告警配置页只读面板，
  // 2026-10-02 迁入本页作为表格列。取数含 403 降级（非管理员看不到片段内容）。
  const {
    rows: derivedRows,
    loading: derivedLoading,
    permissionDenied: derivedForbidden,
  } = useDerivedReceivers()
  // dev-feedback #32：列内需展示每渠道绑定的通知模板，消除「模板没被纳入派生」的错觉。
  // 模板列表含内置模板，用于把 default_template_id 解析为模板名；无权限时降级为仅显示模板 ID。
  const { templates, permissionDenied: tplForbidden } = useNotifyTemplates()
  const templateNameById = useMemo(
    () => new Map(templates.map((t) => [t.id, t.name] as const)),
    [templates],
  )

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSeq, setDrawerSeq] = useState(0)
  const [editing, setEditing] = useState<NotifyChannel | null>(null)
  const [snippetOpen, setSnippetOpen] = useState(false)
  const [snippetSeq, setSnippetSeq] = useState(0)
  const [snippetChannel, setSnippetChannel] = useState<NotifyChannel | null>(null)

  /** 已启用渠道 ID → 派生接收人行（列渲染 O(1) 查表） */
  const derivedByChannelId = useMemo(
    () => new Map(derivedRows.map((r) => [r.channelId, r] as const)),
    [derivedRows],
  )

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

  /**
   * 「平台接收人」列的模板绑定展示（dev-feedback #32 口径随区块迁入本页）：
   * - 已绑定且能解析出模板名 → 模板：<模板名>；
   * - 已绑定但模板列表无权限（tplForbidden）/ 本地列表未命中 → 「模板 #<id>」，不阻断整列；
   * - 未绑定（缺省 / 0）→「回落 <渠道类型中文名> 内置默认模板」。
   */
  const renderTemplateBind = (row: DerivedReceiverRow) => {
    const bound = row.defaultTemplateId != null && row.defaultTemplateId !== 0
    if (!bound) {
      const typeLabel = row.channelType ? notifyChannelTypeLabel[row.channelType] : '该渠道'
      return `${CHANNEL_TEMPLATE_BIND_NONE_PREFIX}${typeLabel} 内置默认模板`
    }
    if (tplForbidden) return `模板 #${row.defaultTemplateId}`
    const name = templateNameById.get(String(row.defaultTemplateId))
    return name ? `模板：${name}` : `模板 #${row.defaultTemplateId}`
  }

  /**
   * 「平台接收人」列单元格：**只给结论，不重复片段**。
   * 片段 YAML 与复制仍由行内「接收人配置」抽屉承载（单一来源）。
   * 停用渠道不参与派生（useDerivedReceivers 只取enabled），故显示「停用后不再生成」。
   */
  const renderDerivedReceiver = (record: NotifyChannel) => {
    if (!record.enabled) {
      return <Text type="secondary">停用后不再生成</Text>
    }
    if (derivedForbidden) {
      return (
        <Tooltip title={CHANNEL_DERIVED_RECEIVER_FORBIDDEN}>
          <Text type="secondary">需管理员权限查看</Text>
        </Tooltip>
      )
    }
    if (derivedLoading) {
      return <Text type="secondary">加载中…</Text>
    }
    const row = derivedByChannelId.get(record.id)
    if (!row) {
      return <Text type="secondary">{CHANNEL_DERIVED_RECEIVER_EMPTY}</Text>
    }
    return (
      <Space direction="vertical" size={2}>
        <Space size={6} wrap>
          <Text code>{row.receiverName}</Text>
          {!row.tokenConfigured && (
            <Tooltip title={CHANNEL_DERIVED_RECEIVER_TOKEN_MISSING}>
              <Tag color="warning">暂不可用</Tag>
            </Tooltip>
          )}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {renderTemplateBind(row)}
        </Text>
      </Space>
    )
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
      // 2026-10-02：随「平台自动生成的接收人」区块由告警配置页迁入本页。
      // 列内只展示结论（接收人名 / 模板绑定 / 可用性），片段明细与复制走行内「接收人配置」抽屉。
      title: CHANNEL_DERIVED_RECEIVER_COLUMN_TITLE,
      key: 'derived_receiver',
      width: 220,
      render: (_: unknown, r: NotifyChannel) => renderDerivedReceiver(r),
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
        {/* 页头 + 说明区（四页统一，见 components/PageIntro.tsx）。
            副标只做定位；机制与「为什么这样做」全部收进默认收起的说明区，不占常驻首屏。 */}
        <PageIntro
          testId="notify-channels-intro"
          title="通知渠道"
          subtitle="登记告警送达的机器人渠道；告警分派只引用渠道，真实地址仅平台侧存储、列表脱敏展示"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增渠道
            </Button>
          }
          points={[
            <>
              本页是告警接收人的来源：已启用的渠道会被平台在下发配置时自动写入
              <Link to={ALERT_CONFIG_PATH}>「告警配置」</Link>
              所用 alertmanager.yml 的 receivers（配置即生效），无需手工复制片段。
            </>,
            <>
              每个已启用渠道对应一个接收人，接收人名见「{CHANNEL_DERIVED_RECEIVER_COLUMN_TITLE}」列；
              停用或删除渠道后，下一次配置变更会同步移除。
            </>,
            <>
              需要自定义接收人时，点行内「接收人配置」查看该渠道的片段作参考；
              请勿手写与自动生成同名（含渠道名归一化后同名）的接收人，重名会导致配置校验失败。
            </>,
          ]}
        />

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