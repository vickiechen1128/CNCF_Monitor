/**
 * 监控规则 API —— v3 兼容层（/api/v3/platform/monitoring-rules）。
 * 页面沿用 legacy 视图类型；v3 无「可用标签探查」端点，该方法降级为空结果。
 */
import type { ApiResponse, Paginated } from '../types/api'
import type { MonitoringRule, RuleContentMode } from '../types/strategy'
import { ruleApiV3 } from './strategyV3'
import type { RuleInputV3 } from './strategyV3'

export interface MonitoringRuleListParams extends Record<string, string | number | boolean | undefined> {
  rule_type?: string
  enabled?: boolean
  template_code?: string
  keyword?: string
  page?: number
  page_size?: number
}

export interface MonitoringRuleInput {
  content_mode?: RuleContentMode
  rule_content?: string
  name?: string
  enabled?: boolean
  template_code?: string
  ack_job_ref_errors?: boolean
  ack_reason?: string
}

export type PromQLCheckStatus = 'passed' | 'failed' | 'unavailable'

export interface PromQLCheckResult {
  status: PromQLCheckStatus
  message?: string
}

export interface JobRefIssue {
  group: string
  rule_name: string
  expr: string
  matcher: string
  referenced_job: string
  type: 'literal' | 'regex'
  severity: 'error' | 'warning'
  message: string
  network_domain_id?: string
  network_domain_name?: string
}

export interface YamlValidationResult {
  valid: boolean
  error?: string
  /** 已解析的规则组数（检查结果明细；解析失败时为 0/缺省） */
  groups?: number
  /** 已解析的规则条数（检查结果明细） */
  rules?: number
  job_ref?: JobRefIssue[] | null
  promql_check?: PromQLCheckResult | null
}

export interface RuleLabelInfo {
  key: string
  values: string[]
}

export interface RuleInspectResult {
  group: string
  rule: string
  kind: 'alert' | 'record' | 'empty'
  expr: string
  error?: string
  note?: string
  series_count: number
  labels: RuleLabelInfo[]
  summary_template?: string
  summary_preview?: string
  summary_error?: string
}

function toView(rule: unknown): MonitoringRule {
  const raw = rule as Record<string, unknown>
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    content_mode: (raw.content_mode as RuleContentMode) ?? 'yaml_passthrough',
    rule_content: raw.rule_content as string | undefined,
    rule_type: raw.rule_type as string | undefined,
    expr: raw.expr as string | undefined,
    duration: raw.duration as string | undefined,
    labels: raw.labels as Record<string, string> | undefined,
    annotations: raw.annotations as Record<string, string> | undefined,
    template_code: raw.template_code as string | undefined,
    exporter_template_id: raw.exporter_template_id as string | undefined,
    scope: (raw.scope as MonitoringRule['scope']) ?? 'central',
    enabled: Boolean(raw.enabled),
    draft_status: String(raw.draft_status ?? 'ready'),
    change_status: 'none',
    sync: raw.sync as MonitoringRule['sync'],
    group_count: raw.group_count as number | undefined,
    rule_count: raw.rule_count as number | undefined,
    ack_job_ref_errors: raw.ack_job_ref_errors as boolean | undefined,
    ack_reason: raw.ack_reason as string | undefined,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  }
}

function toInput(input: MonitoringRuleInput | Partial<MonitoringRuleInput>): RuleInputV3 {
  return {
    name: input.name,
    content_mode: 'yaml_passthrough',
    rule_content: input.rule_content ?? '',
    template_code: input.template_code,
    enabled: input.enabled,
    ack_job_ref_errors: input.ack_job_ref_errors,
    ack_reason: input.ack_reason,
  }
}

export const monitoringRuleApi = {
  async list(params?: MonitoringRuleListParams): Promise<ApiResponse<Paginated<MonitoringRule>>> {
    const res = await ruleApiV3.list(params)
    return { ...res, data: { ...res.data, list: (res.data?.list ?? []).map(toView) } }
  },
  async get(id: string | number): Promise<ApiResponse<MonitoringRule>> {
    const res = await ruleApiV3.get(String(id))
    return { ...res, data: toView(res.data) }
  },
  async create(input: MonitoringRuleInput): Promise<ApiResponse<MonitoringRule>> {
    const res = await ruleApiV3.create(toInput(input))
    return { ...res, data: toView(res.data) }
  },
  async update(id: string | number, input: Partial<MonitoringRuleInput>): Promise<ApiResponse<MonitoringRule>> {
    const current = await ruleApiV3.get(String(id))
    const merged: RuleInputV3 = {
      ...toInput(input),
      rule_content: input.rule_content ?? current.data.rule_content,
      name: input.name ?? current.data.name,
    }
    const res = await ruleApiV3.update(String(id), merged)
    return { ...res, data: toView(res.data) }
  },
  async remove(id: string | number): Promise<ApiResponse<{ id: number }>> {
    await ruleApiV3.remove(String(id))
    return { status: 'success', data: { id: Number(id) } }
  },
  async validateYaml(id: number | string, ruleContent: string): Promise<ApiResponse<YamlValidationResult>> {
    const res = await ruleApiV3.validate({ id: String(id || ''), rule_content: ruleContent })
    const data = res.data
    return {
      ...res,
      data: {
        valid: data.valid,
        error: data.error,
        groups: data.groups,
        rules: data.rules,
        job_ref: data.job_ref as JobRefIssue[],
        promql_check: data.promql
          ? { status: data.promql.status, message: data.promql.error || undefined }
          : undefined,
      },
    }
  },
  /** v3 暂未提供标签探查端点，降级为空结果（不阻断编辑）。 */
  async inspectRuleLabels(_ruleContent: string): Promise<ApiResponse<{ rules: RuleInspectResult[] }>> {
    return { status: 'success', data: { rules: [] } }
  },
}
