/**
 * 首页 L1 资源类型区 / L2 应用明细表的**非组件常量与纯函数**（Module_05 §3.1 决策 91）。
 *
 * 单独成 .ts 而非写在组件里：导出常量 + 纯函数与 react-refresh/only-export-components
 * 冲突，且这两处口径（数量量词、子类标题、告警分组）需要被单测直接引用。
 */
import type { PromAlertItem } from '../../types/alertmanager'

/** 资源类型枚举（与 M07 `resource_category` 同源） */
export type ResourceCategoryKey =
  | 'host'
  | 'database'
  | 'middleware'
  | 'application'
  | 'generic_target'

/**
 * L1 五类卡的**固定渲染顺序**（不随接口返回顺序变化）。
 * `dashboard.by_category` 后端已按此顺序返回且五类齐全，前端仍显式排序，
 * 避免接口顺序变化导致版式漂移。
 */
export const L1_CATEGORY_ORDER: ResourceCategoryKey[] = [
  'host',
  'database',
  'middleware',
  'application',
  'generic_target',
]

interface CategoryMeta {
  /** 卡片标题（中文用户语言） */
  label: string
  /**
   * 类型徽标：**单字**（视觉定版）。
   * 三个线性图标（数据库 / 中间件 / 应用服务）在 26px 容器里形态接近、扫读辨识成本高；
   * 改用类型首字 + 品牌青浅底，一眼可辨，也不与右侧大数字争视觉权重。
   */
  badge: string
  /**
   * 数量量词（视觉定版）：主机用「台」，**其余类型留空**。
   * 「个」在 `/ 26 个已采` 里只增视觉噪音不增信息；主机保留「台」是因为它同时承载
   * 「机器」这一物理语义。量词只出现在「已采 / 总数」一处，「未采 N」不重复量词。
   */
  unit: string
  /**
   * 子类区小标题；`null` 表示该类型**不设子类**——
   * 应用服务不按语言 / 框架拆子类（所有业务指标端点统一归 `application_http`）。
   */
  subtypeTitle: string | null
  /** 不设子类时替代小标题的一行规则说明（避免卡内留白，并讲清「为什么不拆」） */
  subtypeNote?: string
  /** 卡内脚注：只给「本类最容易被误读成成员」的类型写，避免每张卡都挂一句变成噪音 */
  footnote?: string
}

export const L1_CATEGORY_META: Record<ResourceCategoryKey, CategoryMeta> = {
  host: { label: '主机', badge: '主', unit: '台', subtypeTitle: '采集类型子类' },
  database: { label: '数据库', badge: '数', unit: '', subtypeTitle: '采集类型子类' },
  middleware: { label: '中间件', badge: '中', unit: '', subtypeTitle: '采集类型子类' },
  application: {
    label: '应用服务',
    badge: '应',
    unit: '',
    subtypeTitle: null,
    subtypeNote: '单一采集类型 · 不按语言拆',
    // 应用往往同时配了 health_check_url，其拨测目标不入本类
    footnote: '拨测目标不计入本类 ↓',
  },
  generic_target: {
    label: '其他监控目标',
    badge: '其',
    unit: '',
    subtypeTitle: '采集类型子类',
    // 本类的 SNMP / K8s 端点 / 自定义 HTTP 都是「拉指标」端点，拨测走 Blackbox 采集任务
    footnote: '拨测走 blackbox Job，不录入资源台账',
  },
}

/** 应用服务的采集形态示例（**非指标 chip**：只说明 `application_http` 覆盖哪些实现，不参与口径） */
export const APPLICATION_SUBTYPE_EXAMPLES = 'Java Spring / Go / Python'

/** 应用服务「不拆子类」的理由（chip Tooltip 文案） */
export const APPLICATION_SUBTYPE_TIP =
  '业务应用自带指标端点：Spring Boot Actuator / Go client / Python 等实现同归这一类，平台不按语言 / 框架拆分采集类型'

/** 应用服务卡内 `application_http` 子类 chip 的展示名 */
export const APPLICATION_SUBTYPE_LABEL = 'application_http'

/** 子类覆盖率低于该阈值时用橙色语义底警示（PRD §「视觉 Token 规范」） */
export const SUBTYPE_COVERAGE_WARN_THRESHOLD = 70

/**
 * 覆盖率百分数（纯函数）：`monitored ÷ total` 取整。
 * `total` 缺失 / 为 0 时返回 `null` → 调用方渲染 `-`（**不渲染 0%**，避免把「无数据」
 * 表达成「覆盖率为零」）。
 */
export function coveragePercent(monitored: number, total: number): number | null {
  if (!Number.isFinite(monitored) || !Number.isFinite(total) || total <= 0) return null
  return Math.round((monitored / total) * 100)
}

/** 覆盖率展示串：`null` → `-` */
export function coverageText(monitored: number, total: number): string {
  const pct = coveragePercent(monitored, total)
  return pct === null ? '-' : `${pct}%`
}

/** 未采数：总数 − 已采数，负数兜底为 0（接口异常时不显示负数） */
export function uncoveredCount(total: number, monitored: number): number {
  return Math.max(0, total - monitored)
}

/** 仅取当前仍在触发（`firing`）的告警；`pending`（求值中）不计入任何「未恢复」数字 */
export function firingAlerts(alerts: PromAlertItem[]): PromAlertItem[] {
  return alerts.filter((a) => a.state === 'firing')
}

/**
 * L1 各资源类型卡的「未恢复」胶囊数：按 `resource_category` 分组（决策 91，后端零改动）。
 * 无 `resource_category`（空串 / undefined）的告警**不计入任何资源类型卡**，由入口卡附注承载。
 */
export function firingCountByCategory(
  alerts: PromAlertItem[],
  category: ResourceCategoryKey,
): number {
  return firingAlerts(alerts).filter((a) => a.resource_category === category).length
}

/**
 * 入口卡附注数：`firing` 但无 `resource_category` 的告警数——
 * 拨测目标、聚合规则、用户自写规则均无该标签，它们不属于资源台账对象。
 */
export function firingUnclassifiedCount(alerts: PromAlertItem[]): number {
  return firingAlerts(alerts).filter((a) => !a.resource_category).length
}

/**
 * L2 应用明细行的「未恢复」数：按告警标签 `app` 分组。
 *
 * `app` 标签由 M07 默认标签模板注入且**恒取 `app_code`**（决策 92），故这里用 `app_code`
 * 直接匹配。告警未携带 `app` 标签（无资源归属、未命中模板）时不归任何应用行。
 */
export function firingCountByApp(alerts: PromAlertItem[], appCode: string): number {
  if (!appCode) return 0
  return firingAlerts(alerts).filter((a) => a.labels?.app === appCode).length
}

/** 资源清单页深链：按资源类型 + 子类预筛（子类参数名按各类型字段名传，便于列表页客户端过滤） */
export function resourceListHref(
  category: ResourceCategoryKey,
  subtype?: string,
): string {
  const search = new URLSearchParams({ resource_category: category })
  if (subtype) search.set('subtype', subtype)
  return `/resources?${search.toString()}`
}

/** 资源清单页深链：按应用预筛（L2 行「看明细」） */
export function appResourceListHref(appCode: string): string {
  return `/resources?${new URLSearchParams({ app_code: appCode }).toString()}`
}

/** 资源导入入口（L2 空态引导 + 未归类行「去补填」） */
export const RESOURCE_IMPORT_HREF = '/resources?import=1'
