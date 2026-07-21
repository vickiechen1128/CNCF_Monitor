import { Layout, Typography } from 'antd'
import type { ReactNode } from 'react'

const { Header, Content } = Layout
const { Title } = Typography

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <Title level={3} className="app-title">
          MetricCenter
        </Title>
      </Header>
      <Content className="app-content">{children}</Content>
    </Layout>
  )
}
