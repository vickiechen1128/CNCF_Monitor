// —— 首页（决策 72 / 72-1 / 72-2 / 72-3 / 73）：资产 / 治理进度指标卡 + 告警状态卡 ——

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

/** 告警量 + AM 治理态计数（决策 73：当日 / 近 7 天为主数字，治理态为次）+ Prom 求值态（仅参考小字） */
export interface AlertGovernance {
  todayCount: number // 当日告警：今日 0 点起触发过的告警条数（含已恢复；M02 /api/v1/alerts/history 前端计数）
  weekCount: number // 近 7 天告警：fired_at ≥ now-7d 的告警条数（含已恢复）
  active: number // 通知中（AM active）：此刻仍在投递；与 silenced/inhibited 满足「未恢复 = 通知中 + 静默 + 抑制」
  silenced: number // 已静默（Prom 侧仍 firing，AM 不再投递）
  inhibited: number // 已抑制（同上）
  unprocessed: number // 仍在计算通知状态（不计数、不进列表）
  promFiring: number // Prom 触发中（= L0「告警」卡当前未恢复，仅参考展示）
  promPending: number // Prom 求值中（仅参考）
}

/** 首页最新告警列表条目（决策 73 两行制：行 1 级别 / 告警名 / 相对时间 / 状态，行 2 实例名 + 告警内容） */
export interface LatestAlert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  name: string
  summary: string // 告警具体内容（告警规则 annotations.summary / 历史告警 summary）
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

/** 告警列表固定取最新 8 条（决策 73：两行制下单条信息量翻倍，总信息量不降，「查看全部」兜底） */
export const LATEST_ALERT_LIMIT = 8

export const SEVERITY_COLORS: Record<LatestAlert['severity'], string> = {
  critical: '#FF4C3A',
  warning: '#FA8C16',
  info: '#1481FD',
}

