import { Layout, Menu, Typography, Space, Tag, Switch, Select, App, Tooltip, Divider } from 'antd'
import { useState, type ReactNode } from 'react'
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
const currentTenant = { id: 'module-04', name: 'AIDC 运维租户', multi_site_enabled: true }

// {v1.5} 版本声明与 PRD v1.5 对齐（决策 D12~D17 落版，见 docs/05-execution-records/module-04/design-decisions.md）
const PROTOTYPE_VERSION = 'v1.5'
const PRD_VERSION = 'v1.5'
const PRODUCT_VERSION_COVERED = 'v0.4+'

interface MainLayoutProps {
  /** 页面级设计意图 / 决策依据，受「评审说明」开关控制；禁止在 Content 顶部写常驻说明性 Alert */
  reviewNotes?: ReactNode
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(): MenuItem[] {
  return [
    { key: '/providers', icon: <AppstoreOutlined />, label: 'Provider 配置' },
    { key: '/sync-policies', icon: <AppstoreOutlined />, label: '同步策略' },
    // {v1.4} PRD 7.1 CMDB CI 类型映射（三列推导链，决策 D24）
    { key: '/cmdb-mapping', icon: <AppstoreOutlined />, label: 'CI 类型映射' },
    { key: '/pending-ci', icon: <AppstoreOutlined />, label: '待分类 CI' },
    { key: '/orphans', icon: <AppstoreOutlined />, label: '孤儿资源' },
  ]
}

export function MainLayout({ reviewNotes, children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const menuItems = buildMenu()
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [multiSite, setMultiSite] = useState(currentTenant.multi_site_enabled)
  const role: UserRole = searchParams.get('role') === 'ops2' ? 'ops2' : 'ops1'

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
            <Tag color="geekblue">{PROTOTYPE_VERSION}</Tag>
            <Tag color="default" style={{ color: 'rgba(255,255,255,0.65)' }}>
              PRD {PRD_VERSION} · {PRODUCT_VERSION_COVERED}
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
