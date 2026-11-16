/**
 * 默认采集映射 API —— v3 兼容层（/api/v3/platform/ci-exporter-mappings）。
 * `label_template_id` 在 v3 走独立端点，本层自动拆分。
 */
import type { ApiResponse, Paginated } from '../types/api'
import type { CITypeExporterMapping, MonitorType } from '../types/strategy'
import { ciMappingApiV3 } from './strategyV3'

export interface CITypeExporterMappingListParams extends Record<string, string | number | boolean | undefined> {
  monitor_type?: string
  is_default?: boolean
  page?: number
  page_size?: number
}

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

export interface CITypeExporterMappingUpdateInput extends Partial<CITypeExporterMappingInput> {
  monitor_type?: MonitorType
}

function toView(item: unknown): CITypeExporterMapping {
  return item as CITypeExporterMapping
}

function splitInput(input: CITypeExporterMappingInput | CITypeExporterMappingUpdateInput) {
  const { label_template_id, ...rest } = input
  return { rest, label_template_id }
}

export const ciExporterMappingApi = {
  async list(
    params?: CITypeExporterMappingListParams,
  ): Promise<ApiResponse<Paginated<CITypeExporterMapping>>> {
    const res = await ciMappingApiV3.list(params)
    return { ...res, data: { ...res.data, list: (res.data?.list ?? []).map(toView) } }
  },
  async create(input: CITypeExporterMappingInput): Promise<ApiResponse<CITypeExporterMapping>> {
    const { rest, label_template_id } = splitInput(input)
    const res = await ciMappingApiV3.create(rest as never)
    const created = toView(res.data)
    if (label_template_id) {
      const withTemplate = await ciMappingApiV3.setLabelTemplate(created.id, label_template_id)
      return { ...withTemplate, data: toView(withTemplate.data) }
    }
    return { ...res, data: created }
  },
  async update(
    id: string | number,
    input: CITypeExporterMappingUpdateInput,
  ): Promise<ApiResponse<CITypeExporterMapping>> {
    const { rest, label_template_id } = splitInput(input)
    const res = await ciMappingApiV3.update(String(id), rest as never)
    const updated = toView(res.data)
    if (label_template_id !== undefined) {
      const withTemplate = await ciMappingApiV3.setLabelTemplate(String(id), label_template_id)
      return { ...withTemplate, data: toView(withTemplate.data) }
    }
    return { ...res, data: updated }
  },
  async remove(id: string | number): Promise<ApiResponse<{ id: number }>> {
    await ciMappingApiV3.remove(String(id))
    return { status: 'success', data: { id: Number(id) } }
  },
}
