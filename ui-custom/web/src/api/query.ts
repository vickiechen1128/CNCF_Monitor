/**
 * PromQL 即时查询 API（Module_02 查询代理，/api/v1）。
 *
 * 代理语义：M02 后端以通配路由挂载 /api/v1/query 并反向代理 Prometheus，
 * **原生透传上游响应体、不包平台信封**，故响应形状即 Prometheus 原生
 * `{status, data:{resultType, result}}`，与 `ApiResponse<T>` 兼容；
 * 查询为只读 GET（无需 POST），错误信封 `{status:'error', error}` 由
 * `apiClient` 统一抛 `ApiError`（HTTP 400/422）。
 *
 * 消费方：module-05 首页第 6 步「查指标」深链目标 QueryPage（决策 72-1）。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { PromQueryData } from '../types/query'

/** GET /api/v1/query 查询参数（time 缺省时由 Prometheus 取服务端当前时刻） */
export interface PromQueryParams extends Record<string, string | number | boolean | undefined> {
  /** PromQL 表达式 */
  query: string
  /** 求值时刻，RFC3339 或 unix 秒 */
  time?: string | number
}

export const queryApi = {
  /** 即时查询：执行 PromQL 并按 resultType 返回 vector / matrix / scalar / string */
  query(params: PromQueryParams): Promise<ApiResponse<PromQueryData>> {
    return apiClient.get<PromQueryData>('/api/v1/query', { params })
  },
}
