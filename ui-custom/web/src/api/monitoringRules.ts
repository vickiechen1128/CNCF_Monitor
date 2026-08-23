/**
 * 监控规则（MonitoringRule）平台 API（/api/v2/platform/...）
 *
 * Module_01 §6.2.4 / api-contract-snapshot §7：CRUD（yaml_passthrough 整文件透传）
 * + validate-yaml 预检。统一信封 `apiClient`；列表分页信封 `list` 键。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type { MonitoringRule, RuleContentMode } from '../types/strategy'

/** 规则列表分页与筛选参数（§7，默认 page_size=20 上限 100） */
export interface MonitoringRuleListParams extends Record<string, string | number | boolean | undefined> {
  rule_type?: string
  enabled?: boolean
  keyword?: string
  page?: number
  page_size?: number
}

/** 规则创建/编辑输入（§7 / §10：content_mode 默认 yaml_passthrough，rule_content 必填） */
export interface MonitoringRuleInput {
  content_mode?: RuleContentMode
  rule_content?: string
  name?: string
  enabled?: boolean
}

/** validate-yaml 预检输出（§7：{valid, error?}） */
export interface YamlValidationResult {
  valid: boolean
  error?: string
}

/** 监控规则管理（CRUD + validate-yaml + 详情，§7） */
export const monitoringRuleApi = {
  list(params?: MonitoringRuleListParams): Promise<ApiResponse<Paginated<MonitoringRule>>> {
    return apiClient.get<Paginated<MonitoringRule>>('/api/v2/platform/monitoring-rules', { params })
  },
  get(id: number): Promise<ApiResponse<MonitoringRule>> {
    return apiClient.get<MonitoringRule>(`/api/v2/platform/monitoring-rules/${id}`)
  },
  create(input: MonitoringRuleInput): Promise<ApiResponse<MonitoringRule>> {
    return apiClient.post<MonitoringRule>('/api/v2/platform/monitoring-rules', { body: input })
  },
  update(id: number, input: Partial<MonitoringRuleInput>): Promise<ApiResponse<MonitoringRule>> {
    return apiClient.put<MonitoringRule>(`/api/v2/platform/monitoring-rules/${id}`, { body: input })
  },
  remove(id: number): Promise<ApiResponse<{ id: number }>> {
    return apiClient.delete<{ id: number }>(`/api/v2/platform/monitoring-rules/${id}`)
  },
  validateYaml(id: number, ruleContent: string): Promise<ApiResponse<YamlValidationResult>> {
    return apiClient.post<YamlValidationResult>(`/api/v2/platform/monitoring-rules/${id}/validate-yaml`, {
      body: { rule_content: ruleContent },
    })
  },
}