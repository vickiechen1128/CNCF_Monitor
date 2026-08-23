/**
 * CI 类型 → Exporter 默认采集映射平台 API（/api/v2/platform/...）
 *
 * Module_01 §6.2.1 / api-contract-snapshot §4：CRUD + is_default 每类型唯一。
 * 统一信封 `apiClient`；列表分页信封 `list` 键（03_API_Standard §7.2）。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type { CITypeExporterMapping, MonitorType } from '../types/strategy'

/** 默认采集映射列表分页与筛选参数（§4，默认 page_size=20 上限 100） */
export interface CITypeExporterMappingListParams extends Record<string, string | number | boolean | undefined> {
  monitor_type?: string
  is_default?: boolean
  page?: number
  page_size?: number
}

/** 默认采集映射创建输入（§4 / §10 必填口径） */
export interface CITypeExporterMappingInput {
  monitor_type: MonitorType
  exporter_template_id: string
  is_default?: boolean
  default_port?: number
  metrics_path?: string
  scheme?: string
  scrape_interval?: string
  scrape_timeout?: string
  label_template_id?: string
}

/** 默认采集映射编辑输入（部分可改字段） */
export interface CITypeExporterMappingUpdateInput extends Partial<CITypeExporterMappingInput> {
  monitor_type?: MonitorType
}

/** CI 类型 → Exporter 默认采集映射管理（CRUD，§4） */
export const ciExporterMappingApi = {
  list(params?: CITypeExporterMappingListParams): Promise<ApiResponse<Paginated<CITypeExporterMapping>>> {
    return apiClient.get<Paginated<CITypeExporterMapping>>('/api/v2/platform/ci-exporter-mappings', { params })
  },
  create(input: CITypeExporterMappingInput): Promise<ApiResponse<CITypeExporterMapping>> {
    return apiClient.post<CITypeExporterMapping>('/api/v2/platform/ci-exporter-mappings', { body: input })
  },
  update(id: number, input: CITypeExporterMappingUpdateInput): Promise<ApiResponse<CITypeExporterMapping>> {
    return apiClient.put<CITypeExporterMapping>(`/api/v2/platform/ci-exporter-mappings/${id}`, { body: input })
  },
  remove(id: number): Promise<ApiResponse<{ id: number }>> {
    return apiClient.delete<{ id: number }>(`/api/v2/platform/ci-exporter-mappings/${id}`)
  },
}