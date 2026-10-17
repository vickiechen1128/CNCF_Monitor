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
  /**
   * ⚠️ 已废弃（阶段5）：拨测目标改走「从接口服务资源选择」，手填入口彻底禁用，
   * 后端亦拒绝写入本字段。仅 `ScrapeJob`（记录类型）保留它做历史数据读取。
   */
  blackbox_targets?: BlackboxTarget[]
  /**
   * 拨测 Job 的目标资源类别：由用户在表单选择，**只有两类**
   * （interface_service / application，见 `blackboxProbeCategories` 与后端
   * `models.BlackboxProbeCategories()`）。
   */
  resource_type?: ResourceType
  /**
   * ⚠️ 已不再由前端提交：探测地址字段由 `resource_type` 写死推导
   * （接口服务→api_url、应用服务→health_check_url），保存时后端按同一映射覆盖写入。
   * 字段仅作兼容保留，传了也不生效（后端不再校验其合法性）。
   */
  target_field?: string
  enabled?: boolean
  /**
   * 创建时直接指定为草稿或提交生效（方案 C，决策 D28-2）。
   * - "draft"：仅基础校验（job_name / job_type / 唯一性）并保存为草稿；
   * - "ready"（默认）：完整校验并进入 M09 变更管线。
   */
  draft_status?: 'draft' | 'ready'
}

/** 实例候选列表分页与筛选参数（§6，GET /scrape-jobs/instance-candidates） */
export interface InstanceCandidateListParams extends Record<string, string | number | boolean | undefined> {
  /** 二选一（与 resource_category）：按 monitor_type 推导资源类别（standard 采集 Job） */
  monitor_type?: MonitorType
  /** 二选一（与 monitor_type）：直接按资源类别收敛候选（拨测 Job = 用户在表单选定的类别，现为接口服务/应用服务两类） */
  resource_category?: ResourceCategory
  /**
   * 可选：候选第二列改渲染该字段的值。**拨测入口不必传** —— 后端按 `resource_category`
   * 推导出该类别写死的探测地址字段（接口服务→api_url、应用服务→health_check_url），
   * 使列表所见 = 实际探测地址。
   */
  target_field?: string
  network_domain_id: string
  keyword?: string
  page?: number
  page_size?: number
}

/** 已选实例 + 安装状态列表响应（GET /scrape-jobs/:id/instances，子资源 `items` 信封，§6.2.5）
 * `total` = 有效实例数（`items.length`，不含已软删/失效引用）；
 * `missing_count` = 选中集引用、但资源已被软删/不存在的失效引用数（F-38/F-39 暴露口径）。 */
export interface ScrapeJobInstancesResponse {
  items: ScrapeJobInstanceItem[]
  total: number
  missing_count?: number
}

/** Exporter 安装确认输入（§6.2.5 / §8④：confirmed_by 固定 platform_admin） */
export interface ConfirmInstanceInput {
  confirmed_by: string
  actual_port?: number
  notes?: string
}

/** preview-targets 目标清单（standard→实例地址；blackbox→所选实例在 target_field 上的值，§6） */
export interface PreviewTargetsResult {
  targets: {
    /** 所选资源 id（拨测 Job 据此回连 probe_success 的 resource_id 标签） */
    resource_id?: string
    address: string
    /** 目标地址的 scheme（仅 URL 类字段有值，如 http/https） */
    protocol?: string
    /** {T01-P6} standard 目标生效端口（blackbox 恒 0，不进端口解析链，D3 矩阵） */
    port?: number
    /**
     * {T01-P6} 生效端口来源（与 GET /instances items 同源，api-contract-snapshot §6）：
     * instance / mapping / template / business / unresolved；blackbox 为空串。
     */
    port_source?: string
  }[]
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
  /**
   * 批量将 draft 态采集 Job 提交为 ready（draft→ready 单向，决策 D28-3）。
   * 目标 Job 必须当前为 draft_status=draft，后端逐条做完整校验（all-or-nothing）。
   */
  batchSubmitReady(input: { ids: number[] }): Promise<ApiResponse<{ jobs: ScrapeJob[] }>> {
    return apiClient.post<{ jobs: ScrapeJob[] }>('/api/v2/platform/scrape-jobs/batch-draft-status', { body: input })
  },
}