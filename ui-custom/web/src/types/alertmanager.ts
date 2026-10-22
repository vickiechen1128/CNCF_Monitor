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

/**
 * 配置版本状态（2026-10-13 dev-feedback #44 废弃联动修订）：
 *   - applied：已收录为 M09 下发源（applied_at 为空 = 待确认下发；有值 = 已生效）；
 *   - discarded：已废弃终态——变更单被废弃（用户废弃 / 被更新单取代）后，已无活
 *     pending 单可确认的留痕一律标记此态，不再显示「已提交，待确认下发」。
 */
export type AlertmanagerConfigStatus = 'applied' | 'discarded'

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
  /** applied（待确认下发 / 已生效）或 discarded（已废弃，dev-feedback #44） */
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

/** 校验失败响应 data（契约 §3：bad_request，error.data 形如 `{ items, note, cause }`） */
export interface ValidateErrorData {
  items: ValidateErrorItem[]
  /** 契约 note：校验失败未保存、未生效；修改后请重新挂载 */
  note?: string
  /**
   * 校验归因（决策 / dev-feedback 口径）：
   * - `user_config`：你的配置内容有错，按 `items` 行级提示修改后重新提交；
   * - `platform_fault`：平台校验服务暂不可用（校验工具缺失 / 不可执行），不是你的问题，稍后重试或联系管理员。
   */
  cause?: string
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
  /** 实际生效的 query_range 步长（秒）：窗口过宽时服务端会抬高，见决策 90 */
  step?: number
}

// =====================================================================
// 通知渲染桥（PL-3，2026-09-28）：通知渠道 + 通知模板
// 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
// =====================================================================

/** 通知渠道类型（机器人）：飞书 / 钉钉 / 企业微信 */
export type NotifyChannelType = 'feishu' | 'dingtalk' | 'wecom'

/**
 * 通知渠道（机器人 Webhook 目标，提案 §3.3.2）。
 * AM 侧桥 URL 只引用渠道 ID，目标地址仅平台侧存储、响应严格脱敏。
 */
export interface NotifyChannel {
  /** 数字串 ID（如 `"1"`，即 BaseModel.ID 的十进制字符串）；AM 桥 URL 只引用该 ID */
  id: string
  /** 渠道名称（如「SRE 飞书群」） */
  name: string
  type: NotifyChannelType
  /** 已脱敏展示值（`scheme://host/***`）；原值不回显 */
  webhook_url: string
  /** secret 永不回显，仅告知是否已设置 */
  secret_set: boolean
  /** 渠道在 alertmanager.yml 中的稳定 receiver 名（恒为 notify-<id>，与 M09 生成器同源）；
   * 非敏感字段，列表即回显。供前端批量派生「已知接收人」清单，避免逐渠道调用
   * admin-only 的 receiver-snippet 接口（H1）。 */
  receiver_name?: string
  /** 当前生效 / 待确认路由树中引用该渠道 receiver 的节点数；0 = 未被路由使用 */
  route_reference_count?: number
  /** 绑定的通知模板 ID（缺省 = 使用平台内置默认模板）；渠道 ↔ 模板一等绑定（dev-feedback #30） */
  default_template_id?: number
  /** RFC3339 */
  created_at: string
}

/** 通知模板列表项（不含 content；2026-10-22 起模板为可编辑实体，不再有版本历史） */
export interface NotifyTemplate {
  id: string
  name: string
  /** 适用渠道类型（创建后不可修改；与渠道类型匹配后才可组合） */
  channel_type: NotifyChannelType
  /** 平台内置默认模板（随版本升级，只读；可复制为自定义模板） */
  is_builtin: boolean
  /** 被多少个通知渠道显式绑定（删除前提示用） */
  bound_channel_count: number
  /** RFC3339 */
  created_at: string
  /** RFC3339 */
  updated_at: string
}

/** 通知模板详情（含 Alertmanager 标准 Go template 文本，不是脚本） */
export interface NotifyTemplateDetail extends NotifyTemplate {
  content: string
}

/** 创建通知渠道请求体（name/type/webhook_url 必填） */
export interface CreateNotifyChannelPayload {
  name: string
  type: NotifyChannelType
  webhook_url: string
  secret?: string
  /** 绑定的通知模板 ID（可选；不传 = 使用平台内置默认模板） */
  default_template_id?: number
}

/**
 * 更新通知渠道请求体：**仅传需修改字段**；不传 `webhook_url` / `secret` 即保留原值
 * （响应已脱敏，编辑表单不得把 `***` 回填提交）。
 * `default_template_id`：不传 = 保留原绑定；`0` = 解绑（回落内置默认）；>0 = 改为该模板。
 */
export interface UpdateNotifyChannelPayload {
  name?: string
  type?: NotifyChannelType
  webhook_url?: string
  secret?: string
  default_template_id?: number
}

/** 新建 / 编辑通知模板请求体（content 为 Alertmanager 标准 Go template） */
export interface SubmitNotifyTemplatePayload {
  name: string
  channel_type: NotifyChannelType
  content: string
}

/** GET /notify-channels 响应 data 信封 */
export interface NotifyChannelsData {
  items: NotifyChannel[]
}

/**
 * 接收人配置片段（PL-3 T08-12，B 路线；Module_08 §3.3.5）。
 * 服务端按渠道 ID 拼好可参考的 `alertmanager.yml` `receivers:` YAML 片段（内嵌真实数字渠道 ID；
 * 桥令牌走 `http_config.authorization` 请求头，不写进 URL query）。B 路线：已启用渠道的接收人由平台
 * 生成配置时自动写入，本片段仅在用户**手写自定义 receiver** 时作参考。
 * 令牌未配置（`token_configured=false`）时 url / snippet 用占位符，片段不可直接使用。
 */
