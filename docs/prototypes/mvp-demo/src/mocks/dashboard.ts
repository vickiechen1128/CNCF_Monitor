export const dashboardStats = {
  resources: {
    host: 128,
    middleware: 46,
    application: 89,
    total: 263,
  },
  networkDomains: {
    total: 3,
    online: 2,
    offline: 1,
  },
  monitoringSources: {
    total: 5,
    online: 3,
    offline: 1,
    disabled: 1,
  },
  collectionCoverage: 87.5,
  activeAlerts: 5,
  inhibitedAlerts: 1,
  pendingAlerts: 7,
  scrapeJobs: 12,
  probeConfigs: 5,
  latestAlerts: [
    { id: '1', name: 'EdgeSiteOffline', severity: 'critical', summary: '网域 finance-dmz 边缘 Agent 失联超过 5 分钟', network_domain_id: 'finance-dmz', firedAt: '2026-07-24 13:55:00' },
    { id: '2', name: 'HostDown', severity: 'critical', summary: '主机 node-exporter-finance 不可达（已抑制）', network_domain_id: 'finance-dmz', firedAt: '2026-07-24 13:56:00' },
    { id: '3', name: 'HostDiskUsageHigh', severity: 'critical', summary: '主机 disk 使用率超过 85%', network_domain_id: 'default', firedAt: '2026-07-21 09:12:00' },
  ],
  recentActivities: [
    { id: '1', action: '下发配置', operator: 'admin', time: '2026-07-24 14:25:00', result: '成功（gov-cloud-a）' },
    { id: '2', action: '注册监控源', operator: 'admin', time: '2026-07-24 14:00:00', result: '业务网已有 Prometheus' },
    { id: '3', action: '导入主机资源', operator: 'admin', time: '2026-07-21 09:30:00', result: '成功 128 条' },
    { id: '4', action: '创建采集 Job', operator: 'admin', time: '2026-07-21 09:15:00', result: 'node-exporter-prod' },
  ],
}
