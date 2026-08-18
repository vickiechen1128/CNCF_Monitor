import { Layout, Menu, Space, Tag, Typography } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { MenuProps } from 'antd'
import { ReviewNotesProvider } from '../contexts/ReviewNotesContext'
import { ReviewNote } from '../components/ReviewNote'
import { ReviewNoteSwitch } from '../components/ReviewNoteSwitch'

const { Header, Sider, Content } = Layout
const { Title } = Typography

export type MenuItem = Required<MenuProps>['items'][number]

interface MainLayoutProps {
  /** 模块菜单（[TEMPLATE] 替换为当前模块的菜单项） */
  menuItems: MenuItem[]
  /** 页面级评审说明（设计意图 / 决策依据），受「评审说明」开关控制 */
  reviewNotes?: ReactNode
  children: ReactNode
}

/**
 * 标准布局骨架：
 * - ReviewNotesProvider + 右上角「评审说明」开关；
 * - 页面级设计意图 / 决策依据一律通过 reviewNotes 槽位传入（进 ReviewNote），
 *   禁止在 Content 顶部写常驻 Alert。
 */
export function MainLayout({ menuItems, reviewNotes, children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const openKeys = menuItems
    .filter((item): item is Exclude<typeof item, null> => {
      if (!item || !('children' in item) || !Array.isArray(item.children)) return false
      return item.children.some((c) => c && 'key' in c && c.key === location.pathname)
    })
    .map((item) => ('key' in item ? String(item.key) : ''))

  return (
    <ReviewNotesProvider>
      <Layout className="app-layout">
        <Header className="app-header">
          <Space size="large">
            <Title level={4} className="app-title" style={{ margin: 0, color: '#fff' }}>
              <span className="app-title-accent">◆</span>
              MetricCenter
            </Title>
            <Tag color="#0ECDEB" style={{ color: '#0B1B2A', fontWeight: 600 }}>
              原型验证版
            </Tag>
          </Space>
          <Space size="large" align="center">
            <ReviewNoteSwitch />
          </Space>
        </Header>
        <Layout>
          <Sider theme="light" width={240} style={{ borderRight: '1px solid #E5E6EB' }}>
            <Menu
              mode="inline"
              selectedKeys={[location.pathname]}
              defaultOpenKeys={openKeys}
              items={menuItems}
              onClick={(e) => navigate(e.key)}
              style={{ borderRight: 0, paddingTop: 8 }}
            />
          </Sider>
          <Content className="app-content">
            {reviewNotes && <ReviewNote title="设计意图（面向产品 / 技术评审）">{reviewNotes}</ReviewNote>}
            {children}
          </Content>
        </Layout>
      </Layout>
    </ReviewNotesProvider>
  )
}
