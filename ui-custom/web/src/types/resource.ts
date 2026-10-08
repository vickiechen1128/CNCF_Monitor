/**
 * 资源领域类型
 *
 * 与 Module_07 §5 数据模型对齐。Phase 0 引入五类权威枚举 `ResourceCategory`
 * （host / database / middleware / application / generic_target），
 * `ResourceType` 保留为过渡别名（resource_type 字段仍用于向后兼容）。
 */

/** 五类资源权威枚举（Phase 0） */
export type ResourceCategory = 'host' | 'database' | 'middleware' | 'application' | 'generic_target'

/** 过渡别名，与后端 resource_type 字段一致（保留兼容） */
export type ResourceType = ResourceCategory

/** 共享基座字段（ResourceBase），五类资源共同承载 */
export interface ResourceBaseShape {
  id: number
  resource_id: string
  tenant_id: string
  resource_type: ResourceType
  resource_category: ResourceCategory
  network_domain_id: string
  /**
   * 云归属（决策 103 scheme-B）：**只读派生**——值 = 所属网域 `cloud_code`，
   * 由后端列表/详情派生下发；资源侧无写入口，不随创建/更新请求体。
   */
  cloud_code?: string
  /**
   * 网络分区（决策 103 scheme-B）：**只读派生**——值 = 所属网域 `zone_type`，
   * 五类资源均返回（不再仅限 host）；资源侧无写入口。
   */
  zone_type?: string
  /**
   * 平台归属（决策 110 / §5.24）：`platform` **不是派生标签而是资源行一等业务字段**——
   * 平台归属是登记期第一个确定的业务信息，`platform` 标签取值由本字段唯一确定
   * （经标签模板 `platform_code → platform` 映射注入）；未显式填写时兜底取所属应用主平台
   * （`app_platform_rel.is_primary`），仍未确定则不注入 `platform`。
   * 可空（五类通用），与只读派生的 `cloud_code` / `zone_type` 不同——创建 / 更新均可显式填写。
   */
  platform_code?: string
  biz_code: string
  env: string
  owner: string
  status: string
  created_at: string
  updated_at: string
  deleted_at?: string
}

export interface Host extends ResourceBaseShape {
  resource_type: 'host'
  resource_category: 'host'
  app_code: string
  sub_app_code: string
  env_flag: 'SIT' | 'PRD'
  server_id: string
  instance_name: string
  cluster: string
  region: string
  zone_env: 'INT' | 'GOV'
  instance_spec: string
  vcpu: number
  memory_gb: number
  image: string
  system_disk_gb: number
  data_disk_gb: number
  public_ip: string
  bandwidth: number
  private_subnet: string
  private_ip: string
  purpose: string
  vpc: string
  security_group: string
  expired_at?: string
}

export interface Database extends ResourceBaseShape {
  resource_type: 'database'
  resource_category: 'database'
  app_code: string | null
  cluster: string | null
  source_type: 'manual' | 'import' | 'cmdb'
  database_type: string
  instance_ip: string
  port: number
  version: string
  connection_string: string
}

export interface Middleware extends ResourceBaseShape {
  resource_type: 'middleware'
  resource_category: 'middleware'
  app_code: string
  cluster: string
  middleware_type: string
  instance_ip: string
  port: number
  version: string
  connection_string: string
}

export interface Application extends ResourceBaseShape {
  resource_type: 'application'
  resource_category: 'application'
  app_code: string
  cluster: string
  service_name: string
  health_check_url: string
  protocol: string
  endpoint: string
  port: number
  /** {v2.45 决策 105} 可选服务归属（列表/详情「服务」列按 service_code 解析展示） */
  service_code?: string
}

export interface GenericTarget extends ResourceBaseShape {
  resource_type: 'generic_target'
  resource_category: 'generic_target'
  app_code: string | null
  cluster: string | null
  source_type: 'manual' | 'import' | 'cmdb'
  target_name: string
  instance_ip: string
  port: number
  metrics_path: string
  scheme: string
  exporter_type: string
  custom_labels: Record<string, string>
  /** {v2.45 决策 105} 可选服务归属（同 application，留空不注入 `svc`） */
  service_code?: string
}

export type Resource = Host | Database | Middleware | Application | GenericTarget

/**
 * 资源写请求 / 导入 / 业务字典 / 标签相关类型（T07-F1）
 *
 * 与 Module_07 §5.2/§5.3/§5.16/§6.2/§6.4 对齐。
 */

/** 资源运行状态（§5.2 / §8.1，UI 展示名「运行状态」） */
export type ResourceStatus = 'online' | 'offline' | 'maintenance'

/** 资源创建公共字段（resource_category 创建必传，§5.2） */
export interface ResourceCreateBaseShape {
  resource_category: ResourceCategory
  network_domain_id: string
  biz_code: string
  app_code?: string
  /**
   * {v2026-09-28 决策 110} 平台归属（UI 展示名「平台归属」）：**资源行一等业务字段**、可空。
   * 登记期显式填写；`null` / `undefined` 均表达「留空」，`platform` 标签兜底取所属应用主平台。
   */
  platform_code?: string | null
  // 决策 103 scheme-B：**无 cloud_code 字段**——云由所属网域派生，创建请求不接受该字段。
  env: string
  cluster?: string
  owner?: string
  status?: ResourceStatus
}

