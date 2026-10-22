/**
 * Module_08 告警收敛与通知管理 枚举/常量/UI 展示名映射（alertmanager）。
 * 权威契约：docs/05-execution-records/module-08/api-contract-snapshot.md（§6 枚举字典 / §8 UI 展示名）。
 * 用户可见文案遵循 PRD §10 术语映射；技术字段（checksum 等）不下沉为 UI 文案。
 *
 * 待办：CURRENT_USER 为 MVP 预置的应用人/创建人硬编码（decision 19 文档化妥协）；
 * M06 用户管理接入后应删除并改用真实登录账号（见设计决策 19），实现 login 前勿新增硬编码凭据/姓名。
 */
import type {
  AlertHistoryState,
  AlertmanagerConfigStatus,
  NotifyChannelType,
  NotifyStatus,
  PromAlertState,
  SilenceMatcher,
  SilenceStatus,
  ValidateErrorItem,
} from '../../types/alertmanager'
import type { SkinTokens } from '../../skins'

/** 当前登录用户（MVP 预置应用人 / 创建人；用户管理接入后同步为真实用户） */
export const CURRENT_USER = '张伟（运维）'

/** 跨模块跳转落点：M09「配置变更确认」页（管理域 default 变更单在此确认下发，决策 60） */
export const CONFIG_PREVIEW_PATH = '/config-preview'

/** 路由规则页（告警路由的唯一配置入口：用户直接编辑路由树） */
export const ROUTES_PATH = '/routes'

/**
 * 平台内置空接收人（`default`）的展示名。
 *
 * Alertmanager 要求根 route 必须有 receiver，但接收人可以没有任何通知配置：
 * 命中它的告警不会发往任何渠道，属**显式的静默丢弃**。文案必须把这个后果说清楚。
 */
export const DEFAULT_RECEIVER_LABEL = '默认（不通知）'

/**
 * 配置版本**收录**状态（AlertmanagerConfigVersion.status）。
 *
 * 2026-10-13（dev-feedback #44 废弃联动）：由「恒 applied」扩为两态——
 *   - applied：已收录为 M09 下发源。**不得据此声称「已生效」**（dev-feedback §25）：该状态在
 *     M08 挂载（Submit/Remount）**落库那一刻**即置位，而此刻磁盘 `config-output/alertmanager.yml`
 *     尚未更新、Alertmanager 仍加载旧文件；真正写盘 + reload 发生在 M09「确认下发」
 *     （ConfirmDraft）之后。applied 内部再按 `applied_at` 派生两种展示（见 configStatusView）。
 *   - discarded：已废弃终态——变更单被废弃（用户废弃 / 被更新单取代）后，已无活 pending 单
 *     可确认的留痕由后端联动标记；修复前此类留痕 applied_at 永为空，会永久显示
 *     「已提交，待确认下发」（用户实测 id=18 遗留问题）。
 */
export const configStatusLabel: Record<AlertmanagerConfigStatus, string> = {
  applied: '已收录',
  discarded: '已废弃',
}

export const configStatusColor: Record<AlertmanagerConfigStatus, string> = {
  applied: 'default',
  discarded: 'default',
}

/**
 * 配置是否**已真正生效**的**唯一判据**（dev-feedback §25）：
 * `applied_at` 由 M09 确认下发、写盘成功后才回填（挂载时为空的），是「Alertmanager 已加载本版本」的信号。
 */
export function isConfigApplied(appliedAt?: string | null): boolean {
  return typeof appliedAt === 'string' && appliedAt.trim().length > 0
}

/** 状态展示：已真正生效 */
export const CONFIG_STATUS_APPLIED_LABEL = '已生效'

/** 状态展示：已提交收录、但尚未下发写盘（status=applied，applied_at 仍为空） */
export const CONFIG_STATUS_PENDING_LABEL = '已提交，待确认下发'

/**
 * 状态展示：已废弃终态（status=discarded，dev-feedback #44）——变更单被废弃后由后端
 * 联动标记，无活单可确认；恢复需重新挂载（Remount）或修改策略/资源重新触发产草稿。
 */
export const CONFIG_STATUS_DISCARDED_LABEL = '已废弃'

/** 「待确认下发」指引（用户语言，不含 applied_at / status 等技术字段名；末尾「前往」接跳转入口） */
export const CONFIG_STATUS_PENDING_TIP =
  '配置已提交收录，尚未写入 Alertmanager，需确认下发后才会生效。前往'