export interface ReceiverSnippetData {
  /** 接收人名（恒为 notify-<渠道ID>，与 M09 物化同源） */
  receiver_name: string
  /** 桥接地址（`?id=<渠道ID>`；桥令牌不入 URL，令牌未配置时为占位符） */
  url: string
  /** 可参考的 `receivers:` YAML 片段 */
  snippet: string
  /** 桥令牌是否已配置；false 时 UI 必须显式告警（片段无法发出通知） */
  token_configured: boolean
}

/** GET /notify-templates 响应 data 信封（含 total） */
export interface NotifyTemplatesData {
  items: NotifyTemplate[]
  total: number
}

// =====================================================================
// route 前台化：路由树只读视图 + 用户直接编辑（后端 GET /routes；保存复用 POST /config）
// 契约权威：platform/alertmanager/route/handler.go（api-contract-snapshot.md 待回写）。
// =====================================================================

/**
 * 归一后的单条路由匹配条件（对齐 `RouteMatcher`，字段名 snake_case）。
 * `is_equal=false` 表示取反（`!=` / `!~`）；`is_regex=true` 为正则匹配（`=~` / `!~`）。
 */
export interface RouteMatcher {
  name: string
  value: string
  is_equal: boolean
  is_regex: boolean
}

/**
 * 路由树节点（前序扁平数组的元素，`items[0]` 恒为顶层路由）。
 * `id` / `parent_id` / `order` 为编辑态内部标识（不落盘，仅供渲染树与定位）；
 * `locked=true` 对应 Alertmanager 的最外层 `route:` 本体，不可删、不可移。
 * `matchers` / `group_by` 缺省为空数组（非 null）。
 */
export interface RouteNode {
  /** 稳定路径标识：根为 `"root"`，子为 `"<parent>/<同层下标>"` */
  id: string
  /** 父节点 ID（根为空串） */
  parent_id: string
  /** 路由名称（注释 `# 路由名称: xxx` 还原；无注释为空串，绝不造值） */
  name: string
  matchers: RouteMatcher[]
  receiver: string
  group_by: string[]
  group_wait: string
  group_interval: string
  repeat_interval: string
  continue: boolean
  /** 同级 `routes[]` 数组位置（0-based；顶层恒 0） */
  order: number
  /** 顶层路由标记 */
  locked: boolean
  /** route 级未建模键（如旧式 match / mute_time_intervals）的原样 YAML 片段；后端解析时捕获 */
  raw?: string
}

/** 编辑态单条匹配条件（与后端 generator.RouteEditMatcher 字段一致） */
export interface RouteEditMatcher {
  name: string
  value: string
  /** true=`=` / `=~`（相等）；false=`!=` / `!~`（取反） */
  is_equal: boolean
  /** true=正则匹配（`=~` / `!~`） */
  is_regex: boolean
}

/**
 * 编辑态路由节点（前序扁平序列，`items[0]` 为根路由）。
 * 保存时原样提交给后端，由后端生成 route YAML。
 */
export interface RouteEditNode {
  id: string
  parent_id: string
  name: string
  matchers: RouteEditMatcher[]
  receiver: string
  group_by: string[]
  group_wait: string
  group_interval: string
  repeat_interval: string
  continue: boolean
  order: number
  enabled: boolean
  /** 不可表达子树的原文（整节点替换）；前端编辑路径通常为空串 */
  raw_yaml: string
  /** route 级未建模键的原样 YAML 片段（节点内附加键） */
  raw: string
}

/**
 * GET `/api/v2/platform/alertmanager/routes` 响应 data（只读、无写能力）。
 * 成功：`{ items, declared_receivers }`；
 * 解析失败 / 非常规结构降级：`{ parse_error, raw_yaml }`（此时无 `items`，非 500、不白屏）。
 *
 * `declared_receivers` = 生效 YAML `receivers:` 段已声明的**全集**（含用户手写），
 * 供前端判「路由引用的接收人是否悬空」。手写 receiver 必须在其中，否则合法配置被误判
 * 为「未定义」而阻断保存。
 */
export interface RouteTreeData {
  /** 前序扁平节点序列（`items[0]` = 顶层路由）；解析失败时缺省 */
  items?: RouteNode[]
  /** 当前合并基（生效产品视图 YAML）的 sha256，进入编辑时作为 base_checksum 回传 */
  effective_checksum?: string
  /** 管理域当前活 pending 变更单（存在即表示页面展示的是待确认版本） */
  pending?: {
    change_no: string
    created_at: string
  } | null
  /** 生效配置 `receivers:` 段已声明的接收人名（全集，含手写）；解析失败时仍可能存在 */
  declared_receivers?: string[]
  /** 解析失败原因（成功时缺省） */
  parse_error?: string
  /** 解析失败时的 alertmanager.yml 原文（降级为只读展示） */
  raw_yaml?: string
}

/** POST `/api/v2/platform/alertmanager/routes` 请求体：只提交结构化路由树，不提交 YAML */
export interface SaveRoutesPayload {
  /** 进入编辑时 GET /routes 返回的 effective_checksum（乐观锁） */
  base_checksum: string
  route_tree: RouteEditNode[]
}

/** 路由保存成功响应 data */
export interface SaveRoutesResult {
  version: AlertmanagerConfigVersion
  /** 本次生成的 pending 变更单号（无则缺省） */
  change_no?: string
}