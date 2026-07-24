export interface Alert {
  id: string
  name: string
  severity: 'critical' | 'warning' | 'info'
  summary: string
  description: string
  network_domain_id: string
  scope: 'central' | 'edge' | 'both'
  inhibitable: boolean
  inhibited: boolean
  labels: Record<string, string>
  firedAt: string
}

export const alerts: Alert[] = [
  {
    id: '1',
    name: 'EdgeSiteOffline',
    severity: 'critical',
    summary: '网域 finance-dmz 边缘 Agent 失联超过 5 分钟',
    description: '边缘 Agent ea-finance-01 最后心跳 2026-07-24 13:50:00，已触发告警抑制规则。',
    network_domain_id: 'finance-dmz',
    scope: 'central',
    inhibitable: false,
    inhibited: false,
    labels: { network_domain: 'finance-dmz', agent_id: 'ea-finance-01' },
    firedAt: '2026-07-24 13:55:00',
  },
  {
    id: '2',
    name: 'HostDown',
    severity: 'critical',
    summary: '主机 node-exporter-finance 不可达',
    description: 'instance 10.0.3.10:9100 up=0，已被 EdgeSiteOffline 抑制。',
    network_domain_id: 'finance-dmz',
    scope: 'central',
    inhibitable: true,
    inhibited: true,
    labels: { instance: '10.0.3.10:9100', app: 'payment-service', env: 'staging', cluster: 'sh-01', network_domain: 'finance-dmz' },
    firedAt: '2026-07-24 13:56:00',
  },
  {
    id: '3',
    name: 'HostDiskUsageHigh',
    severity: 'critical',
    summary: '主机 disk 使用率超过 85%',
    description: 'instance 10.0.1.10:9100 的 /data 分区使用率已达 91%，预计 2 小时内写满。',
    network_domain_id: 'default',
    scope: 'central',
    inhibitable: false,
    inhibited: false,
    labels: { instance: '10.0.1.10:9100', app: 'order-service', env: 'prod', cluster: 'bj-01', network_domain: 'default' },
    firedAt: '2026-07-21 09:12:00',
  },
  {
    id: '4',
    name: 'MiddlewareConnectionPoolHigh',
    severity: 'warning',
    summary: 'MySQL 连接池使用率超过 80%',
    description: 'instance 10.0.1.50:3306 当前连接池使用率 83%。',
    network_domain_id: 'default',
    scope: 'central',
    inhibitable: false,
    inhibited: false,
    labels: { instance: '10.0.1.50:3306', app: 'order-service', env: 'prod', cluster: 'bj-01', middleware_type: 'mysql', network_domain: 'default' },
    firedAt: '2026-07-21 08:45:00',
  },
  {
    id: '5',
    name: 'ApplicationHealthCheckFailed',
    severity: 'critical',
    summary: '订单服务拨测失败',
    description: 'Blackbox probe 连续 3 次检测到 https://order.example.com/api/health 返回非 2xx。',
    network_domain_id: 'default',
    scope: 'central',
    inhibitable: true,
    inhibited: false,
    labels: { target: 'https://order.example.com/api/health', app: 'order-service', env: 'prod', cluster: 'bj-01', network_domain: 'default' },
    firedAt: '2026-07-21 08:30:00',
  },
]
