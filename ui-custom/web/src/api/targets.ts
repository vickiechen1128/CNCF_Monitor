/**
 * 采集目标状态 API（Module_02 决策 47，/api/v1，api-contract-snapshot.md §2.1）
 *
 * targetsApi.list：代理中心 Prometheus /api/v1/targets，M02 后端本地按
 * job / network_domain / health 过滤并补全 network_domain（前端不重复过滤，
 * §1.3/§2.1 透传语义）。被 module-01（Job 实例采集状态回显，决策 47-2）与
 * module-02 独立目标状态页（P1，决策 47-4）只读消费。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { TargetHealth, TargetsResponse } from '../types/query'

/** GET /api/v1/targets 筛选参数（§2.1，全部可选；health 非法值由 M02 返回 bad_request） */
export interface TargetsListParams extends Record<string, string | number | boolean | undefined> {
  /** 按 Job 过滤（M01 回显用） */
  job?: string
  /** 按注入标签过滤 */
  network_domain?: string
  /** up / down / unknown */
  health?: TargetHealth
  /** 透传上游，MVP 恒 active，可不传 */
  state?: string
}

/** 采集目标状态（M01 回显 / 目标状态页共用数据源，§2.1） */
export const targetsApi = {
  list(params?: TargetsListParams): Promise<ApiResponse<TargetsResponse>> {
    return apiClient.get<TargetsResponse>('/api/v1/targets', { params })
  },
}