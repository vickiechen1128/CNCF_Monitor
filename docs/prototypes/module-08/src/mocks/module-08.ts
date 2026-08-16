/**
 * Module_08「告警收敛与通知管理」原型 mock 数据
 *
 * 数据模型对齐 PRD v1.3（2026-08-15）：
 * - 接收人（Receiver / Alertmanager receiver）
 * - 路由规则（Route / alertmanager.yml route 树）
 * - 静默规则（Silence，状态 active / expired / pending）
 * - 告警抑制规则（InhibitionRule，含自动生成的内置规则）
 * - Alertmanager 通知状态（active / silenced / inhibited / unprocessed）
 * - Alertmanager 配置版本（AlertmanagerConfigVersion）
 *
 * 职责边界（PRD 第 4 章）：告警规则内容创作（expr / for / labels）归 Module_01，
 * rules.yml 生成与下发归 Module_09，本模块聚焦 Alertmanager 域，不再维护 AlertingRule / RuleGroup。
 */
export type NotifierType = 'feishu' | 'dingtalk' | 'email' | 'wecom' | 'webhook'
export type NotifierConfig = Record<string, unknown>
export type SilenceStatus = 'active' | 'expired' | 'pending'
export type NotificationStatus = 'active' | 'silenced' | 'inhibited' | 'unprocessed'

export interface Matcher {
  name: string
  value: string
  isRegex: boolean
}

/** 通知接收人（Alertmanager receiver），对应 PRD 6.1 */
export interface Notifier {
  id: string
  name: string
  type: NotifierType
  config: NotifierConfig
  enabled: boolean
  created_at: string
  updated_at: string
}

/** 路由规则（Alertmanager route 树节点），对应 PRD 6.2 */
export interface Route {
  id: string
  parent_id: string | null
  name: string
  matchers: Matcher[]
  receiver_id: string
  group_by: string[]
  group_wait: string
  group_interval: string
  repeat_interval: string
  continue: boolean
  order: number
  enabled: boolean
}

/** 静默规则，对应 PRD 6.3 */
export interface Silence {
  id: string
  matchers: Matcher[]
  starts_at: string
  ends_at: string
  comment: string
  created_by: string
  status: SilenceStatus
}

/** 告警抑制规则，对应 PRD 6.4 */
export interface InhibitionRule {
  id: string
  name: string
  source_matchers: Matcher[]
  target_matchers: Matcher[]
  equal: string[]
  is_builtin: boolean
  enabled: boolean
  description: string
}

/** Alertmanager 通知状态条目（active / silenced / inhibited / unprocessed），对应 PRD 3.2 */
export interface AlertNotification {
  id: string
  alertname: string
  labels: Record<string, string>
  status: NotificationStatus
  receiver: string
  network_domain: string
  instance: string
  active_since: string
  note: string
}

/** Alertmanager 配置版本，对应 PRD 6.6 */
export interface AlertmanagerConfigVersion {
  id: string
  version: string
  content: string
  checksum: string
  applied_at: string
  applied_by: string
  status: 'applied' | 'failed'
  error_msg?: string
}

const now = new Date()
const fmt = (t: Date) => t.toISOString()

export const mockNotifiers: Notifier[] = [
  {
    id: 'nt-001',
    name: 'default',
    type: 'webhook',
    config: {
      url: 'http://metric-center:8080/api/v1/webhooks/feishu',
      method: 'POST',
    },
    enabled: true,
    created_at: '2026-07-20 10:00:00',
    updated_at: '2026-08-14 15:20:00',
  },
  {
    id: 'nt-002',
    name: 'sre-critical',
    type: 'feishu',
    config: {
      webhook_url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx',
      secret: 'sre-bot-secret',
      at_users: ['user_001'],
    },
    enabled: true,
    created_at: '2026-07-20 10:05:00',
    updated_at: '2026-08-14 15:22:00',
  },
  {
    id: 'nt-003',
    name: 'gov-ops',
    type: 'dingtalk',
    config: {
      webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=xxxxx',
      secret: 'dingtalk-secret',
    },
    enabled: true,
    created_at: '2026-07-22 09:00:00',
    updated_at: '2026-08-15 09:10:00',
  },
  {
    id: 'nt-004',
    name: '值班邮箱组',
    type: 'email',
    config: {
      smtp_server: 'smtp.company.com',
      from: 'alert@company.com',
      to: ['oncall@company.com', 'sre@company.com'],
    },
    enabled: false,
    created_at: '2026-07-25 11:00:00',
    updated_at: '2026-08-10 18:30:00',
  },
]

