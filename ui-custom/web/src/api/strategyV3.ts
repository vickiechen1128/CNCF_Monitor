/**
 * M01 v3 API 客户端（/api/v3/platform/*）。
 *
 * 页面在 F2/F3 迁移到本模块；旧的 `/api/v2` 客户端在页面迁完前保留。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type {
  BusinessMetricV3,
  CITypeExporterMappingV3,
  ExporterTemplateV3,
  InstanceCandidateV3,
  JobInstanceV3,
  JobRefIssueV3,
  MetricV3,
  MonitoringRuleV3,
  ProbeModuleV3,
  ResourceCategory,
  RuleValidationV3,
  ScrapeJobV3,
  SyncState,
} from '../types/strategyV3'

export type ListParams = Record<string, string | number | boolean | undefined>

// ---------------------------------------------------------------- exporters

export interface ExporterTemplateInputV3 {
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
  description?: string
  source?: 'official' | 'third_party' | 'internal'
}

export const exporterTemplateApiV3 = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<ExporterTemplateV3>>> {
    return apiClient.get<Paginated<ExporterTemplateV3>>('/api/v3/platform/exporter-templates', { params })
  },
  get(id: string): Promise<ApiResponse<ExporterTemplateV3>> {
    return apiClient.get<ExporterTemplateV3>(`/api/v3/platform/exporter-templates/${id}`)
  },
  create(input: ExporterTemplateInputV3): Promise<ApiResponse<ExporterTemplateV3>> {
    return apiClient.post<ExporterTemplateV3>('/api/v3/platform/exporter-templates', { body: input })
  },
  update(id: string, input: ExporterTemplateInputV3): Promise<ApiResponse<ExporterTemplateV3>> {
    return apiClient.put<ExporterTemplateV3>(`/api/v3/platform/exporter-templates/${id}`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(`/api/v3/platform/exporter-templates/${id}`)
  },
}

// ----------------------------------------------------------------- mappings

export interface MappingInputV3 {
  monitor_type: string
  exporter_template_id: string
  is_default?: boolean
  default_port?: number
  metrics_path?: string
  scheme?: string
  scrape_interval?: string
  scrape_timeout?: string
}

export const ciMappingApiV3 = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<CITypeExporterMappingV3>>> {
    return apiClient.get<Paginated<CITypeExporterMappingV3>>('/api/v3/platform/ci-exporter-mappings', { params })
  },
  create(input: MappingInputV3): Promise<ApiResponse<CITypeExporterMappingV3>> {
    return apiClient.post<CITypeExporterMappingV3>('/api/v3/platform/ci-exporter-mappings', { body: input })
  },
  update(id: string, input: MappingInputV3): Promise<ApiResponse<CITypeExporterMappingV3>> {
    return apiClient.put<CITypeExporterMappingV3>(`/api/v3/platform/ci-exporter-mappings/${id}`, { body: input })
  },
  /** label_template_id has a dedicated v3 endpoint. */
  setLabelTemplate(id: string, labelTemplateId: string): Promise<ApiResponse<CITypeExporterMappingV3>> {
    return apiClient.put<CITypeExporterMappingV3>(
      `/api/v3/platform/ci-exporter-mappings/${id}/label-template`,
      { body: { label_template_id: labelTemplateId } },
    )
  },
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(`/api/v3/platform/ci-exporter-mappings/${id}`)
  },
}

// --------------------------------------------------------------------- jobs

export interface JobInputV3 {
  job_name: string
  job_type?: 'standard' | 'blackbox'
  resource_category?: ResourceCategory
  monitor_type?: string
  exporter_template_id?: string
  network_domain_id: string
  instance_selection_mode?: 'manual'
  selected_instance_ids?: string[]
  scrape_interval?: string
  scrape_timeout?: string
  metrics_path?: string
  scheme?: string
  auth_type?: 'none' | 'basic' | 'bearer'
  username?: string
  password?: string
  token?: string
  tls_skip_verify?: boolean
  ca_file?: string
  label_template_id?: string
  blackbox_module?: string
  draft_status?: 'draft' | 'ready'
  enabled?: boolean
  sync_mapping_defaults?: boolean
}

