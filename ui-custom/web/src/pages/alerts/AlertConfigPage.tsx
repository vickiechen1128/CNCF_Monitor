/**
 * 告警配置页（决策 59/60 + 设计提案 alert-config-three-layer-model.md §7.3 方案 A）。
 *
 * 页面职责（2026-10-02用户拍板，IA 重构）：由「文件挂载中心」改为「策略 + 动线 + 现状 + 高级」四段——
 *   ① 策略卡（提级为首屏第一卡）：未匹配规则的告警发给谁 + 路由规则由谁维护（二选一模式控件）；
 *   ② 动线卡：回答「我该去哪配」（通知渠道 / 路由规则 / 通知模板 + 抑制规则标「即将支持」）；
 *   ③ 现状卡（瘦身）：一行状态摘要，完整 YAML 默认折叠；
 *   ④ 配置版本历史（常驻）：内容侧留痕，与告警策略无关，故不进高级区；
 *   ⑤ 高级区（默认收起）：导入整份配置文件 / 手写配置说明。
 *
 * 2026-10-02 用户意见（已落地）：
 *   - 「配置版本历史」是全局留痕能力，从高级区提出为常驻卡（现状卡之后、高级区之前）；
 *   - 删除「重新挂载此版本」：历史配置重新提交走「打开版本内容→改→导入」即可，
 *     专用remount 端点 + 二次确认 + 行级错误区属过度设计，且与「通知模板」页的
 *     「重新挂载（模板回滚）」语义同名易混——后者保留（那是模板版本回滚，有独立价值）；
 *   - 「平台自动生成的接收人」只读面板迁出本页 → 「通知渠道」页表格的「平台接收人」列
 *     （明细/复制仍走该页行内「接收人配置」抽屉）：它是**渠道的产物**，只在渠道上下文里有意义，
 *     放在本页高级区既割裂又与渠道页的片段能力形成「同源能力两份」。
 *     本页仅在手写说明的「接收人」块保留前往渠道页的链接（常量 ALERT_CONFIG_REQUIRED_BLOCKS）。
 *
 * 三层模型与 UI 的对应（提案 §1.3）：三层模型里「导入整份文件」是第 ③ 层（永久逃生舱，PRD §11.6），
 * 因此**页头不再挂type="primary" 主按钮**——降级不删除，入口移入高级区。
 *
 * 状态口径（dev-feedback §25 方案 A 前端侧）：展示一律按 `applied_at` 派生——有值「已生效」，
 * 为空「已提交，待确认下发」+ 配置变更确认入口；不再直读 `status=applied` 冒充「已生效」
 * （提交只落库收录，真正写盘 + reload 在 M09 确认下发之后）。
 *
 * 术语口径（提案 §7.5）：用户视图一律不出「派生 / 兜底 / 作者模式 / 收敛（复合词）」与
 * `route`/`receivers` 等字段名；字段名只在高级区的手写说明与 YAML 里出现。
 */
