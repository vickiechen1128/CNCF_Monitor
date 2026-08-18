import { Layout, Menu, Typography, Space, Tag, Select, App } from 'antd'
import { type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AppstoreOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { ReviewNotesProvider } from '../contexts/ReviewNotesContext'
import { ReviewNote } from '../components/ReviewNote'
import { ReviewNoteSwitch } from '../components/ReviewNoteSwitch'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

type UserRole = 'ops1' | 'ops2'
const USER_ROLE_MAP: Record<UserRole, string> = {
  ops1: '运维工程师1',
  ops2: '运维工程师2',
}

interface MainLayoutProps {
  /** 页面级设计意图 / 决策依据，受「评审说明」开关控制；禁止在 Content 顶部写常驻说明性 Alert */
  reviewNotes?: ReactNode
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(): MenuItem[] {
  return [
    { key: '/tenants', icon: <AppstoreOutlined />, label: '租户管理' },
    { key: '/network-domains', icon: <AppstoreOutlined />, label: '网域管理' },
    { key: '/users', icon: <AppstoreOutlined />, label: '用户与权限' },
    { key: '/audit-logs', icon: <AppstoreOutlined />, label: '审计日志' },
    { key: '/platform-settings', icon: <AppstoreOutlined />, label: '平台配置' },
  ]
}

/**
 * 标准布局骨架：
 * - ReviewNotesProvider + 右上角「评审说明」开关；
 * - 页面级设计意图 / 决策依据一律通过 reviewNotes 槽位传入（进 ReviewNote），
 *   禁止在 Content 顶部写常驻说明性 Alert。
 * - 本模块保留顶栏「当前角色」演示切换（ops1 / ops2）。
 */
export function MainLayout({ reviewNotes, children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const menuItems = buildMenu()
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const role: UserRole = searchParams.get('role') === 'ops2' ? 'ops2' : 'ops1'

  const switchRole = (next: UserRole) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'ops2') params.set('role', 'ops2')
    else params.delete('role')
    setSearchParams(params)
    message.info(next === 'ops2' ? '已切换为运维工程师2' : '已切换为运维工程师1')
  }

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
            <Space size="small" align="center">
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>当前角色</Text>
              <Select
                value={role}
                onChange={(v: UserRole) => switchRole(v)}
                style={{ width: 140 }}
                options={Object.entries(USER_ROLE_MAP).map(([value, label]) => ({ value, label }))}
              />
            </Space>
            <ReviewNoteSwitch />
          </Space>
        </Header>
        <Layout>
          <Sider theme="light" width={220} style={{ borderRight: '1px solid #E5E6EB' }}>
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