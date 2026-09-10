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

// =====================================================================
// 历史告警（v1.13 MVP 增量，M02 §5.4 / M08 §3.1）
// =====================================================================

/** 历史告警状态展示名：firing=触发中 / resolved=已恢复 */
export const alertHistoryStateLabel: Record<AlertHistoryState, string> = {
  firing: '触发中',
  resolved: '已恢复',
}

export const alertHistoryStateColor: Record<AlertHistoryState, string> = {
  firing: 'error',
  resolved: 'success',
}