/**
 * 健康检查 API（/api/v1/health）
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'

/** 系统健康状态 */
export interface HealthResponse {
  status: string
  /** 数据库连通状态（/api/v1/health/db 特有） */
  db_status?: string
}

/** 系统运行状态（/api/v1/status） */
export interface StatusResponse {
  version: string
  mode: string
}

/** 系统整体健康检查 */
export function getHealth(): Promise<ApiResponse<HealthResponse>> {
  return apiClient.get<HealthResponse>('/api/v1/health')
}

/** 数据库健康检查 */
export function getHealthDb(): Promise<ApiResponse<HealthResponse>> {
  return apiClient.get<HealthResponse>('/api/v1/health/db')
}

/** 系统运行状态 */
export function getStatus(): Promise<ApiResponse<StatusResponse>> {
  return apiClient.get<StatusResponse>('/api/v1/status')
}