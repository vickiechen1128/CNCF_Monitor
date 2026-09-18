import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
  Col,
  Row,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  ApiOutlined,
  BellOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  FileDoneOutlined,
  GlobalOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  LineChartOutlined,
  MonitorOutlined,
  SendOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { MainLayout } from '../layouts/MainLayout'
import {
  DEPLOYMENT_STATUS_LABEL,
  LATEST_ALERT_LIMIT,
  NOTIFY_STATUS_LABEL,
  PROM_EVAL_LABEL,
  SEVERITY_BG,
  SEVERITY_COLORS,
  SEVERITY_LABEL,
  mockAlertGovernance,
  mockDashboardStats,
  mockLatestAlerts,
  mockOnboardingSteps,
  mockQuickAccess,
  mockRecentDeployments,
  type LatestAlert,
} from '../mocks/module-05'

const { Title, Text } = Typography

const BRAND = '#0ECDEB'
const BRAND_SOFT = 'rgba(14, 205, 235, 0.10)'
const DANGER = '#FF4C3A'
const TEXT_BASE = '#1D2129'
const TEXT_SECONDARY = '#4E5969'
const TEXT_TERTIARY = '#86909C'

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

const coverageText =
  mockDashboardStats.resourceTotal > 0
    ? `${Math.round((mockDashboardStats.monitoredCount / mockDashboardStats.resourceTotal) * 100)}%`
    : '-'

interface MetricCard {
  key: string
  title: string
  value: string | number
  sub?: string
  tip: string
  icon: ReactNode
}

/** 关键指标卡（6 张纯资产 / 治理进度口径，不含任何告警数字） */
const metricCards: MetricCard[] = [
  {
    key: 'resourceTotal',
    title: '资源总数',
    value: mockDashboardStats.resourceTotal,
    tip: '已导入平台的监控资源总数（主机 / 数据库 / 中间件 / 应用 / 拨测目标五类合计）。',
    icon: <CloudServerOutlined />,
  },
  {
    key: 'monitored',
    title: '已监控',
    value: mockDashboardStats.monitoredCount,
    tip: '至少被一个已启用的采集任务覆盖到的资源数。',
    icon: <MonitorOutlined />,
  },
  {
    key: 'scrapeJob',
    title: '采集 Job',
    value: mockDashboardStats.scrapeJobCount,
    sub: `启用 ${mockDashboardStats.scrapeJobEnabledCount}`,
    tip: '采集任务总数，「启用」为当前正在生效的任务数。',
    icon: <ApiOutlined />,
  },
  {
    key: 'domain',
    title: '已纳管网域',
    value: mockDashboardStats.managedDomainCount,
    tip: '已纳入平台监控的网域数量。',
    icon: <GlobalOutlined />,
  },
  {
    key: 'draft',
    title: '待确认草稿',
    value: mockDashboardStats.pendingDraftCount,
    tip: '已生成配置草稿、但还没人工确认下发的变更数量。',
    icon: <FileDoneOutlined />,
  },
  {
    key: 'coverage',
    title: '采集覆盖率',
    value: coverageText,
    tip: '已监控资源数 ÷ 资源总数，反映当前纳管进度。',
    icon: <DashboardOutlined />,
  },
]

const QUICK_ACCESS_ICON: Record<string, ReactNode> = {
  resources: <CloudServerOutlined />,
  scrapeJobs: <ApiOutlined />,
  configPreview: <SendOutlined />,
  query: <LineChartOutlined />,
  alertStatus: <BellOutlined />,
}

const ONBOARDING_ICON: Record<string, ReactNode> = {
  domain: <GlobalOutlined />,
  resources: <ImportOutlined />,
  job: <ApiOutlined />,
  deploy: <SendOutlined />,
  alertConfig: <BellOutlined />,
  query: <LineChartOutlined />,
}

const deploymentColumns = [
  { title: '变更单号', dataIndex: 'changeNo', key: 'changeNo' },
  { title: '网域', dataIndex: 'networkDomain', key: 'networkDomain' },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    render: (status: keyof typeof DEPLOYMENT_STATUS_LABEL) => (
      <Tag color={status === 'pending' ? 'orange' : status === 'confirmed' ? 'green' : 'default'}>
        {DEPLOYMENT_STATUS_LABEL[status]}
      </Tag>
    ),
  },
  { title: '时间', dataIndex: 'triggeredAt', key: 'triggeredAt' },
]

/** 告警状态四格统计条：当日 / 近 7 天为主数字，AM 治理态为次（决策 73） */
function AlertStatStrip() {
  const cells: { key: string; value: string | number; label: string; tip: string; color: string }[] = [
    {
      key: 'today',
      value: mockAlertGovernance.todayCount,
      label: '当日告警',
      tip: '今日 0 点起触发过的告警条数（含已恢复）',
      color: TEXT_BASE,
    },
    {
      key: 'week',
      value: mockAlertGovernance.weekCount,
      label: '近 7 天告警',
      tip: '最近 7 天内触发过的告警条数（含已恢复）',
      color: TEXT_BASE,
    },
    {
      key: 'active',
      value: mockAlertGovernance.active,
      label: '通知中',
      tip: 'Alertmanager 当前仍在通知中的告警条数',
      color: DANGER,
    },
    {
      key: 'governed',
      value: `${mockAlertGovernance.silenced} · ${mockAlertGovernance.inhibited}`,
      label: '已静默 · 已抑制',
      tip: 'Alertmanager 静默规则命中数 · 抑制规则命中数',
      color: TEXT_SECONDARY,
    },
  ]
  return (
    <div
      style={{
        display: 'flex',
        borderTop: '1px solid #F2F3F5',
        borderBottom: '1px solid #F2F3F5',
        padding: '8px 0 7px',
      }}
    >
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
            <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 2, whiteSpace: 'nowrap' }}>
              {cell.label}
            </div>
          </div>
        </Tooltip>
      ))}
    </div>
  )
}

