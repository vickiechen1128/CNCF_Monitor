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

/**
 * 配置版本**收录**状态（AlertmanagerConfigVersion.status），本表恒为 applied（决策 60）。
 *
 * **不得据此声称「已生效」**（dev-feedback §25）：该状态在 M08 挂载（Submit/Remount）**落库那一刻**
 * 即置位，而此刻磁盘 `config-output/alertmanager.yml` 尚未更新、Alertmanager 仍加载旧文件；真正
 * 写盘 + reload 发生在 M09「确认下发」（ConfirmDraft）之后。故此处只表述「已收录」——即已被收录为
 * M09 生成配置的源数据，不承诺已生效；页面展示一律走 `configStatusView()`（按 `applied_at` 派生）。
 */
export const configStatusLabel: Record<AlertmanagerConfigStatus, string> = {
  applied: '已收录',
}

export const configStatusColor: Record<AlertmanagerConfigStatus, string> = {
  applied: 'default',
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

/** 状态展示：已提交收录、但尚未下发写盘（status 已 applied，applied_at 仍为空） */
export const CONFIG_STATUS_PENDING_LABEL = '已提交，待确认下发'

/** 「待确认下发」指引（用户语言，不含 applied_at / status 等技术字段名；末尾「前往」接跳转入口） */
export const CONFIG_STATUS_PENDING_TIP =
  '配置已提交收录，尚未写入 Alertmanager，需确认下发后才会生效。前往'

/** 配置状态派生视图（展示色随状态：已生效=成功绿 / 待确认下发=警示橙） */
export interface ConfigStatusView {
  label: string
  color: string
  /** 是否已真正生效（applied_at 有值） */
  applied: boolean
}

/**
 * 按 `applied_at` 派生配置状态展示（dev-feedback §25 方案 A 前端侧）：
 * 有值 → 「已生效」；为空 / 缺失 → 「已提交，待确认下发」。
 *
 * 契约未变、wire 字段未变，仅展示口径改由真实生效信号派生，消除「看到 applied 以为已生效」的误判。
 */
export function configStatusView(appliedAt?: string | null): ConfigStatusView {
  return isConfigApplied(appliedAt)
    ? { label: CONFIG_STATUS_APPLIED_LABEL, color: 'success', applied: true }
    : { label: CONFIG_STATUS_PENDING_LABEL, color: 'warning', applied: false }
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

/**
 * 用户在**手写整份 alertmanager.yml 时**需要写的三块
 * （口径与服务端 amtool 校验一致，不承诺校验器不校验的字段）。
 *
 * 术语口径（设计提案 alert-config-three-layer-model.md §7.5，2026-10-02 IA 重构）：
 *   - 块名用 Alertmanager 官方中文名（「告警抑制」），不造「收敛（告警抑制）」这类复合词；
 *   - `fields` 字段名**只在本高级区出现**，动线卡 / 策略卡等用户视图一律不出现。
 */
export const ALERT_CONFIG_REQUIRED_BLOCKS: AlertConfigScopeBlock[] = [
  {
    key: 'receivers',
    title: '接收人',
    fields: 'receivers',
    // 「已启用渠道由平台自动写入」的口径只在引导句（ALERT_ADVANCED_GUIDE_HANDWRITTEN_INTRO）说一次，
    // 此处只说「你手写时要注意什么」——避免同一事实两处表述。
    desc: '仅在需要自定义接收人时才手写；不得与渠道自动生成的接收人重名（重名会导致配置校验失败）',
    path: NOTIFY_CHANNELS_PATH,
    linkText: '通知渠道',
  },
  {
    key: 'route',
    title: '路由规则',
    fields: 'route / routes',
    desc: '按什么标签分发给谁、怎么分组、多久重复（group_by / group_wait / group_interval / repeat_interval）',
    path: null,
  },
  {
    key: 'inhibit_rules',
    title: '告警抑制',
    fields: 'inhibit_rules',
    // 「平台已为边缘站点离线等场景自动生成」只在托管模式引导句里说一次，此处不重复。
    desc: '存在根因告警时，自动抑制它引发的次生告警以降噪；平台已生成的规则按需补充即可',
    path: null,
  },
]

/**
 * 明确**豁免的两块**：静默由「静默管理」页承载、模板内容由PL-3「通知模板」页承载，
 * 二者均给出平台内替代入口（迭代二 PL-3 落地后回补模板入口，关闭 dev-feedback #14）。
 */
export const ALERT_CONFIG_EXEMPT_BLOCKS: AlertConfigScopeBlock[] = [
  {
    key: 'silences',
    title: '静默',
    fields: '',
    desc: '静默是 Alertmanager 的运行时状态，由「静默管理」页即时控制生效，不需要写进配置文件',
    path: SILENCES_PATH,
    linkText: '静默管理',
  },
  {
    key: 'templates',
    title: '通知模板内容',
    fields: '',
    desc: '通知模板由「通知模板」页独立管理，平台自动引用，你不用手写模板文件',
    path: NOTIFY_TEMPLATES_PATH,
    linkText: '通知模板',
  },
]

// =====================================================================
// 告警配置页信息架构（设计提案 alert-config-three-layer-model.md §7.3 方案 A，2026-10-02 用户拍板）
//
// 页面职责由「文件挂载中心」改为「策略 + 动线 + 现状 + 高级」四段：
//   ① 策略卡（提级为首屏第一卡）：未匹配规则的告警发给谁 + 路由规则由谁维护（二选一模式）；
//   ② 动线卡：回答「我该去哪配」；
//   ③ 现状卡（瘦身）：一行状态摘要，完整 YAML 默认折叠；
//   ④ 高级区（默认收起）：导入整份配置文件 / 派生预览 / 版本历史。
// 页头不再挂 type="primary" 主按钮——「导入整份配置文件」是三层模型里的第③ 层（逃生舱），
// 不应是页面的主操作（PRD §11.6：手写= 永久逃生舱，降级不删除）。
// =====================================================================

/** 策略卡标题 */
export const ALERT_POLICY_CARD_TITLE = '路由与收敛策略'

/** 策略卡控件：未匹配任何规则的告警发给谁（原「默认兜底接收人」，去「兜底/接收人」双术语） */
export const ALERT_POLICY_FALLBACK_LABEL = '未匹配规则的告警发给谁'

/** 策略卡控件：路由规则由谁维护（原「路由规则作者模式」，「作者模式」为实现视角术语） */
export const ALERT_POLICY_ROUTE_MODE_LABEL = '路由规则由谁维护'

/** 模式二选一选项（用户语言；刻意不用「接管」——接管暗示冲突，实为二选一） */
export const ALERT_POLICY_MODE_HANDWRITTEN = '我手写'
export const ALERT_POLICY_MODE_MANAGED = '平台管理'

/** 动线卡标题 */
export const ALERT_GUIDE_CARD_TITLE = '我要做的事'

/** 动线项：抑制规则尚未 UI 化（dev-feedback #37）——本期只标注不实现，不静默消失 */
export const ALERT_GUIDE_INHIBIT_COMING = '即将支持'

/** 高级区标题（默认收起） */
export const ALERT_ADVANCED_CARD_TITLE = '高级：导入整份配置文件'

/** 高级区入口按钮（原页头主按钮「挂载新配置」；「挂载」是 K8s 术语，产品侧无对应心智） */
export const ALERT_ADVANCED_IMPORT_LABEL = '导入整份配置文件'

/** 高级区折叠面板：手写配置说明（原「写配置前必读：三块必写 + 两块豁免」，按 mode 条件化） */
export const ALERT_ADVANCED_GUIDE_TITLE = '手写配置说明'

/**
 * 手写配置说明的引导句（**按 mode 条件化**）。
 *
 * 2026-10-02 用户意见「文字重复性很高」后的去重原则：**每个事实只在一处说**——
 *   - 「路由规则由谁维护」已在策略卡 + `policySummary` 说过 → 本区不再复述；
 *   - 「已启用渠道的接收人由平台自动写入」是三块必写里唯一需要额外解释的一条 → 只在此处说一次；
 *   - 抑制规则的「平台已自动生成边缘站点离线等场景」只在托管模式引导句里说一次。
 * 本区只回答一个问题：**我手写时要写哪几块、每块管什么、哪些不用写。**
 */
export const ALERT_ADVANCED_GUIDE_HANDWRITTEN_INTRO =
  '已启用渠道的接收人由平台自动写入，通常不用手写。整份配置里，你只需关注这三块（字段名仅在此处出现）：'

/**
 * 托管模式下的引导句：此时三块必写里的route + inhibit_rules 由平台生成，
 * 唯一还需手写的是**自定义告警抑制规则**（dev-feedback #37：抑制规则尚未 UI 化）。
 * 不复述「路由规则由平台管理」（策略卡已说），不自指「才使用下方的手写说明」（本区就是它）。
 */
export const ALERT_ADVANCED_GUIDE_MANAGED =
  '路由分流与告警抑制规则已由平台自动生成，通常无需手写配置。抑制规则暂未提供界面入口，仅当需要自定义时可参考下面三块。'

/**
 * 最小可运行 `alertmanager.yml` 骨架（说明卡展示 + 挂载抽屉「插入骨架示例」共用）。
 *
 * 三块必写齐全（receivers / route+routes / inhibit_rules），已用上游 `amtool check-config`
 * 校验 SUCCESS（语法 + route/receiver 引用闭合 + receiver 字段类型）；`global` 仅最简
 * `resolve_timeout`（邮件渠道才需 smtp_*，属「按需最简」不列为必写块）。
 *
 * receivers 段为**手写自定义 receiver 示例**（B 路线：平台会为已启用渠道自动写入接收人，
 * 手写仅用于自定义场景）：`channel` 是**醒目占位符**（真实渠道 ID 是数字串，勿写成 ch-*）；
 * 桥令牌**绝不写进 URL query**，改走 `http_config.authorization`（type: Bearer）请求头。
 */
export const ALERTMANAGER_MIN_SKELETON = `# 本骨架已通过 amtool 校验。已启用渠道的接收人由平台在生成配置时自动写入，一般无需手写。
# 下方 receivers 为「自定义接收人」手写示例：channel 为数字串占位符；桥令牌走 http_config.authorization 头，勿写进 URL。
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
  # 已启用渠道的接收人由平台自动写入；此处仅在需要自定义 receiver 时手写，
  # 且不得与渠道自动生成的 receiver 名重名（重名会导致配置校验失败）。
  - name: default
    webhook_configs:
      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?channel=REPLACE_WITH_CHANNEL_ID'
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials: REPLACE_WITH_BRIDGE_TOKEN
  - name: sre-critical
    webhook_configs:
      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?channel=REPLACE_WITH_CHANNEL_ID'
        send_resolved: true
        http_config:
          authorization:
            type: Bearer
            credentials: REPLACE_WITH_BRIDGE_TOKEN

inhibit_rules:
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="warning"']
    equal: ['network_domain']
`

// =====================================================================
// 平台为渠道生成的接收人（通知渠道页「平台接收人」列，B 路线 / 决策 74）
//
// 2026-10-02 用户意见：原先以只读面板形式挂在**告警配置页**高级区，语义割裂（它是渠道的产物，
// 与告警策略/路由无关），且与通知渠道页行内「接收人配置」抽屉形成「同源能力两份」。
// 现改为通知渠道页表格的一列：列内只给结论（接收人名 / 模板绑定 / 可用性），
// 片段 YAML 与复制仍由行内抽屉承载（单一来源）。
// 术语口径（提案 §7.5）：「派生」是技术词，用户视图一律说「平台接收人」。
// =====================================================================

/** 通知渠道表格「平台接收人」列标题（用户视图：不出现「派生」） */
export const CHANNEL_DERIVED_RECEIVER_COLUMN_TITLE = '平台接收人'

/** 列内取不到派生行时的兜底（渠道已启用但片段接口未返回，异常态） */
export const CHANNEL_DERIVED_RECEIVER_EMPTY = '暂不可见'

/** 列内权限不足（片段含平台内部凭据，仅管理员可获取；渠道接收人仍由平台自动写入） */
export const CHANNEL_DERIVED_RECEIVER_FORBIDDEN =
  '接收人片段含平台内部凭据，仅管理员可查看；渠道接收人仍由平台自动写入，不影响生效。'

/** 桥令牌未配置 → 该接收人当前不可用（Tooltip 展开说明） */
export const CHANNEL_DERIVED_RECEIVER_TOKEN_MISSING =
  '平台尚未配置通知桥令牌，该接收人当前不可用，请联系管理员配置后生效。'

/** 重名提醒（自动接收人名与手写同名会校验失败）；贴在该列下方 */
export const CHANNEL_DERIVED_RECEIVER_RENAME_TIP =
  '请勿在「告警配置」里手写与上表同名（含渠道名归一化后同名）的接收人，重名会导致配置校验失败。'

/** 模板未绑定时的前缀（后接渠道类型中文名，如「回落飞书内置默认模板」） */
export const CHANNEL_TEMPLATE_BIND_NONE_PREFIX = '回落'

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