export type ProviderType = 'blueking' | 'http' | 'nacos' | 'kubernetes'

export interface CMDBProvider {
  id: string
  name: string
  type: ProviderType
  networkDomainId: string
  networkDomainName: string
  syncCycleMinutes: number
  status: 'enabled' | 'disabled'
  config: Record<string, string>
  lastSyncAt: string
}

export type SyncStrategy = 'full' | 'incremental'
export type SyncStatus = 'success' | 'running' | 'failed' | 'idle'

export interface SyncPolicy {
  id: string
  name: string
  providerId: string
  providerName: string
  strategy: SyncStrategy
  fallbackPollingMinutes: number
  lastSyncAt: string
  nextRunAt: string
  status: SyncStatus
  failureHandling: string
}

export type PendingReason = 'unmapped' | 'disabled_type' | 'missing_field'

export interface PendingCI {
  id: string
  providerId: string
  providerName: string
  bkObjId?: string
  resourceType?: string
  rawData: Record<string, unknown>
  reason: PendingReason
  createdAt: string
}

export interface OrphanResource {
  id: string
  networkDomainId: string
  networkDomainName: string
  resourceType: string
  instanceName: string
  instanceIp?: string
  deletedSource: string
  deletedAt: string
  retentionDeadline: string
}

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  blueking: 'BlueKing',
  http: 'HTTP',
  nacos: 'Nacos',
  kubernetes: 'Kubernetes',
}

export const PENDING_REASON_LABELS: Record<PendingReason, string> = {
  unmapped: '未映射 CI 类型',
  disabled_type: '已禁用类型',
  missing_field: '缺少必填字段',
}

export const PENDING_REASON_COLORS: Record<PendingReason, string> = {
  unmapped: '#FA8C16',
  disabled_type: '#86909C',
  missing_field: '#FF4C3A',
}

export const mockProviders: CMDBProvider[] = [
  {
    id: 'p-bk-001',
    name: 'BlueKing 主 CMDB',
    type: 'blueking',
    networkDomainId: 'nd-default',
    networkDomainName: 'default',
    syncCycleMinutes: 15,
    status: 'enabled',
    config: {
      bkBaseUrl: 'https://cmdb.example.com',
      bkBizId: '2',
      username: 'metriccenter',
    },
    lastSyncAt: '2026-08-02 09:15:00',
  },
  {
    id: 'p-http-001',
    name: '资产平台 HTTP 接口',
    type: 'http',
    networkDomainId: 'nd-default',
    networkDomainName: 'default',
    syncCycleMinutes: 30,
    status: 'enabled',
    config: {
      endpoint: 'https://assets.example.com/api/resources',
      authType: 'bearer',
    },
    lastSyncAt: '2026-08-02 08:45:00',
  },
  {
    id: 'p-nacos-001',
    name: 'Nacos 服务发现',
    type: 'nacos',
    networkDomainId: 'nd-edge',
    networkDomainName: 'edge',
    syncCycleMinutes: 10,
    status: 'disabled',
    config: {
      serverAddr: 'http://nacos-edge.example.com:8848',
      namespace: 'prod',
    },
    lastSyncAt: '2026-08-01 22:00:00',
  },
  {
    id: 'p-k8s-001',
    name: 'Kubernetes 自动发现',
    type: 'kubernetes',
    networkDomainId: 'nd-edge',
    networkDomainName: 'edge',
    syncCycleMinutes: 5,
    status: 'enabled',
    config: {
      kubeconfig: '/etc/metriccenter/kubeconfig-edge',
      namespaces: 'default,monitoring',
    },
    lastSyncAt: '2026-08-02 09:18:00',
  },
]

