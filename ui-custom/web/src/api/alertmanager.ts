/**
 * Module_08 告警收敛与通知管理 API 客户端（v3：`/api/v3/platform/alertmanager/*`）。
 *
 * 权威契约：docs/05-execution-records/rewrite/v2.0/modules/module-08/api-contract-snapshot-v3.md。
 *
 * 说明：v3 的返回结构与页面沿用的 v2 视图结构不同（列表信封、路由树嵌套形态、
 * 即时 apply 语义）。本文件在**客户端边界做形状适配**，页面继续消费原有视图类型，
 * 从而把 F1 的改动收敛在 API 层，不逐个重写页面。
 */
import { apiClient, isApiError } from './client'
import type { ApiResponse } from '../types/api'
import type {
  AlertEventCurrentData,
  AlertEventData,
  AlertEventStats,
  AlertEventStatus,
  AlertHistoryData,
  AlertmanagerConfigVersion,
  AlertmanagerConfigVersionListItem,
  AmAlertItem,
  AmAlertsData,
  CreateNotifyChannelPayload,
  CreateSilencePayload,
  NotifyChannel,
  NotifyChannelType,
  NotifyChannelsData,
  NotifyTemplate,
  NotifyTemplateDetail,
  NotifyTemplatesData,
  PaginatedItems,
  PromAlertsData,
  RouteEditNode,
  RouteMatcher,
  RouteNode,
  RouteTreeData,
  SaveRoutesPayload,
  SaveRoutesResult,
  Silence,
  SilenceLabelOptionGroup,
  SilenceLabelOptionsData,
  SubmitNotifyTemplatePayload,
  UpdateNotifyChannelPayload,
  ValidateErrorData,
} from '../types/alertmanager'

/** v3 前缀（全部 M08 端点） */
const BASE = '/api/v3/platform/alertmanager'

// ---------------------------------------------------------------------------
// v3 wire shapes（仅本文件使用）
// ---------------------------------------------------------------------------

interface WireMatcher {
  name: string
  value: string
  is_regex: boolean
  /** 缺省 = true（正匹配）；false 渲染 != / !~ */
  is_equal?: boolean
}

interface WireRouteNode {
  id: string
  name: string
  matchers: WireMatcher[] | null
  receiver: string
  group_by: string[] | null
  group_wait: string
  group_interval: string
  repeat_interval: string
  continue: boolean
  enabled: boolean
  children: WireRouteNode[] | null
}

interface WireSnapshot {
  id: string
  version: string
  checksum: string
  content: string
  route_tree: WireRouteNode[]
  is_current: boolean
  generated_by: string
  generated_at: string
  reload?: { status: string; duration_ms: number; at?: string } | null
}

interface WireSnapshotListItem {
  id: string
  version: string
  checksum: string
  is_current: boolean
  generated_by: string
  generated_at: string
}

interface WireRouteTree {
  route_tree: WireRouteNode[]
  base_checksum: string
}

interface WireSaveResult {
  config_checksum: string
  config_version: string
  pending_sections: string[]
  reload?: { status: string; duration_ms: number; at?: string } | null
}

interface WireSilence {
  id: string
  matchers: WireMatcher[]
  starts_at: string
  ends_at: string
  created_by?: string
  comment: string
  status?: string
}

interface WireChannel {
  id: string
  name: string
  channel_type: NotifyChannelType
  webhook_url: string
  sign_enabled: boolean
  secret_set: boolean
  template_id: string | null
  receiver_name: string
  referenced_by_routes: number
}

