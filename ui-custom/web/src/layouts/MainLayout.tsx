import { Layout, Menu, Tag, Typography } from 'antd'
import {
  AppstoreOutlined,
  BellOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  FileSearchOutlined,
  RadarChartOutlined,
  SendOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MenuProps } from 'antd'
import { getStoredUser } from '../api/client'

const { Header, Sider, Content } = Layout
const { Title } = Typography

interface MainLayoutProps {
  children: ReactNode
}

/**
 * 一级功能模块定义（Header 横导航 + Sider 二级导航的数据源）。
 * 顶部 tab 文案用 PRD 模块名：M06 为「系统与平台管理」（frontend-developer.md
 * Step 3.5 第 7 项「导航与模块名核对」，禁止用功能页名「网域管理」充当一级模块）。
 * D3（临时）：MVP 现含「首页 / 系统与平台管理 / 网域与边缘配置中心 / 监控对象管理 / 采集策略」等一级模块；
 * M05 自定义前端门户落地后由 M05 统一导航收口，此处仅作 MVP 可达性占位。
 * M09「网域与边缘配置中心」为独立的顶级模块（与「采集策略」同级），含两个一级菜单组（N2-1）：
 * 组「网域与节点管理」（网域纳管 / 采集节点状态 / 监控目标状态）、组「配置下发」（配置变更确认 / 下发记录）；
 * 既有 M06「网域管理」保留在「系统与平台管理」下并与「网域纳管」并存。
 */
interface ModuleDef {
  key: string
  label: string
  path: string
  subItems?: MenuProps['items']
}

/**
 * config-center 二级导航中两个可折叠子菜单（SubMenu）的 key 及各自路由。
 * 「网域与节点管理」为低频接入面、「配置下发」为高频查看面，均默认折叠，
 * 首次进入各自路由时自动展开一次，之后尊重用户手动开合（见 MainLayout 折叠逻辑）。
 */
const ACCESS_PLANE_KEY = 'access-plane'
const DELIVERY_PLANE_KEY = 'delivery-plane'

/** 可折叠子菜单组定义：key 与归属路由（用于首次进入自动展开判断） */
const COLLAPSIBLE_GROUPS = [
  { key: ACCESS_PLANE_KEY, routes: ['/domain-onboarding', '/node-status', '/targets'] },
  { key: DELIVERY_PLANE_KEY, routes: ['/config-preview', '/deployments'] },
]

const MODULES: ModuleDef[] = [
  { key: 'home', label: '首页', path: '/', subItems: [] },
  {
    key: 'platform-admin',
    label: '系统与平台管理',
    path: '/admin/domains',
    subItems: [
      { key: '/admin/tenants', label: '租户管理', icon: <CloudServerOutlined /> },
      { key: '/admin/domains', label: '网域管理', icon: <AppstoreOutlined /> },
      { key: '/admin/users', label: '用户管理', icon: <DesktopOutlined /> },
      { key: '/admin/login-logs', label: '登录日志', icon: <FileSearchOutlined /> },
    ],
  },
  {
    key: 'monitoring-object',
    label: '监控对象管理',
    path: '/resources',
    subItems: [
      // 原型对齐（Module_07 MainLayout §3.23）：业务分组字典为资源录入/导入的取值权威，
      // 故「业务管理」前置，位于「资源管理」之上。
      { key: '/business-domains', label: '业务管理', icon: <AppstoreOutlined /> },
      { key: '/resources', label: '资源管理', icon: <DatabaseOutlined /> },
      { key: '/label-templates', label: '标签模板', icon: <TagsOutlined /> },
    ],
  },
  {
    key: 'monitoring-strategy',
    label: '采集策略',
    path: '/collectors',
    subItems: [
      { key: '/collectors', label: '采集器管理', icon: <DatabaseOutlined /> },
      { key: '/scrape-jobs', label: '采集 Job', icon: <ThunderboltOutlined /> },
      { key: '/rules', label: '规则编辑', icon: <AppstoreOutlined /> },
      { key: '/metric-library', label: '指标库', icon: <DatabaseOutlined /> },
    ],
  },
  {
    key: 'config-center',
    label: '网域与边缘配置中心',
    path: '/domain-onboarding',
    subItems: [
      {
        // 「网域与节点管理」为低频折叠子菜单（SubMenu）：默认折叠，
        // 激活路由落在该组时自动展开（见 MainLayout 折叠逻辑）。
        key: ACCESS_PLANE_KEY,
        label: '网域与节点管理',
        icon: <AppstoreOutlined />,
        children: [
          { key: '/domain-onboarding', label: '网域纳管', icon: <CloudServerOutlined /> },
          { key: '/node-status', label: '采集节点状态', icon: <DesktopOutlined /> },
          // M02 目标状态页（P1）：M09 网域与节点管理下增「监控目标状态」暂挂入口
          // （与 PRD 决策 47-4 不符，见 module-02/dev-feedback.md F-1，待设计侧收割）。
          { key: '/targets', label: '监控目标状态', icon: <RadarChartOutlined /> },
        ],
      },
      {
        // 「配置下发」同样为可折叠子菜单（SubMenu）：默认折叠，进入配置面自动展开。
        key: DELIVERY_PLANE_KEY,
        label: '配置下发',
        icon: <SendOutlined />,
        children: [
          { key: '/config-preview', label: '配置变更确认', icon: <FileSearchOutlined /> },
          { key: '/deployments', label: '下发记录', icon: <SendOutlined /> },
        ],
      },
    ],
  },
  {
    key: 'alert',
    label: '告警收敛与通知管理',
    path: '/alert-config',
    subItems: [
      { key: '/alert-config', label: '告警配置', icon: <FileSearchOutlined /> },
      { key: '/silences', label: '静默管理', icon: <BellOutlined /> },
    ],
  },
]

