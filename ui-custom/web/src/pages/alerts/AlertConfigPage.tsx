/**
 * 告警配置页（文件挂载，决策 59/60）。
 * 能力：上传/粘贴 alertmanager.yml 挂载（校验失败行级报错不落库）；当前生效只读视图；
 * 历史版本列表 + 重新挂载回滚（Modal 二次确认 + 触发重校验）；跨模块跳转 M09 配置变更确认。
 *
 * 状态口径（dev-feedback §25 方案 A 前端侧）：展示一律按 `applied_at` 派生——有值「已生效」，
 * 为空「已提交，待确认下发」+ 配置变更确认入口；不再直读 `status=applied` 冒充「已生效」
 * （挂载只落库收录，真正写盘 + reload 在 M09 确认下发之后）。
 *
 * 信息层级（2026-09-29 排版优化，遵循本模块「说明不占常驻首屏、指引以可收起折叠栏承载」约定）：
 *   1) 页头卡：页名 + 主操作「挂载新配置」+ 一行定位说明（含跨模块「去写规则」入口）；
 *   2) 「写配置前必读」折叠栏（默认收起）：三块必写 / 两块豁免 / 最小骨架示例；
 *   3) 当前生效配置（核心，前置）；4) 派生预览（按状态渐进披露）；5) 配置版本历史。
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { EyeOutlined, HistoryOutlined, InfoCircleOutlined, UploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { alertmanagerConfigApi, readValidateErrors } from '../../api/alertmanager'
import { triggerConfigDrafts } from '../config-center/preview/triggerConfigDraft'
import type { AlertmanagerConfigVersionListItem, ValidateErrorItem } from '../../types/alertmanager'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { RuleGuideLink } from '../../components/RuleGuideLink'
import { useAlertConfig } from './useAlertConfig'
import { AlertConfigDrawer } from './AlertConfigDrawer'
import {
  ALERTMANAGER_MIN_SKELETON,
  ALERT_CONFIG_EXEMPT_BLOCKS,
  ALERT_CONFIG_REQUIRED_BLOCKS,
  ALERT_DERIVED_PREVIEW_DESC,
  ALERT_DERIVED_PREVIEW_EMPTY,
  ALERT_DERIVED_PREVIEW_FORBIDDEN,
  ALERT_DERIVED_PREVIEW_RENAME_TIP,
  ALERT_DERIVED_PREVIEW_SCOPE,
  ALERT_DERIVED_PREVIEW_TITLE,
  CONFIG_PREVIEW_PATH,
  CONFIG_STATUS_PENDING_TIP,
  CURRENT_USER,
  NOTIFY_CHANNELS_PATH,
  configStatusView,
} from './alertmanagerConstants'
import { useDerivedReceivers } from './useDerivedReceivers'
import { shortChecksum } from '../../utils/shortChecksum'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'

const { Text } = Typography

/** 配置状态展示所需的字段子集（当前生效 / 版本列表 / 版本详情三处同构） */
type ConfigStatusSource = Pick<AlertmanagerConfigVersionListItem, 'applied_at' | 'source_change_no'>

