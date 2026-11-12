/**
 * 采集目标状态 API（/api/v1/targets，M09 v3 契约 §7.1）
 *
 * v3 响应为分页信封 `{list,total,page,page_size}`，字段 job/instance/network_domain/
 * instance_name/health/last_scrape/last_error/source；本适配层把单条映射回页面既有的
 * TargetItem（activeTargets 形态），避免 M01/M02 页面因契约换代而重写。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { TargetHealth, TargetItem, TargetsResponse } from '../types/query'

/** GET /api/v1/targets 筛选参数（v3：network_domain / job / health / keyword + 分页） */
export interface TargetsListParams extends Record<string, string | number | boolean | undefined> {
  /** 按 Job 过滤（M01 回显用） */
  job?: string
  /** 按注入标签过滤（v3 参数名仍为 network_domain） */
  network_domain?: string
  /** up / down / unknown */
  health?: TargetHealth
  /** 模糊搜索（前端沿用 search，适配层转换为 v3 的 keyword） */
  search?: string
  page?: number
  page_size?: number
}

/** v3 单条目标视图（契约 §7.1） */
interface TargetResponse {
  job: string
  instance: string
  network_domain: string
  instance_name: string
  health: string
  last_scrape?: string | null
  last_error?: string
  source?: string
}

interface TargetListResponse {
  list?: TargetResponse[]
  total?: number
  page?: number
  page_size?: number
}

/** v3 目标 → 页面 TargetItem（保留旧字段名，新增 source 便于排障） */
function toTargetItem(item: TargetResponse): TargetItem {
  return {
    scrapePool: item.job,
    job: item.job,
    instance: item.instance,
    network_domain: item.network_domain,
    health: (item.health as TargetHealth) || 'unknown',
    lastScrape: item.last_scrape ?? undefined,
    lastError: item.last_error || undefined,
    instance_name: item.instance_name || undefined,
    source: item.source,
  }
}

/** 采集目标状态（M01 回显 / 目标状态页共用数据源，§2.1） */
export const targetsApi = {
  async list(params: TargetsListParams = {}): Promise<ApiResponse<TargetsResponse>> {
    const { search, page, page_size, ...rest } = params
    const res = await apiClient.get<TargetListResponse>('/api/v1/targets', {
      params: { page: page ?? 1, page_size: page_size ?? 100, ...rest, keyword: search },
    })
    const activeTargets = (res.data?.list ?? []).map(toTargetItem)
    return {
      ...res,
      data: { activeTargets, droppedTargets: [], targetsByJob: {} },
    }
  },
}
