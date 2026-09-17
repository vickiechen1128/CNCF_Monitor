import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
  Col,
  Row,
  Space,
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
const TEXT_BASE = '#1D2129'
const TEXT_SECONDARY = '#4E5969'
const TEXT_TERTIARY = '#86909C'

/** 最新告警列表列宽单一来源（表头与数据行共用，各写一份会列位错开） */
const ALERT_COL_WIDTH = { severity: 46, instance: 86, time: 70, status: 52 }

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

function AlertListHeader() {
  const style = { fontSize: 12, color: TEXT_TERTIARY }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0 6px',
        borderBottom: '1px solid #F2F3F5',
      }}
    >
      <span style={{ ...style, width: ALERT_COL_WIDTH.severity, flexShrink: 0 }}>级别</span>
      <span style={{ ...style, flex: 1, minWidth: 0 }}>告警名</span>
      <span style={{ ...style, width: ALERT_COL_WIDTH.instance, flexShrink: 0 }}>实例名</span>
      <span style={{ ...style, width: ALERT_COL_WIDTH.time, flexShrink: 0, textAlign: 'right' }}>时间</span>
      <span style={{ ...style, width: ALERT_COL_WIDTH.status, flexShrink: 0, textAlign: 'right' }}>状态</span>
    </div>
  )
}

function AlertRow({ alert, isLast }: { alert: LatestAlert; isLast: boolean }) {
  const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 0',
        fontSize: 13,
        borderBottom: isLast ? 'none' : '1px solid #F7F8FA',
      }}
    >
      <span style={{ width: ALERT_COL_WIDTH.severity, flexShrink: 0 }}>
        <Tag color={SEVERITY_COLORS[alert.severity]} style={{ marginInlineEnd: 0 }}>
          {SEVERITY_LABEL[alert.severity]}
        </Tag>
      </span>
      <Tooltip title={alert.name}>
        <span style={{ flex: 1, minWidth: 0, color: TEXT_BASE, ...ellipsis }}>{alert.name}</span>
      </Tooltip>
      <span style={{ width: ALERT_COL_WIDTH.instance, flexShrink: 0, color: TEXT_SECONDARY, ...ellipsis }}>
        {alert.instanceName ?? '-'}
      </span>
      <span style={{ width: ALERT_COL_WIDTH.time, flexShrink: 0, textAlign: 'right', color: TEXT_TERTIARY }}>
        {relativeTime(alert.startsAt)}
      </span>
      <span style={{ width: ALERT_COL_WIDTH.status, flexShrink: 0, textAlign: 'right', color: TEXT_SECONDARY }}>
        {NOTIFY_STATUS_LABEL[alert.status]}
      </span>
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

      {/* 关键指标卡区（6 张资产 / 治理进度卡，不含任何告警数字；卡内横向排版 + 右上角口径注释） */}
      <Row gutter={[16, 16]}>
        {metricCards.map((card) => (
          <Col xs={24} sm={12} md={8} xl={4} key={card.key}>
            <Card
              className="page-card"
              style={{ position: 'relative', height: '100%' }}
              styles={{ body: { padding: '16px 18px' } }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 32, lineHeight: 1, color: BRAND }}>{card.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2, color: TEXT_BASE }}>
                    {card.value}
                  </div>
                  <div style={{ fontSize: 13, color: TEXT_SECONDARY }}>
                    {card.title}
                    {card.sub ? <span style={{ marginLeft: 6, color: TEXT_TERTIARY }}>{card.sub}</span> : null}
                  </div>
                </div>
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
        {/* 告警状态卡：首页唯一告警入口（主数字 + 状态分布 + 最新告警列表 + Prom 仅参考小字） */}
        <Col xs={24} lg={10}>
          <Card
            className="page-card"
            title="告警状态"
            extra={<Link to="/alert-status">查看全部 →</Link>}
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, color: '#FF4C3A' }}>
                {mockAlertGovernance.active}
              </span>
              <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>通知中</span>
            </div>
            <Space size={16} style={{ marginTop: 8 }}>
              <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>
                已静默{' '}
                <Text style={{ fontSize: 16, fontWeight: 600, color: TEXT_BASE }}>
                  {mockAlertGovernance.silenced}
                </Text>
              </span>
              <span style={{ fontSize: 13, color: TEXT_SECONDARY }}>
                已抑制{' '}
                <Text style={{ fontSize: 16, fontWeight: 600, color: TEXT_BASE }}>
                  {mockAlertGovernance.inhibited}
                </Text>
              </span>
            </Space>

            {mockAlertGovernance.unprocessed > 0 && (
              <Tooltip title="告警刚进入通知队列，系统还在计算是否通知、通知给谁。">
                <Text style={{ display: 'inline-block', marginTop: 6, fontSize: 12, color: TEXT_TERTIARY }}>
                  另有 {mockAlertGovernance.unprocessed} 条告警仍在计算通知状态
                </Text>
              </Tooltip>
            )}

            <div style={{ marginTop: 12, borderTop: '1px solid #F2F3F5', paddingTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_BASE, marginBottom: 4 }}>最新告警</div>
              <AlertListHeader />
              {latestAlerts.map((alert, idx) => (
                <AlertRow key={alert.id} alert={alert} isLast={idx === latestAlerts.length - 1} />
              ))}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 10 }}>
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

        {/* 右列：系统快速入口 + 最近下发记录 */}
        <Col xs={24} lg={14}>
          <Card className="page-card" title="系统快速入口">
            <Row gutter={[12, 12]}>
              {mockQuickAccess.map((item) => (
                <Col xs={24} sm={12} lg={8} key={item.key}>
                  <Link to={item.to} style={{ textDecoration: 'none' }}>
                    <Card className="page-card" hoverable styles={{ body: { padding: 14 } }}>
                      <Space align="start" size={12}>
                        <span style={{ fontSize: 40, lineHeight: 1, color: BRAND }}>
                          {QUICK_ACCESS_ICON[item.key]}
                        </span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: TEXT_BASE }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: TEXT_TERTIARY, marginTop: 2 }}>{item.desc}</div>
                        </div>
                      </Space>
                    </Card>
                  </Link>
                </Col>
              ))}
            </Row>
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
        </Col>
      </Row>

      {/* 使用指引区：六步开箱动线 */}
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
    </MainLayout>
  )
}
