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

// {v1.4} 五大类资源类别（决策 D19/D24）：与 Module_07 resource_category 对齐
export type ResourceCategory = 'host' | 'database' | 'middleware' | 'application' | 'generic_target'

export const RESOURCE_CATEGORY_LABELS: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

// {v1.4} 细粒度子类型（决策 D19）：database_type / middleware_type
export type SubType = 'linux' | 'windows' | 'mysql' | 'redis' | 'dm8' | 'mongodb' | 'kafka' | 'nginx' | 'elasticsearch'

export const SUB_TYPE_LABELS: Record<SubType, string> = {
  linux: 'Linux',
  windows: 'Windows',
  mysql: 'MySQL',
  redis: 'Redis',
  dm8: '达梦 dm8',
  mongodb: 'MongoDB',
  kafka: 'Kafka',
  nginx: 'Nginx',
  elasticsearch: 'Elasticsearch',
}

export const SUB_TYPES_BY_CATEGORY: Record<ResourceCategory, SubType[]> = {
  host: ['linux', 'windows'],
  database: ['mysql', 'redis', 'dm8', 'mongodb'],
  middleware: ['kafka', 'nginx', 'elasticsearch'],
  application: [],
  generic_target: [],
}

export interface PendingCI {
  id: string
  providerId: string
  providerName: string
  bkObjId?: string
  // {v1.4} 已指派的资源类别（原 resourceType 更名）
  resourceCategory?: ResourceCategory
  subType?: SubType
  rawData: Record<string, unknown>
  reason: PendingReason
  createdAt: string
}

export interface OrphanResource {
  id: string
  networkDomainId: string
  networkDomainName: string
  // {v1.4} 资源类别（原 resourceType 更名，五大类）
  resourceCategory: ResourceCategory
  instanceName: string
  instanceIp?: string
  deletedSource: string
  deletedAt: string
  retentionDeadline: string
}

// {v1.4} CMDB CI 类型映射表（PRD 7.1 三列完整推导链，决策 D24）：
// CI 类型（bk_obj_id，只读权威来源）→ 资源类别 + 子类型（管理员配置）→ 监控对象类型（只读，推导表实时计算）
export interface CiTypeMapping {
  id: string
  ciType: string // bk_obj_id
  category: ResourceCategory
  subType?: SubType
  enabled: boolean
}

/** {v1.4} 推导：类别 + 子类型 → 监控对象类型（monitor_type，只读；与 Module_01 MONITOR_TYPE_DERIVATION_MAP 对齐） */
export function deriveMonitorType(category: ResourceCategory, subType?: SubType): string {
  switch (category) {
    case 'host':
      return subType === 'windows' ? 'host_windows' : 'host_linux'
    case 'database':
      return subType ?? 'mysql'
    case 'middleware':
      return subType ?? 'kafka'
    case 'application':
      return 'application_http'
    case 'generic_target':
      return 'snmp'
  }
}

export const mockCiTypeMappings: CiTypeMapping[] = [
  { id: 'ctm-001', ciType: 'bk_host', category: 'host', subType: 'linux', enabled: true },
  { id: 'ctm-002', ciType: 'bk_host', category: 'host', subType: 'windows', enabled: true },
  { id: 'ctm-003', ciType: 'mysql', category: 'database', subType: 'mysql', enabled: true },
  { id: 'ctm-004', ciType: 'redis', category: 'database', subType: 'redis', enabled: true },
  { id: 'ctm-005', ciType: 'dm8', category: 'database', subType: 'dm8', enabled: true },
  { id: 'ctm-006', ciType: 'kafka', category: 'middleware', subType: 'kafka', enabled: true },
  { id: 'ctm-007', ciType: 'nginx', category: 'middleware', subType: 'nginx', enabled: true },
  { id: 'ctm-008', ciType: 'elasticsearch', category: 'middleware', subType: 'elasticsearch', enabled: true },
  { id: 'ctm-009', ciType: 'biz', category: 'application', enabled: false },
]

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
    resourceCategory: 'generic_target',
    reason: 'disabled_type',
    rawData: { bk_inst_name: 'fw-perimeter-01', bk_asset_id: 'FW-2001' },
    createdAt: '2026-08-02 09:12:00',
  },
  {
    id: 'pci-003',
    providerId: 'p-http-001',
    providerName: '资产平台 HTTP 接口',
    resourceCategory: 'host',
    subType: 'linux',
    reason: 'missing_field',
    rawData: { hostname: 'prod-web-99', os_type: 'Linux' },
    createdAt: '2026-08-02 08:50:00',
  },
  {
    id: 'pci-004',
    providerId: 'p-http-001',
    providerName: '资产平台 HTTP 接口',
    resourceCategory: 'middleware',
    subType: 'kafka',
    reason: 'missing_field',
    rawData: { instance_name: 'mq-01', middleware: 'kafka' },
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
  // {v1.4} 新数据库产品线示例：达梦 dm8 进入待分类（决策 D19，指派目标类别 = database）
  {
    id: 'pci-006',
    providerId: 'p-bk-001',
    providerName: 'BlueKing 主 CMDB',
    bkObjId: 'dm8',
    reason: 'unmapped',
    rawData: { bk_inst_name: 'dm-master-01', bk_asset_id: 'DM-3001', ip: '172.16.0.31', db_version: 'dm8' },
    createdAt: '2026-08-02 09:30:00',
  },
]

export const mockOrphans: OrphanResource[] = [
  {
    id: 'orp-001',
    networkDomainId: 'nd-default',
    networkDomainName: 'default',
    resourceCategory: 'host',
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
    // {v1.4} redis 归 database（决策 D19）
    resourceCategory: 'database',
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
    resourceCategory: 'host',
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
    resourceCategory: 'application',
    instanceName: 'legacy-app-pod',
    deletedSource: 'Kubernetes 自动发现',
    deletedAt: '2026-07-31 15:00:00',
    retentionDeadline: '2026-08-07 15:00:00',
  },
]
