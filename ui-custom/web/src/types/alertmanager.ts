/**
 * Module_08 告警收敛与通知管理 类型定义（alertmanager）。
 * 权威契约：docs/05-execution-records/module-08/api-contract-snapshot.md（第一权威）。
 * 字段名使用 snake_case 对齐后端 JSON；禁止反向以 platform/models/*.go 为实现依据。
 */

/** M08 分页信封：本模块接口统一返回 `{ items, total }`（与 M09 一致，非 M06 的 `list`）。 */
export interface PaginatedItems<T> {
  items: T[]
  total: number
}

/** 配置版本状态：校验失败不落库（决策 60），本表恒为 applied */
export type AlertmanagerConfigStatus = 'applied'

/** 静默状态（Alertmanager 运行时状态） */
export type SilenceStatus = 'active' | 'pending' | 'expired'

/**
 * Alertmanager 配置版本（详情 / 当前生效返回完整含 content）。
 * 对应 alertmanager.yml 挂载留痕（决策 59/60）：M08 为内容侧 Owner。
 */
export interface AlertmanagerConfigVersion {
  id: string
  /** alertmanager.yml 完整内容（详情与当前生效返回；列表返回不含以省流量） */
  content: string
  /** 配置内容 sha256 */
  checksum: string
  /** 写入并 reload 成功时间（M09 下发回写后才回填） */
  applied_at?: string
  /** 应用人（M09 下发回写） */
  applied_by?: string
  /** 本表恒为 applied（校验失败不落库，决策 60） */
  status: AlertmanagerConfigStatus
  /** 挂载留痕时间 */
  created_at?: string
  /** 关联 M09 变更单号（决策 60，管道侧确认后可见） */
  source_change_no?: string
}

/** 配置版本列表项（不含 content，省流量） */
export interface AlertmanagerConfigVersionListItem {
  id: string
  checksum: string
  applied_at?: string
  applied_by?: string
  status: AlertmanagerConfigStatus
  created_at?: string
  source_change_no?: string
}

/**
 * 行级校验错误项（挂载 POST /config 校验失败返回，不落库不进流水线）。
 * file 恒为 alertmanager.yml（单文件挂载）；line=0 表示无行号。
 */
export interface ValidateErrorItem {
  file: string
  line: number
  message: string
}

/** 校验失败响应 data（契约 §3：bad_request，error.data 形如 `{ items, note }`） */
export interface ValidateErrorData {
  items: ValidateErrorItem[]
  /** 契约 note：校验失败未保存、未生效；修改后请重新挂载 */
  note?: string
}

/** 静默 matcher（标签匹配条件，契约 §4 Matcher） */
export interface SilenceMatcher {
  name: string
  value: string
  /** true=`=`（相等）false=`!=` */
  is_equal?: boolean
  /** true=正则匹配 */
  is_regex?: boolean
}

/** 静默规则（Alertmanager silence，经 M08 服务端代理，运行时状态即时生效） */
export interface Silence {
  id: string
  matchers: SilenceMatcher[]
  starts_at: string
  ends_at: string
  created_by?: string
  /** 静默原因 */
  comment: string
  /** active / pending / expired */
  status: SilenceStatus
}

/** 创建静默请求体（契约 §4 POST /silences，字段必填见契约 §7） */
export interface CreateSilencePayload {
  matchers: SilenceMatcher[]
  starts_at: string
  ends_at: string
  comment: string
  created_by?: string
}

/** 静默 matcher 标签选项（契约 §4 LabelOptionGroup.items，v1.16 决策 71） */
export interface SilenceLabelOption {
  name: string
  description?: string
}

/**
 * 标签选项分组（契约 §4 LabelOptionGroup）。
 * source 枚举：target_system（系统与采集标签）/ template（标签模板产出）/
 * rule（规则标签）/ external（网域标识）——对应决策 71 四层并集。
 */
export interface SilenceLabelOptionGroup {
  source: 'target_system' | 'template' | 'rule' | 'external'
  label: string
  items: SilenceLabelOption[]
}

/** GET /silences/label-options 响应 data */
export interface SilenceLabelOptionsData {
  groups: SilenceLabelOptionGroup[]
}

// =====================================================================
// 告警状态查看（v1.12 MVP 增量，契约快照 §10，Track B+）
// =====================================================================

