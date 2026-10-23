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
import { useState } from 'react'
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
import { EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { EllipsisText } from '../../components/EllipsisText'
import { PageIntro } from '../../components/PageIntro'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { CreateNotifyChannelPayload, NotifyChannel, UpdateNotifyChannelPayload } from '../../types/alertmanager'
import { useNotifyChannels } from './useNotifyChannels'
import { NotifyChannelDrawer } from './NotifyChannelDrawer'
import { ROUTES_PATH, notifyChannelTypeColor, notifyChannelTypeLabel } from './alertmanagerConstants'

const { Text } = Typography

/** 创建时间展示：RFC3339 → 本地可读串（沿用 M08 既有约定，不引入新依赖） */
function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-'
}

export function NotifyChannelsPage() {
  const { message, modal } = App.useApp()
  const { channels, loading, error, permissionDenied, reload, create, update, remove } = useNotifyChannels()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSeq, setDrawerSeq] = useState(0)
  const [editing, setEditing] = useState<NotifyChannel | null>(null)

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

  const columns: ColumnsType<NotifyChannel> = [
    {
      title: '渠道名称',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      fixed: 'left',
      render: (v: string) => <EllipsisText maxWidth={220}>{v}</EllipsisText>,
    },
    {
      title: '渠道类型',
      dataIndex: 'type',
      key: 'type',
      width: 130,
      render: (v: NotifyChannel['type']) => <Tag color={notifyChannelTypeColor[v]}>{notifyChannelTypeLabel[v]}</Tag>,
    },
    {
      title: '被引用次数',
      dataIndex: 'route_reference_count',
      key: 'route_reference_count',
      width: 120,
      render: (v?: number) => {
        const n = v ?? 0
        return n > 0 ? <Tag color="blue">{n}</Tag> : <Text type="secondary">0</Text>
      },
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
      width: 160,
      fixed: 'right',
      render: (_: unknown, r: NotifyChannel) => (
        <Space size={0}>
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
          subtitle="登记告警送达的渠道；列表只展示通用信息，Webhook、模板、签名等类型独有配置在编辑抽屉中维护"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增渠道
            </Button>
          }
          points={[
            <>
              渠道是告警送达的目的地；平台只保存渠道 ID、真实 Webhook 地址和可选签名密钥，告警分派只引用渠道。
            </>,
            <>
              只有被路由规则引用的渠道才会写入 alertmanager.yml（接收人名恒为 notify-&lt;渠道ID&gt;）；
              未被路由引用的渠道不会物化，也不会收到告警。
            </>,
            <>
              删除被路由引用的渠道会被阻止，请先到路由规则页改绑；改名、改 Webhook、换绑模板都不会影响
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

      </ConfigProvider>
    </MainLayout>
  )
}