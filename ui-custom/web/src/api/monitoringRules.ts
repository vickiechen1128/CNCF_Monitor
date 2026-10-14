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
  monitor_type?: string
  keyword?: string
  page?: number
  page_size?: number
}

/** 规则创建/编辑输入（§7 / §10：content_mode 默认 yaml_passthrough，rule_content 必填；monitor_type 可空） */
export interface MonitoringRuleInput {
  content_mode?: RuleContentMode
  rule_content?: string
  name?: string
  enabled?: boolean
  monitor_type?: string
  /**
   * 决策 67-2 逃生门：存在 error 级 job 引用时默认拒绝提交；
   * 置 true 表示用户已显式确认「先挂规则，稍后补建 Job」，放行落库留痕。
   */
  ack_job_ref_errors?: boolean
}

/** promql_check：PromQL 语义校验（promtool check rules）三态结论 */
export type PromQLCheckStatus = 'passed' | 'failed' | 'unavailable'

/** promql_check 明细（2026-10-13 新增；unavailable 时仅提示、不阻断保存） */
export interface PromQLCheckResult {
  status: PromQLCheckStatus
  message?: string
}

/** validate-yaml 预检输出（§7：{valid, error?, job_ref?, promql_check?}） */
export interface YamlValidationResult {
  valid: boolean
  error?: string
  /**
   * 决策 66：规则 job 引用语义校验问题。
   * 决策 67-2：`valid` 仅反映 YAML 语法，job_ref 的 error 级**由提交侧阻断**
   *（前端门禁 + 后端 ack_job_ref_errors 兜底），不再「不阻断保存」。
   */
  job_ref?: JobRefIssue[] | null
  /** 2026-10-13：PromQL 语义校验；`unavailable`（工具缺失）不改写 valid */
  promql_check?: PromQLCheckResult | null
}

/** 单个标签键及其在真实匹配序列上的样例值 */
export interface RuleLabelInfo {
  key: string
  values: string[]
}

/** 单条规则的探查结果（对齐后端 platform/query.InspectRuleResult） */
export interface RuleInspectResult {
  group: string
  rule: string
  kind: 'alert' | 'record' | 'empty'
  expr: string
  /** expr 非法 / 上游不可达；非空表示该条探查失败 */
  error?: string
  /** 成功但需提示（如当前无匹配序列） */
  note?: string
  series_count: number
  labels: RuleLabelInfo[]
  /** 规则里写的 summary 原文（可能含 {{ $labels.xxx }}） */
  summary_template?: string
  /** 用第一条匹配序列的标签渲染后的摘要 */
  summary_preview?: string
  /** 注解模板渲染失败原因 */
  summary_error?: string
}

/** 规则 job 引用问题的严重级（决策 66） */
export type JobRefSeverity = 'error' | 'warning'

/** 规则 job 引用校验的一条问题（对齐后端 platform/strategy/rule/jobref.Issue） */
export interface JobRefIssue {
  group: string
  rule_name: string
  expr: string
  matcher: string
  referenced_job: string
  /** literal 精确 / regex 正则 */
  type: 'literal' | 'regex'
  severity: JobRefSeverity
  message: string
  /** v0.2 多域预留（决策 67-4）：MVP 单域恒为空，留空不渲染 */
  network_domain_id?: string
  network_domain_name?: string
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
  /**
   * 规则表达式「可用标签清单 + 注解预览」探查（2026-10-13）。
   *
   * 让用户在保存前看到：这条 expr 当前能匹配到哪些标签键、`{{ $labels.xxx }}` 会渲染成什么。
   * 背景是拨测告警的真实困惑——历史摘要曾长期显示原始模板，用户据此误以为「取不到实例 IP」。
   * 只读探查，不落库。
   */
  inspectRuleLabels(ruleContent: string): Promise<ApiResponse<{ rules: RuleInspectResult[] }>> {
    return apiClient.post<{ rules: RuleInspectResult[] }>('/api/v2/platform/monitoring-rule-labels', {
      body: { rule_content: ruleContent },
    })
  },
}