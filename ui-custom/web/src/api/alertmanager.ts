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
  CreateNotifyChannelPayload,
  CreateSilencePayload,
  NotifyChannel,
  NotifyChannelsData,
  NotifyTemplate,
  NotifyTemplatesData,
  PaginatedItems,
  PromAlertsData,
  ReceiverSnippetData,
  RouteSetting,
  RouteTreeData,
  Silence,
  SilenceLabelOptionsData,
  SubmitNotifyTemplatePayload,
  UpdateNotifyChannelPayload,
  UpdateRouteSettingPayload,
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

/** 当前生效「产品视图」alertmanager.yml 原文（C1：route 保存合并基）响应 data */
export interface EffectiveAlertmanagerYaml {
  /** 含平台物化 receivers 的生效产品视图 alertmanager.yml */
  yaml: string
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
  /**
   * 当前生效「产品视图」alertmanager.yml 原文（C1：route 保存合并基）。
   * 与 `GET /routes` 同源（草稿/版本优先、回落挂载留痕），已含平台物化 receivers；
   * 因含出站凭据等同级敏感内容，挂 RequireAdmin（与 /config/current 同级）。
   * 响应 `{ yaml: "<生效产品视图 alertmanager.yml>" }`。
   */
  getProduct(): Promise<ApiResponse<EffectiveAlertmanagerYaml>> {
    return apiClient.get<EffectiveAlertmanagerYaml>('/api/v2/platform/alertmanager/config/product')
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
  /**
   * 重新挂载历史版本（P0 回滚）：再次走校验 + M09 变更单。
   *
   * @deprecated 2026-10-02 起前端**无调用方**——告警配置页已按用户意见移除「重新挂载此版本」入口
   * （重新提交历史配置改走「查看版本内容 → 改 → 导入整份配置文件」）。
   * 端点本身后端仍在（契约 §3 保留，未删），故此处镜像暂留以保持契约可追溯；
   * 注意与 `notifyTemplatesApi.remount`（通知模板版本回滚，**仍在用**）语义区分，勿混。
   */
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

/**
 * 历史告警 query_range 步长（秒，决策 90）：**所有调用方必须显式传入**，不得省略。
 *
 * 根因（2026-09-18）：`step` 与服务端最大时间窗（7d）是两个独立参数，7d ÷ 30s = 20160 个点，
 * 超过 Prometheus 单序列 11000 点上限 → 上游返回 400 → 后端 500 → 历史告警页/首页告警计数
 * 整体不可用（首页「当日 / 近 7 天告警」两格表现为恒 0）。
 *
 * 取值 **30s**（= PRD §5.4/§6.1 默认步长、≥ 最小 15s；用户 2026-09-18 定口径）：调用侧统一按
 * **细粒度**取数 —— 窄窗口（窗口 < 约 91.6h）保持 30s 的估算精度；宽窗口由服务端
 * `normalizeHistoryStep`（`platform/query/alerts_history.go`）按窗口抬高兜底（7d → 55s）。
 * 即：显式传值保证调用方行为可预期，上限保护交给服务端，实际生效值看响应 `data.step`。
 */
export const ALERT_HISTORY_STEP_SECONDS = 30

/** 历史告警查询参数（M02 §6.1 / M08 §3.1） */
export interface AlertHistoryQuery extends Record<string, string | number | boolean | undefined> {
  network_domain?: string
  alertname?: string
  instance?: string
  state?: 'all' | 'firing' | 'resolved'
  start?: string
  end?: string
  /** query_range 步长（秒）；必须传 `ALERT_HISTORY_STEP_SECONDS`，勿省略（决策 90） */
  step?: number
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

/**
 * 通知渠道管理 API（PL-3 通知渲染桥，提案 §3.3.8；M08 内容 Owner）。
 * 端点尚未写入 api-contract-snapshot.md，契约权威 = 设计提案 §3.3 + 任务卡 wire 格式，待回写。
 * 凭据口径：webhook_url 响应脱敏、secret 永不回显（secret_set 仅布尔）；
 * 接收人片段（含平台桥令牌）挂 RequireAdmin，非管理员 403。
 */
export const notifyChannelsApi = {
  /** 渠道列表（登录态） */
  list(): Promise<ApiResponse<NotifyChannelsData>> {
    return apiClient.get<NotifyChannelsData>('/api/v2/platform/alertmanager/notify-channels')
  },
  /** 新建渠道（admin）：名称空 / 类型非法 / webhook 非法 → 400 bad_request */
  create(input: CreateNotifyChannelPayload): Promise<ApiResponse<NotifyChannel>> {
    return apiClient.post<NotifyChannel>('/api/v2/platform/alertmanager/notify-channels', { body: input })
  },
  /** 更新渠道（admin）：仅传需修改字段；不传 webhook_url/secret 即保留原值 */
  update(id: string, input: UpdateNotifyChannelPayload): Promise<ApiResponse<NotifyChannel>> {
    return apiClient.put<NotifyChannel>(
      `/api/v2/platform/alertmanager/notify-channels/${encodeURIComponent(id)}`,
      { body: input },
    )
  },
  /** 删除渠道（admin）：不存在返回 not_found */
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(
      `/api/v2/platform/alertmanager/notify-channels/${encodeURIComponent(id)}`,
    )
  },
  /**
   * 接收人配置片段（admin，T08-F13）：按渠道生成可直接粘进 alertmanager.yml `receivers:`
   * 段的 YAML 片段（内嵌真实数字渠道 ID 与桥令牌，目标地址恒由服务端拼装）。
   * 非管理员调用返回 403；渠道不存在 not_found；id 非法 bad_request。
   */
  getReceiverSnippet(id: string): Promise<ApiResponse<ReceiverSnippetData>> {
    return apiClient.get<ReceiverSnippetData>(
      `/api/v2/platform/alertmanager/notify-channels/${encodeURIComponent(id)}/receiver-snippet`,
    )
  },
}

/**
 * 默认接收人（根兜底）设定 API（T08-11，决策 113 口径 C）。
 *
 * 选定默认接收人 = 授权平台在生成配置时**只替换** alertmanager.yml 根 `route.receiver` 单键
 * （不触碰 group_by / 三个时间字段 / continue，不写 route.routes[]）；`null` = 关闭接管（护栏③：
 * 停止替换、不删最后写入的值）。写端点需管理员权限（非 admin 403），渠道不存在/未启用 → 400
 * bad_request；响应**不含下发状态**（决策 60 冻结）。
 */
export const routeSettingApi = {
  /** 读取设定并派生生效态视图（登录态） */
  get(): Promise<ApiResponse<RouteSetting>> {
    return apiClient.get<RouteSetting>('/api/v2/platform/alertmanager/route-setting')
  },
  /** 写入设定（admin）：写入后与挂载同构触发重算 + 自动下发；响应返回最新生效视图 */
  update(payload: UpdateRouteSettingPayload): Promise<ApiResponse<RouteSetting>> {
    return apiClient.put<RouteSetting>('/api/v2/platform/alertmanager/route-setting', { body: payload })
  },
}

/**
 * 通知模板管理 API（PL-3 通知渲染桥，提案 §3.3.2/§3.3.8；M08 内容 Owner）。
 * 端点尚未写入 api-contract-snapshot.md，契约权威 = 设计提案 §3.3 + 任务卡 wire 格式，待回写。
 * 模板内容为 Alertmanager 标准 Go template（不是脚本）；校验在服务端做，校验失败不落库。
 */
export const notifyTemplatesApi = {
  /** 模板列表（含 total；内置模板 is_builtin=true，随版本升级） */
  list(): Promise<ApiResponse<NotifyTemplatesData>> {
    return apiClient.get<NotifyTemplatesData>('/api/v2/platform/alertmanager/notify-templates')
  },
  /** 提交模板（admin）：服务端校验 Go template，失败返回 400 bad_request（data.items 行级错误），校验通过才落库留痕 */
  submit(input: SubmitNotifyTemplatePayload): Promise<ApiResponse<NotifyTemplate>> {
    return apiClient.post<NotifyTemplate>('/api/v2/platform/alertmanager/notify-templates', { body: input })
  },
  /** 回滚：把该历史版本内容重新提交为新的留痕（name 指定新留痕名称） */
  remount(id: string, name: string): Promise<ApiResponse<NotifyTemplate>> {
    return apiClient.post<NotifyTemplate>(
      `/api/v2/platform/alertmanager/notify-templates/${encodeURIComponent(id)}/remount`,
      { body: { name } },
    )
  },
  /** 删除自定义模板（admin）：内置模板不可删除；不存在 not_found */
  remove(id: string): Promise<ApiResponse<{ id: string }>> {
    return apiClient.delete<{ id: string }>(
      `/api/v2/platform/alertmanager/notify-templates/${encodeURIComponent(id)}`,
    )
  },
}

/**
 * 路由规则（route 前台化）只读视图 API（T08-12 / T08-F10，v0.3-a）。
 *
 * 仅全局认证、只读、无写能力；响应成功为 `{ mode, items, dead_receivers }`，
 * 解析失败降级为 `{ mode, parse_error, raw_yaml }`（非 500、不白屏）。
 * 契约权威：platform/alertmanager/route/handler.go（api-contract-snapshot.md 待回写）。
 */
export const alertmanagerRoutesApi = {
  /** 只读路由树视图（当前生效 alertmanager.yml 的 route 段解析结果） */
  getRoutes(): Promise<ApiResponse<RouteTreeData>> {
    return apiClient.get<RouteTreeData>('/api/v2/platform/alertmanager/routes')
  },
}