interface WireTemplate {
  id: string
  name: string
  channel_type: NotifyChannelType
  content?: string
  builtin: boolean
  bound_channels: number
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// 适配工具
// ---------------------------------------------------------------------------

function toMatcher(matcher: WireMatcher): RouteMatcher {
  return {
    name: matcher.name,
    value: matcher.value,
    is_equal: matcher.is_equal !== false,
    is_regex: matcher.is_regex,
  }
}

function toWireMatcher(matcher: { name: string; value: string; is_regex?: boolean; is_equal?: boolean }): WireMatcher {
  return {
    name: matcher.name,
    value: matcher.value,
    is_regex: matcher.is_regex === true,
    is_equal: matcher.is_equal !== false,
  }
}

/** 嵌套 v3 路由树 → 页面沿用的扁平前序序列（parent_id / order 由遍历位置生成）。 */
export function flattenWireRouteTree(nodes: WireRouteNode[] | null, parentID = ''): RouteNode[] {
  const out: RouteNode[] = []
  const walk = (list: WireRouteNode[] | null, parent: string) => {
    ;(list ?? []).forEach((node, index) => {
      out.push({
        id: node.id,
        parent_id: parent,
        name: node.name ?? '',
        matchers: (node.matchers ?? []).map(toMatcher),
        receiver: node.receiver ?? '',
        group_by: node.group_by ?? [],
        group_wait: node.group_wait ?? '',
        group_interval: node.group_interval ?? '',
        repeat_interval: node.repeat_interval ?? '',
        continue: node.continue === true,
        order: index,
        locked: parent === '',
        raw: '',
      })
      walk(node.children, node.id)
    })
  }
  walk(nodes, parentID)
  return out
}

/** 页面编辑态扁平序列 → 嵌套 v3 路由树（同层顺序 = 数组顺序）。 */
export function nestEditRouteTree(items: RouteEditNode[]): WireRouteNode[] {
  const byParent = new Map<string, RouteEditNode[]>()
  for (const node of items ?? []) {
    const parent = node.parent_id ?? ''
    const siblings = byParent.get(parent)
    if (siblings) siblings.push(node)
    else byParent.set(parent, [node])
  }
  const build = (parentID: string): WireRouteNode[] =>
    (byParent.get(parentID) ?? []).map((node) => ({
      id: node.id,
      name: node.name ?? '',
      matchers: (node.matchers ?? []).map(toWireMatcher),
      receiver: node.receiver ?? '',
      group_by: node.group_by ?? [],
      group_wait: node.group_wait ?? '',
      group_interval: node.group_interval ?? '',
      repeat_interval: node.repeat_interval ?? '',
      continue: node.continue === true,
      enabled: node.enabled !== false,
      children: build(node.id),
    }))
  return build('')
}

function toConfigVersion(snapshot: WireSnapshot): AlertmanagerConfigVersion {
  return {
    id: snapshot.id,
    content: snapshot.content,
    checksum: snapshot.checksum,
    generated_at: snapshot.generated_at,
    generated_by: snapshot.generated_by,
    is_current: snapshot.is_current,
    created_at: snapshot.generated_at,
  }
}

function toConfigVersionListItem(item: WireSnapshotListItem): AlertmanagerConfigVersionListItem {
  return {
    id: item.id,
    checksum: item.checksum,
    generated_at: item.generated_at,
    generated_by: item.generated_by,
    is_current: item.is_current,
    created_at: item.generated_at,
  }
}

function toSilence(silence: WireSilence): Silence {
  const status = silence.status === 'pending' || silence.status === 'expired' ? silence.status : 'active'
  return {
    id: silence.id,
    matchers: (silence.matchers ?? []).map(toMatcher),
    starts_at: silence.starts_at,
    ends_at: silence.ends_at,
    created_by: silence.created_by,
    comment: silence.comment,
    status,
  }
}

function toChannel(channel: WireChannel): NotifyChannel {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.channel_type,
    webhook_url: channel.webhook_url,
    secret_set: channel.secret_set,
    receiver_name: channel.receiver_name,
    route_reference_count: channel.referenced_by_routes,
    default_template_id: channel.template_id ?? undefined,
    created_at: '',
  }
}

function toTemplate(template: WireTemplate): NotifyTemplate {
  return {
    id: template.id,
    name: template.name,
    channel_type: template.channel_type,
    is_builtin: template.builtin,
    bound_channel_count: template.bound_channels,
    created_at: template.created_at,
    updated_at: template.updated_at,
  }
}

