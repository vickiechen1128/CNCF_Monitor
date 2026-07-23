export const dashboardStats = {
  resources: {
    host: 128,
    middleware: 46,
    application: 89,
    total: 263,
  },
  collectionCoverage: 87.5,
  activeAlerts: 3,
  pendingAlerts: 7,
  scrapeJobs: 12,
  probeConfigs: 5,
  latestAlerts: [
    { id: '1', name: 'HostDiskUsageHigh', severity: 'critical', summary: '主机 disk 使用率超过 85%', firedAt: '2026-07-21 09:12:00' },
    { id: '2', name: 'MiddlewareConnectionPoolHigh', severity: 'warning', summary: 'MySQL 连接池使用率超过 80%', firedAt: '2026-07-21 08:45:00' },
    { id: '3', name: 'ApplicationHealthCheckFailed', severity: 'critical', summary: '订单服务拨测失败', firedAt: '2026-07-21 08:30:00' },
  ],
  recentActivities: [
    { id: '1', action: '下发配置', operator: 'admin', time: '2026-07-21 10:00:00', result: '成功' },
    { id: '2', action: '导入主机资源', operator: 'admin', time: '2026-07-21 09:30:00', result: '成功 128 条' },
    { id: '3', action: '创建采集 Job', operator: 'admin', time: '2026-07-21 09:15:00', result: 'node-exporter-prod' },
  ],
}
