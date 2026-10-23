/**
 * 通知模板管理页（M08 PL-3，2026-10-22 模板改为可编辑实体）。
 *
 * 页面形态：一个模板清单 + 按渠道类型分 Tab；内置与自定义同表展示。
 * - 内置模板：置顶、只读，只能查看 / 复制（随平台版本升级，不可编辑 / 删除）。
 * - 自定义模板：可新建 / 编辑 / 复制 / 删除；渠道类型创建后不可修改。
 * - 删除被渠道绑定的模板会被阻止，提示先去通知渠道页改绑。
 * - 模板没有版本历史 / 回滚；保存后立即生效，不需要下发配置。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  ConfigProvider,
  Drawer,
  Empty,
  Input,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import type { ColumnsType } from 'antd/es/table'
import { EllipsisText } from '../../components/EllipsisText'
import { PageIntro } from '../../components/PageIntro'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'
import type {
  NotifyChannelType,
  NotifyTemplate,
  NotifyTemplateDetail,
  SubmitNotifyTemplatePayload,
} from '../../types/alertmanager'
import { useNotifyTemplates } from './useNotifyTemplates'
import { NotifyTemplateDrawer, type NotifyTemplateInitial } from './NotifyTemplateDrawer'
import {
  NOTIFY_CHANNELS_PATH,
  NOTIFY_TEMPLATE_BUILTIN_TIP,
  notifyChannelTypeColor,
  notifyChannelTypeLabel,
} from './alertmanagerConstants'

const { Text } = Typography

/** 更新时间展示：RFC3339 → 本地可读串 */
function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-'
}

const EMPTY_INITIAL: NotifyTemplateInitial = { name: '', channelType: 'feishu', content: '' }

const CHANNEL_TABS: { key: 'all' | NotifyChannelType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'feishu', label: '飞书' },
  { key: 'dingtalk', label: '钉钉' },
  { key: 'wecom', label: '企业微信' },
]

