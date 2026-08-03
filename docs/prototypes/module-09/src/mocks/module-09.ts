export type NetworkDomainStatus = 'online' | 'offline' | 'unknown'
export type DomainType = 'management' | 'edge'
export type AgentType = 'vmagent' | 'prometheus-agent'
export type ConfigSyncStatus = 'in_sync' | 'out_of_sync' | 'unknown' | 'manual_override'
export type ConfigDraftStatus = 'pending' | 'confirmed' | 'discarded'
export type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'
export type DeploymentTargetType = 'central_prometheus' | 'edge_agent' | 'vmagent'

export interface Tenant {
  id: string
  name: string
  multi_site_enabled: boolean
}

export interface NetworkDomain {
  id: string
  name: string
  description: string
  domain_type: DomainType
  tenant_id: string
  token: string
  agent_type: AgentType
  remote_write_url: string
  status: NetworkDomainStatus
  last_heartbeat: string
  agent_version: string
  created_at: string
  updated_at: string
}

export interface EdgeAgent {
  id: string
  network_domain_id: string
  agent_type: AgentType
  version: string
  hostname: string
  status: NetworkDomainStatus
  last_heartbeat: string
  heartbeat_rtt_ms: number
  last_config_pull: string
  config_version: string
  config_sync_status: ConfigSyncStatus
  wal_backlog_bytes: number
  remote_write_url: string
  last_error: string
  created_at: string
  updated_at: string
}

export interface ConfigDraft {
  id: string
  network_domain_id: string
  source_version: string
  prometheus_yml: string
  rules_yml: string
  blackbox_yml: string
  metadata: Record<string, unknown>
  status: ConfigDraftStatus
  created_at: string
  updated_at: string
  confirmed_by?: string
  confirmed_at?: string
}

export interface ConfigVersion {
  id: string
  network_domain_id: string
  draft_id: string
  prometheus_yml: string
  rules_yml: string
  blackbox_yml: string
  metadata: Record<string, unknown>
  created_at: string
  created_by: string
}

export interface ConfigDeployment {
  id: string
  network_domain_id: string
  config_version_id: string
  target_type: DeploymentTargetType
  target_address: string
  status: DeploymentStatus
  error_message: string
  triggered_by: string
  triggered_at: string
  completed_at: string
  created_at: string
}

// 当前租户上下文：通过切换 multi_site_enabled 演示单网域/多网域模式差异
export const currentTenant: Tenant = {
  id: 'platform_admin',
  name: '平台默认租户',
  multi_site_enabled: true,
}

export const networkDomains: NetworkDomain[] = [
  {
    id: 'default',
    name: 'default',
    description: '默认中心管理域，承载单机与中心采集模式；可修改名称以匹配云区域命名',
    domain_type: 'management',
    tenant_id: 'platform_admin',
    token: 'tk_default_a1b2c3d4e5f6',
    agent_type: 'vmagent',
    remote_write_url: 'http://localhost:8428/api/v1/write',
    status: 'online',
    last_heartbeat: '2026-08-03 14:30:00',
    agent_version: 'v1.102.0',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-08-03 14:30:00',
  },
  {
    id: 'gov-cloud-a',
    name: '政务网 A 区',
    description: '物理隔离政务网，通过 Edge Agent 单向 HTTPS 出站接入',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    token: 'tk_gova_7g8h9i0j1k2l',
    agent_type: 'vmagent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'online',
    last_heartbeat: '2026-08-03 14:28:00',
    agent_version: 'v1.102.0',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-08-03 14:28:00',
  },
  {
    id: 'finance-dmz',
    name: '金融 DMZ',
    description: '金融专网 DMZ 区，部署 Prometheus Agent Mode',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    token: 'tk_finance_3m4n5o6p7q8r',
    agent_type: 'prometheus-agent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'offline',
    last_heartbeat: '2026-08-03 13:50:00',
    agent_version: 'v2.54.0',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-08-03 13:50:00',
  },
  {
    id: 'manufacturing-edge',
    name: '制造边缘节点',
    description: '工厂边缘网关，网络不稳定，启用 WAL 本地缓冲',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    token: 'tk_mfg_9s0t1u2v3w4x',
    agent_type: 'vmagent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'online',
    last_heartbeat: '2026-08-03 14:25:00',
    agent_version: 'v1.102.0',
    created_at: '2026-07-20 00:00:00',
    updated_at: '2026-08-03 14:25:00',
  },
]