/** 「已废弃」说明（为何废弃、如何恢复；用户语言，不含技术字段名） */
export const CONFIG_STATUS_DISCARDED_TIP =
  '对应变更单已废弃，本版本不会下发。如需生效请重新挂载，或修改策略/资源后重新生成变更单。'

/** 配置状态派生视图（展示色随状态：已生效=成功绿 / 待确认下发=警示橙 / 已废弃=中性灰） */
export interface ConfigStatusView {
  label: string
  color: string
  /** 是否已真正生效（applied_at 有值） */
  applied: boolean
  /** 是否已废弃终态（status=discarded） */
  discarded: boolean
}

/**
 * 按 `status` + `applied_at` 派生配置状态展示（dev-feedback §25 方案 A 前端侧 +
 * #44 废弃联动）：
 *   - status=discarded → 「已废弃」（终态，不再提示去确认——已无在途单可确认）；
 *   - applied_at 有值 → 「已生效」；
 *   - 其余（status=applied 且 applied_at 为空）→ 「已提交，待确认下发」。
 *
 * 契约未变、wire 字段未变（status / applied_at 均既有字段），仅展示口径补入废弃态，
 * 消除「看到 applied 以为已生效」与「单子已废弃却永远显示待确认」两类误判。
 *
 * status 缺省（老调用方 / 缓存数据）时按 applied 处理，行为与修订前一致。
 */
export function configStatusView(appliedAt?: string | null, status?: AlertmanagerConfigStatus): ConfigStatusView {
  if (status === 'discarded') {
    return { label: CONFIG_STATUS_DISCARDED_LABEL, color: 'default', applied: false, discarded: true }
  }
  return isConfigApplied(appliedAt)
    ? { label: CONFIG_STATUS_APPLIED_LABEL, color: 'success', applied: true, discarded: false }
    : { label: CONFIG_STATUS_PENDING_LABEL, color: 'warning', applied: false, discarded: false }
}

/** 静默状态（Alertmanager 运行时状态，追踪 §6 枚举字典 / §8 UI 展示名） */
export const silenceStatusLabel: Record<SilenceStatus, string> = {
  active: '生效中',
  pending: '待生效',
  expired: '已过期',
}

export const silenceStatusColor: Record<SilenceStatus, string> = {
  active: 'success',
  pending: 'warning',
  expired: 'default',
}

/** 校验错误分区类型（契约 §3：行级错误集合，用于页内分组定位） */
export type ValidateSection = 'syntax' | 'reference' | 'other'

/** 错误分区标题（用户语言，不含决策编号） */
export const validateSectionLabel: Record<ValidateSection, string> = {
  syntax: '配置语法错误',
  reference: '引用闭合错误',
  other: '其他校验错误',
}

export const validateSectionColor: Record<ValidateSection, string> = {
  syntax: 'error',
  reference: 'warning',
  other: 'default',
}

/**
 * 校验错误分区：按 message 关键词启发式归类为「语法错误 / 引用闭合错误 / 其他」。
 * 语法类侧重 YAML 解析（unmarshal / syntax / parse / yaml 行号类），
 * 引用闭合类侧重 route/receiver 引用（referenced / undefined / receiver / route），
 * 其余归 other，兜底保证每条错误都落在某个分区展示。
 */
export function partitionValidateErrors(items: ValidateErrorItem[]): Record<ValidateSection, ValidateErrorItem[]> {
  const syntaxRe = /(yaml|syntax|parse|unmarshal|cannot\s+unmarshal|did\s+not\s+find\s+expected|禁止覆盖|非法)/i
  const referenceRe = /(undefined|referenced|unknown\s+receiver|receiver|route|引用|未定义|不存在的接收人)/i
  return (items ?? []).reduce<Record<ValidateSection, ValidateErrorItem[]>>(
    (acc, item) => {
      const msg = item.message ?? ''
      if (referenceRe.test(msg)) acc.reference.push(item)
      else if (syntaxRe.test(msg)) acc.syntax.push(item)
      else acc.other.push(item)
      return acc
    },
    { syntax: [], reference: [], other: [] },
  )
}

