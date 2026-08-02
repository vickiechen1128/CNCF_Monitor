import { Layout, Menu, Typography, Space, Badge, Tag } from 'antd'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppstoreOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(): MenuItem[] {
  return [
    { key: '/query', icon: <AppstoreOutlined />, label: 'PromQL 查询' },
    { key: '/targets', icon: <AppstoreOutlined />, label: '目标状态' },
    { key: '/alert-status', icon: <AppstoreOutlined />, label: '当前告警' },
  ]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const menuItems = buildMenu()

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <Space size="large">
          <Title level={4} className="app-title" style={{ margin: 0 }}>
            <span className="app-title-accent">◆</span>
            MetricCenter
          </Title>
          <Tag color="#0ECDEB" style={{ color: '#0B1B2A', fontWeight: 600 }}>
            原型验证版
          </Tag>
        </Space>
        <Space size="middle">
          <Badge status="success" text={<Text style={{ color: 'rgba(255,255,255,0.85)' }}>default 网域在线</Text>} />
          <Text style={{ color: 'rgba(255,255,255,0.65)' }}>运维工程师</Text>
        </Space>
      </Header>
      <Layout>
        <Sider theme="light" width={220} style={{ borderRight: '1px solid #E5E6EB' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={(e) => navigate(e.key)}
            style={{ borderRight: 0, paddingTop: 8 }}
          />
        </Sider>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  )
}
