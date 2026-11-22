/**
 * PromQL 查询 API（M09 配置与查询中心，/api/v1）。
 *
 * 后端查询代理会按当前用户授权网域注入 `network_domain_id`，调用方无需
 * 在 PromQL 中手写网域过滤；成功响应在外层追加 `meta`（见 types/api.ts）。
 *
 * - `query`：即时查询，返回 vector / scalar / string；
 * - `queryRange`：区间查询，返回 matrix，供指标查询页时序图使用；
 * - `labelValues`：标签值枚举，供指标名 / Job / 实例辅助选择。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { PromQueryData } from '../types/query'

/** 查询请求可取消（AbortController），避免旧响应覆盖新结果。 */
export interface QueryRequestOptions {
  signal?: AbortSignal
}

/** GET /api/v1/query 查询参数（time 缺省时由 Prometheus 取服务端当前时刻） */
export interface PromQueryParams extends Record<string, string | number | boolean | undefined> {
  /** PromQL 表达式 */
  query: string
  /** 求值时刻，RFC3339 或 unix 秒 */
  time?: string | number
}

/** GET /api/v1/query_range 查询参数（start/end 支持 RFC3339 或 unix 秒，step 支持秒数或 duration） */
export interface PromQueryRangeParams extends Record<string, string | number | boolean | undefined> {
  /** PromQL 表达式 */
  query: string
  /** 起始时间 */
  start: string | number
  /** 结束时间 */
  end: string | number
  /** 步长（秒数或 Prometheus duration，如 30s / 1m） */
  step: string | number
}

/** GET /api/v1/label/:name/values 查询参数 */
export interface PromLabelValuesParams extends Record<string, string | number | boolean | undefined> {
  /** 起始时间（可选，限制标签值枚举窗口） */
  start?: string | number
  /** 结束时间（可选） */
  end?: string | number
}

export const queryApi = {
  /** 即时查询：执行 PromQL 并按 resultType 返回 vector / matrix / scalar / string */
  query(params: PromQueryParams, options?: QueryRequestOptions): Promise<ApiResponse<PromQueryData>> {
    return apiClient.get<PromQueryData>('/api/v1/query', { params, signal: options?.signal })
  },

  /** 区间查询：返回 matrix，供时序图与序列明细使用 */
  queryRange(
    params: PromQueryRangeParams,
    options?: QueryRequestOptions,
  ): Promise<ApiResponse<PromQueryData>> {
    return apiClient.get<PromQueryData>('/api/v1/query_range', { params, signal: options?.signal })
  },

  /** 标签值枚举：指标名用 `__name__`，Job / 实例分别用 `job` / `instance` */
  labelValues(
    name: string,
    params: PromLabelValuesParams = {},
    options?: QueryRequestOptions,
  ): Promise<ApiResponse<string[]>> {
    return apiClient.get<string[]>(`/api/v1/label/${encodeURIComponent(name)}/values`, {
      params,
      signal: options?.signal,
    })
  },
}