/**
 * 从 ApiError 中提取行级校验错误（v3：`data.validation.items`，
 * 兼容旧形 `data.items`）。
 */
export function readValidateErrors(error: unknown): ValidateErrorData | null {
  if (!isApiError(error) || error.errorType !== 'bad_request') return null
  const data = (error as { payload?: { data?: unknown } }).payload?.data as
    | { items?: unknown; validation?: { items?: unknown; note?: string; cause?: string } }
    | undefined
  const rawItems = data?.validation?.items ?? data?.items
  if (!Array.isArray(rawItems)) return null
  const items = rawItems.map((item) => {
    const entry = item as { line?: number; field?: string; message?: string; file?: string }
    return {
      file: entry.file ?? 'alertmanager.yml',
      line: entry.line ?? 0,
      message: entry.message ?? String(item),
    }
  })
  return { items, note: data?.validation?.note ?? '', cause: data?.validation?.cause }
}

/** M08 列表查询参数（snake_case + 分页） */
export interface AlertmanagerListParams extends Record<string, string | number | undefined> {
  page?: number
  page_size?: number
}

/** 当前生效 alertmanager.yml 原文响应 data */
export interface EffectiveAlertmanagerYaml {
  yaml: string
}

/** 通知渠道 → v3 写入体（type/template 字段改名）。 */
async function toChannelPayload(
  input: CreateNotifyChannelPayload | UpdateNotifyChannelPayload,
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.type !== undefined) payload.channel_type = input.type
  if (input.webhook_url !== undefined) payload.webhook_url = input.webhook_url
  if (input.secret !== undefined) payload.secret = input.secret
  if (input.default_template_id !== undefined || input.type !== undefined) {
    let templateID = input.default_template_id
    const channelType = input.type
    // v3 requires IM channels to bind a template; fall back to the built-in
    // template of the same type when the form did not pick one explicitly.
    if (!templateID && channelType && channelType !== 'webhook') {
      const templates = await notifyTemplatesApi.list({ channel_type: channelType })
      const builtin = templates.data?.items?.find((item) => item.is_builtin)
      templateID = builtin?.id
    }
    payload.template_id = templateID ?? null
  }
  return payload
}

// ---------------------------------------------------------------------------
// 配置（只读 + 版本历史 + 手动重载）
// ---------------------------------------------------------------------------

export const alertmanagerConfigApi = {
  /** 当前生效配置（只读）。v3：GET /config */
  getCurrent(): Promise<ApiResponse<AlertmanagerConfigVersion>> {
    return apiClient.get<WireSnapshot>(`${BASE}/config`).then((res) => ({
      ...res,
      data: toConfigVersion(res.data),
    }))
  },
  /** 当前生效 YAML 原文（兼容保留；等价 /config 的 content） */
  getProduct(): Promise<ApiResponse<EffectiveAlertmanagerYaml>> {
    return apiClient.get<WireSnapshot>(`${BASE}/config`).then((res) => ({
      ...res,
      data: { yaml: res.data.content },
    }))
  },
  /** 历史版本列表（不含 content） */
  getVersions(params?: AlertmanagerListParams): Promise<ApiResponse<PaginatedItems<AlertmanagerConfigVersionListItem>>> {
    return apiClient
      .get<{ list: WireSnapshotListItem[]; total: number; page: number; page_size: number }>(
        `${BASE}/config/versions`,
        { params },
      )
      .then((res) => ({
        ...res,
        data: { items: (res.data.list ?? []).map(toConfigVersionListItem), total: res.data.total },
      }))
  },
  /** 版本详情 */
  getVersion(id: string): Promise<ApiResponse<AlertmanagerConfigVersion>> {
    return apiClient
      .get<WireSnapshot>(`${BASE}/config/versions/${encodeURIComponent(id)}`)
      .then((res) => ({ ...res, data: toConfigVersion(res.data) }))
  },
  /** 手动重载当前生效配置（admin；不产生新版本，D-M08-06） */
  reload(): Promise<ApiResponse<{ status: string; duration_ms: number; at?: string }>> {
    return apiClient.post<{ status: string; duration_ms: number; at?: string }>(`${BASE}/config/reload`, {})
  },
  /** Reload 记录（只读） */
  getReloadLogs(params?: AlertmanagerListParams): Promise<
    ApiResponse<
      PaginatedItems<{
        id: string
        config_version: string
        status: string
        trigger: string
        operator: string
        duration_ms: number
        started_at: string
        error?: string
      }>
    >
  > {
    return apiClient
      .get<{ list: Array<Record<string, unknown>>; total: number }>(`${BASE}/config/reload-logs`, { params })
      .then((res) => ({
        ...res,
        data: {
          items: (res.data.list ?? []).map((row) => ({
            id: String(row.id ?? ''),
            config_version: String(row.config_version ?? ''),
            status: String(row.status ?? ''),
            trigger: String(row.trigger ?? ''),
            operator: String(row.operator ?? ''),
            duration_ms: Number(row.duration_ms ?? 0),
            started_at: String(row.started_at ?? ''),
            error: row.error ? String(row.error) : undefined,
          })),
          total: res.data.total,
        },
      }))
  },
}

