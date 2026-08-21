export interface Tenant {
  id: string
  name: string
  /** {v2.0} 租户被授权可使用的网域 ID 列表（授权 ≠ 拥有；网域为部署级资源，登记所有权归 platform_admin，授权不转移所有权）；不等于这些网域均已接入监控 */
  networkDomainIds: string[]
  networkDomainNames: string[]
  /** {v1.3} 在这些网域中已完成监控纳管的子集（由 Module_09 维护，演示用） */
  monitoredNetworkDomainIds?: string[]
  /**
   * {v2.0} 行政能力开关：是否允许该租户**被授权使用多个网域**（决策 18~20）。
   * 注意：该开关不控制 Module_09 页面入口显示/隐藏（M09 入口由数据驱动）；
   * false 时平台侧仅授权该租户单个网域（通常为 default），M09 仍可查看 default 网域及其纳管状态。
   */
  multi_site_enabled: boolean
  /**
   * {v1.9} 租户与业务解耦（决策 12~17）：租户是权限/管理边界（对应运维团队/组织），
   * 业务（biz_code / biz_name）是监控对象分组维度、由 Module_07 维护，租户不再承载 CMDB 业务映射字段。
   */
  isPlatformAdmin: boolean
  status: 'active' | 'inactive'
}

/**
 * {v2.0} 网域行政记录（M06 为 NetworkDomain 的行政 Owner，PRD v2.0 决策 18~20）：
 * 网域为部署级资源、可跨租户共享：登记归属（tenant_id）为部署级登记方（MVP 固定 platform_admin），
 * 登记 ≠ 独占——通过 authorized_tenant_ids 授权多个租户共享使用（授权 ≠ 拥有）。
 * 表单只维护行政信息（名称、登记归属、授权租户、状态、描述、zone_type），
 * 不维护监控参数（agent_type / remote_write_url 等，由 Module_09 纳管时填写）。
 */
export interface NetworkDomain {
  id: string
  name: string
  description: string
  /** 网域类型：default 管理域由系统预置，其余为边缘网域 */
  domain_type: 'management' | 'edge'
  /** 登记归属租户 ID（部署级登记方，MVP 固定 platform_admin）；登记 ≠ 独占，网域可授权多个租户共享 */
  tenant_id: string
  /** {v2.0} 被授权可使用该网域的租户 ID 列表（1 网域 : N 租户，可跨租户共享）；由 M06 维护授权关系，授权 ≠ 拥有，不等于已纳管 */
  authorized_tenant_ids?: string[]
  status: 'active' | 'disabled'
  /**
   * {v1.4} 网络区域类型（行政分类字段，表达网络隔离/位置语义）：
   * - 值集为部署级字典（ZONE_TYPE_OPTIONS），UI 以下拉选择呈现，不开放自由文本；
   * - 由 M06 在网域创建/编辑时登记，M09 纳管时只读引用并注入指标标签；
   * - 空字符串表示未登记（如 default 管理域由中心直接采集，无网闸拓扑，不适用）。
   */
  zone_type: string
  /**
   * 监控纳管状态：只读展示字段，由 Module_09 的纳管动作维护；
   * created = 行政已创建未纳管；monitored = 已由 M09 完成监控纳管
   */
  registration_status: 'created' | 'monitored'
  created_at: string
  updated_at: string
}

export type UserRole = 'platform_admin' | 'tenant_admin' | 'operator' | 'viewer'

export interface User {
  id: string
  username: string
  displayName: string
  role: UserRole
  tenantId?: string
  tenantName?: string
  status: 'active' | 'inactive'
  email?: string
}

export type AuditAction = 'create' | 'update' | 'delete' | 'login' | 'sync'

export interface AuditLog {
  id: string
  action: AuditAction
  resourceType: string
  resourceId: string
  operator: string
  operatedAt: string
  diff?: Record<string, { old?: unknown; new?: unknown }>
  description: string
}

export interface PlatformSettings {
  tsdbRetentionDays: number
  remoteWriteForwardEnabled: boolean
  minScrapeIntervalSeconds: number
  maxScrapeIntervalSeconds: number
}

export const ROLE_LABELS: Record<UserRole, string> = {
  platform_admin: '平台管理员',
  tenant_admin: '租户管理员',
  operator: '运维工程师',
  viewer: '只读用户',
}

export const ACTION_LABELS: Record<AuditAction, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  login: '登录',
  sync: '同步',
}

