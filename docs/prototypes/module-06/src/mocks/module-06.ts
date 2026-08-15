export interface Tenant {
  id: string
  name: string
  /** {v1.3} 租户被授权可使用的网域 ID 列表（由 Module_06 分配），不等于这些网域均已接入监控 */
  networkDomainIds: string[]
  networkDomainNames: string[]
  /** {v1.3} 在这些网域中已完成监控纳管的子集（由 Module_09 维护，演示用） */
  monitoredNetworkDomainIds?: string[]
  cmdbBusinessId: string
  cmdbBusinessPath: string
  isPlatformAdmin: boolean
  status: 'active' | 'inactive'
}

/**
 * {v1.3} 网域行政记录（M06 为 NetworkDomain 的行政 Owner）：
 * 本模块负责网域的创建 / 编辑 / 禁用与租户分配，表单只维护行政信息（名称、租户、状态、描述），
 * 不维护监控参数（agent_type / remote_write_url 等，由 Module_09 纳管时填写）。
 */
export interface NetworkDomain {
  id: string
  name: string
  description: string
  /** 网域类型：default 管理域由系统预置，其余为边缘网域 */
  domain_type: 'management' | 'edge'
  /** 网域归属租户（1 网域 : 1 租户，创建后不可变更） */
  tenant_id: string
  status: 'active' | 'disabled'
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

export const mockTenants: Tenant[] = [
  {
    id: 't-platform',
    name: '平台运营部',
    networkDomainIds: ['nd-default', 'nd-edge', 'nd-manufacturing'],
    networkDomainNames: ['default', 'edge', 'manufacturing'],
    monitoredNetworkDomainIds: ['nd-default', 'nd-edge'],
    cmdbBusinessId: 'bk-biz-1',
    cmdbBusinessPath: '平台 / 基础设施',
    isPlatformAdmin: true,
    status: 'active',
  },
  {
    id: 't-ecommerce',
    name: '电商业务',
    networkDomainIds: ['nd-default'],
    networkDomainNames: ['default'],
    monitoredNetworkDomainIds: ['nd-default'],
    cmdbBusinessId: 'bk-biz-2',
    cmdbBusinessPath: '业务 / 电商',
    isPlatformAdmin: false,
    status: 'active',
  },
  {
    id: 't-finance',
    name: '金融业务',
    networkDomainIds: ['nd-finance'],
    networkDomainNames: ['finance'],
    monitoredNetworkDomainIds: [],
    cmdbBusinessId: 'bk-biz-3',
    cmdbBusinessPath: '业务 / 金融',
    isPlatformAdmin: false,
    status: 'inactive',
  },
]

/**
 * {v1.3} 网域行政记录（M06 行政 Owner / M09 监控纳管 Owner，PRD v1.3 职责边界）：
 * - nd-default：系统预置中心管理域，归属 platform_admin 预置租户（演示中为 t-platform），默认已纳管
 * - registration_status 为只读演示字段，模拟「已由 Module_09 纳管」的回显，M06 页面不可编辑
 */
export const mockNetworkDomains: NetworkDomain[] = [
  {
    id: 'nd-default',
    name: 'default',
    description: '系统预置中心管理域，承载单机与中心采集模式',
    domain_type: 'management',
    tenant_id: 't-platform',
    status: 'active',
    registration_status: 'monitored',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-08-10 09:00:00',
  },
  {
    id: 'nd-edge',
    name: 'edge',
    description: '边缘接入网域，通过 Edge Agent 单向 HTTPS 出站接入',
    domain_type: 'edge',
    tenant_id: 't-platform',
    status: 'active',
    registration_status: 'monitored',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-08-10 09:00:00',
  },
  {
    id: 'nd-finance',
    name: 'finance',
    description: '金融专网网域（行政已禁用，未纳管监控）',
    domain_type: 'edge',
    tenant_id: 't-finance',
    status: 'disabled',
    registration_status: 'created',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-08-01 10:00:00',
  },
  {
    id: 'nd-manufacturing',
    name: 'manufacturing',
    description: '制造边缘节点网域（行政已创建，待 Module_09 纳管）',
    domain_type: 'edge',
    tenant_id: 't-platform',
    status: 'active',
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
    tenantName: '电商业务',
    status: 'active',
    email: 'zhangsan@example.com',
  },
  {
    id: 'u-003',
    username: 'lisi',
    displayName: '李四',
    role: 'operator',
    tenantId: 't-ecommerce',
    tenantName: '电商业务',
    status: 'active',
  },
  {
    id: 'u-004',
    username: 'wangwu',
    displayName: '王五',
    role: 'operator',
    tenantId: 't-finance',
    tenantName: '金融业务',
    status: 'inactive',
  },
  {
    id: 'u-005',
    username: 'zhaoliu',
    displayName: '赵六',
    role: 'viewer',
    tenantId: 't-ecommerce',
    tenantName: '电商业务',
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
    description: '创建租户：金融业务',
    diff: {
      name: { new: '金融业务' },
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
    description: '禁用租户：金融业务',
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
