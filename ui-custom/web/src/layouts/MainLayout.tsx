import { Layout, Menu, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

const { Header, Sider, Content } = Layout
const { Title } = Typography

interface MainLayoutProps {
  children: ReactNode
}

/**
 * 主布局（Header + Sider 导航 + Content）。
 * 部署级登记能力入口（模块 Module_06 §11 前端交互契约）：Phase 5 统一导航前先提供最小可达入口
 * 「首页 / 网域管理」。
 */
export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const selectedKey = location.pathname.startsWith('/admin/domains') ? '/admin/domains' : '/'

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <Title level={3} className="app-title">
          MetricCenter
        </Title>
      </Header>
      <Layout>
        <Sider width={200} className="app-sider" theme="light">
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            onClick={({ key }) => navigate(key)}
            items={[
              { key: '/', label: '首页' },
              { key: '/admin/domains', label: '网域管理' },
            ]}
          />
        </Sider>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  )
}
