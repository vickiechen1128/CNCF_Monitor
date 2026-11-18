/**
 * M01 Job 组（监控意图）与组合筛选类型（SRS JG v1.2 §5.3 / 契约 §4.1、§5.1.1）。
 */
import type { InstanceCandidateV3, ResourceCategory, ScrapeJobV3 } from './strategyV3'

/** 可筛选字段（服务端下发，前端不硬编码） */
export interface CandidateFilterField {
  key: string
  label: string
  type: 'multi_enum' | 'text'
  ops: string[]
  source?: string
  default?: string[]
  options?: { value: string; label: string }[]
}

/** 一条用户条件（本地 id 仅用于 React key / 删除） */
export interface FilterCondition {
  id: string
  field: string
  op: string
  values: string[]
}

export interface DomainHit {
  network_domain_id: string
  network_domain_name: string
  count: number
}

export interface CandidateQueryResult {
  list: InstanceCandidateV3[]
  total: number
  page: number
  page_size: number
  domains: DomainHit[]
}

export interface CandidateIdsResult {
  ids: string[]
  total: number
  truncated: boolean
  max_ids: number
}

export interface JobGroupChild {
  /** 子任务的完整 Job 投影（合并任务表复用同一套列，后端内嵌） */
  job?: ScrapeJobV3
  network_domain_id: string
  network_domain_name: string
  job_id: string
  job_name: string
  instance_count: number
  enabled: boolean
  sync_status: string
  sync_version: string
  sync_error: string
  synced_at: string | null
}

export interface JobGroupSync {
  status: string
  total: number
  synced: number
  failed: number
  pending: number
  draft: number
}

export interface JobGroup {
  id: string
  name: string
  job_name: string
  job_type: string
  resource_category: ResourceCategory
  monitor_type: string
  blackbox_module?: string
  scrape_interval: string
  scrape_timeout: string
  metrics_path: string
  scheme: string
  status: string
  created_by: string
  created_at: string
  updated_at: string
  domains: JobGroupChild[]
  sync: JobGroupSync
}

export interface JobGroupInput {
  name: string
  job_name: string
  job_type?: string
  resource_category?: ResourceCategory
  monitor_type: string
  exporter_template_id?: string
  scrape_interval?: string
  scrape_timeout?: string
  metrics_path?: string
  scheme?: string
  auth_type?: string
  label_template_id?: string
  blackbox_module?: string
  selected_instance_ids: string[]
  enabled?: boolean
  status?: string
}