// ---------------------------------------------------------------------------
// 静默
// ---------------------------------------------------------------------------

export const alertmanagerSilenceApi = {
  getSilences(params?: AlertmanagerListParams): Promise<ApiResponse<PaginatedItems<Silence>>> {
    return apiClient
      .get<{ list: WireSilence[]; total: number }>(`${BASE}/silences`, { params })
      .then((res) => ({
        ...res,
        data: { items: (res.data.list ?? []).map(toSilence), total: res.data.total },
      }))
  },
  createSilence(payload: CreateSilencePayload): Promise<ApiResponse<Silence>> {
    return apiClient
      .post<WireSilence>(`${BASE}/silences`, {
        body: {
          matchers: payload.matchers.map(toWireMatcher),
          starts_at: payload.starts_at,
          ends_at: payload.ends_at,
          created_by: payload.created_by ?? '',
          comment: payload.comment,
        },
      })
      .then((res) => ({ ...res, data: toSilence(res.data) }))
  },
  deleteSilence(silenceId: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient
      .delete<{ silence_id: string }>(`${BASE}/silences/${encodeURIComponent(silenceId)}`)
      .then((res) => ({ ...res, data: { id: res.data.silence_id } }))
  },
  /** matcher 标签联想：v3 返回 [{name, values}]，适配为页面沿用的 groups。 */
  getLabelOptions(): Promise<ApiResponse<SilenceLabelOptionsData>> {
    return apiClient
      .get<{ items: Array<{ name: string; values: string[] }> }>(`${BASE}/silences/label-options`)
      .then((res) => {
        const sourceOf = (name: string): SilenceLabelOptionGroup['source'] =>
          name === 'network_domain' ? 'external' : 'rule'
        const groups: SilenceLabelOptionGroup[] = (res.data.items ?? []).map((group) => ({
          source: sourceOf(group.name),
          label: group.name,
          items: (group.values ?? []).map((value) => ({ name: value })),
        }))
        return { ...res, data: { groups } }
      })
  },
}

// ---------------------------------------------------------------------------
// 告警状态
// ---------------------------------------------------------------------------

export interface AlertStatusQuery extends Record<string, string | number | boolean | undefined> {
  network_domain?: string
}

/** 历史告警 query_range 步长（秒）：调用方必须显式传入（决策 90）。 */
export const ALERT_HISTORY_STEP_SECONDS = 30

export interface AlertHistoryQuery extends Record<string, string | number | boolean | undefined> {
  network_domain?: string
  alertname?: string
  instance?: string
  state?: 'all' | 'firing' | 'resolved'
  start?: string
  end?: string
  step?: number
  page?: number
  page_size?: number
}

