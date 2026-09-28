/**
 * 跨模块「去写规则」引导（Module_08 PL-1，裁决 D-1 方案丙）。
 *
 * 规则编辑（rules.yml / MonitoringRule）归属 M01「采集策略」，导航与页面归属**零变更**；
 * M08 告警三页仅提供跨模块联动入口。本组件为三处（告警状态页空态 / 历史告警页空态 /
 * 告警配置页说明卡）共用，统一落点与文案，避免各页散点手写链接导致口径漂移。
 *
 * 空态写法与既有 M09「去网域纳管」「去配置拨测任务」等 `Empty + Link` 引导同构
 * （参见 pages/config-center/nodes/EdgeAgentsPage.tsx、pages/home/ProbePanel.tsx）。
 */
import type { ReactNode } from 'react'
import { Empty } from 'antd'
import { Link } from 'react-router-dom'

/** 规则编辑页路由（M01 采集策略 · 规则编辑；方案丙：不迁移、兜底归属不变） */
export const RULES_PATH = '/rules'

/** 统一引导链接文案 */
export const RULE_GUIDE_TEXT = '去写规则 →'

/** 空态引导前置语（与设计提案 §3.1.2 用户原话一致） */
export const RULE_GUIDE_PREFIX = '还没有告警规则？'

/** 行内引导链接：`去写规则 →`，供说明卡等行内场景引用 */
export function RuleGuideLink({ prefix }: { prefix?: ReactNode }) {
  return (
    <span>
      {prefix}
      <Link to={RULES_PATH}>{RULE_GUIDE_TEXT}</Link>
    </span>
  )
}

/** 空态引导：Empty（简洁图 + description）下方挂「还没有告警规则？去写规则 →」 */
export function RuleGuideEmpty({ description }: { description: ReactNode }) {
  return (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
      <RuleGuideLink prefix={RULE_GUIDE_PREFIX} />
    </Empty>
  )
}

export default RuleGuideLink