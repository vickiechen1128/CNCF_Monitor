export interface NetworkDomain {
  id: string
  name: string
  description: string
  token: string
  agent_type: 'vmagent' | 'prometheus-agent'
  remote_write_url: string
  status: 'online' | 'offline' | 'unknown'
  last_heartbeat: string
  agent_version: string
  created_at: string
  updated_at: string
}

export interface EdgeAgent {
  id: string
  network_domain_id: string
  agent_type: 'vmagent' | 'prometheus-agent'
  version: string
  hostname: string
  status: 'online' | 'offline' | 'unknown'
  last_heartbeat: string
  heartbeat_rtt_ms: number
  last_config_pull: string
  config_version: string
  config_sync_status: 'in_sync' | 'out_of_sync' | 'unknown'
  wal_backlog_bytes: number
  remote_write_url: string
  last_error: string
  created_at: string
  updated_at: string
}

export const networkDomains: NetworkDomain[] = [
  {
    id: 'default',
    name: '默认网域',
    description: '单机模式默认站点，MVP 阶段隐藏网域概念',
    token: 'tk_default_xxxxxxxx',
    agent_type: 'vmagent',
    remote_write_url: 'http://localhost:8428/api/v1/write',
    status: 'online',
    last_heartbeat: '2026-07-24 14:30:00',
    agent_version: 'v1.101.0',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-07-24 14:30:00',
  },
  {
    id: 'gov-cloud-a',
    name: '政务网 A 区',
    description: '物理隔离政务网，通过 Edge Agent 单向 HTTPS 出站接入',
    token: 'tk_gova_xxxxxxxx',
    agent_type: 'vmagent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'online',
    last_heartbeat: '2026-07-24 14:28:00',
    agent_version: 'v1.101.0',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-07-24 14:28:00',
  },
  {
    id: 'finance-dmz',
    name: '金融 DMZ',
    description: '金融专网 DMZ 区，部署 Prometheus Agent Mode',
    token: 'tk_finance_xxxxxxxx',
    agent_type: 'prometheus-agent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'offline',
    last_heartbeat: '2026-07-24 13:50:00',
    agent_version: 'v2.53.0',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-07-24 13:50:00',
  },
]

export const edgeAgents: EdgeAgent[] = [
  {
    id: 'ea-default',
    network_domain_id: 'default',
    agent_type: 'vmagent',
    version: 'v1.101.0',
    hostname: 'metric-center-local',
    status: 'online',
    last_heartbeat: '2026-07-24 14:30:00',
    heartbeat_rtt_ms: 2,
    last_config_pull: '2026-07-24 14:25:00',
    config_version: '20260724-142500',
    config_sync_status: 'in_sync',
    wal_backlog_bytes: 0,
    remote_write_url: 'http://localhost:8428/api/v1/write',
    last_error: '',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-07-24 14:30:00',
  },
  {
    id: 'ea-gov-a-01',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.101.0',
    hostname: 'edge-agent-gova-01',
    status: 'online',
    last_heartbeat: '2026-07-24 14:28:00',
    heartbeat_rtt_ms: 45,
    last_config_pull: '2026-07-24 14:20:00',
    config_version: '20260724-141500',
    config_sync_status: 'in_sync',
    wal_backlog_bytes: 1048576,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-07-24 14:28:00',
  },
  {
    id: 'ea-finance-01',
    network_domain_id: 'finance-dmz',
    agent_type: 'prometheus-agent',
    version: 'v2.53.0',
    hostname: 'edge-agent-finance-01',
    status: 'offline',
    last_heartbeat: '2026-07-24 13:50:00',
    heartbeat_rtt_ms: 120,
    last_config_pull: '2026-07-24 13:45:00',
    config_version: '20260724-130000',
    config_sync_status: 'unknown',
    wal_backlog_bytes: 5368709120,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: 'remote write: connection reset by peer',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-07-24 13:50:00',
  },
]
