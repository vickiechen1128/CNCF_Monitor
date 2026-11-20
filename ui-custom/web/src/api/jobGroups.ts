/**
 * M01 Job 组（监控意图）与组合筛选 API 客户端。
 *
 * 契约：docs/05-execution-records/rewrite/v2.0/modules/module-01/api-contract-snapshot-v3.md
 * §4.1（job-groups）/ §5.1.1（instance-candidates 组合筛选）。
 *
 * M01 v1.5 起「监控对象类型」概念移除：任务/任务组只携带采集模板 `template_code`
 * 与自己的选择器 `selector`；候选查询同口径。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type { Selector } from '../types/collectionTemplate'
import type {
  CandidateFilterField,
  CandidateIdsResult,
  CandidateQueryResult,
  JobGroup,
  JobGroupInput,
} from '../types/jobGroup'

export interface CandidateFilterPayload {
  field: string
  op: string
  values: string[]
}

export interface CandidateQueryPayload {
  template_code?: string
  selector?: Selector
  resource_category?: string
  /** 旧式固定条件（服务端仍兼容）；新 UI 走 selector。 */
  filters?: CandidateFilterPayload[]
  keyword?: string
  page?: number
  page_size?: number
}

export interface CandidateIdsPayload {
  template_code?: string
  selector?: Selector
  resource_category?: string
  filters?: CandidateFilterPayload[]
  keyword?: string
}

/**
 * 任务组保存载荷：采集模板 + 选择器取代了 `monitor_type`。
 *
 * `types/jobGroup.ts` 的迁移由类型负责人完成（该文件不在本任务改动范围），
 * 这里先用兼容类型承载新字段，避免页面写 `as never`。
 */
export type JobGroupSaveInput = Omit<JobGroupInput, 'monitor_type'> & {
  /** v2 遗留字段：服务端已不识别，兼容期允许传入但 UI 不再填写。 */
  monitor_type?: string
  template_code?: string
  selector?: Selector
}

export const jobGroupApi = {
  filterSchema(): Promise<ApiResponse<{ fields: CandidateFilterField[] }>> {
    return apiClient.get<{ fields: CandidateFilterField[] }>(
      '/api/v3/platform/scrape-jobs/instance-candidates/filter-schema',
    )
  },
  queryCandidates(payload: CandidateQueryPayload): Promise<ApiResponse<CandidateQueryResult>> {
    return apiClient.post<CandidateQueryResult>(
      '/api/v3/platform/scrape-jobs/instance-candidates/query',
      { body: payload },
    )
  },
  candidateIds(payload: CandidateIdsPayload): Promise<ApiResponse<CandidateIdsResult>> {
    return apiClient.post<CandidateIdsResult>(
      '/api/v3/platform/scrape-jobs/instance-candidates/query/ids',
      { body: payload },
    )
  },
  list(params?: Record<string, string | number | undefined>): Promise<ApiResponse<Paginated<JobGroup>>> {
    return apiClient.get<Paginated<JobGroup>>('/api/v3/platform/job-groups', { params })
  },
  get(id: string): Promise<ApiResponse<JobGroup>> {
    return apiClient.get<JobGroup>(`/api/v3/platform/job-groups/${encodeURIComponent(id)}`)
  },
  /** 存量单域任务晋升为任务（跨域）：复用原 Job 行，其余域新建子任务 */
  adoptFromJob(jobId: string, input: JobGroupSaveInput): Promise<ApiResponse<JobGroup>> {
    return apiClient.post<JobGroup>('/api/v3/platform/job-groups/from-job', {
      body: { ...input, job_id: jobId },
    })
  },
  create(input: JobGroupSaveInput): Promise<ApiResponse<JobGroup>> {
    return apiClient.post<JobGroup>('/api/v3/platform/job-groups', { body: input })
  },
  update(id: string, input: JobGroupSaveInput): Promise<ApiResponse<JobGroup>> {
    return apiClient.put<JobGroup>(`/api/v3/platform/job-groups/${encodeURIComponent(id)}`, { body: input })
  },
  /** 启用 / 停用整组任务（含各域子任务），不需要重提整张表单 */
  setEnabled(id: string, enabled: boolean): Promise<ApiResponse<JobGroup>> {
    return apiClient.put<JobGroup>(`/api/v3/platform/job-groups/${encodeURIComponent(id)}/status`, {
      body: { enabled },
    })
  },
  remove(id: string): Promise<ApiResponse<{ job_group_id: string }>> {
    return apiClient.delete<{ job_group_id: string }>(`/api/v3/platform/job-groups/${encodeURIComponent(id)}`)
  },
}
