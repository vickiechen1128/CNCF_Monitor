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