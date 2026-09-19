import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  Card,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ApiOutlined,
  BellOutlined,
  GlobalOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  SendOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { MainLayout } from '../layouts/MainLayout'
import {
  LATEST_ALERT_LIMIT,
  PROM_EVAL_LABEL,
  SEVERITY_BG,
  SEVERITY_COLORS,
  SEVERITY_LABEL,
  NOTIFY_STATUS_LABEL,
  mockAlertGovernance,
  mockAppSummaries,
  mockLatestAlerts,
  mockOnboardingSteps,
  mockProbeSummary,
  mockProbeTargets,
  mockResourceTypes,
  mockUnclassifiedResource,
  type AppSummary,
  type LatestAlert,
  type ResourceCategoryKey,
} from '../mocks/module-05'
import { ReviewNote } from '../components/ReviewNote'

const { Title, Text } = Typography

const BRAND = '#0ECDEB'
const BRAND_SOFT = 'rgba(14, 205, 235, 0.10)'
const DANGER = '#FF4C3A'
const WARN = '#FF8B00'
const TEXT_BASE = '#1D2129'
const TEXT_SECONDARY = '#4E5969'
const TEXT_TERTIARY = '#86909C'
const BORDER = '#ECEEF1'

/** 告警列表每页行数（决策 89：数据池仍为最新 8 条，每页 5 行） */
const ALERT_PAGE_SIZE = 5

const relativeTime = (raw: string): string => {
  const t = dayjs(raw)
  if (!t.isValid()) return '-'
  const mins = dayjs().diff(t, 'minute')
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

const rate = (monitored: number, total: number): number => (total > 0 ? Math.round((monitored / total) * 100) : 0)

/**
 * L0 全局数字由 L1 五类汇总而来，保证「分项加得齐」：
 * 资源总数 = 五类 resourceCount 之和；已纳入监控 = 五类 monitoredCount 之和。
 * 后端同一不变量见 PRD v1.7 §5.1（by_category 之和等于 resource_count）。
 */
const resourceTotal = mockResourceTypes.reduce((sum, item) => sum + item.resourceCount, 0)
const monitoredTotal = mockResourceTypes.reduce((sum, item) => sum + item.monitoredCount, 0)
const coverageRate = rate(monitoredTotal, resourceTotal)

/**
 * 资源类型量词（**视觉定版**）：主机按「台」，其余类型**不写量词**。
 *
 * 「个」在 `/ 26 个已采` 里只增视觉噪音、不增信息（数据库 / 中间件 / 应用服务 / 其他监控目标
 * 都已经是「实例」口径）；主机保留「台」是因为它同时承载了「机器」这一物理语义。
 * 量词只出现在「已采 / 总数」一处；「未采 N」不重复量词。
 */
const CATEGORY_UNIT: Record<ResourceCategoryKey, string> = {
  host: '台',
  database: '',
  middleware: '',
  application: '',
  generic_target: '',
}

/**
 * L1 类型徽标：**单字**（视觉定版）。
 * 三个线性图标（数据库 / 中间件 / 应用服务）在 26px 容器里形态接近、扫读时辨识成本高；
 * 改用类型首字 + 品牌青浅底，一眼可辨，也不再与右侧大数字争视觉权重。
 */
const CATEGORY_BADGE: Record<ResourceCategoryKey, string> = {
  host: '主',
  database: '数',
  middleware: '中',
  application: '应',
  generic_target: '其',
}

/**
 * 卡内脚注：只给「本类里最容易被误读成成员」的两类写，不给每张卡都挂一句（那会变成噪音）。
 *
 * - **应用服务**：应用往往同时配了 `health_check_url`，它产生的拨测目标**不入本类**；
 * - **其他监控目标**：本类的 SNMP / K8s 端点 / 自定义 HTTP 都是「拉指标」端点，
 *   拨测走 Blackbox 采集任务、不录入资源台账。
 */
const CATEGORY_FOOTNOTE: Partial<Record<ResourceCategoryKey, string>> = {
  application: '拨测目标不计入本类 ↓',
  generic_target: '拨测走 blackbox Job，不录入资源台账',
}

/** 应用服务卡副标题：明示「为什么不拆子类」，避免子类区留白 */
const APPLICATION_SUBTYPE_NOTE = '单一采集类型 · 不按语言拆'

/** 应用服务不拆子类的理由（chip Tooltip） */
const APPLICATION_SUBTYPE_TIP =
  '业务应用自带指标端点：Spring Boot Actuator / Go client / Python 等实现同归这一类，平台不按语言 / 框架拆分采集类型'

/** L0 第 4 卡：当前未恢复告警总数（单一来源 = mockAlertGovernance.promFiring；L1 / L2 不再分组展示告警） */
const unrecoveredTotal = mockAlertGovernance.promFiring

const ONBOARDING_ICON: Record<string, ReactNode> = {
  domain: <GlobalOutlined />,
  resources: <ImportOutlined />,
  job: <ApiOutlined />,
  deploy: <SendOutlined />,
  alertConfig: <BellOutlined />,
  query: <LineChartOutlined />,
}

/** 覆盖率进度条：低于 70% 用橙色警示（决策 91） */
function CoverageBar({
  value,
  width,
  color,
}: {
  value: number
  width?: number | string
  /** 覆写颜色（L0「整体覆盖率」恒用品牌青）；缺省按 70% 阈值自动切换 */
  color?: string
}) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: width ?? '100%',
        height: 6,
        borderRadius: 3,
        background: '#ECEFF3',
        overflow: 'hidden',
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          display: 'block',
          width: `${value}%`,
          height: '100%',
          borderRadius: 3,
          background: color ?? (value < 70 ? WARN : BRAND),
        }}
      />
    </span>
  )
}