/** 级别 Tag 浅底配色（决策 73：浅底色 + 深字，替代实底 Tag） */
export const SEVERITY_BG: Record<LatestAlert['severity'], string> = {
  critical: '#FFEBE9',
  warning: '#FFF4E6',
  info: '#E6F1FF',
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

/**
 * 计数字段与 `mockResourceTypes` 保持自洽：`resourceTotal` = 五类 `resourceCount` 之和（128），
 * `monitoredCount` = 五类 `monitoredCount` 之和（96）。改动任一侧都必须同步另一侧。
 */
export const mockDashboardStats: DashboardStats = {
  resourceTotal: 128,
  monitoredCount: 96,
  scrapeJobCount: 64,
  scrapeJobEnabledCount: 58,
  managedDomainCount: 4,
  pendingDraftCount: 9,
}

export const mockAlertGovernance: AlertGovernance = {
  todayCount: 12,
  weekCount: 38,
  // 通知中（AM active）：与 silenced / inhibited 满足不变量
  // 「当前未恢复 8（= L0 告警卡）= 通知中 3 + 已静默 3 + 已抑制 2」
  // ——静默 / 抑制的告警在 Prom 侧仍 firing，只是 AM 不再投递（2026-09-19 用户反馈后修齐）
  // 不变量二：「最新告警」列表 = 当前未恢复全量 8 条，status 分布必须与 active/silenced/inhibited 一致（3/3/2）
  active: 3,
  silenced: 3,
  inhibited: 2,
  unprocessed: 4,
  // Prom 触发中 = L0「告警」卡同源（/api/v1/alerts firing 总数），必须与 8 一致
  promFiring: 8,
  promPending: 5,
}

/**
 * 最新告警列表（决策 73 / 93 同版本微调）：
 * 维度 = 「当前未恢复告警」按触发时间倒序的全量 8 条（与 mockAlertGovernance.promFiring 同源同数），
 * 不是「当日 12 条」的明细——当日为历史累计（含已恢复），与本列表口径不同、数量不对应属正常。
 * status 分布必须满足不变量：active 3 + silenced 3 + inhibited 2 = 8。
 * 首条 alt-008 特意保留一条 5 天前触发的长时未恢复：让读者直观看到「未恢复 ≠ 今日触发」。
 */
export const mockLatestAlerts: LatestAlert[] = [
  {
    id: 'alt-001',
    severity: 'critical',
    name: '主机 CPU 使用率过高',
    summary: 'CPU 使用率 92%，超过阈值 85% 已持续 5 分钟',
    instanceName: 'prod-web-01',
    startsAt: '2026-09-19 09:32:00',
    status: 'active',
  },
  {
    id: 'alt-002',
    severity: 'critical',
    name: '节点离线',
    summary: '节点已 60 秒无响应，疑似断网或采集进程异常',
    instanceName: 'edge-node-03',
    startsAt: '2026-09-19 09:28:00',
    status: 'active',
  },
  {
    id: 'alt-003',
    severity: 'warning',
    name: '磁盘空间不足',
    summary: '数据盘使用率 91%，预计 6 小时后写满',
    instanceName: 'prod-db-01',
    startsAt: '2026-09-19 09:15:00',
    status: 'active',
  },
  {
    id: 'alt-004',
    severity: 'critical',
    name: '服务拨测失败',
    summary: 'HTTP 探针连续 3 次超时（>3s）',
    instanceName: 'order-service-v2',
    startsAt: '2026-09-19 08:58:00',
    status: 'silenced',
  },
  {
    id: 'alt-005',
    severity: 'warning',
    name: '内存使用率偏高',
    summary: '内存使用率 88%，接近告警阈值 90%',
    instanceName: 'redis-cache-01',
    startsAt: '2026-09-19 08:40:00',
    status: 'silenced',
  },
  {
    id: 'alt-007',
    severity: 'critical',
    name: 'MySQL 连接数逼近上限',
    summary: '当前连接数 480 / 上限 512，剩余 6%',
    instanceName: 'mysql-master',
    startsAt: '2026-09-18 17:05:00',
    status: 'inhibited',
  },
  {
    id: 'alt-009',
    severity: 'warning',
    name: '容器重启次数异常',
    summary: '过去 1 小时内重启 5 次',
    instanceName: 'k8s-worker-12',
    startsAt: '2026-09-17 21:12:00',
    status: 'inhibited',
  },
  {
    id: 'alt-008',
    severity: 'warning',
    name: '文件系统 inode 使用率偏高',
    summary: 'inode 使用率 87%，小文件数量过多',
    instanceName: 'prod-app-07',
    startsAt: '2026-09-14 07:48:00',
    status: 'silenced',
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

// —— 首页 v1.4（决策 91）：L1 资源类型分组 / L2 应用明细 / 拨测口径 ——

/** 资源类型枚举（对齐 Module_07 `resource_category`，UI 名见 §10 术语映射） */
export type ResourceCategoryKey =
  | 'host'
  | 'database'
  | 'middleware'
  | 'application'
  | 'generic_target'

/** 采集类型子类明细行（卡内二级层级，可点击下钻资源清单） */
export interface SubtypeSummary {
  key: string
  name: string
  resourceCount: number
  monitoredCount: number
}

/** L1 资源类型卡数据：按资源类型分组的采集覆盖（决策 93 同版本微调第二轮：告警收口 L0 + 告警状态卡，不再携带告警字段） */
export interface ResourceTypeSummary {
  resourceCategory: ResourceCategoryKey
  name: string
  resourceCount: number
  monitoredCount: number
  /** 应用服务为空数组：平台不按语言 / 框架拆分采集类型子类 */
  subtypes: SubtypeSummary[]
}

/** L2 应用明细行（决策 93 同版本微调：告警数字收口 L0 + 告警状态卡，本表不再携带「未恢复」列） */
export interface AppSummary {
  appCode: string
  appName: string
  bizCode: string
  bizName: string
  resourceCount: number
  monitoredCount: number
}

/** 拨测目标概况：不计入资源台账与覆盖率分子分母，仅作附注 */
export interface ProbeSummary {
  targetCount: number
  abnormalCount: number
}

/**
 * 拨测目标明细（决策 93）：驱动 L3 拨测态势面板。
 * 归属定则：业务域必填、应用可选（官网 / 证书 / 第三方类拨测不属任何应用；
 * 先例 = Module_07 决策 92 设备类 `app_code` 留空）。`lastProbeAt` 口径由 M01 blackbox 回传承载。
 */
export interface ProbeTarget {
  id: string
  url: string
  status: 'up' | 'down'
  bizCode: string
  bizName: string
  appCode?: string
  appName?: string
  lastProbeAt: string
}

/**
 * 五个资源类型的资源数之和应等于资源总数——原型 mock 保持这一自洽关系，
 * 避免演示时出现「分项加不齐」的质疑。（告警字段已随两点收口移除，告警数字唯一来源 = mockAlertGovernance）
 */
export const mockResourceTypes: ResourceTypeSummary[] = [
  {
    resourceCategory: 'host',
    name: '主机',
    resourceCount: 42,
    monitoredCount: 36,
    subtypes: [
      { key: 'linux', name: 'Linux', resourceCount: 34, monitoredCount: 30 },
      { key: 'windows', name: 'Windows', resourceCount: 8, monitoredCount: 6 },
    ],
  },
  {
    resourceCategory: 'database',
    name: '数据库',
    resourceCount: 26,
    monitoredCount: 21,
    subtypes: [
      { key: 'mysql', name: 'MySQL', resourceCount: 10, monitoredCount: 9 },
      { key: 'redis', name: 'Redis', resourceCount: 6, monitoredCount: 5 },
      { key: 'oracle', name: 'Oracle', resourceCount: 3, monitoredCount: 1 },
      { key: 'postgresql', name: 'PostgreSQL', resourceCount: 5, monitoredCount: 4 },
      { key: 'mongodb', name: 'MongoDB', resourceCount: 2, monitoredCount: 2 },
    ],
    /** 5 个子类 > 封顶 3：演示「更多 +2」聚合 chip（决策 93）；分项之和 26/21 与类目一致 */
  },
  {
    resourceCategory: 'middleware',
    name: '中间件',
    resourceCount: 18,
    monitoredCount: 12,
    subtypes: [
      { key: 'kafka', name: 'Kafka', resourceCount: 8, monitoredCount: 6 },
      { key: 'nginx', name: 'Nginx', resourceCount: 6, monitoredCount: 4 },
      { key: 'elasticsearch', name: 'Elasticsearch', resourceCount: 4, monitoredCount: 2 },
    ],
  },
  {
    resourceCategory: 'application',
    name: '应用服务',
    resourceCount: 34,
    monitoredCount: 22,
    subtypes: [],
  },
  {
    resourceCategory: 'generic_target',
    name: '其他监控目标',
    resourceCount: 8,
    monitoredCount: 5,
    subtypes: [
      { key: 'snmp', name: 'SNMP 网络设备', resourceCount: 4, monitoredCount: 3 },
      { key: 'k8s', name: 'K8s 集群端点', resourceCount: 3, monitoredCount: 2 },
      { key: 'custom_http', name: '自定义 HTTP 端点', resourceCount: 1, monitoredCount: 0 },
    ],
  },
]

/**
 * L2 应用明细：按覆盖率升序排列（缺口最大的排最前），未归类行置底。
 * 三个应用 + 未归类行的 `resourceCount` / `monitoredCount` 之和同样等于 128 / 96，
 * 与 L0 全局、L1 五类两个层级互为交叉校验。
 */
export const mockAppSummaries: AppSummary[] = [
  {
    appCode: 'user',
    appName: '用户中心',
    bizCode: 'user',
    bizName: '用户业务',
    resourceCount: 24,
    monitoredCount: 16,
  },
  {
    appCode: 'data-api',
    appName: '数据网关',
    bizCode: 'data-api',
    bizName: '数据服务',
    resourceCount: 26,
    monitoredCount: 20,
  },
  {
    appCode: 'payment',
    appName: '支付平台',
    bizCode: 'payment',
    bizName: '支付业务',
    resourceCount: 30,
    monitoredCount: 24,
  },
]

/** 未标注应用归属的资源（L2 置底行，引导补填） */
export const mockUnclassifiedResource = {
  resourceCount: 48,
  monitoredCount: 36,
}

/** 拨测目标概况（Blackbox；不计入资源台账与覆盖率）。abnormalCount 应等于 mockProbeTargets 中 down 数 */
export const mockProbeSummary: ProbeSummary = {
  targetCount: 12,
  abnormalCount: 2,
}

/** 拨测目标明细（12 条，2 条异常演示「异常排前 + 标红」；应用列留空演示可空语义） */
export const mockProbeTargets: ProbeTarget[] = [
  { id: 'probe-01', url: 'https://pay-api.example.cn/healthz', status: 'down', bizCode: 'payment', bizName: '支付业务', appCode: 'payment', appName: '支付平台', lastProbeAt: '2026-09-19T09:36:00+08:00' },
  { id: 'probe-02', url: 'https://www.example.cn/cert-check', status: 'down', bizCode: 'user', bizName: '用户业务', lastProbeAt: '2026-09-19T09:27:00+08:00' },
  { id: 'probe-03', url: 'https://www.example.cn/', status: 'up', bizCode: 'user', bizName: '用户业务', lastProbeAt: '2026-09-19T09:38:00+08:00' },
  { id: 'probe-04', url: 'https://data-api.example.cn/health', status: 'up', bizCode: 'data', bizName: '数据服务', appCode: 'data-api', appName: '数据网关', lastProbeAt: '2026-09-19T09:38:00+08:00' },
  { id: 'probe-05', url: 'https://order.example.cn/submit', status: 'up', bizCode: 'payment', bizName: '支付业务', appCode: 'payment', appName: '支付平台', lastProbeAt: '2026-09-19T09:37:00+08:00' },
  { id: 'probe-06', url: 'tcp://mysql.pay.example.cn:3306', status: 'up', bizCode: 'payment', bizName: '支付业务', appCode: 'payment', appName: '支付平台', lastProbeAt: '2026-09-19T09:37:00+08:00' },
  { id: 'probe-07', url: 'https://gateway.example.cn/v1/ping', status: 'up', bizCode: 'data', bizName: '数据服务', appCode: 'data-api', appName: '数据网关', lastProbeAt: '2026-09-19T09:36:00+08:00' },
  { id: 'probe-08', url: 'https://sso.example.cn/login', status: 'up', bizCode: 'user', bizName: '用户业务', lastProbeAt: '2026-09-19T09:35:00+08:00' },
  { id: 'probe-09', url: 'https://cdn.example.cn/', status: 'up', bizCode: 'user', bizName: '用户业务', lastProbeAt: '2026-09-19T09:34:00+08:00' },
  { id: 'probe-10', url: 'https://k8s-api.example.cn:6443/healthz', status: 'up', bizCode: 'data', bizName: '数据服务', lastProbeAt: '2026-09-19T09:33:00+08:00' },
  { id: 'probe-11', url: 'https://mail.example.cn/smtp-check', status: 'up', bizCode: 'user', bizName: '用户业务', lastProbeAt: '2026-09-19T09:30:00+08:00' },
  { id: 'probe-12', url: 'https://static.example.cn/', status: 'up', bizCode: 'user', bizName: '用户业务', lastProbeAt: '2026-09-19T09:28:00+08:00' },
]