/** 主机差异化字段（§5.6） */
export interface HostResourceFields {
  instance_name: string
  hostname?: string
  instance_ip: string
  os_type?: string
}

/** 数据库差异化字段（§5.7.1） */
export interface DatabaseResourceFields {
  database_type: string
  instance_ip: string
  port: number
  version?: string
}

/** 中间件差异化字段（§5.7） */
export interface MiddlewareResourceFields {
  middleware_type: string
  instance_ip: string
  port: number
  version?: string
}

/** 应用服务差异化字段（§5.8 / 决策 105：service_code 可选，`svc` 标签取值来源） */
export interface ApplicationResourceFields {
  service_name: string
  endpoint: string
  health_check_url?: string
  protocol?: string
  port?: number
  /**
   * {v2.45 决策 105} 可选服务归属（`svc` label 取值 = `service_code`）：
   * 仅 application / generic_target 适用，留空合法（不注入 `svc` 标签）。
   */
  service_code?: string
}

/** 通用指标目标差异化字段（§5.9 / 决策 105：service_code 可选） */
export interface GenericTargetResourceFields {
  target_name: string
  instance_ip: string
  port?: number
  metrics_path?: string
  scheme?: string
  exporter_type?: string
  custom_labels?: Record<string, string>
  /** {v2.45 决策 105} 可选服务归属（同 application，留空不注入 `svc`） */
  service_code?: string
}

/** 资源创建输入（按 resource_category 判别联合；biz_code 必填，resource_category 创建必传） */
export type ResourceCreateInput =
  | ({ resource_category: 'host' } & ResourceCreateBaseShape & HostResourceFields)
  | ({ resource_category: 'database' } & ResourceCreateBaseShape & DatabaseResourceFields)
  | ({ resource_category: 'middleware' } & ResourceCreateBaseShape & MiddlewareResourceFields)
  | ({ resource_category: 'application' } & ResourceCreateBaseShape & ApplicationResourceFields)
  | ({ resource_category: 'generic_target' } & ResourceCreateBaseShape & GenericTargetResourceFields)

/** 资源更新公共字段（resource_category/source_type 创建后不可改，不随请求体，§6.1/T07-06） */
export interface ResourceUpdateBaseShape {
  network_domain_id?: string
  biz_code?: string
  app_code?: string
  /**
   * {v2026-09-28 决策 110} 平台归属（UI 展示名「平台归属」）：**资源行一等业务字段**、可空。
   * 显式赋值即覆盖兜底取值；`null` 表达「清空平台归属」（编辑态取消选择），`undefined` 表达「不改」。
   */
  platform_code?: string | null
  // 决策 103 scheme-B：**无 cloud_code 字段**——云由所属网域派生，更新请求不接受该字段。
  env?: string
  cluster?: string
  owner?: string
  status?: ResourceStatus
}

/** 资源更新输入（各类型差异化字段均可选，按类型部分更新） */
export type ResourceUpdateInput =
  | (ResourceUpdateBaseShape & Partial<HostResourceFields>)
  | (ResourceUpdateBaseShape & Partial<DatabaseResourceFields>)
  | (ResourceUpdateBaseShape & Partial<MiddlewareResourceFields>)
  | (ResourceUpdateBaseShape & Partial<ApplicationResourceFields>)
  | (ResourceUpdateBaseShape & Partial<GenericTargetResourceFields>)

/** 业务分组字典条目（§3.1 / T07-02，MVP 只读接口） */
export interface BusinessDomain {
  code: string
  name: string
  description?: string
  enabled: boolean
}

/**
 * 应用字典条目（§5.19 / 决策 92）：与业务分组的双层编码同构——
 * `app_code` 为不可变编码（`app` label 的唯一取值来源），`app_name` 为必填展示名。
 */
export interface ApplicationDict {
  app_code: string
  app_name: string
  description?: string
  status: 'enabled' | 'disabled'
  /**
   * @deprecated {v2.49 决策 111} 应用↔平台改 M:N，关联权威迁至 `app_platform_rel`
   * （`GET /api/v2/platform/app-platform-rel`）；存量单值已一次性转入该表（`is_primary=true`）。
   *
   * {v2026-10-03 决策 118-3} 写链路（`ApplicationDictCreateInput` / `ApplicationDictUpdateInput`）
   * 与 generator 读取侧**均已退役**，本字段**全仓生产消费者归零**，仅保留只读响应兼容。
   * **禁止**再据本字段派生资源「平台」列——资源 `platform_code` 是一等字段（决策 110），
   * 资源视图的平台归属一律读 `ResourceListItem.platform_code`。
   */
  platform_code?: string
}

