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
 *
 * 2026-10-13（提案 alert-config-policy-split-migration.md §2.1 / §4.2）：新增「兜底渠道」列，
 * 列位置紧邻「平台接收人」之前。此前「哪个渠道是兜底渠道」只能在路由规则页的下拉框里反推，
 * 看渠道列表时无从判断。三态严格区分「已接管」（Tag「兜底」）与「平台建议值」（Tag「建议兜底」），
 * 绝不把建议值说成已接管（§11.9 契约）。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  ConfigProvider,
  Empty,
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
import { PageIntro } from '../../components/PageIntro'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { CreateNotifyChannelPayload, NotifyChannel, UpdateNotifyChannelPayload } from '../../types/alertmanager'
import { useNotifyChannels } from './useNotifyChannels'
import { useNotifyTemplates } from './useNotifyTemplates'
import { NotifyChannelDrawer } from './NotifyChannelDrawer'
import { ReceiverSnippetDrawer } from './ReceiverSnippetDrawer'
import {
  ROUTES_PATH,
  notifyChannelTypeColor,
  notifyChannelTypeLabel,
} from './alertmanagerConstants'

const { Text } = Typography

/** 创建时间展示：RFC3339 → 本地可读串（沿用 M08 既有约定，不引入新依赖） */
function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-'
}

export function NotifyChannelsPage() {
  const { message, modal } = App.useApp()
  const { channels, loading, error, permissionDenied, reload, create, update, remove } = useNotifyChannels()
  // 列内展示每渠道绑定的通知模板名；模板列表含内置模板，无权限时降级为仅显示模板 ID。
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

  /**
   * 删除渠道前先看路由引用：被引用时后端会拒绝，这里前置提示，避免用户白点。
   * 未被引用时删除不会影响 alertmanager.yml（未引用的渠道本来就不会物化）。
   */
  const handleDelete = (record: NotifyChannel) => {
    const refCount = record.route_reference_count ?? 0
    if (refCount > 0) {
      modal.warning({
        title: '渠道正在被路由规则引用',
        content: (
          <span>
            该渠道正被 {refCount} 条路由规则引用。请先到
            <Link to={ROUTES_PATH}>路由规则</Link>
            页改绑或删除引用，再回来删除。
          </span>
        ),
        okText: '知道了',
      })
      return
    }
    modal.confirm({
      title: `删除通知渠道「${record.name}」？`,
      content: '删除后该渠道不再可用，且操作不可恢复。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      async onOk() {
        try {
          await remove(record.id)
          message.success('通知渠道已删除')
          reload()
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
        }
      },
    })
  }

  /**
   * 模板绑定展示：
   * - 已绑定且能解析出模板名 → 模板：<模板名>；
   * - 已绑定但模板列表无权限 / 未命中 → 「模板 #<id>」；
   * - 未绑定 →「回落 <渠道类型中文名> 内置默认模板」。
   */
  const renderTemplateBind = (record: NotifyChannel) => {
    const boundId = record.default_template_id
    if (boundId == null || boundId === 0) {
      return `回落 ${notifyChannelTypeLabel[record.type]} 内置默认模板`
    }
    if (tplForbidden) return `模板 #${boundId}`
    const name = templateNameById.get(String(boundId))
    return name ? `模板：${name}` : `模板 #${boundId}`
  }

  /**
   * 「接收人 / 路由引用」列：receiver 名恒为 notify-<id>；只有被路由引用的渠道才会物化进
   * alertmanager.yml。未被引用的渠道是正常状态（不会收到告警），删除也不会影响配置。
   */
  const renderReceiverUsage = (record: NotifyChannel) => {
    const refCount = record.route_reference_count ?? 0
    return (
      <Space direction="vertical" size={2}>
        <Space size={6} wrap>
          <Text code>{record.receiver_name || `notify-${record.id}`}</Text>
          {refCount > 0 && <Tag color="blue">被 {refCount} 条路由引用</Tag>}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {renderTemplateBind(record)}
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
      // receiver 名恒为 notify-<id>；只有被路由引用的渠道才会物化进 alertmanager.yml。
      // 列内只展示结论（receiver 名 / 路由引用数 / 模板绑定），片段明细走行内「接收人配置」抽屉。
      title: '接收人 / 路由引用',
      key: 'receiver_usage',
      width: 260,
      render: (_: unknown, r: NotifyChannel) => renderReceiverUsage(r),
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
              渠道是告警送达的目的地；平台只保存渠道 ID、真实机器人地址和加签密钥，告警分派只引用渠道。
            </>,
            <>
              只有被路由规则引用的渠道才会写入 alertmanager.yml（接收人名恒为 notify-&lt;渠道ID&gt;）；
              未被路由引用的渠道不会物化，也不会收到告警。
            </>,
            <>
              删除被路由引用的渠道会被阻止，请先到路由规则页改绑；改名、改 webhook、换绑模板都不会影响
              alertmanager.yml，模板保存后立即生效。
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