/** 收集 Sider 菜单所有叶子 key（含嵌套一级菜单组的子项） */
function collectLeafKeys(items?: MenuProps['items']): string[] {
  if (!items) return []
  const keys: string[] = []
  const walk = (list: MenuProps['items']) => {
    if (!list) return
    list.forEach((it) => {
      if (!it) return
      if ('children' in it && it.children) {
        walk(it.children)
      } else if (it.key) {
        keys.push(it.key as string)
      }
    })
  }
  walk(items)
  return keys
}

/** 按 key 查找一级模块，避免因 MODULES 顺序/索引变更导致激活态错位 */
function findModuleByKey(key: string): ModuleDef {
  return MODULES.find((m) => m.key === key) ?? MODULES[0]
}

/**
 * 依据当前路由推断激活的一级模块。
 * /admin/domains、/admin/users、/admin/tenants、/admin/login-logs → 系统与平台管理；/domain-onboarding、/node-status、/targets、/config-preview、/deployments → 网域与边缘配置中心；
 * /resources、/label-templates、/business-domains → 监控对象管理；/collectors、/scrape-jobs、/rules、/metric-library → 采集策略；其余 → 首页。
 */
function resolveActiveModule(locationPath: string): ModuleDef {
  if (
    locationPath.startsWith('/admin/domains') ||
    locationPath.startsWith('/admin/users') ||
    locationPath.startsWith('/admin/tenants') ||
    locationPath.startsWith('/admin/login-logs')
  )
    return findModuleByKey('platform-admin')
  if (
    locationPath.startsWith('/domain-onboarding') ||
    locationPath.startsWith('/node-status') ||
    locationPath.startsWith('/targets') ||
    locationPath.startsWith('/config-preview') ||
    locationPath.startsWith('/deployments')
  )
    return findModuleByKey('config-center')
  if (
    locationPath.startsWith('/resources') ||
    locationPath.startsWith('/label-templates') ||
    locationPath.startsWith('/business-domains')
  )
    return findModuleByKey('monitoring-object')
  if (
    locationPath.startsWith('/collectors') ||
    locationPath.startsWith('/scrape-jobs') ||
    locationPath.startsWith('/rules') ||
    locationPath.startsWith('/metric-library')
  )
    return findModuleByKey('monitoring-strategy')
  if (locationPath.startsWith('/alert-config') || locationPath.startsWith('/silences'))
    return findModuleByKey('alert')
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
  const leafKeys = collectLeafKeys(active.subItems)
  const selectedSubKey = leafKeys.some((k) => location.pathname.startsWith(k))
    ? location.pathname
    : leafKeys[0]

  // 可折叠子菜单展开态（「网域与节点管理」/「配置下发」）：默认折叠，
  // 激活路由归属的折叠组自动展开，并尊重用户手动开合（点击折叠按钮即可收起）。
  const activeGroup =
    COLLAPSIBLE_GROUPS.find((g) =>
      g.routes.some((r) => location.pathname.startsWith(r)),
    )?.key ?? null
  const [userOpenKeys, setUserOpenKeys] = useState<string[]>([])
  const prevGroup = useRef<string | null>(null)
  useEffect(() => {
    // 默认折叠：自动展开当前激活路由归属的折叠组，其余保持折叠
    if (activeGroup && activeGroup !== prevGroup.current) {
      setUserOpenKeys((keys) =>
        keys.includes(activeGroup) ? keys : [...keys, activeGroup],
      )
    }
    prevGroup.current = activeGroup
  }, [activeGroup])
  const openKeys = userOpenKeys

  const handleModuleSwitch = (key: string) => {
    const target = MODULES.find((m) => m.key === key)
    if (target && target.key !== active.key) navigate(target.path)
  }

  // 顶部栏右上角：统一展示当前登录账号的角色与账号信息（数据来自 login /auth/me 返回的 AuthUser）。
  const authUser = getStoredUser()
  const roleLabel = authUser?.role === 'admin' ? '管理员' : authUser?.role === 'user' ? '普通用户' : ''

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
        {authUser ? (
          <div className="app-header-right">
            {roleLabel && (
              <Tag
                className="app-header-role"
                color={authUser?.role === 'admin' ? 'gold' : 'default'}
              >
                {roleLabel}
              </Tag>
            )}
            <span className="app-header-account">{authUser.username}</span>
          </div>
        ) : null}
      </Header>
      {active.subItems && active.subItems.length > 0 ? (
        <Layout>
          <Sider width={200} className="app-sider" theme="light">
            <Menu
              mode="inline"
              selectedKeys={[selectedSubKey ?? '']}
              openKeys={openKeys}
              onOpenChange={(keys) => setUserOpenKeys(keys)}
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