import { useMemo, useState } from 'react'
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
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import {
  ApiOutlined,
  ApartmentOutlined,
  EyeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { alertmanagerConfigApi } from '../../api/alertmanager'
import { triggerConfigDrafts } from '../config-center/preview/triggerConfigDraft'
import type { AlertmanagerConfigVersionListItem, RouteMode, RouteReceiverSource } from '../../types/alertmanager'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { PageIntro } from '../../components/PageIntro'
import { RuleGuideLink } from '../../components/RuleGuideLink'
import { useAlertConfig } from './useAlertConfig'
import { AlertConfigDrawer } from './AlertConfigDrawer'
import {
  ALERTMANAGER_MIN_SKELETON,
  ALERT_ADVANCED_GUIDE_HANDWRITTEN_INTRO,
  ALERT_ADVANCED_GUIDE_MANAGED,
  ALERT_ADVANCED_GUIDE_TITLE,
  ALERT_ADVANCED_IMPORT_LABEL,
  ALERT_ADVANCED_CARD_TITLE,
  ALERT_CONFIG_EXEMPT_BLOCKS,
  ALERT_CONFIG_REQUIRED_BLOCKS,
  ALERT_GUIDE_CARD_TITLE,
  ALERT_GUIDE_INHIBIT_COMING,
  ALERT_POLICY_CARD_TITLE,
  ALERT_POLICY_FALLBACK_LABEL,
  ALERT_POLICY_MODE_HANDWRITTEN,
  ALERT_POLICY_MODE_MANAGED,
  ALERT_POLICY_ROUTE_MODE_LABEL,
  CONFIG_PREVIEW_PATH,
  CONFIG_STATUS_PENDING_TIP,
  CURRENT_USER,
  NOTIFY_CHANNELS_PATH,
  NOTIFY_TEMPLATES_PATH,
  configStatusView,
} from './alertmanagerConstants'
import { useRouteSetting, NONE_RECEIVER_VALUE } from './useRouteSetting'
import { shortChecksum } from '../../utils/shortChecksum'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'

const { Text } = Typography

/** 默认接收人（根兜底）生效来源展示名（决策 113 第 6 条三态；用户视图，故不含 receiver 名等实现细节） */
const ROUTE_SOURCE_LABEL: Record<RouteReceiverSource, string> = {
  explicit: '你指定的',
  auto_first_enabled: '已启用渠道的第一个',
  none: '暂无',
}

/** 配置状态展示所需的字段子集（当前生效 / 版本列表 / 版本详情三处同构） */
type ConfigStatusSource = Pick<AlertmanagerConfigVersionListItem, 'applied_at' | 'source_change_no'>

/**
 * 嵌套 Collapse 的**包裹层**必须阻止点击冒泡（2026-10-02）。
 * antd Collapse 的 header 是 role="button" 的容器，点击其内部任意子元素都会冒泡到 header；
 * 高级区（外层）内嵌了「手写配置说明 / 平台自动生成的接收人」两个内层折叠项，
 * 若不阻止冒泡，点内层标题会同时触发外层 header → 整个高级区被收起，
 * 表现为「点开内层后内容立刻消失」。
 *
 * 注意：stopPropagation 必须挂在**内层 Collapse 之外**的包裹元素上，不能挂在内层 label 上——
 * 后者会连内层 Collapse 自己的 header 事件一起拦掉，导致内层永远展不开。
 */
function stopHeaderClick(e: React.MouseEvent) {
  e.stopPropagation()
}

/**
 * 动线卡单行（提案 §7.3 ②）：图标 + 标题 + 一句「回答什么问题」+ 跳转。
 * clickable 元素视觉上明确可点击（整行 hover 变色 + 箭头），避免被误读成静态标签。
 */
function GuideLink({
  to,
  icon,
  title,
  desc,
  testId,
}: {
  to: string
  icon: React.ReactNode
  title: string
  desc: string
  testId: string
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        padding: '6px 8px',
        borderRadius: 6,
      }}
    >
      <span style={{ color: 'var(--color-primary)' }}>{icon}</span>
      <Text strong>{title}</Text>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {desc}
      </Text>
      <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
        去配置 →
      </Text>
    </Link>
  )
}

