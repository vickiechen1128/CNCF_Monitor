import { Layout, Menu, Typography } from 'antd'
import { AppstoreOutlined, DatabaseOutlined, TagsOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { MenuProps } from 'antd'

const { Header, Sider, Content } = Layout
const { Title } = Typography

interface MainLayoutProps {
  children: ReactNode
}

/**
 * 一级功能模块定义（Header 横导航 + Sider 二级导航的数据源）。
 * 顶部 tab 文案用 PRD 模块名：M06 为「系统与平台管理」（frontend-developer.md
 * Step 3.5 第 7 项「导航与模块名核对」，禁止用功能页名「网域管理」充当一级模块）。
 * D3（临时）：MVP 现含「首页 / 系统与平台管理 / 监控对象管理」三个一级模块；
 * M05 自定义前端门户落地后由 M05 统一导航收口，此处仅作 MVP 可达性占位，
 * 后续大模块（M09 等）在 MODULES 追加即可。
 */
interface ModuleSubItem {
  key: string
  label: string
  icon?: ReactNode
}

interface ModuleDef {
  key: string
  label: string
  path: string
  subItems: ModuleSubItem[]
}

const MODULES: ModuleDef[] = [
  { key: 'home', label: '首页', path: '/', subItems: [] },
  {
    key: 'platform-admin',
    label: '系统与平台管理',
    path: '/admin/domains',
    subItems: [{ key: '/admin/domains', label: '网域管理', icon: <AppstoreOutlined /> }],
  },
  {
    key: 'monitoring-object',
    label: '监控对象管理',
    path: '/resources',
    subItems: [
      { key: '/resources', label: '资源管理', icon: <DatabaseOutlined /> },
      { key: '/label-templates', label: '标签模板', icon: <TagsOutlined /> },
    ],
  },
  {
    key: 'monitoring-strategy',
    label: '采集策略',
    path: '/scrape-jobs',
    subItems: [
      { key: '/scrape-jobs', label: '采集 Job', icon: <ThunderboltOutlined /> },
      { key: '/rules', label: '规则编辑', icon: <AppstoreOutlined /> },
      { key: '/metric-library', label: '指标库', icon: <DatabaseOutlined /> },
    ],
  },
]

/** 依据当前路由推断激活的一级模块：/admin/domains → 系统与平台管理；/resources、/label-templates → 监控对象管理；/scrape-jobs、/rules、/metric-library → 采集策略；其余 → 首页 */
function resolveActiveModule(locationPath: string): ModuleDef {
  if (locationPath.startsWith('/admin/domains')) return MODULES[1]
  if (locationPath.startsWith('/resources') || locationPath.startsWith('/label-templates')) return MODULES[2]
  if (
    locationPath.startsWith('/scrape-jobs') ||
    locationPath.startsWith('/rules') ||
    locationPath.startsWith('/metric-library')
  )
    return MODULES[3]
  return MODULES[0]
}

/**
 * 主布局（Header 一级模块导航 + Sider 二级导航 + Content）。
 * 参考业界管控台三层导航：Header 承载一级功能模块切换（紧跟品牌右侧），
 * Sider 展示当前模块的二级页面；首页类 overview 模块无二级导航时隐藏 Sider。
 */
export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const active = resolveActiveModule(location.pathname)
  const selectedSubKey = active.subItems.some((it) => location.pathname.startsWith(it.key))
    ? location.pathname
    : active.subItems[0]?.key

  const handleModuleSwitch = (key: string) => {
    const target = MODULES.find((m) => m.key === key)
    if (target && target.key !== active.key) navigate(target.path)
  }

  return (
    <Layout className="app-layout">
      <Header className="app-header">
        <div className="app-header-left">
          <Title level={3} className="app-title">
            MetricCenter
          </Title>
          <nav className="app-module-nav" aria-label="功能模块">
            {MODULES.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`app-module-tab${active.key === m.key ? ' active' : ''}`}
                onClick={() => handleModuleSwitch(m.key)}
              >
                {m.label}
                <span className="app-module-tab-underline" aria-hidden="true" />
              </button>
            ))}
          </nav>
        </div>
      </Header>
      {active.subItems.length > 0 ? (
        <Layout>
          <Sider width={200} className="app-sider" theme="light">
            <Menu
              mode="inline"
              selectedKeys={[selectedSubKey ?? '']}
              onClick={({ key }) => navigate(key)}
              items={active.subItems as MenuProps['items']}
            />
          </Sider>
          <Content className="app-content">{children}</Content>
        </Layout>
      ) : (
        <Content className="app-content">{children}</Content>
      )}
    </Layout>
  )
}