export const mockRoutes: Route[] = [
  {
    id: 'rt-root',
    parent_id: null,
    name: '根路由（默认）',
    matchers: [],
    receiver_id: 'nt-001',
    group_by: ['alertname', 'severity'],
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
    continue: false,
    order: 0,
    enabled: true,
  },
  {
    id: 'rt-001',
    parent_id: 'rt-root',
    name: '严重告警 → SRE 值班',
    matchers: [{ name: 'severity', value: 'critical', isRegex: false }],
    receiver_id: 'nt-002',
    group_by: ['alertname', 'network_domain'],
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
    continue: true,
    order: 1,
    enabled: true,
  },
  {
    id: 'rt-002',
    parent_id: 'rt-root',
    name: '政务云网域 → 政务运维',
    matchers: [{ name: 'network_domain', value: 'gov-cloud-a|gov-cloud-b', isRegex: true }],
    receiver_id: 'nt-003',
    group_by: ['alertname', 'network_domain'],
    group_wait: '1m',
    group_interval: '10m',
    repeat_interval: '6h',
    continue: false,
    order: 2,
    enabled: true,
  },
  {
    id: 'rt-003',
    parent_id: 'rt-root',
    name: 'team=sre → SRE 值班',
    matchers: [{ name: 'team', value: 'sre', isRegex: false }],
    receiver_id: 'nt-002',
    group_by: ['alertname'],
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
    continue: true,
    order: 3,
    enabled: false,
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
    created_by: '张伟（运维）',
    status: 'active',
  },
  {
    id: 'si-002',
    matchers: [{ name: 'severity', value: 'info', isRegex: false }],
    starts_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    ends_at: new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString(),
    comment: '压测窗口：临时屏蔽 info 级别告警',
    created_by: '李娜（SRE）',
    status: 'pending',
  },
  {
    id: 'si-003',
    matchers: [{ name: 'alertname', value: 'HighCPUUsage', isRegex: false }],
    starts_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    ends_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    comment: '历史静默：压测期间 CPU 高',
    created_by: '王强（运维）',
    status: 'expired',
  },
]

export const mockInhibitions: InhibitionRule[] = [
  {
    id: 'in-001',
    name: '网域离线抑制可达性风暴（内置）',
    source_matchers: [{ name: 'alertname', value: 'EdgeSiteOffline', isRegex: false }],
    target_matchers: [
      { name: 'network_domain', value: 'gov-cloud-a', isRegex: false },
      { name: 'inhibitable', value: 'true', isRegex: false },
    ],
    equal: ['network_domain'],
    is_builtin: true,
    enabled: true,
    description:
      '当网域整体离线时（EdgeSiteOffline 根因告警），自动抑制同一 network_domain 下 inhibitable=true 的可达性 / 网络类告警风暴，只保留根因告警。',
  },
  {
    id: 'in-002',
    name: '拨测失败抑制同目标可达性告警（手动）',
    source_matchers: [{ name: 'alertname', value: 'ProbeFailed', isRegex: false }],
    target_matchers: [{ name: 'job', value: 'blackbox', isRegex: false }],
    equal: ['instance'],
    is_builtin: false,
    enabled: true,
    description: '手动调整策略：拨测失败时抑制同一实例上的重复可达性告警。',
  },
]

