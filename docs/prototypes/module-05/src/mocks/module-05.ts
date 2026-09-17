// —— 首页（决策 72 / 72-1 / 72-2 / 72-3）：资产 / 治理进度指标卡 + 告警状态卡 ——

/** 首页关键指标卡口径：6 张纯资产 / 治理进度卡，不含任何告警数字 */
export interface DashboardStats {
  resourceTotal: number // 资源总数
  monitoredCount: number // 已监控（被 enabled + ready + standard 的采集 Job 覆盖，去重）
  scrapeJobCount: number // 采集 Job 总数
  scrapeJobEnabledCount: number // 其中启用
  managedDomainCount: number // 已纳管网域
  pendingDraftCount: number // 待确认草稿
  // 采集覆盖率由前端派生：monitoredCount ÷ resourceTotal
}

/** AM 治理态计数（首页唯一告警入口的主数字与状态分布）+ Prom 求值态（仅参考小字） */
export interface AlertGovernance {
  active: number // 通知中
  silenced: number // 已静默
  inhibited: number // 已抑制
  unprocessed: number // 仍在计算通知状态（不计数、不进列表）
  promFiring: number // Prom 触发中（仅参考）
  promPending: number // Prom 求值中（仅参考）
}

/** 首页最新告警列表条目（表头：级别 / 告警名 / 实例名 / 时间 / 状态） */
export interface LatestAlert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  name: string
  instanceName: string | null // 为空显示 '-'
  startsAt: string
  status: 'active' | 'silenced' | 'inhibited'
}

/** 最近下发记录（首页列精简为 变更单号 / 网域 / 状态 / 时间） */
export interface RecentDeployment {
  id: string
  changeNo: string
  networkDomain: string
  status: 'pending' | 'confirmed' | 'no_change'
  triggeredAt: string
}

/** 系统快速入口（入口集合以 MVP 已上线页面为限） */
export interface QuickAccessItem {
  key: 'resources' | 'scrapeJobs' | 'configPreview' | 'query' | 'alertStatus'
  name: string
  desc: string
  to: string
}

/** 六步开箱动线（决策 72-1） */
export interface OnboardingStep {
  key: string
  title: string
  desc: string
  to: string
}

/** 告警列表固定取最新 10 条（标题与取数共用一份，避免两处数字漂移） */
export const LATEST_ALERT_LIMIT = 10

export const SEVERITY_COLORS: Record<LatestAlert['severity'], string> = {
  critical: '#FF4C3A',
  warning: '#FA8C16',
  info: '#1481FD',
}

export const SEVERITY_LABEL: Record<LatestAlert['severity'], string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
}

export const NOTIFY_STATUS_LABEL: Record<LatestAlert['status'], string> = {
  active: '通知中',
  silenced: '已静默',
  inhibited: '已抑制',
}

export const DEPLOYMENT_STATUS_LABEL: Record<RecentDeployment['status'], string> = {
  pending: '待确认',
  confirmed: '已确认',
  no_change: '无变更',
}

/** 首页本地常量：Prom 求值态文案（不复用 M08 字典，避免把「待处理」歧义词带回首页） */
export const PROM_EVAL_LABEL = { firing: '触发中', pending: '求值中' } as const

export const mockDashboardStats: DashboardStats = {
  resourceTotal: 1248,
  monitoredCount: 986,
  scrapeJobCount: 64,
  scrapeJobEnabledCount: 58,
  managedDomainCount: 4,
  pendingDraftCount: 9,
}

export const mockAlertGovernance: AlertGovernance = {
  active: 7,
  silenced: 3,
  inhibited: 2,
  unprocessed: 4,
  promFiring: 7,
  promPending: 5,
}