/**
 * {v1.4} 网络区域类型部署级字典（模拟平台配置文件维护的值集，PRD v2.2 决策 23：
 * 由只读接口 GET /api/v2/platform/zone-types 提供，仅返回启用中的字典项）：
 * - 不做死枚举：不同客户环境预置不同词汇——政务云预置 互联网区/政务外网区/专线区/DMZ，
 *   公有云预置按 region 划分（如 cn-hangzhou）；
 * - UI 以下拉选择呈现，不开放自由文本；
 * - 一句话原则：隔离边界建实体（NetworkDomain），位置维度建属性（zone_type），叫法建字典（部署级词汇表）。
 */
export interface ZoneTypeOption {
  value: string
  label: string
  description: string
}

export const ZONE_TYPE_OPTIONS: ZoneTypeOption[] = [
  { value: 'internet', label: '互联网区（internet）', description: '政务云预置：面向互联网访问的隔离区' },
  { value: 'extranet', label: '政务外网区（extranet）', description: '政务云预置：政务外网隔离区' },
  { value: 'private-line', label: '专线区（private-line）', description: '政务云预置：专线接入隔离区' },
  { value: 'dmz', label: 'DMZ（dmz）', description: '政务云预置：非军事化隔离区' },
  { value: 'cn-hangzhou', label: 'cn-hangzhou', description: '公有云预置：杭州 region' },
  { value: 'cn-beijing', label: 'cn-beijing', description: '公有云预置：北京 region' },
]

export const zoneTypeLabelOf = (value: string) =>
  ZONE_TYPE_OPTIONS.find((z) => z.value === value)?.label ?? (value ? value : '未登记')

export const mockTenants: Tenant[] = [
  {
    id: 't-platform',
    name: '平台运营部',
    networkDomainIds: ['nd-default', 'nd-edge', 'nd-manufacturing'],
    networkDomainNames: ['default', 'edge', 'manufacturing'],
    monitoredNetworkDomainIds: ['nd-default', 'nd-edge'],
    multi_site_enabled: true,
    isPlatformAdmin: true,
    status: 'active',
  },
  {
    id: 't-ecommerce',
    name: '电商研发部',
    networkDomainIds: ['nd-default'],
    networkDomainNames: ['default'],
    monitoredNetworkDomainIds: ['nd-default'],
    multi_site_enabled: false,
    isPlatformAdmin: false,
    status: 'active',
  },
  {
    id: 't-finance',
    name: '金融运维部',
    networkDomainIds: ['nd-finance'],
    networkDomainNames: ['finance'],
    monitoredNetworkDomainIds: [],
    multi_site_enabled: false,
    isPlatformAdmin: false,
    status: 'inactive',
  },
]

/**
 * {v2.0} 网域行政记录（M06 行政 Owner / M09 监控纳管 Owner，PRD v2.0 职责边界）：
 * - nd-default：系统预置中心管理域，登记归属 platform_admin（t-platform），被授权使用：平台运营部 + 电商研发部（演示「1 网域 : N 租户」跨租户共享），默认已纳管
 * - 登记归属（tenant_id）为部署级登记方，MVP 固定 t-platform；登记 ≠ 独占，通过 authorized_tenant_ids 授权多个租户共享使用
 * - registration_status 为只读演示字段，模拟「已由 Module_09 纳管」的回显，M06 页面不可编辑
 * - zone_type（v1.4）：由 M06 登记的行政字段；default 管理域由中心直接采集、无网闸拓扑，留空不适用
 */
export const mockNetworkDomains: NetworkDomain[] = [
  {
    id: 'default',
    name: 'default',
    description: '系统预置中心管理域，承载单机与中心采集模式',
    domain_type: 'management',
    tenant_id: 't-platform',
    authorized_tenant_ids: ['t-platform', 't-ecommerce'],
    status: 'active',
    zone_type: '',
    registration_status: 'monitored',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-08-10 09:00:00',
  },
  {
    id: 'mc-edge',
    name: 'edge',
    description: '边缘接入网域，通过 Edge Agent 单向 HTTPS 出站接入',
    domain_type: 'edge',
    tenant_id: 't-platform',
    authorized_tenant_ids: ['t-platform'],
    status: 'active',
    zone_type: 'internet',
    registration_status: 'monitored',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-08-10 09:00:00',
  },
  {
    id: 'mc-finance',
    name: 'finance',
    description: '金融专网网域（登记归属平台运营部，授权金融运维部使用；行政已禁用，未纳管监控）',
    domain_type: 'edge',
    tenant_id: 't-platform',
    authorized_tenant_ids: ['t-finance'],
    status: 'disabled',
    zone_type: 'private-line',
    registration_status: 'created',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-08-01 10:00:00',
  },
  {
    id: 'mc-manufacturing',
    name: 'manufacturing',
    description: '制造边缘节点网域（行政已创建，待 Module_09 纳管）',
    domain_type: 'edge',
    tenant_id: 't-platform',
    authorized_tenant_ids: ['t-platform'],
    status: 'active',
    zone_type: 'extranet',
    registration_status: 'created',
    created_at: '2026-07-20 00:00:00',
    updated_at: '2026-08-10 09:00:00',
  },
]

