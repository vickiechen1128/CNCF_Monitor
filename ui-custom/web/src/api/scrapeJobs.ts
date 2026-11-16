/**
 * 采集 Job（ScrapeJob）前端 API —— v3 兼容层。
 *
 * 页面仍使用 legacy `ScrapeJob` 视图类型；本层调用 `/api/v3/platform/scrape-jobs`
 * 并在边界做字段映射（`sync` / `resource_category` / `list` 信封），使 F2 页面
 * 可以在不改动大体量组件的前提下运行在 v3 后端。
 */
import { apiClient } from './client'
import { scrapeJobApiV3 } from './strategyV3'
import type { ApiResponse, Paginated } from '../types/api'
import type { ResourceCategory, ResourceType } from '../types/resource'
import type {
  BlackboxTarget,
  ExporterInstallationRecord,
  InstanceCandidate,
  JobType,
  MonitorType,
  ScrapeJob,
  ScrapeJobInstanceItem,
} from '../types/strategy'
import type { ScrapeJobV3 } from '../types/strategyV3'
import type { JobInputV3 } from './strategyV3'

export interface ScrapeJobListParams extends Record<string, string | number | boolean | undefined> {
  network_domain_id?: string
  monitor_type?: MonitorType
  job_type?: JobType
  enabled?: boolean
  keyword?: string
  page?: number
  page_size?: number
  label_template_id?: number
}

export interface ScrapeJobMappingOverrideInput {
  field: string
  value: string
}

export interface ScrapeJobInput {
  job_name: string
  monitor_type?: MonitorType
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
  mapping_overrides?: ScrapeJobMappingOverrideInput[]
  job_type?: JobType
  blackbox_module?: string
  /** v2 遗留字段：v3 拒绝，本层丢弃。 */
  blackbox_targets?: BlackboxTarget[]
  resource_type?: ResourceType
  target_field?: string
  enabled?: boolean
  draft_status?: 'draft' | 'ready'
  /** v3 action flag（仅更新时使用）。 */
  sync_mapping_defaults?: boolean
}

export interface InstanceCandidateListParams extends Record<string, string | number | boolean | undefined> {
  monitor_type?: MonitorType
  resource_category?: ResourceCategory
  target_field?: string
  network_domain_id: string
  keyword?: string
  page?: number
  page_size?: number
}

export interface ScrapeJobInstancesResponse {
  items: ScrapeJobInstanceItem[]
  total: number
  missing_count?: number
}

export interface ConfirmInstanceInput {
  confirmed_by: string
  actual_port?: number
  notes?: string
}

export interface PreviewTargetsResult {
  targets: {
    resource_id?: string
    address: string
    protocol?: string
    port?: number
    port_source?: string
  }[]
}

function toLegacyJob(job: ScrapeJobV3): ScrapeJob {
  return {
    id: job.id,
    job_name: job.job_name,
    job_type: job.job_type,
    resource_type: job.resource_category,
    resource_category: job.resource_category,
    monitor_type: job.monitor_type,
    exporter_template_id: job.exporter_template_id,
    exporter_template_name: job.exporter_template_name,
    network_domain_id: job.network_domain_id,
    network_domain_name: job.network_domain_name,
    instance_selection_mode: 'manual',
    selected_instance_ids: job.selected_instance_ids ?? [],
    scrape_interval: job.scrape_interval,
    scrape_timeout: job.scrape_timeout,
    metrics_path: job.metrics_path,
    scheme: job.scheme,
    auth_type: job.auth_type,
    username: job.username,
    tls_skip_verify: job.tls_skip_verify,
    ca_file: job.ca_file,
    label_template_id: job.label_template_id,
    label_template_name: job.label_template_name,
    filter_rules: '',
    blackbox_module: job.blackbox_module,
    target_field: job.target_field,
    mapping_overrides: job.mapping_overrides ?? [],
    draft_status: job.draft_status,
    // v3 没有变更单；映射为 none，避免页面 pending 锁把 Job 锁死。
    change_status: 'none',
    sync: job.sync,
    credential_configured: job.credential_configured,
    enabled: job.enabled,
    created_at: job.created_at,
    updated_at: job.updated_at,
  }
}

function toV3Input(input: ScrapeJobInput): JobInputV3 {
  return {
    job_name: input.job_name,
    job_type: input.job_type,
    resource_category: (input.resource_type ?? input.monitor_type) as ResourceCategory,
    monitor_type: input.monitor_type,
    exporter_template_id: input.exporter_template_id,
    network_domain_id: input.network_domain_id,
    instance_selection_mode: 'manual',
    selected_instance_ids: input.selected_instance_ids,
    scrape_interval: input.scrape_interval,
    scrape_timeout: input.scrape_timeout,
    metrics_path: input.metrics_path,
    scheme: input.scheme,
    auth_type: input.auth_type,
    username: input.username,
    password: input.password,
    token: input.token,
    tls_skip_verify: input.tls_skip_verify,
    ca_file: input.ca_file,
    label_template_id: input.label_template_id,
    blackbox_module: input.blackbox_module,
    draft_status: input.draft_status,
    enabled: input.enabled,
    sync_mapping_defaults: input.sync_mapping_defaults,
  }
}

