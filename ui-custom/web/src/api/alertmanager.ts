/**
 * Module_08 告警收敛与通知管理 API 客户端（/api/v2/platform/alertmanager/*）。
 * 权威契约：docs/05-execution-records/module-08/api-contract-snapshot.md（第一权威）。
 * 统一返回 `ApiResponse<T>`；错误类型按契约 errorType 由 `request` 抛出 `ApiError`。
 */
import { apiClient, isApiError } from './client'
import type { ApiResponse } from '../types/api'
import type {
  AlertHistoryData,
  AlertmanagerConfigVersion,
  AlertmanagerConfigVersionListItem,
  AmAlertsData,
  CreateSilencePayload,
  PaginatedItems,
  PromAlertsData,
  Silence,
  SilenceLabelOptionsData,
  ValidateErrorData,
} from '../types/alertmanager'

/**
 * 从 ApiError 中提取行级校验错误 detail（契约 §3：bad_request，error.data 形如 `{ items, note }`）。
 * 非校验类错误（或 payload 缺 data/items）返回 null，由调用方按通用错误处理。
 */
export function readValidateErrors(error: unknown): ValidateErrorData | null {
  if (!isApiError(error) || error.errorType !== 'bad_request') return null
  const data = (error as { payload?: { data?: unknown } }).payload?.data
  if (data && typeof data === 'object' && Array.isArray((data as ValidateErrorData).items)) {
    return data as ValidateErrorData
  }
  return null
}

/** M08 列表查询参数（snake_case + 分页） */
export interface AlertmanagerListParams extends Record<string, string | number | undefined> {
  page?: number
  page_size?: number
}

/** 挂载请求体（契约 §3 POST /config，字段必填见契约 §7） */
export interface SubmitAlertmanagerConfigInput {
  content: string
  uploaded_by?: string
}

/** 重新挂载历史版本请求体（契约 §3 POST .../versions/{id}/remount） */
export interface RemountConfigInput {
  uploaded_by?: string
}

/** Alertmanager 配置挂载与版本 API（config-mount service） */
export const alertmanagerConfigApi = {
  /** 提交挂载：先校验（amtool check-config 等价），校验通过留痕 + 提交 M09 变更单 */
  submit(input: SubmitAlertmanagerConfigInput): Promise<ApiResponse<AlertmanagerConfigVersion>> {
    return apiClient.post<AlertmanagerConfigVersion>('/api/v2/platform/alertmanager/config', { body: input })
  },
  /** 当前生效配置只读视图（最近一条 applied；无则 `{ content: '' }`） */
  getCurrent(): Promise<ApiResponse<AlertmanagerConfigVersion>> {
    return apiClient.get<AlertmanagerConfigVersion>('/api/v2/platform/alertmanager/config/current')
  },
  /** 历史版本列表（不含 content，省流量） */
  getVersions(params?: AlertmanagerListParams): Promise<ApiResponse<PaginatedItems<AlertmanagerConfigVersionListItem>>> {
    return apiClient.get<PaginatedItems<AlertmanagerConfigVersionListItem>>(
      '/api/v2/platform/alertmanager/config/versions',
      { params },
    )
  },
  /** 版本详情（完整含 content 只读视图） */
  getVersion(id: string): Promise<ApiResponse<AlertmanagerConfigVersion>> {
    return apiClient.get<AlertmanagerConfigVersion>(
      `/api/v2/platform/alertmanager/config/versions/${encodeURIComponent(id)}`,
    )
  },
  /** 重新挂载历史版本（P0 回滚）：再次走校验 + M09 变更单 */
  remount(id: string, input: RemountConfigInput = {}): Promise<ApiResponse<AlertmanagerConfigVersion>> {
    return apiClient.post<AlertmanagerConfigVersion>(
      `/api/v2/platform/alertmanager/config/versions/${encodeURIComponent(id)}/remount`,
      { body: input },
    )
  },
}

/** 静默管理 API（silence service，代理 Alertmanager，运行时状态即时生效） */
export const alertmanagerSilenceApi = {
  /** 活跃静默列表 */
  getSilences(params?: AlertmanagerListParams): Promise<ApiResponse<PaginatedItems<Silence>>> {
    return apiClient.get<PaginatedItems<Silence>>('/api/v2/platform/alertmanager/silences', { params })
  },
  /** 创建静默：服务端校验 matcher 收敛于授权网域集合（决策 56），越权 bad_request 拒绝 */
  createSilence(payload: CreateSilencePayload): Promise<ApiResponse<Silence>> {
    return apiClient.post<Silence>('/api/v2/platform/alertmanager/silences', { body: payload })
  },
  /** 删除静默：不存在返回 not_found */
  deleteSilence(silenceId: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(
      `/api/v2/platform/alertmanager/silences/${encodeURIComponent(silenceId)}`,
    )
  },
  /**
   * matcher 标签选项聚合（契约 §4 / 决策 71）：四层并集分组键集，
   * 供创建静默表单做分组联想。只读、不代理 AM。
   */
  getLabelOptions(): Promise<ApiResponse<SilenceLabelOptionsData>> {
    return apiClient.get<SilenceLabelOptionsData>('/api/v2/platform/alertmanager/silences/label-options')
  },
}

/** 告警状态查询参数（契约 §10：network_domain 可选，UX 筛选透传；过滤由后端承担，前端不重复过滤） */
export interface AlertStatusQuery extends Record<string, string | number | boolean | undefined> {
  network_domain?: string
}

/** 历史告警查询参数（M02 §6.1 / M08 §3.1） */
export interface AlertHistoryQuery extends Record<string, string | number | boolean | undefined> {
  network_domain?: string
  alertname?: string
  instance?: string
  state?: 'all' | 'firing' | 'resolved'
  start?: string
  end?: string
  page?: number
  page_size?: number
}

/**
 * 告警状态查看 API（v1.12 MVP 增量，契约快照 §10，Track B+；两条均为只读代理）。
 * 授权过滤由服务端强制注入（决策 56），前端 Query 仅作 UX 筛选透传，不构成权限依据。
 */
export const alertStatusApi = {
  /** Prometheus 当前触发告警（M02 代理 GET /api/v1/alerts，firing/pending 实例） */
  getPromAlerts(params?: AlertStatusQuery): Promise<ApiResponse<PromAlertsData>> {
    return apiClient.get<PromAlertsData>('/api/v1/alerts', { params })
  },
  /** Alertmanager 通知状态（M08 代理 GET /api/v2/platform/alertmanager/alerts，服务端归一四态） */
  getAlertmanagerAlerts(params?: AlertStatusQuery): Promise<ApiResponse<AmAlertsData>> {
    return apiClient.get<AmAlertsData>('/api/v2/platform/alertmanager/alerts', { params })
  },
  /** 历史告警（M02 v1.13 新增）：基于 ALERTS 时间序列重建规则级触发/恢复区间（含已恢复） */
  getAlertHistory(params?: AlertHistoryQuery): Promise<ApiResponse<AlertHistoryData>> {
    return apiClient.get<AlertHistoryData>('/api/v1/alerts/history', { params })
  },
}