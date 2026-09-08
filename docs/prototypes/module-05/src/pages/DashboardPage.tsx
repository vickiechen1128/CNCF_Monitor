import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  Col,
  Row,
  Statistic,
  Table,
  Tag,
  Typography,
  Badge,
  Button,
  Space,
} from 'antd'
import {
  CloudServerOutlined,
  MonitorOutlined,
  ApartmentOutlined,
  BellOutlined,
  GlobalOutlined,
  ApiOutlined,
  FundOutlined,
  FullscreenOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockDashboardStats,
  mockRecentAlerts,
  mockAgentStatus,
  SEVERITY_COLORS,
  type RecentAlert,
  type AgentStatus,
} from '../mocks/module-05'

const { Title, Text } = Typography

const statCards = [
  {
    title: '资源总数',
    valueKey: 'totalResources' as const,
    icon: <CloudServerOutlined style={{ color: '#0ECDEB' }} />,
  },
  {
    title: '已监控',
    valueKey: 'monitoredCount' as const,
    icon: <MonitorOutlined style={{ color: '#00B578' }} />,
  },
  {
    title: '采集 Job',
    valueKey: 'scrapeJobs' as const,
    icon: <ApiOutlined style={{ color: '#1481FD' }} />,
  },
  {
    title: '活跃告警',
    valueKey: 'activeAlerts' as const,
    icon: <BellOutlined style={{ color: '#FF4C3A' }} />,
  },
  {
    title: '网域数量',
    valueKey: 'networkDomains' as const,
    icon: <GlobalOutlined style={{ color: '#FA8C16' }} />,
  },
  {
    title: '监控源',
    valueKey: 'monitoringSources' as const,
    icon: <ApartmentOutlined style={{ color: '#0ECDEB' }} />,
  },
]

export function DashboardPage() {
  const [stats] = useState(mockDashboardStats)
  const navigate = useNavigate()

  const alertColumns = [
    {
      title: '告警名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '级别',
      dataIndex: 'severity',
      key: 'severity',
      render: (severity: RecentAlert['severity']) => (
        <Tag color={SEVERITY_COLORS[severity]}>{severity.toUpperCase()}</Tag>
      ),
    },
    {
      title: '资源',
      dataIndex: 'resource',
      key: 'resource',
    },
    {
      title: '摘要',
      dataIndex: 'summary',
      key: 'summary',
    },
    {
      title: '触发时间',
      dataIndex: 'firedAt',
      key: 'firedAt',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: RecentAlert['status']) =>
        status === 'firing' ? (
          <Badge status="error" text="触发中" />
        ) : (
          <Badge status="success" text="已恢复" />
        ),
    },
  ]

  const agentColumns = [
    {
      title: 'Agent ID',
      dataIndex: 'id',
      key: 'id',
    },
    {
      title: '网域',
      dataIndex: 'networkDomain',
      key: 'networkDomain',
      render: (domain: string) => <Tag color="blue">{domain}</Tag>,
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
    },
    {
      title: '最近心跳',
      dataIndex: 'lastHeartbeat',
      key: 'lastHeartbeat',
    },
    {
      title: '采集目标',
      dataIndex: 'targets',
      key: 'targets',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: AgentStatus['status']) =>
        status === 'online' ? (
          <Badge status="success" text="在线" />
        ) : (
          <Badge status="error" text="离线" />
        ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>概览 Dashboard</Title>
        <Text type="secondary">
          欢迎回到 MetricCenter，当前 default 网域运行正常。
        </Text>
      </div>
      <Card
        className="page-card"
        style={{ marginBottom: 16, background: 'linear-gradient(90deg,#0B1B2A 0%,#11324A 100%)', border: 'none' }}
      >
        <Row align="middle" gutter={[16, 16]}>
          <Col flex="auto">
            <Space>
              <FundOutlined style={{ fontSize: 24, color: '#0ECDEB' }} />
              <div>
                <Title level={5} style={{ color: '#fff', margin: 0 }}>
                  可视化大屏
                </Title>
                <Text type="secondary">
                  Grafana 内嵌面板（数据源走 M02 查询代理），支持全屏 / 新窗口。
                </Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Space>
              <a href="../module-08/index.html#/alerts">
                <Button type="link" icon={<BellOutlined />} style={{ color: '#fff' }}>
                  Web 告警列表
                </Button>
              </a>
              <Button
                type="primary"
                icon={<FullscreenOutlined />}
                style={{ background: '#0ECDEB', borderColor: '#0ECDEB', color: '#0B1B2A', fontWeight: 600 }}
                onClick={() => navigate('/grafana-dashboard?fullscreen=1')}
              >
                进入可视化大屏
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>
      <Row gutter={[16, 16]}>
        {statCards.map((card) => (
          <Col xs={24} sm={12} md={8} lg={8} xl={4} key={card.valueKey}>
            <Card className="page-card">
              <Statistic
                title={card.title}
                value={stats[card.valueKey]}
                prefix={card.icon}
                valueStyle={{ color: '#1D2129', fontWeight: 600 }}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card className="page-card" title="最近告警">
            <Table
              rowKey="id"
              dataSource={mockRecentAlerts}
              columns={alertColumns}
              pagination={{ pageSize: 5 }}
              size="small"
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="page-card" title="Agent 状态">
            <Table
              rowKey="id"
              dataSource={mockAgentStatus}
              columns={agentColumns}
              pagination={{ pageSize: 5 }}
              size="small"
            />
          </Card>
        </Col>
      </Row>
      <div className="page-header" style={{ marginTop: 24 }}>
        <Title level={4}>模块原型入口</Title>
        <Text type="secondary">点击卡片可跳转到对应独立模块原型。</Text>
      </div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-01/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 01">
              监控策略与指标管理
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-02/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 02">
              查询中心
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-03/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 03">
              网关与认证
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-04/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 04">
              自定义服务发现
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-06/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 06">
              系统与平台管理
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-07/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 07">
              监控对象管理
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-08/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 08">
              告警规则管理
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-09/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 09">
              网域与边缘配置中心
            </Card>
          </a>
        </Col>
        <Col xs={24} sm={12} md={8} lg={6}>
          <a href="../module-10/index.html" style={{ textDecoration: 'none' }}>
            <Card className="page-card" hoverable title="Module 10">
              监控源登记册
            </Card>
          </a>
        </Col>
      </Row>
    </MainLayout>
  )
}