export const mockLatestAlerts: LatestAlert[] = [
  {
    id: 'alt-001',
    severity: 'critical',
    name: '主机 CPU 使用率过高',
    instanceName: 'prod-web-01',
    startsAt: '2026-09-14 09:32:00',
    status: 'active',
  },
  {
    id: 'alt-002',
    severity: 'critical',
    name: '节点离线',
    instanceName: 'edge-node-03',
    startsAt: '2026-09-14 09:28:00',
    status: 'active',
  },
  {
    id: 'alt-003',
    severity: 'warning',
    name: '磁盘空间不足',
    instanceName: 'prod-db-01',
    startsAt: '2026-09-14 09:15:00',
    status: 'active',
  },
  {
    id: 'alt-004',
    severity: 'critical',
    name: '服务拨测失败',
    instanceName: 'order-service-v2',
    startsAt: '2026-09-14 08:58:00',
    status: 'silenced',
  },
  {
    id: 'alt-005',
    severity: 'warning',
    name: '内存使用率偏高',
    instanceName: 'redis-cache-01',
    startsAt: '2026-09-14 08:40:00',
    status: 'active',
  },
  {
    id: 'alt-006',
    severity: 'info',
    name: '采集任务配置变更待确认',
    instanceName: null,
    startsAt: '2026-09-14 08:22:00',
    status: 'active',
  },
  {
    id: 'alt-007',
    severity: 'critical',
    name: 'MySQL 连接数逼近上限',
    instanceName: 'mysql-master',
    startsAt: '2026-09-14 08:05:00',
    status: 'inhibited',
  },
  {
    id: 'alt-008',
    severity: 'warning',
    name: '文件系统 inode 使用率偏高',
    instanceName: 'prod-app-07',
    startsAt: '2026-09-14 07:48:00',
    status: 'active',
  },
  {
    id: 'alt-009',
    severity: 'warning',
    name: '容器重启次数异常',
    instanceName: 'k8s-worker-12',
    startsAt: '2026-09-14 07:30:00',
    status: 'silenced',
  },
  {
    id: 'alt-010',
    severity: 'info',
    name: 'Edge Agent 心跳延迟升高',
    instanceName: 'edge-node-01',
    startsAt: '2026-09-14 07:12:00',
    status: 'active',
  },
]

export const mockRecentDeployments: RecentDeployment[] = [
  {
    id: 'dep-001',
    changeNo: 'CHG-20260914-007',
    networkDomain: 'default',
    status: 'pending',
    triggeredAt: '2026-09-14 09:20:00',
  },
  {
    id: 'dep-002',
    changeNo: 'CHG-20260914-006',
    networkDomain: 'finance',
    status: 'confirmed',
    triggeredAt: '2026-09-14 08:41:00',
  },
  {
    id: 'dep-003',
    changeNo: 'CHG-20260913-021',
    networkDomain: 'edge',
    status: 'confirmed',
    triggeredAt: '2026-09-13 19:02:00',
  },
  {
    id: 'dep-004',
    changeNo: 'CHG-20260913-018',
    networkDomain: 'default',
    status: 'no_change',
    triggeredAt: '2026-09-13 16:35:00',
  },
  {
    id: 'dep-005',
    changeNo: 'CHG-20260913-011',
    networkDomain: 'default',
    status: 'confirmed',
    triggeredAt: '2026-09-13 11:18:00',
  },
]

export const mockQuickAccess: QuickAccessItem[] = [
  {
    key: 'resources',
    name: '资源管理',
    desc: '维护主机 / 中间件 / 应用服务等监控对象',
    to: '/resources',
  },
  {
    key: 'scrapeJobs',
    name: '采集 Job',
    desc: '创建采集任务、选择实例并关联标签模板',
    to: '/scrape-jobs',
  },
  {
    key: 'configPreview',
    name: '配置预览下发',
    desc: '预览生成的配置草稿，人工确认后下发',
    to: '/config-preview',
  },
  {
    key: 'query',
    name: '指标查询',
    desc: '在自定义查询页执行 PromQL 并查看结果',
    to: '/query',
  },
  {
    key: 'alertStatus',
    name: '告警状态',
    desc: '查看当前告警列表与通知治理态',
    to: '/alert-status',
  },
]

