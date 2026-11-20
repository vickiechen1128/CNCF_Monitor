/**
 * 采集器模板 API —— v3 兼容层（/api/v3/platform/exporter-templates）。
 */
import type { ApiResponse, Paginated } from '../types/api'
import type { ExporterSource, ExporterTemplate } from '../types/strategy'
import { exporterTemplateApiV3 } from './strategyV3'

export interface ExporterTemplateListParams extends Record<string, string | number | boolean | undefined> {
  source?: ExporterSource
  page?: number
  page_size?: number
}

export interface ExporterTemplateInput {
  name: string
  version?: string
  default_port?: number
  metrics_path?: string
  scheme?: string
  os?: string
  arch?: string
  download_url?: string
  homepage?: string
  install_guide?: string
  description?: string
  source: ExporterSource
}

export interface ExporterTemplateUpdateInput extends Partial<ExporterTemplateInput> {
  name?: string
}

export const exporterTemplateApi = {
  async list(params?: ExporterTemplateListParams): Promise<ApiResponse<Paginated<ExporterTemplate>>> {
    const res = await exporterTemplateApiV3.list(params)
    return { ...res, data: { ...res.data, list: (res.data?.list ?? []) as unknown as ExporterTemplate[] } }
  },
  async create(input: ExporterTemplateInput): Promise<ApiResponse<ExporterTemplate>> {
    const res = await exporterTemplateApiV3.create(input)
    return { ...res, data: res.data as unknown as ExporterTemplate }
  },
  async update(
    id: string | number,
    input: ExporterTemplateUpdateInput,
  ): Promise<ApiResponse<ExporterTemplate>> {
    const res = await exporterTemplateApiV3.update(String(id), input as never)
    return { ...res, data: res.data as unknown as ExporterTemplate }
  },
  async remove(id: string | number): Promise<ApiResponse<{ id: number }>> {
    await exporterTemplateApiV3.remove(String(id))
    return { status: 'success', data: { id: Number(id) } }
  },
}
