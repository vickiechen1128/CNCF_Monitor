/**
 * 采集 Job（ScrapeJob）平台 API（/api/v2/platform/...）
 *
 * Module_01 §6.2.2/§6.2.5 / api-contract-snapshot §5/§6：
 * CRUD + 实例候选 + Exporter 安装确认 + preview-targets。
 * 统一信封 `apiClient`；主资源列表分页信封 `list` 键；
 * 子资源 `instances` 分页信封 `items` 键（§1.3 关键差异）。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type {
  BlackboxTarget,
  ExporterInstallationRecord,
  InstanceCandidate,
  JobType,
  MonitorType,
  ScrapeJob,
  ScrapeJobInstanceItem,
} from '../types/strategy'

/** 采集 Job 列表分页与筛选参数（§5，默认 page_size=20 上限 100） */
export interface ScrapeJobListParams extends Record<string, string | number | boolean | undefined> {
  network_domain_id?: string
  monitor_type?: MonitorType
  job_type?: JobType
  enabled?: boolean
  keyword?: string
  page?: number
  page_size?: number
  /** 引用该标签模板的 Job 反查（模板引用，§2/§5） */
  label_template_id?: number
}

/** 采集 Job 参数覆盖项（继承映射快照可覆盖，§5.4） */
export interface ScrapeJobMappingOverrideInput {
  field: string
  value: string
}

/** 采集 Job 创建/编辑输入（§5.4 全字段 + 认证TLS + blackbox，§10 必填口径） */
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
  blackbox_targets?: BlackboxTarget[]
  enabled?: boolean
}

/** 实例候选列表分页与筛选参数（§6，GET /scrape-jobs/instance-candidates） */
export interface InstanceCandidateListParams extends Record<string, string | number | boolean | undefined> {
  monitor_type: MonitorType
  network_domain_id: string
  keyword?: string
  page?: number
  page_size?: number
}

/** 已选实例 + 安装状态列表响应（GET /scrape-jobs/:id/instances，子资源 `items` 信封，§6.2.5） */
export interface ScrapeJobInstancesResponse {
  items: ScrapeJobInstanceItem[]
  total: number
}

/** Exporter 安装确认输入（§6.2.5 / §8④：confirmed_by 固定 platform_admin） */
export interface ConfirmInstanceInput {
  confirmed_by: string
  actual_port?: number
  notes?: string
}

/** preview-targets 目标清单（standard→实例地址；blackbox→targets，§6） */
export interface PreviewTargetsResult {
  targets: { address: string; protocol?: string }[]
}

/** 采集 Job 管理（CRUD + 实例候选 + 安装确认 + preview，§5/§6） */
export const scrapeJobApi = {
  list(params?: ScrapeJobListParams): Promise<ApiResponse<Paginated<ScrapeJob>>> {
    return apiClient.get<Paginated<ScrapeJob>>('/api/v2/platform/scrape-jobs', { params })
  },
  create(input: ScrapeJobInput): Promise<ApiResponse<ScrapeJob>> {
    return apiClient.post<ScrapeJob>('/api/v2/platform/scrape-jobs', { body: input })
  },
  update(id: number, input: ScrapeJobInput): Promise<ApiResponse<ScrapeJob>> {
    return apiClient.put<ScrapeJob>(`/api/v2/platform/scrape-jobs/${id}`, { body: input })
  },
  remove(id: number): Promise<ApiResponse<{ id: number }>> {
    return apiClient.delete<{ id: number }>(`/api/v2/platform/scrape-jobs/${id}`)
  },
  /** 实例候选（同 monitor_type 推导资源类别 + 同网域收敛；offline 置灰，§6.2.5/决策29） */
  instanceCandidates(params: InstanceCandidateListParams): Promise<ApiResponse<Paginated<InstanceCandidate>>> {
    return apiClient.get<Paginated<InstanceCandidate>>('/api/v2/platform/scrape-jobs/instance-candidates', { params })
  },
  /** 已选实例 + 安装状态（子资源 `items` 信封，§1.3） */
  instances(jobId: number): Promise<ApiResponse<ScrapeJobInstancesResponse>> {
    return apiClient.get<ScrapeJobInstancesResponse>(`/api/v2/platform/scrape-jobs/${jobId}/instances`)
  },
  /** 确认安装（POST，§6.2.5） */
  confirmInstance(jobId: number, resourceId: string, input: ConfirmInstanceInput): Promise<ApiResponse<ExporterInstallationRecord>> {
    return apiClient.post<ExporterInstallationRecord>(
      `/api/v2/platform/scrape-jobs/${jobId}/instances/${encodeURIComponent(resourceId)}/confirm`,
      { body: input },
    )
  },
  /** 取消确认（DELETE，§6.2.5） */
  unconfirmInstance(jobId: number, resourceId: string): Promise<ApiResponse<{ resource_id: string; job_id: number }>> {
    return apiClient.delete<{ resource_id: string; job_id: number }>(
      `/api/v2/platform/scrape-jobs/${jobId}/instances/${encodeURIComponent(resourceId)}/confirm`,
    )
  },
  /** preview-targets（L2 接口预览，§6） */
  previewTargets(jobId: number): Promise<ApiResponse<PreviewTargetsResult>> {
    return apiClient.post<PreviewTargetsResult>(`/api/v2/platform/scrape-jobs/${jobId}/preview-targets`)
  },
}