export const edgeAgents: EdgeAgent[] = [
  {
    id: 'ea-default',
    network_domain_id: 'default',
    agent_type: 'vmagent',
    version: 'v1.102.0',
    hostname: 'metric-center-local',
    status: 'online',
    last_heartbeat: '2026-08-03 14:30:00',
    heartbeat_rtt_ms: 2,
    last_config_pull: '2026-08-03 14:25:00',
    config_version: '20260803-142500',
    config_sync_status: 'in_sync',
    wal_backlog_bytes: 0,
    remote_write_url: 'http://localhost:8428/api/v1/write',
    last_error: '',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-08-03 14:30:00',
  },
  {
    id: 'ea-gov-a-01',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.102.0',
    hostname: 'edge-agent-gova-01',
    status: 'online',
    last_heartbeat: '2026-08-03 14:28:00',
    heartbeat_rtt_ms: 45,
    last_config_pull: '2026-08-03 14:20:00',
    config_version: '20260803-141500',
    config_sync_status: 'in_sync',
    wal_backlog_bytes: 1048576,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-08-03 14:28:00',
  },
  {
    id: 'ea-gov-a-02',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.102.0',
    hostname: 'edge-agent-gova-02',
    status: 'online',
    last_heartbeat: '2026-08-03 14:27:00',
    heartbeat_rtt_ms: 52,
    last_config_pull: '2026-08-03 14:15:00',
    config_version: '20260803-141500',
    config_sync_status: 'out_of_sync',
    wal_backlog_bytes: 2097152,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: 'config reload: timeout waiting for response',
    created_at: '2026-07-15 00:00:00',
    updated_at: '2026-08-03 14:27:00',
  },
  {
    id: 'ea-finance-01',
    network_domain_id: 'finance-dmz',
    agent_type: 'prometheus-agent',
    version: 'v2.54.0',
    hostname: 'edge-agent-finance-01',
    status: 'offline',
    last_heartbeat: '2026-08-03 13:50:00',
    heartbeat_rtt_ms: 120,
    last_config_pull: '2026-08-03 13:45:00',
    config_version: '20260803-130000',
    config_sync_status: 'unknown',
    wal_backlog_bytes: 5368709120,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: 'remote write: connection reset by peer',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-08-03 13:50:00',
  },
  {
    id: 'ea-mfg-01',
    network_domain_id: 'manufacturing-edge',
    agent_type: 'vmagent',
    version: 'v1.102.0',
    hostname: 'edge-agent-mfg-01',
    status: 'online',
    last_heartbeat: '2026-08-03 14:25:00',
    heartbeat_rtt_ms: 88,
    last_config_pull: '2026-08-03 14:10:00',
    config_version: '20260803-140000',
    config_sync_status: 'in_sync',
    wal_backlog_bytes: 268435456,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '',
    created_at: '2026-07-20 00:00:00',
    updated_at: '2026-08-03 14:25:00',
  },
]

const prometheusYmlDefault = `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'default'
    tenant_id: 'platform_admin'

remote_write:
  - url: 'http://localhost:8428/api/v1/write'

scrape_configs:
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['localhost:9100']
        labels:
          network_domain: 'default'

  - job_name: 'blackbox-tcp'
    metrics_path: /probe
    params:
      module: [tcp_connect]
    static_configs:
      - targets: ['localhost:22']
`

const prometheusYmlGov = `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'gov-cloud-a'
    tenant_id: 'platform_admin'

remote_write:
  - url: 'https://metriccenter.example.com/api/v2/ingest/prometheus'
    headers:
      X-Network-Domain-Token: '***'

scrape_configs:
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['10.0.1.10:9100', '10.0.1.11:9100']
        labels:
          network_domain: 'gov-cloud-a'
`

const prometheusYmlFinance = `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'finance-dmz'
    tenant_id: 'platform_admin'

remote_write:
  - url: 'https://metriccenter.example.com/api/v2/ingest/prometheus'
    headers:
      X-Network-Domain-Token: '***'

scrape_configs:
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['10.0.3.20:9100']
        labels:
          network_domain: 'finance-dmz'
`

const rulesYml = `groups:
  - name: node.rules
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'High CPU usage on {{ $labels.instance }}'
`

const blackboxYml = `modules:
  tcp_connect:
    prober: tcp
    timeout: 5s
  http_2xx:
    prober: http
    timeout: 10s
`