export function NotifyTemplatesPage() {
  const { tokens } = useSkin()
  const { message, modal } = App.useApp()
  const { templates, loading, error, permissionDenied, reload, create, update, remove, getDetail } =
    useNotifyTemplates()

  const [activeTab, setActiveTab] = useState<'all' | NotifyChannelType>('all')
  const [keyword, setKeyword] = useState('')

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSeq, setDrawerSeq] = useState(0)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | 'copy'>('create')
  const [drawerInitial, setDrawerInitial] = useState<NotifyTemplateInitial>(EMPTY_INITIAL)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [detail, setDetail] = useState<NotifyTemplateDetail | null>(null)

  /** 复制时生成不冲突的名称：X（副本）、X（副本2）… */
  const copyName = (base: string): string => {
    const names = new Set(templates.map((t) => t.name))
    const first = `${base}（副本）`
    if (!names.has(first)) return first
    for (let i = 2; ; i += 1) {
      const candidate = `${base}（副本${i}）`
      if (!names.has(candidate)) return candidate
    }
  }

  const openCreate = () => {
    setDrawerMode('create')
    setDrawerInitial(EMPTY_INITIAL)
    setEditingId(null)
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  /** 查看 / 编辑 / 复制前按需拉取详情（列表不含 content） */
  const loadDetail = async (record: NotifyTemplate): Promise<NotifyTemplateDetail | null> => {
    try {
      return await getDetail(record.id)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '模板详情加载失败，请稍后重试')
      return null
    }
  }

  const openView = async (record: NotifyTemplate) => {
    const d = await loadDetail(record)
    if (d) setDetail(d)
  }

  const openEdit = async (record: NotifyTemplate) => {
    const d = await loadDetail(record)
    if (!d) return
    setDrawerMode('edit')
    setDrawerInitial({ name: d.name, channelType: d.channel_type, content: d.content })
    setEditingId(d.id)
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  const openCopy = async (record: NotifyTemplate) => {
    const d = await loadDetail(record)
    if (!d) return
    setDrawerMode('copy')
    setDrawerInitial({ name: copyName(d.name), channelType: d.channel_type, content: d.content })
    setEditingId(null)
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  const handleSubmit = async (payload: SubmitNotifyTemplatePayload) => {
    if (drawerMode === 'edit' && editingId) {
      await update(editingId, payload)
      message.success('模板已保存')
    } else {
      await create(payload)
      message.success(drawerMode === 'copy' ? '已复制为新模板' : '模板已创建')
    }
  }

  const handleDelete = (record: NotifyTemplate) => {
    if (record.bound_channel_count > 0) {
      modal.warning({
        title: '模板正在被通知渠道使用',
        content: (
          <span>
            该模板正被 {record.bound_channel_count} 个通知渠道绑定。请先到
            <Link to={NOTIFY_CHANNELS_PATH}>通知渠道</Link>
            页改绑，再回来删除。
          </span>
        ),
        okText: '知道了',
      })
      return
    }
    modal.confirm({
      title: `删除模板「${record.name}」？`,
      content: '删除后不可恢复；已删除模板不影响已经下发的通知。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      async onOk() {
        try {
          await remove(record.id)
          message.success('已删除模板')
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败，请稍后重试')
        }
      },
    })
  }

  const columns: ColumnsType<NotifyTemplate> = [
    {
      title: '模板名称',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      fixed: 'left',
      render: (v: string) => <EllipsisText maxWidth={220}>{v}</EllipsisText>,
    },
    {
      title: '适用渠道',
      dataIndex: 'channel_type',
      key: 'channel_type',
      width: 120,
      render: (v: NotifyChannelType) => (
        <Tag color={notifyChannelTypeColor[v]}>{notifyChannelTypeLabel[v]}</Tag>
      ),
    },
    {
      title: '来源',
      dataIndex: 'is_builtin',
      key: 'is_builtin',
      width: 110,
      render: (v: boolean) =>
        v ? (
          <Tooltip title={NOTIFY_TEMPLATE_BUILTIN_TIP}>
            <Tag color="gold">内置</Tag>
          </Tooltip>
        ) : (
          <Tag>自定义</Tag>
        ),
    },
    {
      title: '使用情况',
      dataIndex: 'bound_channel_count',
      key: 'bound_channel_count',
      width: 130,
      render: (v: number, r: NotifyTemplate) =>
        r.is_builtin ? (
          <Tooltip title="未绑定模板的渠道会自动使用该类型的内置模板">
            <Text type="secondary">默认兜底</Text>
          </Tooltip>
        ) : v > 0 ? (
          <Tag color="blue">{v} 个渠道</Tag>
        ) : (
          <Text type="secondary">未绑定</Text>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 180,
      render: (v?: string) => <Text type="secondary">{formatTime(v)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      fixed: 'right',
      render: (_: unknown, r: NotifyTemplate) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => void openView(r)}>
            查看
          </Button>
          {!r.is_builtin && (
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => void openEdit(r)}>
              编辑
            </Button>
          )}
          <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => void openCopy(r)}>
            复制
          </Button>
          {!r.is_builtin && (
            <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return templates.filter((t) => {
      if (activeTab !== 'all' && t.channel_type !== activeTab) return false
      if (kw && !t.name.toLowerCase().includes(kw)) return false
      return true
    })
  }, [templates, activeTab, keyword])

  const renderTable = (data: NotifyTemplate[]) => (
    <Table<NotifyTemplate>
      rowKey="id"
      dataSource={data}
      loading={loading}
      columns={columns}
      scroll={TABLE_SCROLL_X}
      pagination={TABLE_PAGINATION}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无模板" /> }}
    />
  )

  const tabs = CHANNEL_TABS.map((t) => ({
    key: t.key,
    label: `${t.label}（${t.key === 'all' ? templates.length : templates.filter((x) => x.channel_type === t.key).length}）`,
    children:
      activeTab === t.key ? (
        renderTable(t.key === 'all' ? filtered : filtered.filter((x) => x.channel_type === t.key))
      ) : null,
  }))

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
        <PageIntro
          testId="notify-templates-intro"
          title="通知模板"
          subtitle="模板决定告警通知长什么样；平台按模板把告警渲染为各渠道机器人卡片并投递"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建模板
            </Button>
          }
          points={[
            <>
              模板就是 <Text strong>Alertmanager 标准 Go template</Text> 文本，
              <Text strong>不是脚本</Text>：平台不执行任意代码，只按模板把告警渲染成对应渠道的卡片。
            </>,
            '时区、证书、发送失败的可观测由平台统一处理，你不用自己写时间转换或证书兜底。',
            '模板保存后立即生效，不需要下发配置；模板要在「通知渠道」里绑定才会被使用（未绑定则用该类型的内置默认模板）。',
            '内置模板随平台版本升级，系统统一维护，不可编辑/删除；需要调整请复制为自定义模板。',
          ]}
        />

        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="通知模板加载失败，请稍后重试"
            description={error}
            action={
              <Button size="small" onClick={reload}>
                重新加载
              </Button>
            }
          />
        )}

        <Card>
          <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
            <Text type="secondary">
              共 {templates.length} 个模板；内置模板置顶，自定义模板可编辑/复制/删除。
            </Text>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索模板名称"
              style={{ width: 240 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Space>
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as 'all' | NotifyChannelType)}
            items={tabs}
          />
        </Card>

        <NotifyTemplateDrawer
          key={`${drawerSeq}`}
          open={drawerOpen}
          mode={drawerMode}
          initial={drawerInitial}
          onClose={() => setDrawerOpen(false)}
          onSubmit={handleSubmit}
        />

        <Drawer
          title={detail ? `模板内容：${detail.name}` : '模板内容'}
          width={720}
          open={detail !== null}
          onClose={() => setDetail(null)}
          destroyOnHidden
          extra={
            detail && !detail.is_builtin ? (
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={() => {
                  const d = detail
                  setDetail(null)
                  void openEdit(d)
                }}
              >
                编辑
              </Button>
            ) : null
          }
        >
          {detail && (
            <pre
              style={{
                margin: 0,
                maxHeight: 560,
                overflow: 'auto',
                background: tokens.colorBgBase,
                padding: 12,
                borderRadius: 8,
                fontSize: 13,
                whiteSpace: 'pre-wrap',
              }}
            >
              {detail.content}
            </pre>
          )}
        </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}