/** tech：matchers 展示串（如 `severity="critical", network_domain=~"gov-*"`） */
export function formatMatchers(matchers: SilenceMatcher[]): string {
  return (matchers ?? [])
    .map((m) => {
      const op = m.is_equal === false ? '!=' : '='
      const regex = m.is_regex ? '~' : ''
      return `${m.name}${op}${regex}"${m.value}"`
    })
    .join(', ')
}

// =====================================================================
// 告警状态查看（v1.12 MVP 增量，契约快照 §10 / 映射表 §8.3 文案对照）
// =====================================================================

/** AM 通知状态四态展示名（服务端归一 notify_status；UI 展示名以契约 §10.2 为准） */
export const notifyStatusLabel: Record<NotifyStatus, string> = {
  active: '通知中',
  silenced: '已静默',
  inhibited: '已抑制',
  unprocessed: '待处理',
}

export const notifyStatusColor: Record<NotifyStatus, string> = {
  active: 'error',
  silenced: 'gold',
  inhibited: 'purple',
  unprocessed: 'default',
}

/** 四态语义说明（统计卡片 / Tag Tooltip 用，沿用原型四态语义） */
export const notifyStatusTip: Record<NotifyStatus, string> = {
  active: '已通过路由计算，正在通知接收人',
  silenced: '被静默规则命中，通知被屏蔽',
  inhibited: '被抑制规则抑制（存在根因告警）',
  unprocessed: '刚进入 Alertmanager，尚未完成路由 / 静默 / 抑制计算',
}

/** Prometheus 当前触发告警状态展示名（契约 §10.1：firing=触发中 / pending=待处理） */
export const promAlertStateLabel: Record<PromAlertState, string> = {
  firing: '触发中',
  pending: '待处理',
}

export const promAlertStateColor: Record<PromAlertState, string> = {
  firing: 'error',
  pending: 'warning',
}

/**
 * 告警级别展示名（标签 labels.severity → 中文）。
 * 权威取值：M09 规则 severity = error / warning（platform/strategy/rule/jobref/jobref.go）；
 * 既有数据与 Alertmanager 侧可能带 critical / warn / info 写法，故做同义归并，
 * 未命中回落原值（原值为空回落 '-'，不猜测语义）。
 */
const SEVERITY_LABELS: Record<string, string> = {
  critical: '严重',
  error: '严重',
  warning: '警告',
  warn: '警告',
  info: '提示',
  notice: '提示',
}

/** 告警级别展示名（用户语言） */
export function severityLabel(severity?: string): string {
  const raw = (severity ?? '').trim()
  if (!raw) return '-'
  return SEVERITY_LABELS[raw.toLowerCase()] ?? raw
}

/** 告警级别 Tag 语义色：严重=红 / 警告=橙 / 提示=蓝 / 未命中=中性（不猜语义，沿用全站语义色名） */
export function severityColor(severity?: string): string {
  switch ((severity ?? '').trim().toLowerCase()) {
    case 'critical':
    case 'error':
      return 'error'
    case 'warning':
    case 'warn':
      return 'warning'
    case 'info':
    case 'notice':
      return 'processing'
    default:
      return 'default'
  }
}

/** 级别色调三档（浅底 / 深字映射的键，与 severityLabel 同一套同义归并） */
export type SeverityTone = 'critical' | 'warning' | 'info'

/** 色调 → 皮肤 token 键（浅底与深字成对声明，避免两处各写一份归并逻辑而漂移） */
const SEVERITY_TOKEN_KEY: Record<SeverityTone, { bg: keyof SkinTokens; text: keyof SkinTokens }> = {
  critical: { bg: 'colorErrorBg', text: 'colorError' },
  warning: { bg: 'colorWarningBg', text: 'colorWarning' },
  info: { bg: 'colorInfoBg', text: 'colorInfo' },
}

/**
 * 告警级别浅底配色（Module_05 §3.1 决策 73：级别 Tag 用浅底色 + 深字替代实底 Tag）。
 *
 * **必须逐次调用，禁止在模块顶层把结果存成常量对象**：
 * 皮肤可在运行时切换（见 `skins.ts` / `SkinProvider.tsx`），token 只有两种合法消费方式——
 * 「作为函数入参传入」或「组件内 `theme.useToken()` / `useSkin().tokens`」。
 * 上一版直接在模块顶层 `import { volcengineTokens }` 拼成常量，等于把配色冻在模块加载那一刻，
 * 切皮肤后告警级别 Tag 会永远停在火山青（React 无从感知该快照已过期）。
 */