export interface AlertEventQuery extends Record<string, string | number | undefined> {
  page?: number
  page_size?: number
  /** 单态过滤；与 status_group 互斥 */
  status?: AlertEventStatus
  /** 未结三态分组（firing/silenced/inhibited）并集，v3 契约别名 */
  status_group?: 'open'
  severity?: string
  alert_name?: string
  summary?: string
  description?: string
  network_domain?: string
  starts_from?: string
  starts_to?: string
  ends_from?: string
  ends_to?: string
  sort?: string
}

interface WireAmAlert {
  labels: Record<string, string>
  annotations: Record<string, string>
  starts_at: string
  ends_at?: string
  state?: string
  notify_status: AmAlertItem['notify_status']
  silenced_by?: string[]
  inhibited_by?: string[]
}

export const alertStatusApi = {
  getPromAlerts(params?: AlertStatusQuery): Promise<ApiResponse<PromAlertsData>> {
    return apiClient.get<PromAlertsData>('/api/v1/alerts', { params })
  },
  /** Alertmanager 通知状态（v3：GET /alerts → {list,total} 适配为 items） */
  getAlertmanagerAlerts(params?: AlertStatusQuery): Promise<ApiResponse<AmAlertsData>> {
    return apiClient.get<{ list: WireAmAlert[]; total: number }>(`${BASE}/alerts`, { params }).then((res) => ({
      ...res,
      data: {
        items: (res.data.list ?? []).map((alert) => ({
          labels: alert.labels,
          annotations: alert.annotations,
          starts_at: alert.starts_at,
          ends_at: alert.ends_at,
          notify_status: alert.notify_status,
          instance_address: alert.labels.instance ?? '',
          instance_display: alert.labels.instance ?? '',
          resource_id: alert.labels.resource_id ?? '',
          resource_name: alert.labels.resource_name ?? '',
          resource_category: alert.labels.resource_category ?? '',
          status: { state: alert.state, silenced_by: alert.silenced_by, inhibited_by: alert.inhibited_by },
        })),
      },
    }))
  },
  getAlertHistory(params?: AlertHistoryQuery): Promise<ApiResponse<AlertHistoryData>> {
    return apiClient.get<AlertHistoryData>('/api/v1/alerts/history', { params })
  },
  getAlertEvents(params?: AlertEventQuery): Promise<ApiResponse<AlertEventData>> {
    return apiClient.get<AlertEventData>(`${BASE}/alert-events`, { params })
  },
  getCurrentAlerts(params?: AlertStatusQuery): Promise<ApiResponse<AlertEventCurrentData>> {
    return apiClient.get<AlertEventCurrentData>(`${BASE}/alert-events/current`, { params })
  },
  getAlertEventStats(params?: AlertStatusQuery): Promise<ApiResponse<AlertEventStats>> {
    return apiClient.get<AlertEventStats>(`${BASE}/alert-events/stats`, { params })
  },
}

// ---------------------------------------------------------------------------
// 通知渠道 / 模板
// ---------------------------------------------------------------------------

export const notifyChannelsApi = {
  list(): Promise<ApiResponse<NotifyChannelsData>> {
    return apiClient.get<{ list: WireChannel[]; total: number }>(`${BASE}/notify-channels`).then((res) => ({
      ...res,
      data: { items: (res.data.list ?? []).map(toChannel) },
    }))
  },
  async create(input: CreateNotifyChannelPayload): Promise<ApiResponse<NotifyChannel>> {
    const body = await toChannelPayload(input)
    return apiClient
      .post<WireChannel>(`${BASE}/notify-channels`, { body })
      .then((res) => ({ ...res, data: toChannel(res.data) }))
  },
  async update(id: string, input: UpdateNotifyChannelPayload): Promise<ApiResponse<NotifyChannel>> {
    const body = await toChannelPayload(input)
    return apiClient
      .put<WireChannel>(`${BASE}/notify-channels/${encodeURIComponent(id)}`, { body })
      .then((res) => ({ ...res, data: toChannel(res.data) }))
  },
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient
      .delete<{ channel_id: string }>(`${BASE}/notify-channels/${encodeURIComponent(id)}`)
      .then((res) => ({ ...res, data: { id: res.data.channel_id } }))
  },
}

