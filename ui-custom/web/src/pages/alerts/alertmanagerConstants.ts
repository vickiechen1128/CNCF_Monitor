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
  NotifyTemplateStatus,
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

// =====================================================================
// 告警配置口径澄清（PL-2，2026-09-28）：三块必写 + 两块豁免 + 最小骨架
// =====================================================================

/** 静默管理页路由（豁免项 ④ 的平台内替代入口：静默是运行时状态，不在 alertmanager.yml 里写） */
export const SILENCES_PATH = '/silences'

/** 告警配置页路由（接收人 / 路由 / 收敛的文件挂载页；逃生门说明指向此处） */
export const ALERT_CONFIG_PATH = '/alert-config'

/** 通知渠道管理页路由（PL-3「通知渠道」能力页） */
export const NOTIFY_CHANNELS_PATH = '/notify-channels'

/** 通知模板管理页路由（PL-3「通知模板」能力页；豁免项 ⑤ 的平台内替代入口） */
export const NOTIFY_TEMPLATES_PATH = '/notify-templates'

/** 说明卡「单块口径」：必写块与豁免块共用形状，避免两处各写一份而漂移 */
export interface AlertConfigScopeBlock {
  key: string
  /** 块名（用户语言） */
  title: string
  /** 对应 `alertmanager.yml` 字段（必写块填写；豁免块为空串） */
  fields: string
  /** 一句话说明（写什么 / 为什么不用写） */
  desc: string
  /** 平台内替代入口路由；必写块或无替代入口的豁免块为 null（null 时只出文案、不产生链接，避免死链） */
  path: string | null
  /** 替代入口链接文案（path 非空时使用；避免渲染层写死「静默管理」造成跨块文案错位） */
  linkText?: string
}

/** 用户在「告警配置」页**必写的三块**（口径与服务端 amtool 校验一致，不承诺校验器不校验的字段） */
export const ALERT_CONFIG_REQUIRED_BLOCKS: AlertConfigScopeBlock[] = [
  {
    key: 'receivers',
    title: '接收人 / 渠道',
    fields: 'receivers',
    // A 路线（用户 2026-09-28 裁决）：receivers 仍由用户填写（平台暂不代生成），但内容来源
    // 改为平台生成——地址与渠道 ID 不要手写，去「通知渠道」页复制「接收人配置」片段填入。
    desc: '告警发给哪个端——地址与渠道 ID 不要手写，在「通知渠道」页登记后复制其「接收人配置」片段填入',
    path: NOTIFY_CHANNELS_PATH,
    linkText: '通知渠道',
  },
  {
    key: 'route',
    title: '路由',
    fields: 'route / routes',
    desc: '按什么标签分发给谁、怎么分组、多久重复（group_by / group_wait / group_interval / repeat_interval）',
    path: null,
  },
  {
    key: 'inhibit_rules',
    title: '收敛（告警抑制）',
    fields: 'inhibit_rules',
    desc: '根因告警存在时自动抑制次生告警以降噪；网域离线场景平台已自动生成 EdgeSiteOffline → inhibitable=true，此处按需增补',
    path: null,
  },
]

/**
 * 明确**豁免的两块**：静默由「静默管理」页承载、模板内容由 PL-3「通知模板」页承载，
 * 二者均给出平台内替代入口（迭代二 PL-3 落地后回补模板入口，关闭 dev-feedback #14）。
 */
export const ALERT_CONFIG_EXEMPT_BLOCKS: AlertConfigScopeBlock[] = [
  {
    key: 'silences',
    title: '静默（silences）',
    fields: '',
    desc: '平台已实现——静默是 Alertmanager 运行时状态，由「静默管理」页直调 v2 API 即时生效，文件挂载本来就承载不了',
    path: SILENCES_PATH,
    linkText: '静默管理',
  },
  {
    key: 'templates',
    title: '通知模板内容（templates）',
    fields: '',
    desc: '由「通知模板」页独立承载并经平台生成引用，用户不再手写模板文件',
    path: NOTIFY_TEMPLATES_PATH,
    linkText: '通知模板',
  },
]

/**
 * 最小可运行 `alertmanager.yml` 骨架（说明卡展示 + 挂载抽屉「插入骨架示例」共用）。
 *
 * 三块必写齐全（receivers / route+routes / inhibit_rules），已用上游 `amtool check-config`
 * 校验 SUCCESS（语法 + route/receiver 引用闭合 + receiver 字段类型）；`global` 仅最简
 * `resolve_timeout`（邮件渠道才需 smtp_*，属「按需最简」不列为必写块）。
 *
 * receivers 段的 `channel` 与 `token` 是**醒目占位符**（`REPLACE_WITH_*`），不是可用值：
 * 早前写成 `channel=ch-default` 会让用户误信渠道 ID 是 `ch-*` 形式而照抄失败（真实渠道 ID
 * 是数字串）。使用时到「通知渠道」页点「接收人配置」复制完整片段替换（A 路线：平台只校验、
 * 不托管，也不代生成 receivers）。
 */
export const ALERTMANAGER_MIN_SKELETON = `# 本骨架已通过 amtool 校验。receivers 段渠道 ID 与令牌请勿手写：
# 到「通知渠道」页点「接收人配置」复制片段替换占位符（渠道 ID 为数字串）。
global:
  resolve_timeout: 5m

route:
  receiver: default
  group_by: ['alertname', 'network_domain']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - matchers: ['severity="critical"']
      receiver: sre-critical

receivers:
  # channel / token 请到「通知渠道」页的「接收人配置」复制，勿手写
  - name: default
    webhook_configs:
      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?channel=REPLACE_WITH_CHANNEL_ID&token=REPLACE_WITH_BRIDGE_TOKEN'
        send_resolved: true
  - name: sre-critical
    webhook_configs:
      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?channel=REPLACE_WITH_CHANNEL_ID&token=REPLACE_WITH_BRIDGE_TOKEN'
        send_resolved: true

inhibit_rules:
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="warning"']
    equal: ['network_domain']
`

// =====================================================================
// 通知渲染桥（PL-3，2026-09-28）：通知渠道类型 / 通知模板展示名
// =====================================================================

/** 通知渠道类型展示名（用户语言：飞书 / 钉钉 / 企业微信） */
export const notifyChannelTypeLabel: Record<NotifyChannelType, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
}

export const notifyChannelTypeColor: Record<NotifyChannelType, string> = {
  feishu: 'blue',
  dingtalk: 'cyan',
  wecom: 'green',
}

/** 通知渠道类型下拉选项（Form Select 用，顺序与展示名一致） */
export const NOTIFY_CHANNEL_TYPE_OPTIONS: { value: NotifyChannelType; label: string }[] = [
  { value: 'feishu', label: '飞书' },
  { value: 'dingtalk', label: '钉钉' },
  { value: 'wecom', label: '企业微信' },
]

/** 通知模板状态展示名（先校验、通过才落库留痕，本表恒 applied） */
export const notifyTemplateStatusLabel: Record<NotifyTemplateStatus, string> = {
  applied: '已生效',
}

/** 内置模板提示（内置模板随版本升级、系统统一维护，不可删除） */
export const NOTIFY_TEMPLATE_BUILTIN_TIP = '平台内置模板随版本升级，系统统一维护，不可删除'