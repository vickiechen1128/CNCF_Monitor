/**
 * 技术指标库 API —— v3 兼容层（/api/v3/platform/metric-library）。
 * 页面沿用 legacy 视图类型；ID 为字符串 UUID。
 */
import type { ApiResponse, Paginated } from '../types/api'
import type { ResourceCategory } from '../types/resource'
import type { ExporterMetricLibraryItem, MetricType } from '../types/strategy'
import { metricApiV3 } from './strategyV3'
import type { MetricInputV3 } from './strategyV3'

export interface MetricLibraryListParams extends Record<string, string | number | boolean | undefined> {
  template_code?: string
  /** 粗粒度资源类别，后端按 collection_templates 锚点归属展开过滤 */
  resource_category?: ResourceCategory
  metric_type?: MetricType
  /** 指标语义域（cpu / memory / ...），非资源类别 */
  category?: string
  keyword?: string
  page?: number
  page_size?: number
}

export interface MetricLibraryInput {
  metric_name: string
  metric_type: MetricType
  help?: string
  unit?: string
  labels?: string[]
  collection_templates: { template_code: string; source_exporter?: string }[]
  category?: string
  exporter_template_id?: string
  enabled?: boolean
}

export interface MetricLibraryUpdateInput {
  metric_name?: string
  metric_type?: MetricType
  labels?: string[]
  enabled?: boolean
  help?: string
  unit?: string
  collection_templates?: { template_code: string; source_exporter?: string }[]
  category?: string
}

type MetricViewSource = MetricInputV3 & {
  id: string
  is_builtin: boolean
  created_at: string
  updated_at: string
}

function toView(item: MetricViewSource): ExporterMetricLibraryItem {
  return {
    id: item.id,
    metric_name: item.metric_name,
    metric_type: item.metric_type as MetricType,
    help: item.help ?? '',
    unit: item.unit ?? '',
    labels: item.labels ?? [],
    collection_templates: item.collection_templates ?? [],
    category: item.category,
    exporter_template_id: item.exporter_template_id,
    is_builtin: item.is_builtin,
    enabled: item.enabled ?? true,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

export const metricLibraryApi = {
  async list(params?: MetricLibraryListParams): Promise<ApiResponse<Paginated<ExporterMetricLibraryItem>>> {
    const res = await metricApiV3.list(params)
    return { ...res, data: { ...res.data, list: (res.data?.list ?? []).map((x) => toView(x as MetricViewSource)) } }
  },
  async create(input: MetricLibraryInput): Promise<ApiResponse<ExporterMetricLibraryItem>> {
    const res = await metricApiV3.create(input)
    return { ...res, data: toView(res.data as MetricViewSource) }
  },
  async update(
    metricId: string | number,
    input: MetricLibraryUpdateInput,
  ): Promise<ApiResponse<ExporterMetricLibraryItem>> {
    const current = await metricApiV3.get(String(metricId))
    const body: MetricInputV3 = {
      metric_name: input.metric_name ?? current.data.metric_name,
      metric_type: input.metric_type ?? current.data.metric_type,
      help: input.help ?? current.data.help,
      unit: input.unit ?? current.data.unit,
      labels: input.labels ?? current.data.labels,
      collection_templates: input.collection_templates ?? current.data.collection_templates,
      category: input.category ?? current.data.category,
      exporter_template_id: current.data.exporter_template_id,
      enabled: input.enabled ?? current.data.enabled,
    }
    const res = await metricApiV3.update(String(metricId), body)
    return { ...res, data: toView(res.data as MetricViewSource) }
  },
  async remove(metricId: string | number): Promise<ApiResponse<{ id: string }>> {
    return metricApiV3.remove(String(metricId))
  },
}