export const notifyTemplatesApi = {
  list(params?: { channel_type?: NotifyChannelType }): Promise<ApiResponse<NotifyTemplatesData>> {
    return apiClient
      .get<{ list: WireTemplate[]; total: number }>(`${BASE}/notify-templates`, { params })
      .then((res) => ({
        ...res,
        data: { items: (res.data.list ?? []).map(toTemplate), total: res.data.total },
      }))
  },
  get(id: string): Promise<ApiResponse<NotifyTemplateDetail>> {
    return apiClient
      .get<WireTemplate>(`${BASE}/notify-templates/${encodeURIComponent(id)}`)
      .then((res) => ({ ...res, data: { ...toTemplate(res.data), content: res.data.content ?? '' } }))
  },
  create(input: SubmitNotifyTemplatePayload): Promise<ApiResponse<NotifyTemplateDetail>> {
    return apiClient
      .post<WireTemplate>(`${BASE}/notify-templates`, {
        body: { name: input.name, channel_type: input.channel_type, content: input.content },
      })
      .then((res) => ({ ...res, data: { ...toTemplate(res.data), content: res.data.content ?? input.content } }))
  },
  update(id: string, input: SubmitNotifyTemplatePayload): Promise<ApiResponse<NotifyTemplateDetail>> {
    return apiClient
      .put<WireTemplate>(`${BASE}/notify-templates/${encodeURIComponent(id)}`, {
        body: { name: input.name, channel_type: input.channel_type, content: input.content },
      })
      .then((res) => ({ ...res, data: { ...toTemplate(res.data), content: res.data.content ?? input.content } }))
  },
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient
      .delete<{ template_id: string }>(`${BASE}/notify-templates/${encodeURIComponent(id)}`)
      .then((res) => ({ ...res, data: { id: res.data.template_id } }))
  },
}

// ---------------------------------------------------------------------------
// 路由规则
// ---------------------------------------------------------------------------

export const alertmanagerRoutesApi = {
  /**
   * 路由树只读视图。v3 返回嵌套树 + base_checksum；适配为页面沿用的扁平 items，
   * 并合成 declared_receivers（default + 全部渠道 receiver_name），供前端做悬空校验。
   */
  async getRoutes(): Promise<ApiResponse<RouteTreeData>> {
    const res = await apiClient.get<WireRouteTree>(`${BASE}/routes`)
    let declaredReceivers: string[] = ['default']
    try {
      const channels = await notifyChannelsApi.list()
      const names = (channels.data?.items ?? [])
        .map((channel) => channel.receiver_name)
        .filter((name): name is string => Boolean(name))
      declaredReceivers = ['default', ...names]
    } catch {
      // 渠道列表失败不阻断路由页；悬空校验退化为「仅 default 已知」。
    }
    return {
      ...res,
      data: {
        items: flattenWireRouteTree(res.data.route_tree),
        effective_checksum: res.data.base_checksum,
        declared_receivers: declaredReceivers,
      },
    }
  },
  /**
   * 保存路由树（v3 即时生效）：提交嵌套树 → 生成 → amtool 校验 → apply → 快照。
   * 响应适配为页面沿用的 SaveRoutesResult，并补充 applied/reload 供提示文案使用。
   */
  saveRoutes(payload: SaveRoutesPayload): Promise<ApiResponse<SaveRoutesResult>> {
    return apiClient
      .post<WireSaveResult>(`${BASE}/routes`, {
        body: {
          base_checksum: payload.base_checksum,
          route_tree: nestEditRouteTree(payload.route_tree),
        },
      })
      .then((res) => ({
        ...res,
        data: {
          version: {
            id: '',
            content: '',
            checksum: res.data.config_checksum,
            generated_at: res.data.reload?.at,
            generated_by: '',
            is_current: true,
            created_at: res.data.reload?.at,
          },
          change_no: undefined,
          applied: res.data.reload?.status === 'succeeded',
          reload_status: res.data.reload?.status,
          pending_sections: res.data.pending_sections,
        },
      }))
  },
}
