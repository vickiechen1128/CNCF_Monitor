import { Layout, Menu, Typography, Space, Tag, Switch, Select, App, Tooltip, Divider } from 'antd'
import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertOutlined,
  ApartmentOutlined,
  BellOutlined,
  PauseCircleOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

type UserRole = 'ops' | 'arch'
const USER_ROLE_MAP: Record<UserRole, string> = {
  ops: '运维工程师',
  arch: '运维架构师',
}
const currentTenant = { id: 'module-08', name: 'AIDC 运维租户', multi_site_enabled: true }

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(): MenuItem[] {
  return [
    { key: '/alerts', icon: <AlertOutlined />, label: '告警状态' },
    { key: '/routes', icon: <ApartmentOutlined />, label: '路由规则' },
    { key: '/notifiers', icon: <BellOutlined />, label: '通知渠道' },
    { key: '/silences', icon: <PauseCircleOutlined />, label: '静默规则' },
    { key: '/inhibitions', icon: <ThunderboltOutlined />, label: '告警抑制' },
    { key: '/config', icon: <SettingOutlined />, label: '配置管理' },
  ]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const menuItems = buildMenu()
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [multiSite, setMultiSite] = useState(currentTenant.multi_site_enabled)
  const role: UserRole = searchParams.get('role') === 'arch' ? 'arch' : 'ops'

  const switchRole = (next: UserRole) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'arch') params.set('role', 'arch')
    else params.delete('role')
    setSearchParams(params)
    message.info(next === 'arch' ? '已切换为运维架构师' : '已切换为运维工程师')
  }

  const toggleMultiSite = (checked: boolean) => {
    currentTenant.multi_site_enabled = checked
    setMultiSite(checked)
    window.dispatchEvent(new CustomEvent('tenant-mode-change', { detail: { multiSiteEnabled: checked } }))
    message.info(checked ? '已切换为多网域模式' : '已切换为单网域模式：仅 default 管理域')
  }

  const openKeys = menuItems
    .filter((item): item is Exclude<typeof item, null> => {
      if (!item || !('children' in item) || !Array.isArray(item.children)) return false
      return item.children.some((c) => c && 'key' in c && c.key === location.pathname)
    })
    .map((item) => ('key' in item ? String(item.key) : ''))

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <Space size="large">
          <Title level={4} className="app-title" style={{ margin: 0, color: '#fff' }}>
            <span className="app-title-accent">◆</span>
            MetricCenter
          </Title>
          <Tag color="#0ECDEB" style={{ color: '#0B1B2A', fontWeight: 600 }}>
            告警收敛与通知管理
          </Tag>
          <Tag color="rgba(14,205,235,0.15)" style={{ color: '#0ECDEB', borderColor: 'rgba(14,205,235,0.4)' }}>
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
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  )
}