export const mockOnboardingSteps: OnboardingStep[] = [
  {
    key: 'domain',
    title: '登记网域',
    desc: '注册网络域并生成 Edge Agent Token，开启采集下发通道。',
    to: '/domain-onboarding',
  },
  {
    key: 'resources',
    title: '导入资源',
    desc: '录入或导入主机 / 中间件 / 应用服务等监控对象。',
    to: '/resources',
  },
  {
    key: 'job',
    title: '建采集 Job',
    desc: '选择 CI-Exporter 模板并关联资源实例，生成采集任务。',
    to: '/scrape-jobs',
  },
  {
    key: 'deploy',
    title: '下发',
    desc: '预览生成的配置草稿，人工确认后下发至采集面。',
    to: '/config-preview',
  },
  {
    key: 'alertConfig',
    title: '配置告警通知',
    desc: '挂载 Alertmanager 通知配置，打通告警投递闭环。',
    to: '/alert-config',
  },
  {
    key: 'query',
    title: '查指标 / 看告警',
    desc: '在查询页执行 PromQL，或在告警状态查看当前告警。',
    to: '/query',
  },
]

// —— 决策 51：Grafana 监控大屏（iframe 嵌入）mock ——

/** Grafana 数据源红线：必须指向 M02 查询代理，禁止直连 Prometheus（见 Module_02 §1 可视化边界） */
export interface GrafanaDatasource {
  name: string
  type: string
  url: string
  readonly: boolean
  redLine: string
}

/** 预置仪表盘模板（读模板只读、可克隆；克隆后自由编辑；升级覆盖模板不影响用户副本） */
export interface DashboardTemplate {
  id: string
  name: string
  ciType: string
  description: string
  readonly: boolean
  cloneable: boolean
  tags: string[]
  updatedAt: string
}

export interface GovernanceDrilldown {
  networkDomain: string
  bizCode: string
  app: string
  instance: string
}

export const mockGrafanaDatasource: GrafanaDatasource = {
  name: 'metric-center-proxy',
  type: 'Prometheus',
  url: 'http://metric-center:8080/api/v1',
  readonly: true,
  redLine: '数据源必须指向 M02 查询代理（metric-center:8080），禁止直连 Prometheus 实例（租户/网域注入红线）。',
}

export const mockDashboardTemplates: DashboardTemplate[] = [
  {
    id: 'tpl-host',
    name: '主机基础监控',
    ciType: '主机',
    description: 'CPU / 内存 / 磁盘 / 网络四维总览，按网域 → 业务 → 应用 → 实例下钻。',
    readonly: true,
    cloneable: true,
    tags: ['主机', '系统', 'base'],
    updatedAt: '2026-08-31',
  },
  {
    id: 'tpl-mysql',
    name: 'MySQL 性能监控',
    ciType: '中间件',
    description: '连接数、慢查询、缓冲池命中率等核心指标。',
    readonly: true,
    cloneable: true,
    tags: ['MySQL', '数据库', 'base'],
    updatedAt: '2026-08-31',
  },
  {
    id: 'tpl-probe',
    name: '拨测可用性',
    ciType: '拨测',
    description: 'HTTP / TCP / ICMP 探针可用性与延迟分布。',
    readonly: true,
    cloneable: true,
    tags: ['拨测', 'blackbox', '可用性'],
    updatedAt: '2026-08-31',
  },
]

/** 四层下钻的治理标签默认值（dashboard variables 的 label_values 查询走 M02 代理） */
export const mockGovernanceOptions: GovernanceDrilldown = {
  networkDomain: 'default',
  bizCode: 'Iaas',
  app: 'nginx-prod',
  instance: '10.0.0.11:9100',
}

export const mockNetworkDomains = ['default', 'edge', 'finance']
export const mockBizCodes = ['Iaas', 'PaaS', 'Saas']
export const mockApps = ['nginx-prod', 'mysql-master', 'order-service']
export const mockInstances = ['10.0.0.11:9100', '10.0.0.12:9100', '10.0.1.5:9100']
