export interface DashboardStats {
  totalResources: number
  monitoredCount: number
  scrapeJobs: number
  activeAlerts: number
  networkDomains: number
  monitoringSources: number
}

export interface RecentAlert {
  id: string
  name: string
  severity: 'critical' | 'warning' | 'info'
  resource: string
  summary: string
  firedAt: string
  status: 'firing' | 'resolved'
}

export interface AgentStatus {
  id: string
  networkDomain: string
  version: string
  lastHeartbeat: string
  status: 'online' | 'offline'
  targets: number
}

// —— 决策 51：Grafana 监控大屏（iframe 嵌入）mock ——

/** Grafana 数据源红线：必须指向 M02 查询代理，禁止直连 Prometheus（见 Module_02 §1 可视化边界） */
export interface GrafanaDatasource {
  name: string
  type: string
  url: string
  readonly: boolean
  redLine: string
}

/** 预置仪表盘模板（读模板只读、可克隆；克隆后自由编辑；升级覆盖模板不影响用户副本） */
export interface DashboardTemplate {
  id: string
  name: string
  ciType: string
  description: string
  readonly: boolean
  cloneable: boolean
  tags: string[]
  updatedAt: string
}

export interface GovernanceDrilldown {
  networkDomain: string
  bizCode: string
  app: string
  instance: string
}

export const mockGrafanaDatasource: GrafanaDatasource = {
  name: 'metric-center-proxy',
  type: 'Prometheus',
  url: 'http://metric-center:8080/api/v1',
  readonly: true,
  redLine: '数据源必须指向 M02 查询代理（metric-center:8080），禁止直连 Prometheus 实例（租户/网域注入红线）。',
}

export const mockDashboardTemplates: DashboardTemplate[] = [
  {
    id: 'tpl-host',
    name: '主机基础监控',
    ciType: '主机',
    description: 'CPU / 内存 / 磁盘 / 网络四维总览，按网域 → 业务 → 应用 → 实例下钻。',
    readonly: true,
    cloneable: true,
    tags: ['主机', '系统', 'base'],
    updatedAt: '2026-08-31',
  },
  {
    id: 'tpl-mysql',
    name: 'MySQL 性能监控',
    ciType: '中间件',
    description: '连接数、慢查询、缓冲池命中率等核心指标。',
    readonly: true,
    cloneable: true,
    tags: ['MySQL', '数据库', 'base'],
    updatedAt: '2026-08-31',
  },
  {
    id: 'tpl-probe',
    name: '拨测可用性',
    ciType: '拨测',
    description: 'HTTP / TCP / ICMP 探针可用性与延迟分布。',
    readonly: true,
    cloneable: true,
    tags: ['拨测', 'blackbox', '可用性'],
    updatedAt: '2026-08-31',
  },
]

/** 四层下钻的治理标签默认值（dashboard variables 的 label_values 查询走 M02 代理） */
export const mockGovernanceOptions: GovernanceDrilldown = {
  networkDomain: 'default',
  bizCode: 'Iaas',
  app: 'nginx-prod',
  instance: '10.0.0.11:9100',
}

export const mockNetworkDomains = ['default', 'edge', 'finance']
export const mockBizCodes = ['Iaas', 'PaaS', 'Saas']
export const mockApps = ['nginx-prod', 'mysql-master', 'order-service']
export const mockInstances = ['10.0.0.11:9100', '10.0.0.12:9100', '10.0.1.5:9100']

export const mockDashboardStats: DashboardStats = {
  totalResources: 1248,
  monitoredCount: 986,
  scrapeJobs: 64,
  activeAlerts: 7,
  networkDomains: 4,
  monitoringSources: 12,
}

export const mockRecentAlerts: RecentAlert[] = [
  {
    id: 'alt-001',
    name: '主机 CPU 使用率过高',
    severity: 'critical',
    resource: 'prod-web-01',
    summary: 'CPU 使用率持续 5 分钟超过 90%',
    firedAt: '2026-08-02 09:32:00',
    status: 'firing',
  },
  {
    id: 'alt-002',
    name: '磁盘空间不足',
    severity: 'warning',
    resource: 'prod-db-01',
    summary: '根分区使用率超过 85%',
    firedAt: '2026-08-02 09:15:00',
    status: 'firing',
  },
  {
    id: 'alt-003',
    name: '服务拨测失败',
    severity: 'critical',
    resource: 'order-service-v2',
    summary: '/health 接口连续 3 次无响应',
    firedAt: '2026-08-02 08:58:00',
    status: 'resolved',
  },
  {
    id: 'alt-004',
    name: '内存使用率偏高',
    severity: 'warning',
    resource: 'redis-cache-01',
    summary: '内存使用率达到 80%',
    firedAt: '2026-08-02 08:40:00',
    status: 'firing',
  },
  {
    id: 'alt-005',
    name: '节点离线',
    severity: 'critical',
    resource: 'edge-node-03',
    summary: 'Agent 超过 5 分钟未上报心跳',
    firedAt: '2026-08-02 08:12:00',
    status: 'firing',
  },
]

export const mockAgentStatus: AgentStatus[] = [
  {
    id: 'ag-default-01',
    networkDomain: 'default',
    version: 'v0.4.2',
    lastHeartbeat: '2026-08-02 09:39:00',
    status: 'online',
    targets: 312,
  },
  {
    id: 'ag-default-02',
    networkDomain: 'default',
    version: 'v0.4.2',
    lastHeartbeat: '2026-08-02 09:38:30',
    status: 'online',
    targets: 298,
  },
  {
    id: 'ag-edge-01',
    networkDomain: 'edge',
    version: 'v0.4.1',
    lastHeartbeat: '2026-08-02 09:30:00',
    status: 'offline',
    targets: 156,
  },
  {
    id: 'ag-finance-01',
    networkDomain: 'finance',
    version: 'v0.4.2',
    lastHeartbeat: '2026-08-02 09:39:10',
    status: 'online',
    targets: 220,
  },
]

export const SEVERITY_COLORS: Record<RecentAlert['severity'], string> = {
  critical: '#FF4C3A',
  warning: '#FA8C16',
  info: '#1481FD',
}