export const mockUsers: User[] = [
  {
    id: 'u-001',
    username: 'admin',
    displayName: '系统管理员',
    role: 'platform_admin',
    status: 'active',
    email: 'admin@example.com',
  },
  {
    id: 'u-002',
    username: 'zhangsan',
    displayName: '张三',
    role: 'tenant_admin',
    tenantId: 't-ecommerce',
    tenantName: '电商研发部',
    status: 'active',
    email: 'zhangsan@example.com',
  },
  {
    id: 'u-003',
    username: 'lisi',
    displayName: '李四',
    role: 'operator',
    tenantId: 't-ecommerce',
    tenantName: '电商研发部',
    status: 'active',
  },
  {
    id: 'u-004',
    username: 'wangwu',
    displayName: '王五',
    role: 'operator',
    tenantId: 't-finance',
    tenantName: '金融运维部',
    status: 'inactive',
  },
  {
    id: 'u-005',
    username: 'zhaoliu',
    displayName: '赵六',
    role: 'viewer',
    tenantId: 't-ecommerce',
    tenantName: '电商研发部',
    status: 'active',
  },
  {
    id: 'u-006',
    username: 'ops-sre',
    displayName: 'SRE 值班',
    role: 'operator',
    tenantId: 't-platform',
    tenantName: '平台运营部',
    status: 'active',
  },
]

export const mockAuditLogs: AuditLog[] = [
  {
    id: 'log-001',
    action: 'create',
    resourceType: 'tenant',
    resourceId: 't-finance',
    operator: 'admin',
    operatedAt: '2026-08-01 10:00:00',
    description: '创建租户：金融运维部',
    diff: {
      name: { new: '金融运维部' },
      status: { new: 'active' },
    },
  },
  {
    id: 'log-002',
    action: 'update',
    resourceType: 'tenant',
    resourceId: 't-finance',
    operator: 'admin',
    operatedAt: '2026-08-01 14:30:00',
    description: '禁用租户：金融运维部',
    diff: {
      status: { old: 'active', new: 'inactive' },
    },
  },
  {
    id: 'log-003',
    action: 'delete',
    resourceType: 'gateway_route',
    resourceId: 'r-004',
    operator: 'zhangsan',
    operatedAt: '2026-08-01 16:00:00',
    description: '删除网关路由 /api/v1/admin/*',
  },
  {
    id: 'log-004',
    action: 'sync',
    resourceType: 'cmdb_provider',
    resourceId: 'p-bk-001',
    operator: 'system',
    operatedAt: '2026-08-02 09:00:00',
    description: 'BlueKing 主 CMDB 全量同步成功，新增 12 条资源',
  },
  {
    id: 'log-005',
    action: 'update',
    resourceType: 'platform_settings',
    resourceId: 'global',
    operator: 'admin',
    operatedAt: '2026-08-02 09:20:00',
    description: '更新平台配置：TSDB retention 改为 30 天',
    diff: {
      tsdbRetentionDays: { old: 15, new: 30 },
    },
  },
  {
    id: 'log-006',
    action: 'login',
    resourceType: 'user',
    resourceId: 'u-002',
    operator: 'zhangsan',
    operatedAt: '2026-08-02 09:35:00',
    description: '用户登录成功',
  },
  {
    id: 'log-007',
    action: 'create',
    resourceType: 'sync_policy',
    resourceId: 'sp-004',
    operator: 'lisi',
    operatedAt: '2026-08-02 08:00:00',
    description: '创建同步策略：K8s 事件 + 轮询',
  },
]

export const mockPlatformSettings: PlatformSettings = {
  tsdbRetentionDays: 30,
  remoteWriteForwardEnabled: false,
  minScrapeIntervalSeconds: 15,
  maxScrapeIntervalSeconds: 300,
}