export function severityBg(tone: SeverityTone, tokens: SkinTokens): string {
  return tokens[SEVERITY_TOKEN_KEY[tone].bg]
}

/** 告警级别深字配色（与浅底同源：红 / 橙 / 蓝，随皮肤切换） */
export function severityText(tone: SeverityTone, tokens: SkinTokens): string {
  return tokens[SEVERITY_TOKEN_KEY[tone].text]
}

/**
 * 告警级别 → 三档色调（同义归并 error→critical / warn→warning / notice→info）；
 * 未命中返回 null，由调用方渲染中性 Tag（不猜测语义）。
 */
export function severityTone(severity?: string): SeverityTone | null {
  switch ((severity ?? '').trim().toLowerCase()) {
    case 'critical':
    case 'error':
      return 'critical'
    case 'warning':
    case 'warn':
      return 'warning'
    case 'info':
    case 'notice':
      return 'info'
    default:
      return null
  }
}

// =====================================================================
// 历史告警（v1.13 MVP 增量，M02 §5.4 / M08 §3.1）
// =====================================================================

/** 历史告警状态展示名：firing=触发中 / resolved=已恢复 */
export const alertHistoryStateLabel: Record<AlertHistoryState, string> = {
  firing: '触发中',
  resolved: '已恢复',
}

/**
 * history 项与 AM 条目的关联键：告警名 + 采集地址（instance）。
 * Module_05 首页告警卡用它把 M02 history 的 summary 回填到 AM 实时告警行 2（决策 73）。
 */
export function alertMatchKey(alertname?: string, instance?: string): string {
  return `${(alertname ?? '').trim()}|${(instance ?? '').trim()}`
}

export const alertHistoryStateColor: Record<AlertHistoryState, string> = {
  firing: 'error',
  resolved: 'success',
}

// =====================================================================
// 告警模块页面路径
// =====================================================================

/** 告警配置页路由（只读查看当前生效配置与版本历史） */
export const ALERT_CONFIG_PATH = '/alert-config'

/** 通知渠道管理页路由（PL-3「通知渠道」能力页） */
export const NOTIFY_CHANNELS_PATH = '/notify-channels'

/** 通知模板管理页路由（PL-3「通知模板」能力页） */
export const NOTIFY_TEMPLATES_PATH = '/notify-templates'

// =====================================================================
// 平台为渠道生成的接收人（通知渠道页「平台接收人」列，B 路线 / 决策 74）
//
// 2026-10-02 用户意见：原先以只读面板形式挂在**告警配置页**高级区，语义割裂（它是渠道的产物，
// 与告警策略/路由无关），且与通知渠道页行内「接收人配置」抽屉形成「同源能力两份」。
// 现改为通知渠道页表格的一列：列内只给结论（接收人名 / 模板绑定 / 可用性），
// 片段 YAML 与复制仍由行内抽屉承载（单一来源）。
// =====================================================================
// 通知渲染桥（PL-3，2026-09-28）：通知渠道类型 / 通知模板展示名
// =====================================================================

/** 通知渠道类型展示名（用户语言：飞书 / 钉钉 / 企业微信 / 自定义 Webhook） */
export const notifyChannelTypeLabel: Record<NotifyChannelType, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
  webhook: '自定义 Webhook',
}

export const notifyChannelTypeColor: Record<NotifyChannelType, string> = {
  feishu: 'blue',
  dingtalk: 'cyan',
  wecom: 'green',
  webhook: 'geekblue',
}

/** 通知渠道类型下拉选项（Form Select 用，顺序与展示名一致） */
export const NOTIFY_CHANNEL_TYPE_OPTIONS: { value: NotifyChannelType; label: string }[] = [
  { value: 'feishu', label: '飞书' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'wecom', label: '企业微信' },
  { value: 'webhook', label: '自定义 Webhook' },
]

/** 通知模板适用的渠道类型（自定义 Webhook 不使用模板，排除）。 */
export const TEMPLATE_CHANNEL_TYPE_OPTIONS: { value: NotifyChannelType; label: string }[] =
  NOTIFY_CHANNEL_TYPE_OPTIONS.filter((o) => o.value !== 'webhook')

/** 内置模板提示（内置模板随版本升级、系统统一维护，不可编辑/删除） */
export const NOTIFY_TEMPLATE_BUILTIN_TIP = '平台内置模板随版本升级，系统统一维护，不可删除'