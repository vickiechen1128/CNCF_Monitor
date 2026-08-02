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