/**
 * 实例展示字段组（M08 v1.15 决策 70，契约快照 §10.1/§10.2）：
 * 三条告警读取链路（Prom 当前告警 / 历史告警 / AM 通知状态）同构，JSON 平铺。
 */
export interface AlertInstanceFields {
  /**
   * 采集地址：Prometheus 抓取地址 `ip:exporter端口`（拨测 / application 为 URL）。
   * **不是实例名、端口不是业务端口**，UI 表头须提示；聚合 / 全局告警为空串。
   */
  instance_address?: string
  /** 兼容字段（后端保留）：resource_name 非空取之，否则取标签回落链 */
  instance_display?: string
  /** M01 资源 ID（告警标签 resource_id，决策 47-3 强制注入） */
  resource_id?: string
  /** M01 资源清单口径的实例名（host=instance_name、database/middleware=instance_ip 等）；无 resource_id 时为空串 */
  resource_name?: string
  /** 五类资源枚举（host / database / middleware / application / generic_target）；未命中为空串 */
  resource_category?: string
  /** 资源 IP；未命中为空串 */
  resource_ip?: string
  /** 资源业务端口（与采集地址中的 exporter 端口不同）；0 表示该类别无业务端口 */
  resource_port?: number
}

/** Prometheus 当前触发告警状态（契约 §10.1）：firing=触发中 / pending=待处理 */
export type PromAlertState = 'firing' | 'pending'

/** Prometheus 当前触发告警实例（M02 代理 GET /api/v1/alerts，data.alerts[] 字段子集） */
export interface PromAlertItem extends AlertInstanceFields {
  /** 告警标签（含 alertname / severity / network_domain / instance） */
  labels: Record<string, string>
  /** 告警注解（summary / description） */
  annotations: Record<string, string>
  /** firing（触发中）/ pending（待处理） */
  state: PromAlertState
  /** 激活时间（进入 pending 的时间） */
  activeAt: string
  /** 当前值（告警表达式当前求值） */
  value?: string
}

/** GET /api/v1/alerts 响应 data 信封（空结果返回 [] 而非 null） */
export interface PromAlertsData {
  alerts: PromAlertItem[]
}

/** AM 通知状态四态（服务端归一，契约 §10.2，映射逻辑在后端，前端不重复映射） */
export type NotifyStatus = 'active' | 'silenced' | 'inhibited' | 'unprocessed'

/** AM v2 GettableAlert 状态子集（输入字段，不直接外露；notify_status 已服务端归一） */
export interface AmAlertStatus {
  state?: string
  silenced_by?: string[]
  inhibited_by?: string[]
}

/** Alertmanager 通知状态告警项（M08 代理 GET /api/v2/platform/alertmanager/alerts，data.items[]） */
export interface AmAlertItem extends AlertInstanceFields {
  /** 告警标签（alertname / severity / network_domain / instance，UI 展示名同契约 §10.1） */
  labels: Record<string, string>
  /** 告警注解（summary / description） */
  annotations: Record<string, string>
  /** 开始时间（告警进入 AM 时间） */
  starts_at: string
  /** 结束时间（告警预计结束时间） */
  ends_at?: string
  status?: AmAlertStatus
  /** 通知状态四态（服务端归一）：active=通知中 / silenced=已静默 / inhibited=已抑制 / unprocessed=待处理 */
  notify_status: NotifyStatus
}

/** GET /api/v2/platform/alertmanager/alerts 响应 data 信封（空结果返回 [] 而非 null） */
export interface AmAlertsData {
  items: AmAlertItem[]
}

// =====================================================================
// 历史告警（M02 v1.13 + M08 v1.13，Track B+）
// =====================================================================

/** 历史告警状态：firing=查询窗口结束时仍在触发 / resolved=触发区间已结束 */
export type AlertHistoryState = 'firing' | 'resolved'

/** 历史告警记录（M02 §5.4 / M08 §3.1） */
export interface AlertHistoryItem extends AlertInstanceFields {
  alertname: string
  instance: string
  network_domain: string
  state: AlertHistoryState
  fired_at: string
  resolved_at?: string
  duration_seconds: number
  summary: string
  value: string
}

/** GET /api/v1/alerts/history 响应 data 信封（空结果 list=[] 非 null） */
export interface AlertHistoryData {
  list: AlertHistoryItem[]
  total: number
  page: number
  page_size: number
}