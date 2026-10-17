/**
 * 首页 L1 资源类型区的**非组件常量与纯函数**（Module_05 §3.1 决策 91）。
 *
 * 单独成 .ts 而非写在组件里：导出常量 + 纯函数与 react-refresh/only-export-components
 * 冲突，且这两处口径（数量量词、覆盖率计算）需要被单测直接引用。
 *
 * 2026-10-17 走查瘦身：随「采集方式细分」子类区一起删除的导出——
 * `subtypeTitle` / `subtypeNote` / `footnote`（CategoryMeta 字段）、
 * `SINGLE_SUBTYPE_CHIP` / `APPLICATION_SUBTYPE_*` / `INTERFACE_SERVICE_SUBTYPE_*`
 * （不设子类类的单条 chip）、`resourceListHref` / `appResourceListHref`
 * （子类 / 应用下钻深链，动线归资源清单页）、`RESOURCE_IMPORT_HREF`
 * （L2 应用明细表空态引导，该表已删）、`firingAlerts`（已删的告警胶囊计数）。
 * `by_category[].by_subtype` 契约字段仍在（后端不变），只是前端不再消费。
 */

/** 资源类型枚举（与 M07 `resource_category` 同源） */
export type ResourceCategoryKey =
  | 'host'
  | 'database'
  | 'middleware'
  | 'application'
  | 'interface_service'
  | 'generic_target'

/**
 * L1 六类表的**固定渲染顺序**（不随接口返回顺序变化）。
 * `dashboard.by_category` 后端已按此顺序返回且六类齐全，前端仍显式排序，
 * 避免接口顺序变化导致版式漂移。
 *
 * 2026-10-17 第五轮走查（产品负责人裁定）：「接口服务」上调至「其他监控目标」
 * **之上**——「其他监控目标」是兜底聚合类（snmp / k8s / custom_http 等混排），
 * 与「未指定平台 / 未指定应用」同类属「读表时放最后」的收尾类；
 * 具体的「接口服务」是拨测主对象之一，应排在兜底类之前。
 */
export const L1_CATEGORY_ORDER: ResourceCategoryKey[] = [
  'host',
  'database',
  'middleware',
  'application',
  'interface_service',
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
}

export const L1_CATEGORY_META: Record<ResourceCategoryKey, CategoryMeta> = {
  host: { label: '主机', badge: '主', unit: '台' },
  database: { label: '数据库', badge: '数', unit: '' },
  middleware: { label: '中间件', badge: '中', unit: '' },
  application: { label: '应用服务', badge: '应', unit: '' },
  generic_target: { label: '其他监控目标', badge: '其', unit: '' },
  interface_service: { label: '接口服务', badge: '接', unit: '' },
}

/** 覆盖率低于该阈值时进度条用橙色语义警示（PRD §「视觉 Token 规范」；颜色不作为唯一语义——行内仍并列百分数） */
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
