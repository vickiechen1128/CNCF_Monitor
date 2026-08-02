export interface GatewayRoute {
  id: string
  path: string
  targetService: string
  method: string
  status: 'enabled' | 'disabled'
  description: string
}

export interface RolePermission {
  role: string
  roleName: string
  pages: string[]
  actions: string[]
}

export const mockRoutes: GatewayRoute[] = [
  {
    id: 'r-001',
    path: '/api/v1/query',
    targetService: 'prometheus-query',
    method: 'GET',
    status: 'enabled',
    description: 'PromQL 查询代理',
  },
  {
    id: 'r-002',
    path: '/api/v1/config/*',
    targetService: 'platform-config',
    method: 'ANY',
    status: 'enabled',
    description: '配置管理 API 路由',
  },
  {
    id: 'r-003',
    path: '/api/v1/ingest',
    targetService: 'ingestion-gateway',
    method: 'POST',
    status: 'enabled',
    description: '指标写入网关',
  },
  {
    id: 'r-004',
    path: '/api/v1/admin/*',
    targetService: 'platform-admin',
    method: 'ANY',
    status: 'disabled',
    description: '平台管理接口（MVP 未启用）',
  },
  {
    id: 'r-005',
    path: '/api/v1/audit',
    targetService: 'audit-service',
    method: 'POST',
    status: 'enabled',
    description: '请求级审计日志上报',
  },
  {
    id: 'r-006',
    path: '/api/v1/sd/*',
    targetService: 'service-discovery',
    method: 'ANY',
    status: 'enabled',
    description: '服务发现接口',
  },
]

export const mockRolePermissions: RolePermission[] = [
  {
    role: 'platform_admin',
    roleName: '平台管理员',
    pages: ['全部页面'],
    actions: ['查看', '新增', '编辑', '删除', '授权', '系统配置'],
  },
  {
    role: 'tenant_admin',
    roleName: '租户管理员',
    pages: ['网关路由', '认证配置', 'Provider 配置', '同步策略', '租户管理', '用户与权限'],
    actions: ['查看', '新增', '编辑', '删除（本租户）'],
  },
  {
    role: 'operator',
    roleName: '运维工程师',
    pages: ['网关路由', 'Provider 配置', '同步策略', '待分类 CI', '孤儿资源', '审计日志'],
    actions: ['查看', '编辑'],
  },
  {
    role: 'viewer',
    roleName: '只读用户',
    pages: ['网关路由', 'Provider 配置', '同步策略', '审计日志'],
    actions: ['查看'],
  },
]

export const authModes = ['none', 'basic_auth', 'token', 'sso'] as const
export type AuthMode = (typeof authModes)[number]

export const mockAuthConfig = {
  mode: 'none' as AuthMode,
  sessionTtlMinutes: 120,
  ssoCallbackUrl: 'https://metric-center.example.com/auth/sso/callback',
}