/**
 * L0 全局态势卡（**视觉定版**）：标签 12px 在上 → 30px/800 数字 → 副行。
 *
 * 版式要点：
 * - 卡内**不放图标容器**——数字已经是卡内唯一视觉主体，图标只会与它争权重；
 * - 「整体覆盖率」用**进度条**替代副行文字：75% 这个数字需要一段横向长度才有「进度感」，
 *   文字副行（「已纳入监控 ÷ 资源总数」）挪进 ⓘ 口径说明，不重复；
 * - 第 4 卡（告警）用**浅红底 + 浅红边**：它表达的是「异常数」而非「资产数」，
 *   与前 3 张分开才不会在扫读时被当成第四种资产。
 */
function GlobalStatCard({
  title,
  value,
  sub,
  tip,
  valueColor,
  progress,
  danger,
}: {
  title: string
  value: string | number
  sub?: string
  tip: string
  valueColor?: string
  /** 传入时以进度条替代副行文字（目前仅「整体覆盖率」使用） */
  progress?: number
  /** 告警卡：浅红底 + 浅红边，与三张资产卡视觉分离 */
  danger?: boolean
}) {
  return (
    <Card
      className="page-card"
      style={{
        position: 'relative',
        height: '100%',
        ...(danger ? { background: '#FFF1F0', borderColor: '#FFCFC9' } : {}),
      }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      <div style={{ fontSize: 12, color: danger ? '#A8321F' : TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{title}</div>
      <div
        style={{
          marginTop: 8,
          fontSize: 30,
          fontWeight: 800,
          lineHeight: 1.15,
          color: valueColor ?? TEXT_BASE,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {progress === undefined ? (
        <div style={{ marginTop: 4, fontSize: 11, color: TEXT_TERTIARY, whiteSpace: 'nowrap' }}>{sub}</div>
      ) : (
        <div style={{ marginTop: 12 }} aria-label={`覆盖率 ${progress}%`}>
          <CoverageBar value={progress} color={BRAND} />
        </div>
      )}
      <Tooltip title={tip}>
        <InfoCircleOutlined
          tabIndex={0}
          aria-label={`${title}口径说明`}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            fontSize: 13,
            color: danger ? '#C98A80' : TEXT_TERTIARY,
          }}
        />
      </Tooltip>
    </Card>
  )
}

/**
 * 子类明细 chip（**视觉定版**）：白底细边，左侧子类名、右侧「已采/总数 · 覆盖率」。
 * 覆盖率 <70% 换**橙底橙边 + 橙色数字**；纯说明性 chip（`muted`）用浅灰底、无右侧数值；
 * 聚合 chip（`more`，决策 93）用虚线品牌青边——子类封顶 3 条后，第 4 条起收进「更多 +N」。
 * 颜色不是唯一语义——右侧始终保留数字，色盲用户同样可读。
 */
function SubtypeChip({
  label,
  value,
  warn,
  muted,
  more,
}: {
  label: string
  value?: string
  warn?: boolean
  muted?: boolean
  more?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        borderRadius: 6,
        fontSize: 12,
        background: more ? '#FFFFFF' : muted ? '#F7F8FA' : warn ? '#FFF3E8' : '#FFFFFF',
        border: `1px ${more ? 'dashed' : 'solid'} ${more ? '#7DD8EA' : !muted && warn ? '#FBDCC2' : BORDER}`,
        color: more ? '#0AA5C4' : undefined,
      }}
    >
      <span
        style={{
          color: more ? '#0AA5C4' : muted ? TEXT_TERTIARY : TEXT_SECONDARY,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {value && (
        <span
          style={{
            color: more ? '#0AA5C4' : warn ? '#C25E0A' : TEXT_TERTIARY,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      )}
    </div>
  )
}

/**
 * L1 资源类型卡（**视觉定版 v3，决策 93**）：单字徽标 + 类型名 →（告警胶囊已删：告警信息收口 L0 + 告警状态卡，本卡只承载采集覆盖）→
 * 已采数 + `/ N 量词已采` → 覆盖率进度条 → 「覆盖率 X%」/「未采 N」 →
 * 细分隔线 → 子类 chip 列表（<70% 橙底）。
 *
 * **子类封顶 3 条**（决策 93）：第 4 条起聚合为「更多 +N」虚线 chip，行高有确定性上界，
 * 同行五卡等高不再被子类数量拉爆（一行五卡布局的前提）。
 *
 * 「应用服务」没有子类：渲染 一行规则说明 + `application_http` 指标 chip，
 * 让「为什么不拆」在卡内自解释；**不再渲染采集形态示例 chip**（空态减负，决策 93）。
 * 其他分类录入为 0 时保留卡位，子类区给「去录入」行动出口（不自动隐藏，决策 93 第 9 条）。
 */
function ResourceTypeCard({ item }: { item: (typeof mockResourceTypes)[number] }) {
  const percent = rate(item.monitoredCount, item.resourceCount)
  const footnote = CATEGORY_FOOTNOTE[item.resourceCategory]
  return (
    <Card
      className="page-card"
      style={{ height: '100%', borderRadius: 12, display: 'flex', flexDirection: 'column' }}
      styles={{ body: { padding: 16, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: BRAND_SOFT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1, fontWeight: 700, color: BRAND }}>
              {CATEGORY_BADGE[item.resourceCategory]}
            </span>
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: TEXT_BASE, whiteSpace: 'nowrap' }}>{item.name}</span>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          style={{
            fontSize: 32,
            fontWeight: 800,
            lineHeight: 1.1,
            color: TEXT_BASE,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {item.monitoredCount}
        </span>
        <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>
          / {item.resourceCount} {CATEGORY_UNIT[item.resourceCategory]}已采
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        <CoverageBar value={percent} />
        <div
          style={{
            marginTop: 5,
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: TEXT_SECONDARY,
          }}
        >
          <span>覆盖率 {percent}%</span>
          <span style={{ color: TEXT_TERTIARY }}>未采 {item.resourceCount - item.monitoredCount}</span>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: `1px solid ${BORDER}`,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: TEXT_TERTIARY }}>
          {item.resourceCategory === 'application' ? APPLICATION_SUBTYPE_NOTE : '采集类型子类'}
        </div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {item.resourceCategory === 'application' ? (
            <Tooltip title={APPLICATION_SUBTYPE_TIP}>
              <SubtypeChip
                label="application_http"
                value={`${item.monitoredCount}/${item.resourceCount} · ${percent}%`}
                warn={percent < 70}
              />
            </Tooltip>
          ) : item.subtypes.length === 0 ? (
            <Tooltip title="该分类暂无录入；登记后此处将按采集类型展开子类明细">
              <Link to="/resources" style={{ textDecoration: 'none' }}>
                <SubtypeChip label="暂无录入 · 去录入" value="→" more />
              </Link>
            </Tooltip>
          ) : (
            <>
              {item.subtypes.slice(0, 3).map((sub) => {
                const subRate = rate(sub.monitoredCount, sub.resourceCount)
                return (
                  <Tooltip key={sub.key} title="点击查看该采集类型的资源清单">
                    <Link to="/resources" style={{ textDecoration: 'none' }}>
                      <SubtypeChip
                        label={sub.name}
                        value={`${sub.monitoredCount}/${sub.resourceCount} · ${subRate}%`}
                        warn={subRate < 70}
                      />
                    </Link>
                  </Tooltip>
                )
              })}
              {item.subtypes.length > 3 && (
                <Tooltip title={`其余 ${item.subtypes.length - 3} 个采集类型，点击查看资源清单`}>
                  <Link to="/resources" style={{ textDecoration: 'none' }}>
                    <SubtypeChip label={`更多 +${item.subtypes.length - 3}`} value="→" more />
                  </Link>
                </Tooltip>
              )}
            </>
          )}
        </div>
        {footnote && (
          <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 10, color: TEXT_TERTIARY }}>{footnote}</div>
        )}
      </div>
    </Card>
  )
}

/** 告警状态四格统计条：当日 / 近 7 天为主数字，AM 治理态为次；每格 ⓘ 用户语言释义（口径公式与按角色读法收进评审说明区，决策 93 同版本微调） */
function AlertStatStrip() {
  const cells: { key: string; value: string | number; label: string; tip: string; color: string }[] = [
    {
      key: 'today',
      value: mockAlertGovernance.todayCount,
      label: '当日告警',
      tip: '今日 0 点以来触发过的告警总数，包含已自动恢复的。用来看今天的告警多不多。',
      color: TEXT_BASE,
    },
    {
      key: 'week',
      value: mockAlertGovernance.weekCount,
      label: '近 7 天告警',
      tip: '最近 7 天触发过的告警总数，包含已恢复的。用来看这一周的告警趋势。',
      color: TEXT_BASE,
    },
    {
      key: 'active',
      value: mockAlertGovernance.active,
      label: '通知中',
      tip: '正在发送通知的告警——你收到的告警通知来自这里。',
      color: DANGER,
    },
    {
      key: 'governed',
      value: `${mockAlertGovernance.silenced} · ${mockAlertGovernance.inhibited}`,
      label: '已静默 · 已抑制',
      tip: '被暂时屏蔽通知的告警：问题还在，只是暂不打扰，恢复前仍需处理。左侧「告警」总数 = 通知中 + 已静默 + 已抑制。',
      color: TEXT_SECONDARY,
    },
  ]
  return (
    <div>
      <div style={{ display: 'flex', borderTop: `1px solid #F2F3F5`, borderBottom: `1px solid #F2F3F5`, padding: '8px 0 7px' }}>
        {cells.map((cell, idx) => (
          <Tooltip key={cell.key} title={cell.tip}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                padding: idx === 0 ? '0 12px 0 0' : '0 12px',
                borderLeft: idx === 0 ? undefined : '1px solid #F2F3F5',
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: cell.color,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {cell.value}
              </div>
              <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 2, whiteSpace: 'nowrap' }}>{cell.label}</div>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

/** 最新告警两行制列表行：行 1 级别 + 告警名 + 相对时间 + 状态，行 2 实例名 + 告警内容 */
function AlertRow({ alert, isLast }: { alert: LatestAlert; isLast: boolean }) {
  const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }
  return (
    <div style={{ padding: '6px 0', borderBottom: isLast ? 'none' : '1px solid #F7F8FA' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag
          style={{
            marginInlineEnd: 0,
            flexShrink: 0,
            color: SEVERITY_COLORS[alert.severity],
            background: SEVERITY_BG[alert.severity],
            border: 'none',
          }}
        >
          {SEVERITY_LABEL[alert.severity]}
        </Tag>
        <Tooltip title={alert.name}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: TEXT_BASE, ...ellipsis }}>
            {alert.name}
          </span>
        </Tooltip>
        <span style={{ flexShrink: 0, fontSize: 12, color: TEXT_TERTIARY, textAlign: 'right' }}>
          {relativeTime(alert.startsAt)}
        </span>
        <span style={{ flexShrink: 0, width: 48, fontSize: 12, color: TEXT_SECONDARY, textAlign: 'right' }}>
          {NOTIFY_STATUS_LABEL[alert.status]}
        </span>
      </div>
      <Tooltip title={`${alert.instanceName ?? '-'} · ${alert.summary}`}>
        <div style={{ marginTop: 2, fontSize: 12, lineHeight: '17px', color: TEXT_TERTIARY, ...ellipsis }}>
          {alert.instanceName ?? '-'} · {alert.summary}
        </div>
      </Tooltip>
    </div>
  )
}

interface AppRow extends AppSummary {
  key: string
  isUnclassified: boolean
}

const appRows: AppRow[] = [
  ...mockAppSummaries.map((app) => ({ ...app, key: app.appCode, isUnclassified: false })),
  {
    key: 'unclassified',
    appCode: '',
    appName: '未归类应用',
    bizCode: '',
    bizName: '',
    resourceCount: mockUnclassifiedResource.resourceCount,
    monitoredCount: mockUnclassifiedResource.monitoredCount,
    isUnclassified: true,
  },
]

const appColumns: ColumnsType<AppRow> = [
  {
    title: '应用名称',
    dataIndex: 'appName',
    key: 'appName',
    render: (name: string, row) => (
      <span style={{ color: row.isUnclassified ? TEXT_TERTIARY : TEXT_BASE }}>
        {name}
        {row.appCode ? <span style={{ marginLeft: 6, fontSize: 12, color: TEXT_TERTIARY }}>{row.appCode}</span> : null}
      </span>
    ),
  },
  {
    title: '业务域',
    dataIndex: 'bizName',
    key: 'bizName',
    render: (name: string) => name || '—',
  },
  { title: '实例', dataIndex: 'resourceCount', key: 'resourceCount', width: 80 },
  { title: '已采', dataIndex: 'monitoredCount', key: 'monitoredCount', width: 80 },
  {
    title: '覆盖率',
    key: 'coverage',
    width: 160,
    render: (_, row) => {
      const percent = rate(row.monitoredCount, row.resourceCount)
      return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CoverageBar value={percent} width={52} />
          <span style={{ fontSize: 12, color: percent < 70 ? '#C25E0A' : TEXT_SECONDARY }}>{percent}%</span>
        </span>
      )
    },
  },
  {
    title: '操作',
    key: 'action',
    width: 100,
    render: (_, row) => (
      <Link to="/resources">{row.isUnclassified ? '去补填' : '补齐监控'}</Link>
    ),
  },
]

/** L3 拨测态势面板：每页 5 行（对齐告警列表节奏，决策 89 / 93） */
const PROBE_PAGE_SIZE = 5

type ProbeTargetStatus = (typeof mockProbeTargets)[number]['status']

/**
 * 拨测目标排序（决策 93）：异常固定排最前，同状态按最近拨测时间倒序。
 * 排序在前端做（PRD §5.1：接口不承担排序）。
 */
const sortedProbeTargets = [...mockProbeTargets].sort((a, b) => {
  const aDown = a.status === 'down'
  const bDown = b.status === 'down'
  if (aDown !== bDown) return aDown ? -1 : 1
  return dayjs(b.lastProbeAt).valueOf() - dayjs(a.lastProbeAt).valueOf()
})

/** L3 拨测态势面板（决策 93）：全量拨测目标明细，异常标红排前；业务域必填、应用可选（空显 `-`） */
function ProbePanel() {
  const [probePage, setProbePage] = useState(0)
  const total = sortedProbeTargets.length
  const normalCount = sortedProbeTargets.filter((t) => t.status === 'up').length
  const abnormalCount = total - normalCount
  const pageCount = Math.max(1, Math.ceil(total / PROBE_PAGE_SIZE))
  const safePage = Math.min(probePage, pageCount - 1)
  const pageTargets = sortedProbeTargets.slice(safePage * PROBE_PAGE_SIZE, safePage * PROBE_PAGE_SIZE + PROBE_PAGE_SIZE)

  if (total === 0) {
    return (
      <Card className="page-card" style={{ marginTop: 16 }} title="拨测态势">
        <div style={{ padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: TEXT_BASE }}>暂无拨测目标</div>
          <Text type="secondary" style={{ marginTop: 6, fontSize: 12, textAlign: 'center' }}>
            拨测由 blackbox 采集 Job 承载，不录入资源台账：先创建拨测采集任务并登记目标（需挂业务域，应用可选）。
          </Text>
          <Link to="/strategy" style={{ marginTop: 12 }}>
            去配置拨测任务 →
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card
      className="page-card"
      style={{ marginTop: 16 }}
      title="拨测态势"
      extra={
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
          <Text type="secondary">
            拨测目标 {total} · 正常 {normalCount} ·{' '}
            <span style={{ color: abnormalCount > 0 ? DANGER : TEXT_TERTIARY }}>异常 {abnormalCount}</span>
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            异常排前 · 同状态按最近拨测倒序
          </Text>
          <Link to="/strategy">拨测任务管理 →</Link>
        </span>
      }
    >
      <Table
        rowKey="id"
        size="small"
        dataSource={pageTargets}
        pagination={false}
        rowClassName={(row) => (row.status === 'down' ? 'probe-row-down' : '')}
        columns={[
          {
            title: '拨测目标',
            dataIndex: 'url',
            ellipsis: true,
            render: (url: string) => (
              <Tooltip title={url}>
                <span style={{ color: TEXT_BASE }}>{url}</span>
              </Tooltip>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (status: ProbeTargetStatus) =>
              status === 'down' ? (
                <Badge status="error" text={<span style={{ color: DANGER }}>异常</span>} />
              ) : (
                <Badge status="success" text={<span style={{ color: TEXT_SECONDARY }}>正常</span>} />
              ),
          },
          { title: '业务域', dataIndex: 'bizName', width: 120 },
          {
            title: '应用',
            dataIndex: 'appName',
            width: 120,
            render: (name: string | undefined) => name ?? <span style={{ color: TEXT_TERTIARY }}>-</span>,
          },
          {
            title: '最近拨测',
            dataIndex: 'lastProbeAt',
            width: 110,
            render: (raw: string) => (
              <span style={{ color: TEXT_TERTIARY, fontVariantNumeric: 'tabular-nums' }}>{relativeTime(raw)}</span>
            ),
          },
        ]}
      />
      {pageCount > 1 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          <Text type="secondary" style={{ fontSize: 12, marginRight: 'auto' }}>
            共 {total} 条 · 每页 {PROBE_PAGE_SIZE} 行
          </Text>
          {Array.from({ length: pageCount }).map((_, idx) => (
            <span
              key={idx}
              onClick={() => setProbePage(idx)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setProbePage(idx)
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                cursor: 'pointer',
                color: idx === safePage ? '#fff' : TEXT_SECONDARY,
                background: idx === safePage ? BRAND : '#F4F5F7',
              }}
            >
              {idx + 1}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

export function DashboardPage() {
  const latestAlerts = mockLatestAlerts.slice(0, LATEST_ALERT_LIMIT)
  const [alertPage, setAlertPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(latestAlerts.length / ALERT_PAGE_SIZE))
  const safePage = Math.min(alertPage, pageCount - 1)
  const pageAlerts = latestAlerts.slice(safePage * ALERT_PAGE_SIZE, safePage * ALERT_PAGE_SIZE + ALERT_PAGE_SIZE)

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={3} style={{ marginBottom: 4 }}>
          MetricCenter 概览
        </Title>
        <Text type="secondary">
          这里汇总监控资源、采集覆盖进度、拨测端点可用性与当前未恢复的告警。
        </Text>
      </div>

      {/* L0 全局态势：5 卡一行（资源总数 / 已纳入监控 / 整体覆盖率 / 告警 / 拨测，决策 93） */}
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_BASE, marginBottom: 8 }}>全局态势</div>
      <div className="home-grid-5">
        <GlobalStatCard
          title="资源总数"
          value={resourceTotal}
          sub="五类台账合计"
          tip="已导入平台的监控资源总数（主机 / 数据库 / 中间件 / 应用服务 / 其他监控目标五类合计），拨测目标不计入。"
        />
        <GlobalStatCard
          title="已纳入监控"
          value={monitoredTotal}
          sub={`未纳管 ${resourceTotal - monitoredTotal}`}
          tip="至少被一个已启用的采集任务覆盖到的资源数；其余为尚未纳管的资源。"
        />
        <GlobalStatCard
          title="整体覆盖率"
          value={resourceTotal > 0 ? `${coverageRate}%` : '-'}
          tip="已纳入监控的资源数 ÷ 资源总数，反映当前纳管进度；拨测目标不参与计算。"
          valueColor={BRAND}
          progress={resourceTotal > 0 ? coverageRate : 0}
        />
        <GlobalStatCard
          title="告警"
          value={unrecoveredTotal}
          sub="当前未恢复"
          tip="此刻仍在触发、尚未恢复的告警条数。含已静默 / 已抑制的告警——问题还在，只是暂缓通知，不代表已恢复。去下方「告警状态」逐条处理。"
          valueColor={DANGER}
          danger
        />
        <GlobalStatCard
          title="拨测"
          value={mockProbeSummary.abnormalCount}
          sub={`/ ${mockProbeSummary.targetCount} 个拨测目标 · 异常数`}
          tip="当前探测失败的拨测目标数；拨测由 blackbox 采集任务承载，不计入资源台账与覆盖率。全量明细见下方「拨测态势」面板。"
          valueColor={mockProbeSummary.abnormalCount > 0 ? DANGER : TEXT_BASE}
        />
      </div>

      {/* L1 采集覆盖区（一行五卡，CSS grid；子类封顶 3 条 +「更多 +N」，决策 93；
          标题定名「采集覆盖」；告警胶囊已删（决策 93 同版本微调第二轮：告警数字收口 L0 + 告警状态卡，
          本区只体现采集覆盖，不再混排告警口径） */}
      <div style={{ marginTop: 20, marginBottom: 8, fontSize: 13, fontWeight: 600, color: TEXT_BASE }}>
        采集覆盖
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>
          （进度条与子类明细 = 各类型采集覆盖情况，子类最多 3 条，可点击穿到资源清单）
        </Text>
      </div>
      <div className="home-grid-5">
        {mockResourceTypes.map((item) => (
          <ResourceTypeCard key={item.resourceCategory} item={item} />
        ))}
      </div>

      {/* L2 应用覆盖明细表（标题定名「应用覆盖」：按应用聚合的采集覆盖进度） */}
      <div id="app-detail" style={{ marginTop: 16 }}>
        <Card
          className="page-card"
          title="应用覆盖"
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              按应用聚合的采集覆盖 · 覆盖率升序，缺口最大的排最前
            </Text>
          }
        >
          <Table rowKey="key" size="small" dataSource={appRows} columns={appColumns} pagination={false} />
        </Card>
      </div>

      {/* L3 拨测态势面板（整宽，决策 93：异常排前标红 / 分页 / 业务域必填应用可选） */}
      <ProbePanel />

      {/* L4 告警状态卡 + L5 使用指引（同排等高：左告警 1.6 : 右指引 1，用户反馈告警卡独占整宽太空） */}
      <div style={{ marginTop: 16, display: 'flex', gap: 16, alignItems: 'stretch' }}>
      <Card
        className="page-card"
        style={{ flex: 1.6, minWidth: 0 }}
        title="告警状态"
        extra={<Link to="/alert-status">查看全部 →</Link>}
      >
        <AlertStatStrip />

        {mockAlertGovernance.unprocessed > 0 && (
          <Tooltip title="告警刚进入通知队列，系统还在计算是否通知、通知给谁。">
            <Text style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: TEXT_TERTIARY }}>
              另有 {mockAlertGovernance.unprocessed} 条告警仍在计算通知状态
            </Text>
          </Tooltip>
        )}

        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_BASE, marginBottom: 2 }}>
            最新告警
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>
              （当前未恢复 · 最新的排最前）
            </Text>
          </div>
          {pageAlerts.map((alert, idx) => (
            <AlertRow key={alert.id} alert={alert} isLast={idx === pageAlerts.length - 1} />
          ))}
          {pageCount > 1 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              {Array.from({ length: pageCount }).map((_, idx) => (
                <span
                  key={idx}
                  onClick={() => setAlertPage(idx)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setAlertPage(idx)
                  }}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    cursor: 'pointer',
                    color: idx === safePage ? '#fff' : TEXT_SECONDARY,
                    background: idx === safePage ? BRAND : '#F4F5F7',
                  }}
                >
                  {idx + 1}
                </span>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #F2F3F5' }}>
          <Text style={{ fontSize: 11, color: TEXT_TERTIARY }}>
            Prometheus 原始求值 · {PROM_EVAL_LABEL.firing} {mockAlertGovernance.promFiring} /{' '}
            {PROM_EVAL_LABEL.pending} {mockAlertGovernance.promPending}
          </Text>
          <div style={{ marginTop: 6 }}>
            <Link to="/alert-config">配置告警通知 →</Link>
          </div>
        </div>
      </Card>

      {/* 使用指引（与告警状态卡同排等高，改纵向六步） */}
      <Card className="page-card" style={{ flex: 1, minWidth: 0 }} title="使用指引">
        <Steps
          direction="vertical"
          size="small"
          current={0}
          items={mockOnboardingSteps.map((step) => ({
            title: <Link to={step.to}>{step.title}</Link>,
            description: (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {step.desc}
              </Text>
            ),
            icon: <span style={{ color: BRAND }}>{ONBOARDING_ICON[step.key]}</span>,
          }))}
        />
      </Card>
      </div>

      {/* [DEV] 评审释义统一收口（提示分区规范）：口径公式 / 按角色读法 / 决策清单，默认折叠，右上角开关控制 */}
      <ReviewNote>
        <div>
          决策 93：首页六段版式（L0 全局态势五卡 / L1 采集覆盖一行五卡 + 子类封顶 3 +「更多 +N」/ L2 应用覆盖明细 / L3
          拨测态势面板 / 告警状态卡 + 使用指引同排等高）；删除「按应用查看」入口卡；summary 新增 `probe_targets[]`。
        </div>
        <div style={{ marginTop: 6 }}>
          告警口径（两点收口，同版本微调）：当前未恢复（L0「告警」卡，/api/v1/alerts firing
          总数）= 通知中（AM active）+ 已静默 + 已抑制——静默 / 抑制在 Prometheus 侧仍 firing，只是暂缓通知，不等于恢复；当日 /
          近 7 天 = 历史累计（M02 history，含已恢复），与未恢复并存不互替；「最新告警」列表 = 当前未恢复全量 8
          条（按触发时间倒序），非当日明细。
        </div>
        <div style={{ marginTop: 6 }}>
          按角色读法：业务经理看趋势（当日 / 近 7 天）；运维经理看通知压力（通知中）；运维工程师看待办（当前未恢复 +
          最新告警列表）。
        </div>
      </ReviewNote>
    </MainLayout>
  )
}
