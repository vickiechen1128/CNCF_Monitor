/**
 * 通知模板管理页（PL-3 通知渲染桥，2026-09-28；Module_08 告警收敛与通知管理）。
 * 能力：通知模板列表（Alertmanager 标准 Go template）/ 提交自定义模板 / 复制内置模板自定义 /
 * 历史版本回滚（重新挂载）；显式呈现平台内置默认模板（零模板接入主路径）。
 * 覆盖页面状态：加载 / 空态 / 接口错误 / 权限不足。
 * 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
 *
 * 用户帮助（提案 §7 用户脚本能力映射）：模板 = Alertmanager 标准 Go template（不是脚本）；
 * 时区 / 证书由平台统一处理；改样式改模板即可。说明以折叠栏承载，不做常驻大段说明。
 */
import { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  Drawer,
  Empty,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import {
  CopyOutlined,
  EyeOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { Link } from 'react-router-dom'
import type { ColumnsType } from 'antd/es/table'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'
import type { NotifyTemplate } from '../../types/alertmanager'
import { useNotifyTemplates } from './useNotifyTemplates'
import { NotifyTemplateDrawer, type NotifyTemplateInitial } from './NotifyTemplateDrawer'
import {
  ALERT_CONFIG_PATH,
  NOTIFY_CHANNELS_PATH,
  NOTIFY_TEMPLATE_BUILTIN_TIP,
  notifyChannelTypeColor,
  notifyChannelTypeLabel,
  notifyTemplateStatusLabel,
} from './alertmanagerConstants'

const { Text } = Typography

/** 创建时间展示：RFC3339 → 本地可读串（沿用 M08 既有约定，不引入新依赖） */
function formatTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '-'
}

const EMPTY_INITIAL: NotifyTemplateInitial = { name: '', channelType: 'feishu', content: '' }

export function NotifyTemplatesPage() {
  const { tokens } = useSkin()
  const { message } = App.useApp()
  const { templates, loading, error, permissionDenied, reload, submit, remount } = useNotifyTemplates()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerSeq, setDrawerSeq] = useState(0)
  const [drawerMode, setDrawerMode] = useState<'create' | 'clone'>('create')
  const [drawerInitial, setDrawerInitial] = useState<NotifyTemplateInitial>(EMPTY_INITIAL)
  const [detail, setDetail] = useState<NotifyTemplate | null>(null)
  const [remounting, setRemounting] = useState(false)

  const builtins = templates.filter((t) => t.is_builtin)

  const openCreate = () => {
    setDrawerMode('create')
    setDrawerInitial(EMPTY_INITIAL)
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  /** 复制已有模板后自定义：预填名称（加「副本」）与内容，降低从零手写成本 */
  const openClone = (t: NotifyTemplate) => {
    setDrawerMode('clone')
    setDrawerInitial({ name: `${t.name}（副本）`, channelType: t.channel_type, content: t.content })
    setDrawerSeq((s) => s + 1)
    setDrawerOpen(true)
  }

  const handleRemount = (record: NotifyTemplate) => {
    Modal.confirm({
      title: `回滚到「${record.name}」这个版本？`,
      content: '将把该版本内容重新提交为一次新的留痕；校验通过后生效，原有记录保持不变。',
      okText: '回滚',
      cancelText: '取消',
      async onOk() {
        setRemounting(true)
        try {
          await remount(record.id, record.name)
          message.success('已按该版本重新提交留痕')
          reload()
        } finally {
          setRemounting(false)
        }
      },
    })
  }

  const columns: ColumnsType<NotifyTemplate> = [
    {
      title: '模板名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      fixed: 'left',
      render: (v: string) => <EllipsisText maxWidth={200}>{v}</EllipsisText>,
    },
    {
      title: '适用渠道类型',
      dataIndex: 'channel_type',
      key: 'channel_type',
      width: 130,
      render: (v: NotifyTemplate['channel_type']) => (
        <Tag color={notifyChannelTypeColor[v]}>{notifyChannelTypeLabel[v]}</Tag>
      ),
    },
    {
      title: '模板来源',
      dataIndex: 'is_builtin',
      key: 'is_builtin',
      width: 120,
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
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: NotifyTemplate['status']) => (
        <Tag color="success">{notifyTemplateStatusLabel[v]}</Tag>
      ),
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
      width: 180,
      fixed: 'right',
      render: (_: unknown, r: NotifyTemplate) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(r)}>
            查看内容
          </Button>
          <Button
            size="small"
            type="link"
            icon={<HistoryOutlined />}
            loading={remounting}
            onClick={() => handleRemount(r)}
          >
            重新挂载
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
        {/* 用户帮助：模板心智（Go template 不是脚本）+ 平台内置能力 + 逃生门，折叠栏承载 */}
        <Collapse
          ghost
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'template-guide',
              label: (
                <Space size={8}>
                  <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                  <Text strong>「通知模板」是什么？（从自建脚本迁移过来怎么理解）</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    点击展开说明
                  </Text>
                </Space>
              ),
              children: (
                <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                  <li>
                    模板就是 <Text strong>Alertmanager 标准 Go template</Text> 文本，
                    <Text strong>不是脚本</Text>：平台不执行任意代码，只按模板把告警渲染成对应渠道的卡片。
                  </li>
                  <li>时区、证书、发送失败的可观测由平台统一处理，你不用自己写时间转换或证书兜底。</li>
                  <li>想改通知样式（标题 / 字段 / 颜色）改模板即可，不用改代码；改动会留痕、可回滚。</li>
                  <li>
                    平台已内置默认模板，零模板即可接入；如需投递到自有中继服务，可在
                    <Link to={ALERT_CONFIG_PATH}>告警配置</Link>
                    的接收人地址中直接填写外部地址，平台只做配置与校验、不托管运行。
                  </li>
                </ul>
              ),
            },
          ]}
        />

        <Card
          title="通知模板"
          extra={
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              提交自定义模板
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Text type="secondary">
            模板决定告警通知长什么样；平台按模板把告警渲染为各渠道机器人卡片并投递。
          </Text>
        </Card>

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

        <Card title="平台内置模板" style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            平台已内置默认模板，可直接使用，也可复制后自定义。复制出的模板需在
            <Link to={NOTIFY_CHANNELS_PATH}>通知渠道</Link>
            中绑定才会生效，去绑定 →
          </Text>
          {builtins.length > 0 ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {builtins.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 16px',
                    border: `1px solid ${tokens.colorBorderSecondary}`,
                    borderRadius: 8,
                  }}
                >
                  <Space size={8} wrap>
                    <Text strong>{t.name}</Text>
                    <Tag color={notifyChannelTypeColor[t.channel_type]}>
                      {notifyChannelTypeLabel[t.channel_type]}
                    </Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {NOTIFY_TEMPLATE_BUILTIN_TIP}
                    </Text>
                  </Space>
                  <Space size={0}>
                    <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setDetail(t)}>
                      查看内容
                    </Button>
                    <Button size="small" type="link" icon={<CopyOutlined />} onClick={() => openClone(t)}>
                      复制并自定义
                    </Button>
                  </Space>
                </div>
              ))}
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未获取到内置模板" />
          )}
        </Card>

        <Card title="模板列表（含历史版本）">
          <Table<NotifyTemplate>
            rowKey="id"
            dataSource={templates}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            pagination={TABLE_PAGINATION}
          />
        </Card>

        <NotifyTemplateDrawer
          key={`${drawerSeq}`}
          open={drawerOpen}
          mode={drawerMode}
          initial={drawerInitial}
          onClose={() => setDrawerOpen(false)}
          onSubmit={async (payload) => {
            await submit(payload)
          }}
        />

        {/* 模板内容只读查看（非 Form 抽屉，无回显竞态） */}
        <Drawer
          title={detail ? `模板内容：${detail.name}` : '模板内容'}
          width={720}
          open={detail !== null}
          onClose={() => setDetail(null)}
          destroyOnHidden
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
