import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Col,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd'
import {
  CopyOutlined,
  DatabaseOutlined,
  BellOutlined,
  FundOutlined,
  FilterOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockGrafanaDatasource,
  mockDashboardTemplates,
  mockNetworkDomains,
  mockBizCodes,
  mockApps,
  mockInstances,
  mockGovernanceOptions,
} from '../mocks/module-05'

const { Title, Text } = Typography

export function GrafanaDashboardPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fullscreen = searchParams.get('fullscreen') === '1'

  // 四层下钻的治理标签（dashboard variables 走 M02 代理 label_values）
  const [networkDomain, setNetworkDomain] = useState(mockGovernanceOptions.networkDomain)
  const [bizCode, setBizCode] = useState(mockGovernanceOptions.bizCode)
  const [app, setApp] = useState(mockGovernanceOptions.app)
  const [instance, setInstance] = useState(mockGovernanceOptions.instance)

  const toggleFullscreen = () => {
    if (fullscreen) {
      navigate('/grafana-dashboard')
    } else {
      navigate('/grafana-dashboard?fullscreen=1')
    }
  }

  const openNewWindow = () => {
    window.open(
      `#/grafana-dashboard?fullscreen=1`,
      'grafana-dashboard',
      'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no'
    )
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>可视化大屏</Title>
        <Text type="secondary">
          Grafana 内嵌面板，数据源锁定为 M02 查询代理（非 Prometheus 直连）。
        </Text>
      </div>

      {/* 全屏/新窗口工具栏 */}
      <Card className="page-card" style={{ marginBottom: 16 }}>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space>
              <FundOutlined style={{ fontSize: 20, color: '#0ECDEB' }} />
              <Text strong>大屏显示模式</Text>
              {fullscreen && <Tag color="blue">全屏模式</Tag>}
            </Space>
          </Col>
          <Col>
            <Space>
              <Button
                icon={<FullscreenOutlined />}
                onClick={toggleFullscreen}
              >
                {fullscreen ? '退出全屏' : '全屏进入'}
              </Button>
              <Button
                icon={<LinkOutlined />}
                onClick={openNewWindow}
              >
                新窗口打开
              </Button>
              <a href="../module-08/index.html#/alerts">
                <Button type="primary" icon={<BellOutlined />}>
                  配置告警
                </Button>
              </a>
            </Space>
          </Col>
        </Row>
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          全屏模式隐藏门户侧边栏与顶部导航，iframe 铺满可视区域，适配控制室电视墙 / 投屏场景。
          新窗口打开可独立拖放到扩展屏。
        </Text>
      </Card>

      {/* 数据源红线 */}
      <Alert
        style={{ marginBottom: 16 }}
        type="warning"
        showIcon
        icon={<DatabaseOutlined />}
        message="数据源红线：必须指向 M02 查询代理"
        description={
          <>
            Grafana datasource 名称 <b>{mockGrafanaDatasource.name}</b>（{mockGrafanaDatasource.type}
            ），地址 <code>{mockGrafanaDatasource.url}</code>，由一体化交付包 provisioning 静态下发，{' '}
            <b>只读且不可改指</b>。禁止直连 Prometheus 实例，以保障租户 / 网域隔离（见 Module_02 §1 可视化边界）。
          </>
        }
      />

      {/* 版面引导：治理标签四层下钻 */}
      <Card
        className="page-card"
        style={{ marginBottom: 16 }}
        title={
          <Space>
            <FilterOutlined />
            版面引导 · 治理标签四层下钻
          </Space>
        }
        extra={<Text type="secondary">dashboard variables 走 M02 查询代理</Text>}
      >
        <Row gutter={16} align="middle">
          <Col xs={24} sm={6}>
            <Text type="secondary">网域 network_domain</Text>
            <Select
              value={networkDomain}
              style={{ width: '100%', marginTop: 4 }}
              options={mockNetworkDomains.map((d) => ({ value: d, label: d }))}
              onChange={(v) => setNetworkDomain(v)}
            />
          </Col>
          <Col xs={24} sm={6}>
            <Text type="secondary">业务 biz</Text>
            <Select
              value={bizCode}
              style={{ width: '100%', marginTop: 4 }}
              options={mockBizCodes.map((b) => ({ value: b, label: b }))}
              onChange={(v) => setBizCode(v)}
            />
          </Col>
          <Col xs={24} sm={6}>
            <Text type="secondary">应用 app</Text>
            <Select
              value={app}
              style={{ width: '100%', marginTop: 4 }}
              options={mockApps.map((a) => ({ value: a, label: a }))}
              onChange={(v) => setApp(v)}
            />
          </Col>
          <Col xs={24} sm={6}>
            <Text type="secondary">实例 instance</Text>
            <Select
              value={instance}
              style={{ width: '100%', marginTop: 4 }}
              options={mockInstances.map((i) => ({ value: i, label: i }))}
              onChange={(v) => setInstance(v)}
            />
          </Col>
        </Row>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          当前下钻：{networkDomain} / {bizCode} / {app} / {instance}
        </Text>
      </Card>

      {/* Grafana iframe 嵌入区（原型以占位呈现） */}
      <Card
        className="page-card"
        style={{ marginBottom: 16, ...(fullscreen ? { minHeight: 'calc(100vh - 48px)' } : {}) }}
        title={
          <Space>
            <FundOutlined />
            大屏内容（Grafana iframe）
          </Space>
        }
        extra={
          <Space>
            <Button
              size="small"
              icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleFullscreen}
            >
              {fullscreen ? '退出全屏' : '全屏'}
            </Button>
          </Space>
        }
      >
        <div
          style={{
            height: fullscreen ? 'calc(100vh - 120px)' : 360,
            border: '1px dashed #E5E6EB',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: '#0B1B2A',
            color: 'rgba(255,255,255,0.65)',
          }}
        >
          <Text style={{ color: '#0ECDEB', fontSize: 18 }}>Grafana 仪表盘（iframe 嵌入）</Text>
          <Text type="secondary">
            当前视窗：网域 {networkDomain} · 业务 {bizCode} · 应用 {app} · 实例 {instance}
          </Text>
        </div>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          原型阶段以占位呈现；交付后由门户 iframe 加载 Grafana（anonymous / SSO），数据源为 M02 查询代理，
          不锁 UI，用户可自建 / 编辑 dashboard。
        </Text>
      </Card>

      {/* 预置模板：只读可克隆 */}
      <Card
        className="page-card"
        title="预置仪表盘模板（只读，可克隆）"
        extra={<Text type="secondary">升级覆盖模板不影响用户克隆副本</Text>}
      >
        <Row gutter={[16, 16]}>
          {mockDashboardTemplates.map((tpl) => (
            <Col xs={24} md={8} key={tpl.id}>
              <Card size="small" title={tpl.name} extra={<Tag color="#0ECDEB">只读</Tag>}>
                <Text type="secondary" style={{ display: 'block', minHeight: 44 }}>
                  {tpl.description}
                </Text>
                <Space style={{ marginTop: 8 }}>
                  {tpl.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Space>
                <Space style={{ marginTop: 12 }}>
                  <Button size="small" icon={<CopyOutlined />}>
                    克隆生成
                  </Button>
                  <Tag color="default">{tpl.ciType}</Tag>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          预置模板随交付包 provisioning 下发为只读；「克隆生成」后获得可自由编辑的副本，平台升级覆盖模板不影响用户副本。
        </Text>
      </Card>
    </MainLayout>
  )
}