export function AlertConfigPage() {
  const { tokens } = useSkin()
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const { current, versions, total, loading, error, permissionDenied, reload, page, onPageSizeChange, submit } =
    useAlertConfig()
  // 默认接收人（根兜底）设定：骨架布缆开关（T08-F8，决策 113 口径 C）
  const {
    setting: routeSetting,
    options: routeOptions,
    loading: routeLoading,
    error: routeError,
    saving: routeSaving,
    reload: reloadRouteSetting,
    save: saveRouteSetting,
  } = useRouteSetting()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOpenSeq, setDrawerOpenSeq] = useState(0)
  const [drawerContent, setDrawerContent] = useState('')
  const [detail, setDetail] = useState<AlertmanagerConfigVersionListItem | null>(null)
  const [detailLoaded, setDetailLoaded] = useState<{ id: string; content: string } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

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

  const openMount = (content = '') => {
    setDrawerOpenSeq((s) => s + 1)
    setDrawerContent(content)
    setDrawerOpen(true)
  }

  const handleSubmit = async (content: string) => {
    await submit(content, CURRENT_USER)
    // 决策 60：告警配置仅作用于管理域 default；挂载成功后同步触发变更单生成
    void triggerConfigDrafts(['default'], { prefix: '配置已挂载', onNavigate: () => navigate(CONFIG_PREVIEW_PATH) })
    reload()
  }

  /**
   * 未匹配规则的告警发给谁（原「默认兜底接收人」，T08-F8 / 决策 113 口径 C骨架布缆开关）。
   * 护栏①：选定某个渠道 = 授权平台接管兜底，必须先经二次确认，文案明示注入点（只替换根receiver 单键）。
   * 护栏③：选「不接管」= 停止替换、不删最后写入的值——无阻断交互，保存后明示结果。
   */
  const handleDefaultReceiverChange = (value: number) => {
    const saved = routeSetting?.default_receiver_channel_id ?? NONE_RECEIVER_VALUE
    if (value === saved) return
    if (value === NONE_RECEIVER_VALUE) {
      void saveRouteSetting(null)
        .then(() => message.success('已停止由平台指定默认接收人；最后写入的值保留在配置文件中，可随时手改'))
        .catch((e) => message.error(e instanceof Error ? e.message : '保存失败，请稍后重试'))
      return
    }
    const target = routeOptions.find((o) => o.value === value)
    const targetName = target?.receiverName ?? target?.label ?? String(value)
    modal.confirm({
      title: '确认由平台指定未匹配规则的告警接收人？',
      content:
        `平台将在每次生成配置时，把「没有匹配到任何具体规则的告警」统一发往「${targetName}」；` +
        '你写的具体分流规则不受影响（它们优先于这个兜底）。' +
        '平台只替换这一个值：不触碰 group_by / group_wait / group_interval / repeat_interval / continue，也不写入具体分流规则。',
      okText: '确认指定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await saveRouteSetting(value)
          message.success(`已选定：未匹配规则的告警发往「${targetName}」`)
        } catch (e) {
          message.error(e instanceof Error ? e.message : '保存失败，请稍后重试')
        }
      },
    })
  }

  /**
   * 路由规则由谁维护（T08-F12）：handwritten（我手写）/ managed（平台管理）。
   * 护栏 §11.6：切到 handwritten 不会删除已生成的路由内容，仅改变后续生成归属（平台不再覆盖）；
   * 切到 managed 则平台接管，你在「路由规则」页可视化编辑。
   * 切换即二次确认，文案明示两种模式的产物归属差异；保存时把 mode 一并写入 route-setting。
   */
  const handleRouteModeChange = (mode: RouteMode) => {
    const currentId = routeSetting?.default_receiver_channel_id ?? null
    const toManaged = mode === 'managed'
    modal.confirm({
      title: toManaged ? '切换为「平台管理」路由规则？' : '切换为「我手写」路由规则？',
      content: toManaged
        ? '平台将接管路由规则（含兜底接收人在内的整棵路由树），你在「路由规则」页可可视化编辑并保存；此后手写改动会被平台生成内容覆盖。'
        : '切换为我手写后，平台停止生成路由规则、完全交由你手写维护。注意：切换不会删除已生成的路由内容，仅改变后续生成归属。',
      okText: '确认切换',
      cancelText: '取消',
      onOk: async () => {
        try {
          await saveRouteSetting(currentId, mode)
          message.success(
            toManaged ? '已切换为「平台管理」：平台接管路由规则' : '已切换为「我手写」：路由规则交由你手写维护（已生成内容保留）',
          )
        } catch (e) {
          message.error(e instanceof Error ? e.message : '保存失败，请稍后重试')
        }
      },
    })
  }

  /**
   * 策略卡状态句（提案 §6.3）：把三个控件的语义关系压成一句话，避免用户读Tag 自己拼——
   *   路由规则由谁维护（手写 / 平台管理）+ 未匹配规则的告警发给谁（是否平台接管）。
   * 该句刻意点明「手写模式下平台仍会接管兜底接收人单键」这一非直觉事实
   * （根兜底接管不判 mode，见 notify_route_skeleton.go 门禁）。
   */
  const policySummary = useMemo(() => {
    const managed = routeSetting?.mode === 'managed'
    const routePart = managed ? '路由规则由平台管理' : '路由规则由你手写维护'
    if (!routeSetting) return `${routePart}；正在读取默认接收人设定…`
    if (routeSetting.effective_source === 'none') {
      return `${routePart}；未匹配任何规则的告警暂未指定接收人（平台不接管兜底）。`
    }
    const receiver = routeSetting.effective_receiver_name
    const source = ROUTE_SOURCE_LABEL[routeSetting.effective_source]
    const takeover = routeSetting.enabled ? '平台已接管' : '平台尚未接管，建议指定'
    return `${routePart}；未匹配任何规则的告警发往 ${receiver}（${source}，${takeover}）。`
  }, [routeSetting])

  /**
   * 是否为「平台管理」模式（提案 §7.4）：决定高级区「手写配置说明」的内容——
   * managed 只讲「抑制规则是三块必写中唯一未 UI 化项」；handwritten 才展开完整三块必写 + 两块豁免。
   */
  const isManagedMode = routeSetting?.mode === 'managed'

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
      // 2026-10-02 用户意见：删除「重新挂载此版本」——重新提交历史配置改走
      // 「查看内容 → 在抽屉里改 → 导入整份配置文件」，与首屏导入入口同一条路径。
      // 操作列随之收窄为只读查看（宽度同步下调）。
      title: '操作',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => (
        <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openVersionDetail(r)}>
          查看
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
        {/* 页头 + 说明区（四页统一，见 components/PageIntro.tsx）。
            **页头不挂主按钮**——「导入整份配置文件」是三层模型第③ 层（永久逃生舱，PRD §11.6），
            降级为默认收起的高级区入口（提案 §7.3 方案 A）。`extra` 留空即为此故。*/}
        <PageIntro
          testId="alert-config-intro"
          title="告警配置"
          subtitle="设置「告警发给谁、按什么条件分」；改动经配置中心（M09）变更单，确认后统一下发生效"
          // 刻意不写「已启用渠道的接收人由平台自动写入」——同一事实在手写说明引导句里已说，
          // 且动线卡已给出「通知渠道」入口；此处复述即噪音（2026-10-02 去重原则：每个事实只在一处说）。
          points={[
            '本页管两件事：未匹配任何规则的告警发给谁，以及路由规则由你手写还是由平台管理。',
            <>
              告警规则（什么情况下算告警）在「规则编辑」维护，本页只管「告警发给谁、怎么收敛」。{' '}
              <RuleGuideLink />
            </>,
            '所有改动都不会即时生效：提交后进入配置中心（M09）变更单，人工确认后统一下发。',
          ]}
        />

        {/* 错误条置于数据区之前：问题优先可见。 */}
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

        {/* ① 策略卡（提案 §7.3，提级为首屏第一卡）：两个治理策略控件脱离「版本元数据」卡，
            独占一张卡；顶部一行状态句把两者语义关系压成一句话（§6.3：手写模式下平台仍接管兜底单键）。 */}
        <Card
          title={ALERT_POLICY_CARD_TITLE}
          style={{ marginBottom: 16 }}
          data-testid="alert-policy-card"
        >
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text
              type="secondary"
              style={{ display: 'block', paddingLeft: 10, borderLeft: `3px solid ${tokens.colorInfo}`, lineHeight: 1.6 }}
              data-testid="policy-summary"
            >
              {policySummary}
            </Text>

            {/* 控件一：未匹配规则的告警发给谁（原「默认兜底接收人」，去技术化术语） */}
            <Space size={8} align="center" wrap>
              <Text strong>{ALERT_POLICY_FALLBACK_LABEL}</Text>
              <Select<number>
                aria-label={ALERT_POLICY_FALLBACK_LABEL}
                value={routeSetting?.default_receiver_channel_id ?? NONE_RECEIVER_VALUE}
                options={routeOptions}
                loading={routeLoading}
                disabled={routeLoading || routeSaving}
                style={{ minWidth: 360 }}
                onChange={handleDefaultReceiverChange}
              />
              {routeSetting?.enabled ? <Tag color="success">平台接管中</Tag> : null}
            </Space>

            {/* 控件二：路由规则由谁维护（原「路由规则作者模式」）。用 Segmented 表达「二选一模式」而非
                Switch 的「开/关」——Switch 语义上无法表达两种模式的互斥选择（用户 2026-10-02 拍板）。 */}
            <Space size={8} align="center" wrap>
              <Text strong>{ALERT_POLICY_ROUTE_MODE_LABEL}</Text>
              <Segmented
                aria-label={ALERT_POLICY_ROUTE_MODE_LABEL}
                value={routeSetting?.mode === 'managed' ? 'managed' : 'handwritten'}
                disabled={routeLoading || routeSaving}
                options={[
                  { label: ALERT_POLICY_MODE_HANDWRITTEN, value: 'handwritten' },
                  { label: ALERT_POLICY_MODE_MANAGED, value: 'managed' },
                ]}
                onChange={(value) => handleRouteModeChange(value as RouteMode)}
              />
            </Space>

            {routeError ? (
              <Text type="danger">
                默认接收人设定加载失败：{routeError}{' '}
                <Button size="small" type="link" onClick={reloadRouteSetting}>
                  重试
                </Button>
              </Text>
            ) : routeSetting ? (
              routeSetting.effective_source === 'none' ? (
                <Text type="secondary">
                  当前无生效默认接收人（无已启用渠道，或选定渠道已停用 / 被删除）——平台不接管兜底接收人，配置产物不变。
                </Text>
              ) : (
                <Text type="secondary">
                  {ALERT_POLICY_FALLBACK_LABEL}当前为
                  <Text strong>{routeSetting.effective_receiver_name}</Text>
                  （来源：{ROUTE_SOURCE_LABEL[routeSetting.effective_source]}）
                  {routeSetting.enabled ? '。' : '；未指定时平台不接管，配置产物零变化。'}
                </Text>
              )
            ) : null}

            {/* 诚实口径（决策 113 第 3/4 条）：平台只替换兜底接收人这一个值，绝不触碰节奏字段 / continue /
                具体分流规则；避免制造「全自动」错觉。 */}
            <Text
              type="secondary"
              style={{ display: 'block', paddingLeft: 10, borderLeft: `3px solid ${tokens.colorInfo}`, lineHeight: 1.6 }}
            >
              指定之后，平台只在生成配置时把「没匹配到任何具体规则的告警」统一发往它；你已有的具体分流规则不受影响、且优先于它。平台不会改动你的分组、发送节奏等其它设置。
            </Text>
          </Space>
        </Card>

        {/* ② 动线卡（提案 §7.3）：回答「我该去哪配」。原页面无任何跨页动线，用户只能靠左侧菜单猜。
            抑制规则为「三块必写」中唯一未 UI 化项（dev-feedback #37），本期只标注不实现、
            **不静默消失**（否则用户以为配完了）。 */}
        <Card
          title={ALERT_GUIDE_CARD_TITLE}
          style={{ marginBottom: 16 }}
          data-testid="alert-guide-card"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <GuideLink to={NOTIFY_CHANNELS_PATH} icon={<ApiOutlined />} title="通知渠道" desc="谁收到告警" testId="guide-channels" />
            <GuideLink to="/routes" icon={<ApartmentOutlined />} title="路由规则" desc="按什么条件分发" testId="guide-routes" />
            <GuideLink to={NOTIFY_TEMPLATES_PATH} icon={<FileTextOutlined />} title="通知模板" desc="通知长什么样" testId="guide-templates" />
            {/* 缺口显式化：抑制规则无独立 UI（#37），不静默消失 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }} data-testid="guide-inhibit">
              <Text strong style={{ color: 'var(--color-text-tertiary)' }}>告警抑制</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>根因告警发生时自动抑制次生告警</Text>
              <Tag color="warning">{ALERT_GUIDE_INHIBIT_COMING}</Tag>
            </div>
          </div>
        </Card>

        {/* ③ 现状卡（提案 §7.3 瘦身）：只讲「现在生效的是什么」——一行状态摘要 + 版本元数据；
            完整 YAML 降为默认折叠（原为 maxHeight 420 常驻展开，是首屏YAML 散落的源头之一）。 */}
        <Card
          title="当前生效"
          extra={
            current && current.applied_at ? (
              <Tag color="processing">生效于 {current.applied_at} 由 {current.applied_by ?? '-'} 提交</Tag>
            ) : null
          }
          style={{ marginBottom: 16 }}
          data-testid="alert-current-card"
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Text type="secondary">加载中…</Text>
            </div>
          ) : current && current.content ? (
            <>
              <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="状态">{renderConfigStatus(current)}</Descriptions.Item>
                <Descriptions.Item label="版本 ID">
                  <Text code>{current.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="生效时间">{current.applied_at ?? '-'}</Descriptions.Item>
              </Descriptions>
              {/* 完整配置改为默认折叠：多数用户只需知道「生效了哪一版」，YAML 属高级查看诉求。 */}
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'yaml',
                    label: (
                      <Space size={8}>
                        <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                        <Text>查看完整配置内容</Text>
                        <Tag>只读</Tag>
                      </Space>
                    ),
                    children: (
                      <>
                        <Space size={8} style={{ marginBottom: 8 }} wrap>
                          <Text type="secondary" style={{ fontSize: 12 }}>应用人：{current.applied_by ?? '-'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            变更单：{current.source_change_no ?? '-'}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            校验和：<Text code>{shortChecksum(current.checksum)}</Text>
                          </Text>
                        </Space>
                        <pre style={yamlBlockStyle}>{current.content}</pre>
                      </>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Empty description="当前无生效配置。可在下方「高级」区导入整份配置文件，或先用「通知渠道」「路由规则」在界面上配置。" />
          )}
        </Card>

        {/* ④ 配置版本历史（2026-10-02 用户意见：从高级区提出为常驻卡）：内容侧留痕是全局能力，
            与「平台为渠道生成的接收人」（那是渠道页的产物列）和手写逃生舱都无关，故不藏在高级折叠里。
            位置：现状卡之后（先看现在生效什么 → 再看历史上过什么）、高级区之前。*/}
        <Card
          title={
            <Space size={8} wrap>
              <HistoryOutlined />
              配置版本历史
              <Tag>内容侧留痕</Tag>
            </Space>
          }
          extra={<Text type="secondary" style={{ fontSize: 12 }}>每次导入都会存一版，可查看内容留痕</Text>}
          style={{ marginBottom: 16 }}
          data-testid="alert-versions-card"
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

        {/* ⑤ 高级区（提案 §7.3，默认收起）：整份文件导入 + 手写配置说明。
            整份文件导入是三层模型第③ 层（永久逃生舱，PRD §11.6）——**降级不删除**。
            2026-10-02 用户意见：「平台自动生成的接收人」已迁至「通知渠道」页（作为渠道表格的
            「平台接收人」列，明细/复制走该页行内「接收人配置」抽屉）——它是渠道的产物、只在
            渠道上下文里有意义，故不再以只读面板形式重复出现在本页高级区。 */}
        <Collapse
          size="small"
          style={{ marginBottom: 16 }}
          data-testid="alert-advanced-collapse"
          items={[
            {
              key: 'advanced',
              label: (
                <Space size={8} wrap data-testid="advanced-collapse-label">
                  <UploadOutlined style={{ color: tokens.colorInfo }} />
                  <Text strong>{ALERT_ADVANCED_CARD_TITLE}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    高级用户用：直接上传或粘贴完整 alertmanager.yml
                  </Text>
                </Space>
              ),
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  {/* 导入入口：原页头主按钮「挂载新配置」在此降级为普通按钮（不再是页面主操作）。
                      不再叠一层「导入整份配置文件」粗体标题——外层折叠标题已含同一句，重复即噪音。 */}
                  <div>
                    <Space size={8} wrap style={{ marginBottom: 8 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        上传或粘贴完整 alertmanager.yml，覆盖当前配置；校验通过后进入变更确认
                      </Text>
                    </Space>
                    <Button icon={<UploadOutlined />} onClick={() => openMount()} data-testid="import-config-button">
                      {ALERT_ADVANCED_IMPORT_LABEL}
                    </Button>
                  </div>

                  {/* 手写配置说明（按 mode 条件化，提案 §7.4）：managed 只讲抑制规则缺口，
                      handwritten 才展开完整「三块必写 + 两块豁免 + 最小骨架」。
                      抑制规则是三块必写中唯一未 UI 化项（dev-feedback #37），故不得整体删除本区。
                      2026-10-02：内层label 必须 stopPropagation —— 否则点击会冒泡到外层高级区
                      Collapse 的 header，把整个高级区收起（嵌套 Collapse 的经典坑）。 */}
                  <div onClick={stopHeaderClick}>
                    <Collapse
                      ghost
                      size="small"
                      items={[
                      {
                        key: 'guide',
                        label: (
                          <Space size={8} data-testid="guide-collapse-label">
                            <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                            <Text>{ALERT_ADVANCED_GUIDE_TITLE}</Text>
                          </Space>
                        ),
                        children: (
                          <div
                            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                            data-testid="handwritten-guide-content"
                          >
                            {isManagedMode ? (
                              <Text type="secondary">{ALERT_ADVANCED_GUIDE_MANAGED}</Text>
                            ) : (
                              <>
                                <Text>{ALERT_ADVANCED_GUIDE_HANDWRITTEN_INTRO}</Text>
                                <div>
                                  <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                                    {ALERT_CONFIG_REQUIRED_BLOCKS.map((block) => (
                                      <li key={block.key} style={{ marginBottom: 4 }}>
                                        <Text strong>{block.title}</Text>
                                        <Text code style={{ margin: '0 6px' }}>{block.fields}</Text>
                                        <Text type="secondary">{block.desc}</Text>
                                        {block.path ? (
                                          <Text type="secondary">
                                            ，前往<Link to={block.path}>{block.linkText ?? '详情'}</Link>
                                          </Text>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ol>
                                </div>
                                <div>
                                  <Text strong>这两块不用你写：</Text>
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
                                    <Tag color="processing">已通过配置校验</Tag>
                                  </Space>
                                  <pre style={{ ...yamlBlockStyle, maxHeight: 320 }}>{ALERTMANAGER_MIN_SKELETON}</pre>
                                  <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                                    点上方「{ALERT_ADVANCED_IMPORT_LABEL}」后，可在抽屉里用「插入骨架示例」一键填入这份骨架。
                                  </Text>
                                </div>
                              </>
                            )}
                          </div>
                        ),
                      },
                    ]}
                    />
                  </div>
                </Space>
              ),
            },
          ]}
        />

        <AlertConfigDrawer
          key={drawerOpenSeq}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          initialContent={drawerContent}
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