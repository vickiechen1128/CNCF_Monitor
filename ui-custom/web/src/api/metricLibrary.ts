/**
 * 技术指标库（ExporterMetricLibrary）平台 API（/api/v2/platform/...）
 *
 * Module_01 §6.2.3 / api-contract-snapshot §8：只读列表筛选 + 用户扩展 POST + 内置只读。
 * 统一信封 `apiClient`；列表分页信封 `list` 键。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type { ExporterMetricLibraryItem, MetricType } from '../types/strategy'

/** 指标库列表分页与筛选参数（§8，默认 page_size=20 上限 100） */
export interface MetricLibraryListParams extends Record<string, string | number | boolean | undefined> {
  monitor_type?: string
  metric_type?: MetricType
  category?: string
  keyword?: string
  page?: number
  page_size?: number
}

/** 指标库用户扩展创建输入（§5.3 / §8，is_builtin=false） */
export interface MetricLibraryInput {
  metric_name: string
  metric_type: MetricType
  help?: string
  unit?: string
  labels?: string[]
  monitor_types: { monitor_type: string; source_exporter?: string }[]
  category?: string
  exporter_template_id?: string
  enabled?: boolean
}

/** 指标库内置只读编辑输入（仅 enabled/help/unit/monitor_types/category 可改，§8） */
export interface MetricLibraryUpdateInput {
  enabled?: boolean
  help?: string
  unit?: string
  monitor_types?: { monitor_type: string; source_exporter?: string }[]
  category?: string
}

/** 技术指标库管理（列表/用户扩展/内置只读，§8） */
export const metricLibraryApi = {
  list(params?: MetricLibraryListParams): Promise<ApiResponse<Paginated<ExporterMetricLibraryItem>>> {
    return apiClient.get<Paginated<ExporterMetricLibraryItem>>('/api/v2/platform/metric-library', { params })
  },
  create(input: MetricLibraryInput): Promise<ApiResponse<ExporterMetricLibraryItem>> {
    return apiClient.post<ExporterMetricLibraryItem>('/api/v2/platform/metric-library', { body: input })
  },
  update(metricId: number, input: MetricLibraryUpdateInput): Promise<ApiResponse<ExporterMetricLibraryItem>> {
    return apiClient.put<ExporterMetricLibraryItem>(`/api/v2/platform/metric-library/${metricId}`, { body: input })
  },
}