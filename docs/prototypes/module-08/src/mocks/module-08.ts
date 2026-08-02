export type AlertSeverity = 'critical' | 'warning' | 'info'
export type AlertScope = 'central' | 'edge' | 'both'
export type NotifierType = 'feishu' | 'dingtalk' | 'email' | 'wecom' | 'webhook'

export interface AlertingRule {
  id: string
  group_id: string
  network_domain_id: string
  alert_name: string
  expr: string
  duration: string
  severity: AlertSeverity
  scope: AlertScope
  inhibitable: boolean
  labels: Record<string, string>
  annotations: Record<string, string>
  enabled: boolean
  source_module: string
}

export interface RuleGroup {
  id: string
  name: string
  network_domain_id: string
  interval: number
  rules: AlertingRule[]
}

export interface RecordingRule {
  id: string
  group_id: string
  record_name: string
  expr: string
  enabled: boolean
}

export interface SilenceMatcher {
  name: string
  value: string
  isRegex: boolean
}

export interface Silence {
  id: string
  matchers: SilenceMatcher[]
  starts_at: string
  ends_at: string
  comment: string
  created_by: string
}

export type NotifierConfig = Record<string, unknown>

export interface Notifier {
  id: string
  name: string
  type: NotifierType
  config: NotifierConfig
}

const now = new Date()

export const mockAlertingRules: AlertingRule[] = [
  {
    id: 'ar-001',
    group_id: 'rg-001',
    network_domain_id: 'default',
    alert_name: 'EdgeSiteOffline',
    expr: 'up{scope="edge"} == 0',
    duration: '2m',
    severity: 'critical',
    scope: 'edge',
    inhibitable: true,
    labels: { source_module: 'module-09', team: 'sre' },
    annotations: {
      summary: '边缘站点 {{ $labels.instance }} 离线',
      description: '边缘节点已连续 2 分钟不可达',
    },
    enabled: true,
    source_module: 'module-09',
  },
  {
    id: 'ar-002',
    group_id: 'rg-002',
    network_domain_id: 'default',
    alert_name: 'HighCPUUsage',
    expr: '100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80',
    duration: '5m',
    severity: 'warning',
    scope: 'both',
    inhibitable: false,
    labels: { source_module: 'module-01' },
    annotations: {
      summary: 'CPU 使用率超过 80%',
      description: '实例 {{ $labels.instance }} CPU 使用率持续 5 分钟高于阈值',
    },
    enabled: true,
    source_module: 'module-01',
  },
  {
    id: 'ar-003',
    group_id: 'rg-002',
    network_domain_id: 'default',
    alert_name: 'MemoryPressure',
    expr: '(node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) < 0.1',
    duration: '3m',
    severity: 'critical',
    scope: 'central',
    inhibitable: false,
    labels: { source_module: 'module-01' },
    annotations: {
      summary: '内存压力告警',
      description: '可用内存低于 10%',
    },
    enabled: true,
    source_module: 'module-01',
  },
  {
    id: 'ar-004',
    group_id: 'rg-002',
    network_domain_id: 'default',
    alert_name: 'DiskWillFillIn24Hours',
    expr: 'predict_linear(node_filesystem_avail_bytes[6h], 24 * 3600) < 0',
    duration: '1h',
    severity: 'warning',
    scope: 'both',
    inhibitable: false,
    labels: { source_module: 'module-01' },
    annotations: {
      summary: '磁盘预计 24 小时内写满',
      description: '{{ $labels.mountpoint }} 可用空间线性预测将在 24h 内耗尽',
    },
    enabled: false,
    source_module: 'module-01',
  },
  {
    id: 'ar-005',
    group_id: 'rg-001',
    network_domain_id: 'default',
    alert_name: 'ProbeFailed',
    expr: 'probe_success{job="blackbox"} == 0',
    duration: '1m',
    severity: 'critical',
    scope: 'edge',
    inhibitable: true,
    labels: { source_module: 'module-01' },
    annotations: {
      summary: '拨测任务失败',
      description: '目标 {{ $labels.target }} 连续拨测失败',
    },
    enabled: true,
    source_module: 'module-01',
  },
  {
    id: 'ar-006',
    group_id: 'rg-003',
    network_domain_id: 'default',
    alert_name: 'TooManyTargetsDown',
    expr: 'avg by (job) (up) < 0.5',
    duration: '10m',
    severity: 'info',
    scope: 'central',
    inhibitable: false,
    labels: { source_module: 'module-02' },
    annotations: {
      summary: 'Job 中过多目标不可用',
      description: 'Job {{ $labels.job }} 可用率低于 50%',
    },
    enabled: true,
    source_module: 'module-02',
  },
]

export const mockRuleGroups: RuleGroup[] = [
  {
    id: 'rg-001',
    name: 'edge-availability',
    network_domain_id: 'default',
    interval: 60,
    rules: mockAlertingRules.filter((r) => r.group_id === 'rg-001'),
  },
  {
    id: 'rg-002',
    name: 'infrastructure',
    network_domain_id: 'default',
    interval: 60,
    rules: mockAlertingRules.filter((r) => r.group_id === 'rg-002'),
  },
  {
    id: 'rg-003',
    name: 'availability-slo',
    network_domain_id: 'default',
    interval: 30,
    rules: mockAlertingRules.filter((r) => r.group_id === 'rg-003'),
  },
]

export const mockRecordingRules: RecordingRule[] = [
  {
    id: 'rr-001',
    group_id: 'rg-002',
    record_name: 'instance:node_cpu_utilisation:rate5m',
    expr: '1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m]))',
    enabled: true,
  },
  {
    id: 'rr-002',
    group_id: 'rg-002',
    record_name: 'instance:node_memory_utilisation:ratio',
    expr: '1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)',
    enabled: true,
  },
]

export const mockSilences: Silence[] = [
  {
    id: 'si-001',
    matchers: [
      { name: 'instance', value: 'edge-sh-01', isRegex: false },
      { name: 'alertname', value: 'EdgeSiteOffline', isRegex: false },
    ],
    starts_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    ends_at: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    comment: '上海边缘节点计划维护',
    created_by: 'admin',
  },
  {
    id: 'si-002',
    matchers: [
      { name: 'severity', value: 'info', isRegex: false },
      { name: 'job', value: 'node.*', isRegex: true },
    ],
    starts_at: now.toISOString(),
    ends_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
    comment: '临时屏蔽 info 级别节点告警',
    created_by: 'oncall',
  },
  {
    id: 'si-003',
    matchers: [{ name: 'alertname', value: 'HighCPUUsage', isRegex: false }],
    starts_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    comment: '历史静默：压测期间 CPU 高',
    created_by: 'ops',
  },
]

export const mockNotifiers: Notifier[] = [
  {
    id: 'nt-001',
    name: 'SRE 飞书群',
    type: 'feishu',
    config: {
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx',
      secret: 'sre-bot-secret',
      at_users: ['user_001'],
    },
  },
  {
    id: 'nt-002',
    name: '值班邮箱组',
    type: 'email',
    config: {
      smtp_server: 'smtp.company.com',
      from: 'alert@company.com',
      to: ['oncall@company.com', 'sre@company.com'],
    },
  },
  {
    id: 'nt-003',
    name: '告警钉钉机器人',
    type: 'dingtalk',
    config: {
      webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=xxxxx',
      secret: 'dingtalk-secret',
    },
  },
  {
    id: 'nt-004',
    name: '通用 Webhook',
    type: 'webhook',
    config: {
      url: 'https://alerts.company.com/webhook/generic',
      method: 'POST',
      headers: { Authorization: 'Bearer alert-token' },
    },
  },
]