export interface ScrapeJobListParamsV3 extends ListParams {
  network_domain_id?: string
  monitor_type?: string
  job_type?: 'standard' | 'blackbox'
  enabled?: boolean
  draft_status?: 'draft' | 'ready'
  label_template_id?: string
  keyword?: string
  page?: number
  page_size?: number
}

export interface CandidateParamsV3 extends ListParams {
  monitor_type?: string
  resource_category?: ResourceCategory
  network_domain_id: string
  keyword?: string
  page?: number
  page_size?: number
}

export interface InstallationInputV3 {
  actual_port?: number
  confirmed_by: string
  notes?: string
}

export const scrapeJobApiV3 = {
  list(params?: ScrapeJobListParamsV3): Promise<ApiResponse<Paginated<ScrapeJobV3>>> {
    return apiClient.get<Paginated<ScrapeJobV3>>('/api/v3/platform/scrape-jobs', { params })
  },
  get(id: string): Promise<ApiResponse<ScrapeJobV3>> {
    return apiClient.get<ScrapeJobV3>(`/api/v3/platform/scrape-jobs/${id}`)
  },
  create(input: JobInputV3): Promise<ApiResponse<ScrapeJobV3>> {
    return apiClient.post<ScrapeJobV3>('/api/v3/platform/scrape-jobs', { body: input })
  },
  update(id: string, input: JobInputV3): Promise<ApiResponse<ScrapeJobV3>> {
    return apiClient.put<ScrapeJobV3>(`/api/v3/platform/scrape-jobs/${id}`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<{ job_id: string }>> {
    return apiClient.delete<{ job_id: string }>(`/api/v3/platform/scrape-jobs/${id}`)
  },
  candidates(params: CandidateParamsV3): Promise<ApiResponse<Paginated<InstanceCandidateV3>>> {
    return apiClient.get<Paginated<InstanceCandidateV3>>('/api/v3/platform/scrape-jobs/instance-candidates', { params })
  },
  instances(jobId: string): Promise<ApiResponse<{ list: JobInstanceV3[]; total: number }>> {
    return apiClient.get<{ list: JobInstanceV3[]; total: number }>(`/api/v3/platform/scrape-jobs/${jobId}/instances`)
  },
  confirmInstance(jobId: string, resourceId: string, input: InstallationInputV3): Promise<ApiResponse<unknown>> {
    return apiClient.post<unknown>(
      `/api/v3/platform/scrape-jobs/${jobId}/instances/${encodeURIComponent(resourceId)}/confirm`,
      { body: input },
    )
  },
  unconfirmInstance(jobId: string, resourceId: string): Promise<ApiResponse<{ resource_id: string; job_id: string }>> {
    return apiClient.delete<{ resource_id: string; job_id: string }>(
      `/api/v3/platform/scrape-jobs/${jobId}/instances/${encodeURIComponent(resourceId)}/confirm`,
    )
  },
  previewTargets(jobId: string): Promise<ApiResponse<{ job_name: string; targets: unknown[]; skipped: unknown[] }>> {
    return apiClient.post<{ job_name: string; targets: unknown[]; skipped: unknown[] }>(
      `/api/v3/platform/scrape-jobs/${jobId}/preview-targets`,
    )
  },
}

// -------------------------------------------------------------------- rules

export interface RuleInputV3 {
  name?: string
  content_mode?: 'yaml_passthrough'
  rule_content: string
  monitor_type?: string
  exporter_template_id?: string
  enabled?: boolean
  draft_status?: 'draft' | 'ready'
  ack_job_ref_errors?: boolean
  ack_reason?: string
}

export interface RuleValidationRequestV3 {
  id?: string
  rule_content: string
}

export const ruleApiV3 = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<MonitoringRuleV3>>> {
    return apiClient.get<Paginated<MonitoringRuleV3>>('/api/v3/platform/monitoring-rules', { params })
  },
  get(id: string): Promise<ApiResponse<MonitoringRuleV3>> {
    return apiClient.get<MonitoringRuleV3>(`/api/v3/platform/monitoring-rules/${id}`)
  },
  create(input: RuleInputV3): Promise<ApiResponse<MonitoringRuleV3>> {
    return apiClient.post<MonitoringRuleV3>('/api/v3/platform/monitoring-rules', { body: input })
  },
  update(id: string, input: RuleInputV3): Promise<ApiResponse<MonitoringRuleV3>> {
    return apiClient.put<MonitoringRuleV3>(`/api/v3/platform/monitoring-rules/${id}`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<{ rule_id: string }>> {
    return apiClient.delete<{ rule_id: string }>(`/api/v3/platform/monitoring-rules/${id}`)
  },
  validate(input: RuleValidationRequestV3): Promise<ApiResponse<RuleValidationV3>> {
    return apiClient.post<RuleValidationV3>('/api/v3/platform/monitoring-rules/validate', { body: input })
  },
}

// ------------------------------------------------------------- metric library

export interface MetricInputV3 {
  metric_name: string
  metric_type?: string
  help?: string
  unit?: string
  labels?: string[]
  monitor_types?: { monitor_type: string; source_exporter?: string }[]
  category?: string
  exporter_template_id?: string
  enabled?: boolean
}

export const metricApiV3 = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<MetricV3>>> {
    return apiClient.get<Paginated<MetricV3>>('/api/v3/platform/metric-library', { params })
  },
  get(id: string): Promise<ApiResponse<MetricV3>> {
    return apiClient.get<MetricV3>(`/api/v3/platform/metric-library/${id}`)
  },
  create(input: MetricInputV3): Promise<ApiResponse<MetricV3>> {
    return apiClient.post<MetricV3>('/api/v3/platform/metric-library', { body: input })
  },
  update(id: string, input: MetricInputV3): Promise<ApiResponse<MetricV3>> {
    return apiClient.put<MetricV3>(`/api/v3/platform/metric-library/${id}`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(`/api/v3/platform/metric-library/${id}`)
  },
}

// ------------------------------------------------------------ business metrics

export interface BusinessMetricInputV3 {
  metric_id?: string
  metric_name: string
  description?: string
  metric_type?: string
  unit?: string
  business_domain?: string
  app_name?: string
  threshold_suggestion?: string
  owner: string
  register_source?: 'self' | 'agent'
  status?: 'pending' | 'instrumented' | 'online'
}

export const businessMetricApiV3 = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<BusinessMetricV3>>> {
    return apiClient.get<Paginated<BusinessMetricV3>>('/api/v3/platform/business-metrics', { params })
  },
  get(id: string): Promise<ApiResponse<BusinessMetricV3>> {
    return apiClient.get<BusinessMetricV3>(`/api/v3/platform/business-metrics/${id}`)
  },
  create(input: BusinessMetricInputV3): Promise<ApiResponse<BusinessMetricV3>> {
    return apiClient.post<BusinessMetricV3>('/api/v3/platform/business-metrics', { body: input })
  },
  update(id: string, input: BusinessMetricInputV3): Promise<ApiResponse<BusinessMetricV3>> {
    return apiClient.put<BusinessMetricV3>(`/api/v3/platform/business-metrics/${id}`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(`/api/v3/platform/business-metrics/${id}`)
  },
}

// ------------------------------------------------------------- probe modules

export interface ProbeModuleInputV3 {
  name: string
  content: string
  enabled?: boolean
}

export const probeModuleApiV3 = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<ProbeModuleV3>>> {
    return apiClient.get<Paginated<ProbeModuleV3>>('/api/v3/platform/blackbox-modules', { params })
  },
  get(id: string): Promise<ApiResponse<ProbeModuleV3>> {
    return apiClient.get<ProbeModuleV3>(`/api/v3/platform/blackbox-modules/${id}`)
  },
  create(input: ProbeModuleInputV3): Promise<ApiResponse<ProbeModuleV3>> {
    return apiClient.post<ProbeModuleV3>('/api/v3/platform/blackbox-modules', { body: input })
  },
  update(id: string, input: ProbeModuleInputV3): Promise<ApiResponse<ProbeModuleV3>> {
    return apiClient.put<ProbeModuleV3>(`/api/v3/platform/blackbox-modules/${id}`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(`/api/v3/platform/blackbox-modules/${id}`)
  },
}

/** Re-exported for pages that render sync badges. */
export type { JobRefIssueV3, SyncState }
