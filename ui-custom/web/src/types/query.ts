/**
 * 查询中心领域类型（Module_02 采集状态回显 / 决策 47，api-contract-snapshot.md §2）
 *
 * 本文件为 module-02 前端独占的权威类型出口（T02-F1）：
 * - TargetItem      ：GET /api/v1/targets 单条 target 对象（§2.1.1，透传 Prometheus + network_domain 补全）
 * - CoverageItem    ：GET /api/v1/health/coverage 三态聚合 item（§2.2.1）
 * - CoverageState   ：三态枚举 collecting / pending_down / not_monitored
 * - CoverageSummary ：覆盖率汇总（§2.2.2）
 * 被 module-01（Job 实例采集状态回显）与 module-07（资源列表三态 badge）只读消费。
 */
import type { ResourceCategory } from './resource'

/** Prometheus target 采集状态（§2.1.1） */
export type TargetHealth = 'up' | 'down' | 'unknown'

/** 单条 target 对象（§2.1.1；M02 本地按 job/network_domain/health 过滤并补全 network_domain） */
export interface TargetItem {
  scrapePool: string
  /** 从 discoveryLabels / job 标签解析（≈ job 名） */
  job: string
  /** host:port */
  instance: string
  /** 从注入 network_domain 标签解析补全，缺失回落 default */
  network_domain: string
  /** 采集状态 up / down / unknown */
  health: TargetHealth
  /** 最后采集时间（上游透传） */
  lastScrape?: string
  /** 最后抓取错误，空串表示无 */
  lastError?: string
  /** 采集耗时（秒，上游 lastScrapeDuration） */
  scrapeDuration?: number
  /** 资源 ID（M07 回连键，目标无该标签时字段为空） */
  resource_id?: string
}

/** GET /api/v1/targets 外层 data（对齐 Prometheus targets 响应，§2.1.2） */
export interface TargetsResponse {
  activeTargets: TargetItem[]
  droppedTargets: unknown[]
  targetsByJob: Record<string, unknown>
}

/** coverage 三态枚举（§2.2.1：采集中 / 已下发未采到 / 未监控） */
export type CoverageState = 'collecting' | 'pending_down' | 'not_monitored'

/** GET /api/v1/health/coverage 单条聚合 item（§2.2.1） */
export interface CoverageItem {
  resource_id: string
  resource_category: ResourceCategory
  /** 可读实例名（M01/M07 回显用） */
  instance_name: string
  monitor_state: CoverageState
  /** 未监控时 null */
  health: TargetHealth | null
  /** 最近抓取错误（down 时定位，可选） */
  last_error?: string
}

/** GET /api/v1/health/coverage 覆盖率汇总（§2.2.2） */
export interface CoverageSummary {
  total: number
  collecting: number
  pending_down: number
  not_monitored: number
  /** collecting / total，保留 2 位小数（无资源时 0） */
  coverage_rate: number
}

/** GET /api/v1/health/coverage 响应 data（items 键，§2.2.3） */
export interface CoverageListResponse {
  items: CoverageItem[]
  total: number
  summary: CoverageSummary
}