/**
 * 应用↔平台关联条目（§5.24 / 决策 111）：应用↔平台由「应用单值可选父级」改为 **M:N**
 * （一套软件可同时在多个平台部署），关联表 `app_platform_rel(app_code, platform_code, is_primary)`。
 *
 * - **`is_primary` 唯一性**：同一 `app_code` 至多一个 `is_primary=true`（服务端校验，应用表单「主平台」单选）。
 * - **兜底用途**：资源行未显式填写 `platform_code` 时，`platform` 标签兜底取该应用的唯一主平台（决策 110）。
 * - **停用 / 解绑**：平台停用保留历史关联、不自动解绑；解绑时不强制改写存量资源（§5.24）。
 */
export interface AppPlatformRel {
  rel_id: string
  app_code: string
  platform_code: string
  is_primary: boolean
  created_at?: string
}

/**
 * 平台字典条目（§5.21 / 决策 104；契约快照 §5C）：四层实体层级
 * `platform(1) → app(N) → service(M) → instance(K)` 的顶层。
 *
 * `platform_code` 为**不可变**编码（`platform` label 的唯一取值来源），`platform_name` 为必填展示名；
 * 启用状态按契约快照 §5C 以 `enabled` 布尔承载（停用不删除、无删除入口）。
 */
export interface PlatformDict {
  platform_code: string
  platform_name: string
  description?: string
  enabled: boolean
}

/**
 * 服务字典条目（§5.22 / 决策 105；契约快照 §5D）：四层实体层级的第三层
 * `platform(1) → app(N) → service(M) → instance(K)`，一个应用可含多个服务。
 *
 * `service_code` 为**不可变**编码（`svc` label 的唯一取值来源），`service_name` 为必填展示名；
 * 启用状态按契约快照 §5D 以 `enabled` 布尔承载（停用不删除、无删除入口）。
 *
 * **{v2.49 决策 112} 关系字段（推翻原「本字典不设父子字段」口径）**：字典承载
 * 应用↔服务（1:N，`app_code`）与服务↔业务（N:1 主归属，`biz_code`）的**关系权威**——
 * 跨实例的实体关系无法从资源行稳定推导（某服务当前无实例时关系即丢失）；
 * 资源行 `app_code` / `service_code` 仅为**实例归属的镜像**。
 */
export interface ServiceDict {
  service_code: string
  service_name: string
  /** 所属应用（应用字典主键，可空）——应用↔服务 1:N 的关系权威 */
  app_code?: string | null
  /** 主业务（业务分组字典主键，可空）——服务↔业务 N:1 的主归属权威 */
  biz_code?: string | null
  description?: string
  enabled: boolean
}

/**
 * 云字典条目（§5.20 / 决策 98 / 102）：**一个云 = 云类型 × 云载体的组合整体**——
 * `cloud_code` 是不可变复合码（`{类型}-{载体}`，如 `PUB-TX`），是 `cloud` label 的唯一取值来源；
 * `cloud_name` 为必填展示名（仅 UI 展示，改动不触发配置重生成）；
 * `cloud_type` / `carrier` 仅为条目**描述属性**——不独立成列 / 成筛选维度 / 成 label。
 * 云字典随部署预置、**全局只读**（后端无写接口，前端不提供登记入口，决策 102-③）。
 */
export interface CloudDict {
  cloud_code: string
  cloud_name: string
  cloud_type: string
  carrier: string
  enabled: boolean
}

/** 操作系统内置字典条目（os_dict.go，GET /api/v2/platform/os-options）：规范名 + 家族 */
export interface OSOption {
  name: string
  /** 监控家族：linux / windows（对齐 host_linux / host_windows） */
  family: 'linux' | 'windows'
}

/** 资源标签来源（§5.3 / §8.2） */
export type ResourceLabelSource = 'system' | 'user' | 'cmdb'

/** 资源标签项（§5.3 / §6.2，GET /resources/:resource_id/labels 返回 {items,total}） */
export interface ResourceLabelItem {
  id: number
  key: string
  value: string
  source: ResourceLabelSource
  /** system 标签来源映射标注，如 "app_code→app"（§5.3 联动呈现） */
  source_map?: string
}

/** 导入错误行（§5.16.3） */
export interface ImportError {
  row: number
  resource_category: ResourceCategory
  field: string
  value?: string
  reason: string
}

/** Excel 导入结果（§5.16.3；upsert 含 updated，create_only 无 updated） */
export interface ImportResult {
  total: number
  success: number
  updated?: number
  failed: number
  errors: ImportError[]
}

/** 导入模式（§6.1 / T07-10） */
export type ImportMode = 'create_only' | 'upsert'

/** 导入记录（§6.4 / T07-10，status: success / partial / failed） */
export interface ImportRecord {
  id: number
  import_no: string
  resource_category: ResourceCategory
  mode: ImportMode
  total: number
  success: number
  updated: number
  failed: number
  status: 'success' | 'partial' | 'failed'
  errors: ImportError[]
  operator: string
  created_at: string
}