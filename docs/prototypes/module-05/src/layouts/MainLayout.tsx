import { Layout, Menu, Typography, Space, Tag, Switch, Select, App, Tooltip, Divider } from 'antd'
import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FundOutlined, HomeOutlined, ToolOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

type UserRole = 'ops1' | 'ops2'
const USER_ROLE_MAP: Record<UserRole, string> = {
  ops1: '运维工程师1',
  ops2: '运维工程师2',
}
const currentTenant = { id: 'module-05', name: 'AIDC 运维租户', multi_site_enabled: true }


interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(): MenuItem[] {
  // 决策 51 导航层级（对标 m01 统一样式）：一级导航置于左侧 Sider；「首页」一级分组，
  // 其下「概览 Dashboard / 使用引导」为侧栏子项固定展示。首页（一级，第 1 位）→
  // 可视化大屏（一级，第 2 位）→ 系统设置。
  return [
    {
      key: 'home',
      icon: <HomeOutlined />,
      label: '首页',
      children: [
        { key: '/', label: '概览 Dashboard' },
        { key: '/guide', label: '使用引导' },
      ],
    },
    { key: '/grafana-dashboard', icon: <FundOutlined />, label: '可视化大屏' },
    { key: '/settings', icon: <ToolOutlined />, label: '系统设置' },
  ]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const menuItems = buildMenu()
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [multiSite, setMultiSite] = useState(currentTenant.multi_site_enabled)
  const role: UserRole = searchParams.get('role') === 'ops2' ? 'ops2' : 'ops1'
  // 决策 51：可视化大屏全屏模式（?fullscreen=1，隐藏顶栏，iframe 铺满可视区域）
  const fullscreen = searchParams.get('fullscreen') === '1'

  const switchRole = (next: UserRole) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'ops2') params.set('role', 'ops2')
    else params.delete('role')
    setSearchParams(params)
    message.info(next === 'ops2' ? '已切换为运维工程师2' : '已切换为运维工程师1')
  }

  const toggleMultiSite = (checked: boolean) => {
    currentTenant.multi_site_enabled = checked
    setMultiSite(checked)
    window.dispatchEvent(new CustomEvent('tenant-mode-change', { detail: { multiSiteEnabled: checked } }))
    message.info(checked ? '已切换为多网域模式' : '已切换为单网域模式：仅 default 管理域')
  }

  // 顶栏与侧栏分离（对标 m01 统一样式）：顶部 Header 放产品标识 MetricCenter，
  // 左侧 Sider 固定承载一级导航；「首页」为一级分组，其下「概览 Dashboard / 使用引导」为侧栏子项。
  const openKeys = menuItems
    .filter((item): item is Exclude<typeof item, null> => {
      if (!item || !('children' in item) || !Array.isArray(item.children)) return false
      return item.children.some((c) => c && 'key' in c && c.key === location.pathname)
    })
    .map((item) => ('key' in item ? String(item.key) : ''))

  return (
    <Layout className="app-layout" style={fullscreen ? { height: '100vh', overflow: 'hidden' } : undefined}>
      {!fullscreen && (
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
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>网域模式</Text>
              <Tooltip title={multiSite ? '多网域模式：覆盖多个网域' : '单网域模式：仅 default 管理域'}>
                <Switch
                  checked={multiSite}
                  checkedChildren="多网域"
                  unCheckedChildren="单网域"
                  onChange={toggleMultiSite}
                />
              </Tooltip>
            </Space>
            <Divider type="vertical" style={{ borderColor: 'rgba(255,255,255,0.25)', height: 22, margin: 0 }} />
            <Space size="small" align="center">
              <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>当前角色</Text>
              <Select
                value={role}
                onChange={(v: UserRole) => switchRole(v)}
                style={{ width: 140 }}
                options={Object.entries(USER_ROLE_MAP).map(([value, label]) => ({ value, label }))}
              />
            </Space>
          </Space>
        </Header>
      )}
      <Layout>
        {!fullscreen && (
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
        )}
        <Content className="app-content" style={fullscreen ? { padding: 0, margin: 0, minHeight: '100vh' } : undefined}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
