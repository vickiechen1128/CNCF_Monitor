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

/** 配置版本状态（AlertmanagerConfigVersion.status），本表恒为 applied（决策 60） */
export const configStatusLabel: Record<AlertmanagerConfigStatus, string> = {
  applied: '已生效',
}

export const configStatusColor: Record<AlertmanagerConfigStatus, string> = {
  applied: 'success',
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