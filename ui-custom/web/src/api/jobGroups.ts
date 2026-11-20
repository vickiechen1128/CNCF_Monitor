/**
 * M01 Job 组（监控意图）与组合筛选 API 客户端。
 *
 * 契约：docs/05-execution-records/rewrite/v2.0/modules/module-01/api-contract-snapshot-v3.md
 * §4.1（job-groups）/ §5.1.1（instance-candidates 组合筛选）。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
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
  monitor_type?: string
  resource_category?: string
  filters?: CandidateFilterPayload[]
  keyword?: string
  page?: number
  page_size?: number
}

export interface CandidateIdsPayload {
  monitor_type?: string
  resource_category?: string
  filters?: CandidateFilterPayload[]
  keyword?: string
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
  adoptFromJob(jobId: string, input: JobGroupInput): Promise<ApiResponse<JobGroup>> {
    return apiClient.post<JobGroup>('/api/v3/platform/job-groups/from-job', {
      body: { ...input, job_id: jobId },
    })
  },
  create(input: JobGroupInput): Promise<ApiResponse<JobGroup>> {
    return apiClient.post<JobGroup>('/api/v3/platform/job-groups', { body: input })
  },
  update(id: string, input: JobGroupInput): Promise<ApiResponse<JobGroup>> {
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
