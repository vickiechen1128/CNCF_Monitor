import { Layout, Menu, Typography } from 'antd'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  DashboardOutlined,
  DatabaseOutlined,
  SettingOutlined,
  FileTextOutlined,
  LineChartOutlined,
  CloudServerOutlined,
  BellOutlined,
} from '@ant-design/icons'

const { Header, Sider, Content } = Layout
const { Title } = Typography

interface MainLayoutProps {
  children: ReactNode
}

const menuItems = [
  { key: '/', icon: <DashboardOutlined />, label: '首页 Dashboard' },
  { key: '/resources', icon: <DatabaseOutlined />, label: '资源管理' },
  { key: '/config', icon: <SettingOutlined />, label: '配置管理' },
  { key: '/config-preview', icon: <FileTextOutlined />, label: '配置生成/下发' },
  { key: '/query', icon: <LineChartOutlined />, label: '指标查询' },
  { key: '/collection', icon: <CloudServerOutlined />, label: '采集状态' },
  { key: '/alerts', icon: <BellOutlined />, label: '告警状态' },
]

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <Layout className="app-layout" style={{ minHeight: '100vh' }}>
      <Header className="app-header" style={{ display: 'flex', alignItems: 'center' }}>
        <Title level={3} className="app-title" style={{ color: '#fff', margin: 0 }}>
          MetricCenter
        </Title>
      </Header>
      <Layout>
        <Sider theme="light" width={200}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={(e) => navigate(e.key)}
          />
        </Sider>
        <Content className="app-content" style={{ padding: 24, background: '#f5f5f5' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