export const mockAlertNotifications: AlertNotification[] = [
  {
    id: 'an-001',
    alertname: 'EdgeSiteOffline',
    labels: { severity: 'critical', team: 'sre', network_domain: 'gov-cloud-a', instance: 'edge-sh-01' },
    status: 'active',
    receiver: 'sre-critical',
    network_domain: 'gov-cloud-a',
    instance: 'edge-sh-01',
    active_since: fmt(new Date(now.getTime() - 12 * 60 * 1000)),
    note: '根因告警，正在路由通知（命中路由：severity=critical → sre-critical）',
  },
  {
    id: 'an-002',
    alertname: 'TargetDown',
    labels: { severity: 'warning', network_domain: 'gov-cloud-a', instance: '10.0.1.11:9100', inhibitable: 'true' },
    status: 'inhibited',
    receiver: '-',
    network_domain: 'gov-cloud-a',
    instance: '10.0.1.11:9100',
    active_since: fmt(new Date(now.getTime() - 8 * 60 * 1000)),
    note: '被内置抑制规则 in-001 抑制（同 network_domain 且 inhibitable=true）',
  },
  {
    id: 'an-003',
    alertname: 'HighCPUUsage',
    labels: { severity: 'warning', network_domain: 'gov-cloud-b', instance: '10.0.2.21:9100' },
    status: 'silenced',
    receiver: '-',
    network_domain: 'gov-cloud-b',
    instance: '10.0.2.21:9100',
    active_since: fmt(new Date(now.getTime() - 30 * 60 * 1000)),
    note: '命中静默 si-001（上海边缘节点计划维护）',
  },
  {
    id: 'an-004',
    alertname: 'DiskWillFillIn24Hours',
    labels: { severity: 'warning', network_domain: 'default', instance: '10.0.0.5:9100' },
    status: 'active',
    receiver: 'default',
    network_domain: 'default',
    instance: '10.0.0.5:9100',
    active_since: fmt(new Date(now.getTime() - 3 * 60 * 1000)),
    note: '已路由至 default，等待分组窗口（group_wait 30s）后通知',
  },
  {
    id: 'an-005',
    alertname: 'ProbeFailed',
    labels: { severity: 'critical', network_domain: 'gov-cloud-a', target: 'https://portal.gov-cloud-a.example.com' },
    status: 'unprocessed',
    receiver: '待路由',
    network_domain: 'gov-cloud-a',
    instance: 'https://portal.gov-cloud-a.example.com',
    active_since: fmt(new Date(now.getTime() - 20 * 1000)),
    note: '刚进入 Alertmanager，尚未完成路由 / 静默 / 抑制计算',
  },
]

export const currentAlertmanagerYaml = `# 由 Module_08 生成并直接写文件 + reload（MVP 单域阶段不进入 M09 配置变更确认）
global:
  smtp_smarthost: 'localhost:587'

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'sre-critical'
      group_by: ['alertname', 'network_domain']
      continue: true
    - match_re:
        network_domain: gov-cloud-a|gov-cloud-b
      receiver: 'gov-ops'

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'http://metric-center:8080/api/v1/webhooks/feishu'
  - name: 'sre-critical'
    webhook_configs:
      - url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
  - name: 'gov-ops'
    dingtalk_configs:
      - webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=xxx'

inhibit_rules:
  - source_matchers:
      - alertname = "EdgeSiteOffline"
    target_matchers:
      - network_domain = "gov-cloud-a"
      - inhibitable = "true"
    equal:
      - network_domain
`

export const mockConfigVersions: AlertmanagerConfigVersion[] = [
  {
    id: 'acv-003',
    version: 'v3',
    content: currentAlertmanagerYaml,
    checksum: '9f2a1c4e7b6d8f0a3c5e7b9d1f3a5c7e',
    applied_at: '2026-08-15 09:32:00',
    applied_by: '张伟（运维）',
    status: 'applied',
  },
  {
    id: 'acv-002',
    version: 'v2',
    content: `# v2：新增 gov-cloud 路由与 gov-ops 钉钉接收人
global:
  smtp_smarthost: 'localhost:587'

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'
  routes:
    - match_re:
        network_domain: gov-cloud-a|gov-cloud-b
      receiver: 'gov-ops'

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'http://metric-center:8080/api/v1/webhooks/feishu'
  - name: 'gov-ops'
    dingtalk_configs:
      - webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=xxx'
`,
    checksum: '5b8e2d1a9c4f6e0d3b7a1c5e9f2d4b6a',
    applied_at: '2026-08-12 14:05:00',
    applied_by: '张伟（运维）',
    status: 'applied',
  },
  {
    id: 'acv-001',
    version: 'v1',
    content: `# v1：初始配置
route:
  receiver: 'default'

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'http://metric-center:8080/api/v1/webhooks/feishu'
`,
    checksum: 'd4f8c2a6e9b1d7f0a3c5e7b9d1f3a5c7',
    applied_at: '2026-07-28 10:00:00',
    applied_by: '李娜（SRE）',
    status: 'failed',
    error_msg: 'amtool check-config 校验失败：route 下子路由引用的 receiver "gov-ops" 未定义',
  },
]

/** 角色切换：本模块目标用户为运维工程师 / 运维架构师 */
export type ModuleRole = 'ops' | 'arch'
