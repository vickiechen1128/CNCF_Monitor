/**
 * 采集器模板（ExporterTemplate）平台 API（/api/v2/platform/...）
 *
 * Module_01 §6.2 / api-contract-snapshot §3：登记 / 编辑 / 软删采集器模板。
 * 统一信封 `apiClient`；列表分页信封 `list` 键（03_API_Standard §7.2）。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type { ExporterSource, ExporterTemplate } from '../types/strategy'

/** 采集器模板列表分页与筛选参数（§3，默认 page_size=20 上限 100） */
export interface ExporterTemplateListParams extends Record<string, string | number | boolean | undefined> {
  monitor_type?: string
  source?: ExporterSource
  page?: number
  page_size?: number
}

/** 采集器模板登记输入（§10 必填口径） */
export interface ExporterTemplateInput {
  name: string
  version?: string
  default_port?: number
  metrics_path?: string
  scheme?: string
  supported_monitor_types?: string[]
  os?: string
  arch?: string
  download_url?: string
  homepage?: string
  install_guide?: string
  source: ExporterSource
}

/** 采集器模板编辑输入（部分可改字段，内置只读拒绝） */
export interface ExporterTemplateUpdateInput extends Partial<ExporterTemplateInput> {
  name?: string
}

/** 采集器模板管理（登记/编辑/软删，§3） */
export const exporterTemplateApi = {
  list(params?: ExporterTemplateListParams): Promise<ApiResponse<Paginated<ExporterTemplate>>> {
    return apiClient.get<Paginated<ExporterTemplate>>('/api/v2/platform/exporter-templates', { params })
  },
  create(input: ExporterTemplateInput): Promise<ApiResponse<ExporterTemplate>> {
    return apiClient.post<ExporterTemplate>('/api/v2/platform/exporter-templates', { body: input })
  },
  update(id: number, input: ExporterTemplateUpdateInput): Promise<ApiResponse<ExporterTemplate>> {
    return apiClient.put<ExporterTemplate>(`/api/v2/platform/exporter-templates/${id}`, { body: input })
  },
  remove(id: number): Promise<ApiResponse<{ id: number }>> {
    return apiClient.delete<{ id: number }>(`/api/v2/platform/exporter-templates/${id}`)
  },
}