export function AlertConfigPage() {
  const { tokens } = useSkin()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { current, versions, total, loading, error, permissionDenied, reload, page, onPageSizeChange, submit, remount } =
    useAlertConfig()
  const {
    rows: derivedRows,
    loading: derivedLoading,
    error: derivedError,
    permissionDenied: derivedForbidden,
    reload: reloadDerived,
  } = useDerivedReceivers()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOpenSeq, setDrawerOpenSeq] = useState(0)
  const [drawerContent, setDrawerContent] = useState('')
  const [drawerName, setDrawerName] = useState('')
  const [detail, setDetail] = useState<AlertmanagerConfigVersionListItem | null>(null)
  const [detailLoaded, setDetailLoaded] = useState<{ id: string; content: string } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [remountErrors, setRemountErrors] = useState<ValidateErrorItem[] | null>(null)
  const [remounting, setRemounting] = useState(false)

  // YAML / 配置正文统一排版（一处定义、多处复用）：等宽、可滚动、同圆角同内边距，
  // 避免此前四处各写一套内联样式造成的视觉不一致。配色取皮肤 token（支持运行时换肤）。
  const yamlBlockStyle = {
    margin: 0,
    overflow: 'auto',
    background: tokens.colorBgBase,
    padding: 12,
    borderRadius: 8,
    fontSize: 13,
  } as const

  const openMount = (content = '', name = '') => {
    setDrawerOpenSeq((s) => s + 1)
    setDrawerContent(content)
    setDrawerName(name)
    setDrawerOpen(true)
  }

  const handleSubmit = async (content: string) => {
    await submit(content, CURRENT_USER)
    setRemountErrors(null)
    // 决策 60：告警配置仅作用于管理域 default；挂载成功后同步触发变更单生成
    void triggerConfigDrafts(['default'], { prefix: '配置已挂载', onNavigate: () => navigate(CONFIG_PREVIEW_PATH) })
    reload()
  }

  const openVersionDetail = async (record: AlertmanagerConfigVersionListItem) => {
    setDetail(record)
    setDetailLoading(true)
    setDetailLoaded(null)
    try {
      const res = await alertmanagerConfigApi.getVersion(record.id)
      setDetailLoaded({ id: record.id, content: res.data.content })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载版本内容失败，请稍后重试')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleRemount = (record: AlertmanagerConfigVersionListItem) => {
    Modal.confirm({
      title: `重新挂载本版本（${record.id}）？`,
      content: '将把该历史版本内容再次提交挂载（重新执行 amtool 校验）并进入 M09 变更确认，人工确认后下发生效。',
      okText: '重新挂载',
      cancelText: '取消',
      async onOk() {
        setRemounting(true)
        try {
          await remount(record.id, CURRENT_USER)
          setRemountErrors(null)
          void triggerConfigDrafts(['default'], { prefix: `版本 ${record.id} 已重新挂载`, onNavigate: () => navigate(CONFIG_PREVIEW_PATH) })
          reload()
        } catch (e) {
          const detail = readValidateErrors(e)
          if (detail?.items) {
            setRemountErrors(detail.items)
            message.error('重新挂载校验失败，请在下方错误列表中定位修改后重试')
          } else {
            message.error(e instanceof Error ? e.message : '重新挂载失败，请稍后重试')
          }
          throw e
        } finally {
          setRemounting(false)
        }
      },
    })
  }

  /**
   * 配置状态展示（dev-feedback §25 方案 A）：按 `applied_at` 派生，**不直读 `status`**。
   * `status=applied` 只表示「已收录为 M09 下发源」（挂载落库那一刻即置位，此时 AM 仍加载旧文件），
   * 唯一真实生效信号是 M09 确认下发写盘成功后回填的 `applied_at`；为空即「已提交，待确认下发」，
   * 并附配置变更确认入口（有变更单号则深链到该单，否则落到列表页——不造死链）。
   */
  const renderConfigStatus = (v: ConfigStatusSource) => {
    const view = configStatusView(v.applied_at)
    if (view.applied) {
      return <Tag color={view.color}>{view.label}</Tag>
    }
    const confirmPath = v.source_change_no
      ? `${CONFIG_PREVIEW_PATH}?change_no=${encodeURIComponent(v.source_change_no)}`
      : CONFIG_PREVIEW_PATH
    return (
      <Space direction="vertical" size={2}>
        <Tag color={view.color}>{view.label}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {CONFIG_STATUS_PENDING_TIP}
          <Link to={confirmPath}>{v.source_change_no ? `变更单 ${v.source_change_no}` : '「配置变更确认」'}</Link>
          确认下发。
        </Text>
      </Space>
    )
  }

  const columns: ColumnsType<AlertmanagerConfigVersionListItem> = [
    {
      title: '版本 ID',
      dataIndex: 'id',
      key: 'id',
      width: 160,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      // 状态列改由 applied_at 派生（§25）：展示与「Alertmanager 是否已加载本版本」对齐。
      title: '状态',
      dataIndex: 'applied_at',
      key: 'status',
      width: 230,
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => renderConfigStatus(r),
    },
    {
      title: '生效时间',
      dataIndex: 'applied_at',
      key: 'applied_at',
      width: 180,
      render: (v?: string) => <Text type="secondary">{v ?? '-'}</Text>,
    },
    {
      title: '应用人',
      dataIndex: 'applied_by',
      key: 'applied_by',
      width: 130,
      render: (v?: string) => <Text>{v ?? '-'}</Text>,
    },
    {
      title: 'M09 变更单',
      dataIndex: 'source_change_no',
      key: 'source_change_no',
      width: 170,
      // 决策 69-③（决策 60 补充块）：变更单号直达 M09 该单详情（?change_no= 深链）。
      // 纯展示层增强——source_change_no 字段既已存在，不引入 change_status 依赖、不新增路由。
      render: (v?: string) =>
        v ? (
          <Link to={`${CONFIG_PREVIEW_PATH}?change_no=${encodeURIComponent(v)}`}>{v}</Link>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '校验和（sha256）',
      dataIndex: 'checksum',
      key: 'checksum',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{shortChecksum(v)}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      fixed: 'right',
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openVersionDetail(r)}>
            查看
          </Button>
          <Button size="small" type="link" icon={<HistoryOutlined />} loading={remounting} onClick={() => handleRemount(r)}>
            重新挂载此版本
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
        {/* 页头卡：只保留页名 + 主操作 + 一行定位说明（原「说明书」大段内容已收进下方折叠栏，
            避免首屏被文档淹没；页名不再重复出现在正文标题里）。 */}
        <Card
          title="告警配置"
          extra={
            <Button type="primary" icon={<UploadOutlined />} onClick={() => openMount()}>
              挂载新配置
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Space direction="vertical" size={4}>
            <Text type="secondary">
              通过文件挂载整份 alertmanager.yml，校验通过后提交配置中心（M09）变更单，确认后统一下发生效
            </Text>
            {/* PL-1（D-1 方案丙）：本页只管「发给谁、怎么收敛」，告警规则（什么情况算告警）在 M01
                「规则编辑」维护——跨模块说明 + 联动入口，导航归属不变。 */}
            <Text type="secondary">
              告警规则（什么情况下告警）在「规则编辑」维护，本页只管「告警发给谁、怎么收敛」。 <RuleGuideLink />
            </Text>
          </Space>
        </Card>

        {/* 参考说明区：单一折叠容器（默认收起）承载全部文档性内容——写配置前的必写/豁免/骨架。
            遵循本模块既有约定（用户 2026-09-11 第三轮反馈）：说明不占常驻空间，指引以可收起折叠栏承载。 */}
        <Collapse
          ghost
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'guidance',
              label: (
                <Space size={8}>
                  <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                  <Text strong>写配置前必读：三块必写 + 两块豁免</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    点击展开说明
                  </Text>
                </Space>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* PL-2（2026-09-28）：显式化「在这页要写什么」——三块必写 + 两块豁免，口径与服务端
                      amtool check-config 一致，不承诺校验器不校验的字段。 */}
                  <div>
                    <Text strong>本页你需要写这三块：</Text>
                    <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                      {ALERT_CONFIG_REQUIRED_BLOCKS.map((block) => (
                        <li key={block.key} style={{ marginBottom: 4 }}>
                          <Text strong>{block.title}</Text>
                          <Text code style={{ margin: '0 6px' }}>{block.fields}</Text>
                          <Text type="secondary">{block.desc}</Text>
                          {/* B 路线（决策 74）：已启用渠道的接收人由平台自动写入，receivers 块仍为必写块
                              （自定义场景），给出「通知渠道」页入口与渠道管理心智。 */}
                          {block.path ? (
                            <Text type="secondary">
                              ，前往<Link to={block.path}>{block.linkText ?? '详情'}</Link>
                            </Text>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                    <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                      global 段按需最简即可（如 resolve_timeout）；仅使用邮件渠道时才需补 smtp_* 配置，不列为必写块。
                    </Text>
                  </div>

                  <div>
                    <Text strong>这两块不用你写（已豁免）：</Text>
                    <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                      {ALERT_CONFIG_EXEMPT_BLOCKS.map((block) => (
                        <li key={block.key} style={{ marginBottom: 4 }}>
                          <Text strong>{block.title}</Text>
                          <Text type="secondary">
                            ：{block.desc}
                            {block.path ? (
                              <>
                                ，前往<Link to={block.path}>{block.linkText ?? '详情'}</Link>
                              </>
                            ) : null}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <Space size={8} style={{ marginBottom: 8 }}>
                      <Text strong>最小可运行 alertmanager.yml 骨架</Text>
                      <Tag color="processing">已通过 amtool 校验</Tag>
                    </Space>
                    <pre style={{ ...yamlBlockStyle, maxHeight: 320 }}>{ALERTMANAGER_MIN_SKELETON}</pre>
                    <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                      点「挂载新配置」后可在抽屉里用「插入骨架示例」一键填入；已启用渠道的接收人由平台自动写入，无需手工复制片段，此处 receivers 仅为自定义场景的手写示例。
                    </Text>
                  </div>
                </div>
              ),
            },
          ]}
        />

        {/* 错误条置于数据区之前：问题优先可见（原分别散落在文档卡与配置卡之间）。 */}
        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="配置信息加载失败，请稍后重试"
            description={error}
            action={<Button size="small" onClick={reload}>重新加载</Button>}
          />
        )}

        {remountErrors && remountErrors.length > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="重新挂载校验失败，未保存、未生效，请修改后重试"
            description={
              <div>
                <Text>请在下方定位行级错误：</Text>
                <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                  {remountErrors.map((err, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      <Tag style={{ marginInlineEnd: 8 }}>
                        {err.file}
                        {err.line > 0 ? `:${err.line}` : ''}
                      </Tag>
                      {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            }
            action={<Button size="small" onClick={() => setRemountErrors(null)}>关闭</Button>}
          />
        )}

        {/* 核心内容前置：当前生效配置（原被文档卡挤到第三屏）。 */}
        <Card
          title={
            <Space size={8}>
              当前生效配置
              {current && current.applied_at && (
                <Tag color="processing">生效于 {current.applied_at} 由 {current.applied_by ?? '-'} 提交</Tag>
              )}
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Text type="secondary">加载中…</Text>
            </div>
          ) : current && current.content ? (
            <>
              <Descriptions size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="版本 ID">
                  <Text code>{current.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">{renderConfigStatus(current)}</Descriptions.Item>
                <Descriptions.Item label="生效时间">{current.applied_at ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="应用人">{current.applied_by ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="M09 变更单">
                  {current.source_change_no ? <Text code>{current.source_change_no}</Text> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="校验和（sha256）">
                  <Text code style={{ fontSize: 12 }}>{shortChecksum(current.checksum)}</Text>
                </Descriptions.Item>
              </Descriptions>
              <Space size={8} style={{ marginBottom: 8 }}>
                <Text strong>完整配置</Text>
                <Tag>只读</Tag>
              </Space>
              <pre style={{ ...yamlBlockStyle, maxHeight: 420 }}>{current.content}</pre>
            </>
          ) : (
            <Empty description="当前无生效配置，点击「挂载新配置」上传或粘贴 alertmanager.yml" />
          )}
        </Card>

        {/* B 路线（决策 74）：只读「派生预览」——平台 UI 控制的已启用渠道将被写进 alertmanager.yml
            的 receivers（配置即生效）。按状态渐进披露：仅在有内容 / 无权限 / 出错时占卡片，
            无已启用渠道时只留一行提示，避免空态大卡片占据首屏（数据来自渠道列表 + 每渠道接收人片段，
            后者需管理员权限）。 */}
        {derivedForbidden || derivedError ? (
          <Card title={ALERT_DERIVED_PREVIEW_TITLE} style={{ marginBottom: 16 }}>
            {derivedForbidden ? (
              <Alert
                type="warning"
                showIcon
                message="无权限查看派生接收人"
                description={ALERT_DERIVED_PREVIEW_FORBIDDEN}
                action={<Button size="small" onClick={reloadDerived}>重试</Button>}
              />
            ) : (
              <Alert
                type="error"
                showIcon
                message="派生预览加载失败，请稍后重试"
                description={derivedError}
                action={<Button size="small" onClick={reloadDerived}>重试</Button>}
              />
            )}
          </Card>
        ) : derivedRows.length > 0 ? (
          <Card
            title={
              <Space size={8}>
                {ALERT_DERIVED_PREVIEW_TITLE}
                <Tag>只读</Tag>
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
            <Space direction="vertical" size={4}>
              <Text type="secondary">{ALERT_DERIVED_PREVIEW_DESC}</Text>
              <Text type="secondary">{ALERT_DERIVED_PREVIEW_SCOPE}</Text>
              {/* L3（#26 / #28）：平台只物化 receivers，通知真正生效还须用户在 route/routes 把
                  receiver 指向它；route 段由用户手写维护，避免「建了渠道就自动通知」的误判。 */}
              <Text type="secondary" style={{ display: 'block', paddingLeft: 10, borderLeft: `3px solid ${tokens.colorInfo}`, lineHeight: 1.6 }}>
                平台只自动写入 <Text code>receivers</Text> 定义；要让通知真正发出，还需你在 alertmanager.yml 的{' '}
                <Text code>route</Text>/<Text code>routes</Text> 里把 <Text code>receiver</Text> 指向它（route 段由你手写维护）。
              </Text>
            </Space>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {derivedRows.map((row) => (
                <div key={row.channelId}>
                  <Space size={8} wrap>
                    <Tag color="blue">{row.channelName}</Tag>
                    <Text type="secondary">→ 派生接收人</Text>
                    <Text code>{row.receiverName}</Text>
                    {!row.tokenConfigured && <Tag color="warning">桥令牌未配置，暂不可用</Tag>}
                  </Space>
                  <pre style={{ ...yamlBlockStyle, marginTop: 8, maxHeight: 200, fontSize: 12.5 }}>{row.snippet}</pre>
                </div>
              ))}
            </div>
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              {ALERT_DERIVED_PREVIEW_RENAME_TIP}
            </Text>
          </Card>
        ) : derivedLoading ? (
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">正在加载平台自动写入的接收人…</Text>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary">{ALERT_DERIVED_PREVIEW_EMPTY}前往</Text>
            <Link to={NOTIFY_CHANNELS_PATH}>「通知渠道」</Link>
          </div>
        )}

        <Card
          title={
            <Space size={8}>
              <HistoryOutlined />
              配置版本历史
              <Tag>内容侧留痕</Tag>
            </Space>
          }
        >
          <Table<AlertmanagerConfigVersionListItem>
            rowKey="id"
            dataSource={versions}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            pagination={{
              ...TABLE_PAGINATION,
              current: page,
              total,
              onChange: (p, pz) => onPageSizeChange(p, pz),
            }}
          />
        </Card>

        <AlertConfigDrawer
          key={`${drawerOpenSeq}-${drawerName}`}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          initialContent={drawerContent}
          mountName={drawerName}
          onSubmit={handleSubmit}
        />

        <Drawer
          title={detail ? `配置版本 ${detail.id} 内容` : '配置版本内容'}
          width={760}
          open={detail !== null}
          loading={detailLoading}
          onClose={() => setDetail(null)}
        >
          {detail && (
            <>
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="版本 ID">
                  <Text code>{detail.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">{renderConfigStatus(detail)}</Descriptions.Item>
                <Descriptions.Item label="生效时间">{detail.applied_at ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="应用人">{detail.applied_by ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="M09 变更单">
                  {detail.source_change_no ? <Text code>{detail.source_change_no}</Text> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="校验和（sha256）">
                  <Text code style={{ fontSize: 12 }}>{shortChecksum(detail.checksum)}</Text>
                </Descriptions.Item>
              </Descriptions>
              <pre style={{ ...yamlBlockStyle, maxHeight: 520 }}>
                {detailLoaded?.id === detail.id ? detailLoaded.content : ''}
              </pre>
            </>
          )}
        </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}