export const mockSyncPolicies: SyncPolicy[] = [
  {
    id: 'sp-001',
    name: 'BlueKing 全量同步',
    providerId: 'p-bk-001',
    providerName: 'BlueKing 主 CMDB',
    strategy: 'full',
    fallbackPollingMinutes: 15,
    lastSyncAt: '2026-08-02 09:00:00',
    nextRunAt: '2026-08-02 10:00:00',
    status: 'success',
    failureHandling: '告警并保留上次成功快照',
  },
  {
    id: 'sp-002',
    name: 'HTTP 增量同步',
    providerId: 'p-http-001',
    providerName: '资产平台 HTTP 接口',
    strategy: 'incremental',
    fallbackPollingMinutes: 30,
    lastSyncAt: '2026-08-02 08:45:00',
    nextRunAt: '2026-08-02 09:15:00',
    status: 'running',
    failureHandling: '重试 3 次后标记失败',
  },
  {
    id: 'sp-003',
    name: 'Nacos 事件同步',
    providerId: 'p-nacos-001',
    providerName: 'Nacos 服务发现',
    strategy: 'incremental',
    fallbackPollingMinutes: 15,
    lastSyncAt: '2026-08-01 22:00:00',
    nextRunAt: '2026-08-02 09:30:00',
    status: 'failed',
    failureHandling: '暂停同步并通知运维',
  },
  {
    id: 'sp-004',
    name: 'K8s 事件 + 轮询',
    providerId: 'p-k8s-001',
    providerName: 'Kubernetes 自动发现',
    strategy: 'incremental',
    fallbackPollingMinutes: 5,
    lastSyncAt: '2026-08-02 09:18:00',
    nextRunAt: '2026-08-02 09:23:00',
    status: 'idle',
    failureHandling: '指数退避重试',
  },
]

export const mockPendingCIs: PendingCI[] = [
  {
    id: 'pci-001',
    providerId: 'p-bk-001',
    providerName: 'BlueKing 主 CMDB',
    bkObjId: 'bk_router',
    reason: 'unmapped',
    rawData: { bk_inst_name: 'router-core-01', bk_asset_id: 'R-1001', ip: '172.16.0.1' },
    createdAt: '2026-08-02 09:10:00',
  },
  {
    id: 'pci-002',
    providerId: 'p-bk-001',
    providerName: 'BlueKing 主 CMDB',
    bkObjId: 'bk_firewall',
    resourceType: 'generic_target',
    reason: 'disabled_type',
    rawData: { bk_inst_name: 'fw-perimeter-01', bk_asset_id: 'FW-2001' },
    createdAt: '2026-08-02 09:12:00',
  },
  {
    id: 'pci-003',
    providerId: 'p-http-001',
    providerName: '资产平台 HTTP 接口',
    resourceType: 'host',
    reason: 'missing_field',
    rawData: { hostname: 'prod-web-99', os_type: 'Linux' },
    createdAt: '2026-08-02 08:50:00',
  },
  {
    id: 'pci-004',
    providerId: 'p-http-001',
    providerName: '资产平台 HTTP 接口',
    resourceType: 'middleware',
    reason: 'missing_field',
    rawData: { instance_name: 'mq-01', middleware: 'rabbitmq' },
    createdAt: '2026-08-02 08:55:00',
  },
  {
    id: 'pci-005',
    providerId: 'p-k8s-001',
    providerName: 'Kubernetes 自动发现',
    reason: 'unmapped',
    rawData: { pod_name: 'custom-daemon-xyz', namespace: 'kube-system', labels: { app: 'unknown' } },
    createdAt: '2026-08-02 09:20:00',
  },
]

export const mockOrphans: OrphanResource[] = [
  {
    id: 'orp-001',
    networkDomainId: 'nd-default',
    networkDomainName: 'default',
    resourceType: 'host',
    instanceName: 'prod-web-retired-01',
    instanceIp: '10.0.1.99',
    deletedSource: 'BlueKing 主 CMDB',
    deletedAt: '2026-07-28 10:00:00',
    retentionDeadline: '2026-08-04 10:00:00',
  },
  {
    id: 'orp-002',
    networkDomainId: 'nd-default',
    networkDomainName: 'default',
    resourceType: 'middleware',
    instanceName: 'redis-cache-retired-01',
    instanceIp: '10.0.2.99',
    deletedSource: 'BlueKing 主 CMDB',
    deletedAt: '2026-07-29 12:00:00',
    retentionDeadline: '2026-08-05 12:00:00',
  },
  {
    id: 'orp-003',
    networkDomainId: 'nd-edge',
    networkDomainName: 'edge',
    resourceType: 'host',
    instanceName: 'edge-node-decommissioned',
    instanceIp: '192.168.1.99',
    deletedSource: '资产平台 HTTP 接口',
    deletedAt: '2026-07-30 09:00:00',
    retentionDeadline: '2026-08-06 09:00:00',
  },
  {
    id: 'orp-004',
    networkDomainId: 'nd-edge',
    networkDomainName: 'edge',
    resourceType: 'application',
    instanceName: 'legacy-app-pod',
    deletedSource: 'Kubernetes 自动发现',
    deletedAt: '2026-07-31 15:00:00',
    retentionDeadline: '2026-08-07 15:00:00',
  },
]