export const configDrafts: ConfigDraft[] = [
  {
    id: 'draft-default-001',
    network_domain_id: 'default',
    source_version: '',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    metadata: { generated_by: 'system', reason: 'initial setup' },
    status: 'confirmed',
    created_at: '2026-08-03 14:00:00',
    updated_at: '2026-08-03 14:25:00',
    confirmed_by: 'system',
    confirmed_at: '2026-08-03 14:25:00',
  },
  {
    id: 'draft-gov-001',
    network_domain_id: 'gov-cloud-a',
    source_version: 'cv-gov-001',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    metadata: { generated_by: 'system', reason: 'node target added' },
    status: 'pending',
    created_at: '2026-08-03 14:10:00',
    updated_at: '2026-08-03 14:10:00',
  },
  {
    id: 'draft-finance-001',
    network_domain_id: 'finance-dmz',
    source_version: 'cv-finance-001',
    prometheus_yml: prometheusYmlFinance,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    metadata: { generated_by: 'user', reason: 'manual adjustment' },
    status: 'discarded',
    created_at: '2026-08-03 13:30:00',
    updated_at: '2026-08-03 13:45:00',
  },
]

export const configVersions: ConfigVersion[] = [
  {
    id: 'cv-default-001',
    network_domain_id: 'default',
    draft_id: 'draft-default-001',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    metadata: { version_note: 'initial' },
    created_at: '2026-08-03 14:25:00',
    created_by: 'system',
  },
  {
    id: 'cv-gov-001',
    network_domain_id: 'gov-cloud-a',
    draft_id: 'draft-gov-001',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    metadata: { version_note: 'baseline' },
    created_at: '2026-08-03 14:00:00',
    created_by: 'system',
  },
  {
    id: 'cv-gov-002',
    network_domain_id: 'gov-cloud-a',
    draft_id: 'draft-gov-001',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    metadata: { version_note: 'add second node' },
    created_at: '2026-08-03 14:20:00',
    created_by: 'system',
  },
  {
    id: 'cv-finance-001',
    network_domain_id: 'finance-dmz',
    draft_id: 'draft-finance-001',
    prometheus_yml: prometheusYmlFinance,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    metadata: { version_note: 'baseline' },
    created_at: '2026-08-03 13:45:00',
    created_by: 'admin',
  },
]

export const configDeployments: ConfigDeployment[] = [
  {
    id: 'deploy-001',
    network_domain_id: 'default',
    config_version_id: 'cv-default-001',
    target_type: 'central_prometheus',
    target_address: 'metric-center-local',
    status: 'success',
    error_message: '',
    triggered_by: 'system',
    triggered_at: '2026-08-03 14:25:10',
    completed_at: '2026-08-03 14:25:12',
    created_at: '2026-08-03 14:25:10',
  },
  {
    id: 'deploy-002',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-001',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-01',
    status: 'success',
    error_message: '',
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:15:10',
    completed_at: '2026-08-03 14:15:20',
    created_at: '2026-08-03 14:15:10',
  },
  {
    id: 'deploy-003',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-002',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-02',
    status: 'failed',
    error_message: 'config reload: timeout waiting for response',
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:20:10',
    completed_at: '2026-08-03 14:21:10',
    created_at: '2026-08-03 14:20:10',
  },
  {
    id: 'deploy-004',
    network_domain_id: 'finance-dmz',
    config_version_id: 'cv-finance-001',
    target_type: 'edge_agent',
    target_address: 'edge-agent-finance-01',
    status: 'failed',
    error_message: 'remote write: connection reset by peer',
    triggered_by: 'system',
    triggered_at: '2026-08-03 13:45:10',
    completed_at: '2026-08-03 13:45:15',
    created_at: '2026-08-03 13:45:10',
  },
  {
    id: 'deploy-005',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-001',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-02',
    status: 'rolled_back',
    error_message: '',
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:05:10',
    completed_at: '2026-08-03 14:06:00',
    created_at: '2026-08-03 14:05:10',
  },
  {
    id: 'deploy-006',
    network_domain_id: 'manufacturing-edge',
    config_version_id: 'cv-default-001',
    target_type: 'edge_agent',
    target_address: 'edge-agent-mfg-01',
    status: 'success',
    error_message: '',
    triggered_by: 'system',
    triggered_at: '2026-08-03 14:10:10',
    completed_at: '2026-08-03 14:10:18',
    created_at: '2026-08-03 14:10:10',
  },
]