/** 最新告警两行制列表行：行 1 级别 + 告警名 + 相对时间 + 状态，行 2 实例名 + 告警内容（决策 73） */
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

export function DashboardPage() {
  const latestAlerts = mockLatestAlerts.slice(0, LATEST_ALERT_LIMIT)

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={3} style={{ marginBottom: 4 }}>
          MetricCenter 概览
        </Title>
        <Text type="secondary">
          欢迎回到 MetricCenter，这里汇总监控资源、采集任务与告警的整体运行情况。
        </Text>
      </div>

      {/* 关键指标卡区（6 张资产 / 治理进度卡，不含任何告警数字；卡内纵向排版：标签在上、大数字 30px 在下、图标 44px 容器右下，决策 73） */}
      <Row gutter={[16, 16]}>
        {metricCards.map((card) => (
          <Col xs={24} sm={12} md={8} xl={4} key={card.key}>
            <Card
              className="page-card"
              style={{ position: 'relative', height: '100%' }}
              styles={{ body: { padding: '14px 16px' } }}
            >
              <div style={{ fontSize: 12, color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>
                {card.title}
                {card.sub ? <span style={{ marginLeft: 6, color: TEXT_TERTIARY }}>{card.sub}</span> : null}
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 30,
                    fontWeight: 800,
                    lineHeight: 1.1,
                    color: TEXT_BASE,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {card.value}
                </span>
                <span
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: BRAND_SOFT,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1, color: BRAND }}>{card.icon}</span>
                </span>
              </div>
              <Tooltip title={card.tip}>
                <InfoCircleOutlined
                  tabIndex={0}
                  aria-label={`${card.title}口径说明`}
                  style={{ position: 'absolute', top: 12, right: 12, fontSize: 13, color: TEXT_TERTIARY }}
                />
              </Tooltip>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} align="stretch" style={{ marginTop: 16 }}>
        {/* 告警状态卡：首页唯一告警入口（四格统计条 + 最新告警两行制列表 + Prom 仅参考小字，决策 73） */}
        <Col xs={24} lg={10}>
          <Card
            className="page-card"
            title="告警状态"
            extra={<Link to="/alert-status">查看全部 →</Link>}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', paddingTop: 16 } }}
          >
            <AlertStatStrip />

            {mockAlertGovernance.unprocessed > 0 && (
              <Tooltip title="告警刚进入通知队列，系统还在计算是否通知、通知给谁。">
                <Text style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: TEXT_TERTIARY }}>
                  另有 {mockAlertGovernance.unprocessed} 条告警仍在计算通知状态
                </Text>
              </Tooltip>
            )}

            <div style={{ marginTop: 10, flex: 1, minHeight: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_BASE, marginBottom: 2 }}>最新告警</div>
              {latestAlerts.map((alert, idx) => (
                <AlertRow key={alert.id} alert={alert} isLast={idx === latestAlerts.length - 1} />
              ))}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #F2F3F5' }}>
              <Text style={{ fontSize: 11, color: TEXT_TERTIARY }}>
                Prometheus 原始求值 · {PROM_EVAL_LABEL.firing} {mockAlertGovernance.promFiring} /{' '}
                {PROM_EVAL_LABEL.pending} {mockAlertGovernance.promPending}
              </Text>
              <div style={{ marginTop: 6 }}>
                <Link to="/alert-config">配置告警通知 →</Link>
              </div>
            </div>
          </Card>
        </Col>

        {/* 右列：系统快速入口（一行五列压扁）→ 最近下发记录 → 使用指引（决策 73：指引自底部整行移入右列） */}
        <Col xs={24} lg={14}>
          <Card className="page-card" title="系统快速入口">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {mockQuickAccess.map((item) => (
                <Link
                  key={item.key}
                  to={item.to}
                  style={{ textDecoration: 'none', flex: '1 1 0', minWidth: 100 }}
                >
                  <Tooltip title={item.desc}>
                    <Card className="page-card" hoverable styles={{ body: { padding: '10px 12px' } }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: BRAND_SOFT,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <span style={{ fontSize: 16, lineHeight: 1, color: BRAND }}>
                            {QUICK_ACCESS_ICON[item.key]}
                          </span>
                        </span>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: TEXT_BASE,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.name}
                        </span>
                      </div>
                    </Card>
                  </Tooltip>
                </Link>
              ))}
            </div>
          </Card>

          <Card
            className="page-card"
            style={{ marginTop: 16 }}
            title="最近下发记录"
            extra={<Link to="/deployments">查看全部 →</Link>}
          >
            <Table
              rowKey="id"
              size="small"
              dataSource={mockRecentDeployments}
              columns={deploymentColumns}
              pagination={false}
            />
          </Card>

          <Card className="page-card" style={{ marginTop: 16 }} title="使用指引">
            <Steps
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
        </Col>
      </Row>
    </MainLayout>
  )
}