function fromV3Job(job: ScrapeJobV3, draftStatus: 'draft' | 'ready'): JobInputV3 {
  return {
    job_name: job.job_name,
    job_type: job.job_type,
    resource_category: job.resource_category,
    monitor_type: job.monitor_type || undefined,
    exporter_template_id: job.exporter_template_id || undefined,
    network_domain_id: job.network_domain_id,
    selected_instance_ids: job.selected_instance_ids,
    scrape_interval: job.scrape_interval,
    scrape_timeout: job.scrape_timeout,
    metrics_path: job.metrics_path,
    scheme: job.scheme,
    auth_type: job.auth_type,
    username: job.username,
    tls_skip_verify: job.tls_skip_verify,
    ca_file: job.ca_file,
    label_template_id: job.label_template_id,
    blackbox_module: job.blackbox_module,
    draft_status: draftStatus,
    enabled: job.enabled,
  }
}

export const scrapeJobApi = {
  async list(params?: ScrapeJobListParams): Promise<ApiResponse<Paginated<ScrapeJob>>> {
    const res = await scrapeJobApiV3.list({
      ...params,
      label_template_id: params?.label_template_id !== undefined ? String(params.label_template_id) : undefined,
    })
    const data = res.data
    return {
      ...res,
      data: {
        list: (data?.list ?? []).map(toLegacyJob),
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        page_size: data?.page_size ?? 20,
      },
    }
  },
  async create(input: ScrapeJobInput): Promise<ApiResponse<ScrapeJob>> {
    const res = await scrapeJobApiV3.create(toV3Input(input))
    return { ...res, data: toLegacyJob(res.data) }
  },
  async update(id: string | number, input: ScrapeJobInput): Promise<ApiResponse<ScrapeJob>> {
    const res = await scrapeJobApiV3.update(String(id), toV3Input(input))
    return { ...res, data: toLegacyJob(res.data) }
  },
  remove(id: string | number): Promise<ApiResponse<{ id: number }>> {
    return apiClient.delete<{ id: number }>(`/api/v3/platform/scrape-jobs/${id}`)
  },
  async instanceCandidates(params: InstanceCandidateListParams): Promise<ApiResponse<Paginated<InstanceCandidate>>> {
    const res = await scrapeJobApiV3.candidates(params)
    const data = res.data
    return {
      ...res,
      data: {
        list: (data?.list ?? []).map((item) => ({
          resource_id: item.resource_id,
          instance_name: item.display_name,
          instance_ip: item.instance_ip,
          status: item.status,
          disabled: !item.selectable,
        })),
        total: data?.total ?? 0,
        page: data?.page ?? 1,
        page_size: data?.page_size ?? 20,
      },
    }
  },
  async instances(jobId: string | number): Promise<ApiResponse<ScrapeJobInstancesResponse>> {
    const res = await scrapeJobApiV3.instances(String(jobId))
    const list = res.data?.list ?? []
    return {
      ...res,
      data: {
        items: list.map((item) => ({
          resource_id: item.resource_id,
          instance_name: item.display_name,
          instance_ip: item.instance_ip,
          status: item.installation?.status === 'confirmed' ? 'confirmed' : 'unconfirmed',
          port: item.port,
          port_source: '',
        })),
        total: res.data?.total ?? list.length,
      },
    }
  },
  async confirmInstance(
    jobId: string | number,
    resourceId: string,
    input: ConfirmInstanceInput,
  ): Promise<ApiResponse<ExporterInstallationRecord>> {
    const res = await scrapeJobApiV3.confirmInstance(String(jobId), resourceId, input)
    const data = res.data as {
      installation?: { status: string; actual_port: number; confirmed_by: string; notes: string; confirmed_at: string | null }
    }
    return {
      ...res,
      data: {
        resource_id: resourceId,
        scrape_job_id: String(jobId),
        status: (data?.installation?.status as ExporterInstallationRecord['status']) ?? 'confirmed',
        actual_port: data?.installation?.actual_port,
        confirmed_by: data?.installation?.confirmed_by,
        confirmed_at: data?.installation?.confirmed_at ?? undefined,
        notes: data?.installation?.notes,
      },
    }
  },
  unconfirmInstance(
    jobId: string | number,
    resourceId: string,
  ): Promise<ApiResponse<{ resource_id: string; job_id: number }>> {
    return apiClient.delete<{ resource_id: string; job_id: number }>(
      `/api/v3/platform/scrape-jobs/${jobId}/instances/${encodeURIComponent(resourceId)}/confirm`,
    )
  },
  async previewTargets(jobId: string | number): Promise<ApiResponse<PreviewTargetsResult>> {
    const res = await scrapeJobApiV3.previewTargets(String(jobId))
    const groups = (res.data?.targets ?? []) as { targets?: string[]; labels?: Record<string, string> }[]
    const targets = groups.flatMap((group) =>
      (group.targets ?? []).map((address) => ({
        resource_id: group.labels?.resource_id,
        address,
        port_source: '',
      })),
    )
    return { ...res, data: { targets } }
  },
  /** v3 无批量草稿端点：逐条读取后提交 ready，保持页面动作可用。 */
  async batchSubmitReady(input: { ids: number[] }): Promise<ApiResponse<{ jobs: ScrapeJob[] }>> {
    const jobs: ScrapeJob[] = []
    for (const id of input.ids) {
      const current = await scrapeJobApiV3.get(String(id))
      const updated = await scrapeJobApiV3.update(String(id), fromV3Job(current.data, 'ready'))
      jobs.push(toLegacyJob(updated.data))
    }
    return { status: 'success', data: { jobs } }
  },
}
