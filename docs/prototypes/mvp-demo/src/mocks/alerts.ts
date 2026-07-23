export interface Alert {
  id: string
  name: string
  severity: 'critical' | 'warning' | 'info'
  summary: string
  description: string
  labels: Record<string, string>
  firedAt: string
}

export const alerts: Alert[] = [
  {
    id: '1',
    name: 'HostDiskUsageHigh',
    severity: 'critical',
    summary: '主机 disk 使用率超过 85%',
    description: 'instance 10.0.1.10:9100 的 /data 分区使用率已达 91%，预计 2 小时内写满。',
    labels: { instance: '10.0.1.10:9100', app: 'order-service', env: 'prod', cluster: 'bj-01' },
    firedAt: '2026-07-21 09:12:00',
  },
  {
    id: '2',
    name: 'MiddlewareConnectionPoolHigh',
    severity: 'warning',
    summary: 'MySQL 连接池使用率超过 80%',
    description: 'instance 10.0.1.50:3306 当前连接池使用率 83%。',
    labels: { instance: '10.0.1.50:3306', app: 'order-service', env: 'prod', cluster: 'bj-01', middleware_type: 'mysql' },
    firedAt: '2026-07-21 08:45:00',
  },
  {
    id: '3',
    name: 'ApplicationHealthCheckFailed',
    severity: 'critical',
    summary: '订单服务拨测失败',
    description: 'Blackbox probe 连续 3 次检测到 https://order.example.com/api/health 返回非 2xx。',
    labels: { target: 'https://order.example.com/api/health', app: 'order-service', env: 'prod', cluster: 'bj-01' },
    firedAt: '2026-07-21 08:30:00',
  },
]
