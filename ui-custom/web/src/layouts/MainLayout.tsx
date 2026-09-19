import { Layout, Menu, Tag, Tooltip, Typography } from 'antd'
import {
  AppstoreOutlined,
  BellOutlined,
  BgColorsOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DesktopOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RadarChartOutlined,
  SendOutlined,
  TagsOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MenuProps } from 'antd'
import { getStoredUser } from '../api/client'
import {
  SIDER_COLLAPSED_WIDTH,
  SIDER_WIDTH,
  readSiderCollapsed,
  writeSiderCollapsed,
} from './siderPreference'
import { useProductName } from '../skinContext'

const { Header, Sider, Content } = Layout
const { Title } = Typography

interface MainLayoutProps {
  children: ReactNode
  /**
   * 单屏铺满模式（首页）：内容区高度锁定为「视口 − 顶部栏」，页内不再出现下拉进度条，
   * 由页内自适应布局（指标卡定高 / 告警卡自适应分页 / 右列等高对齐）消化高度。
   * 默认关闭：其余页面保持「内容超出即滚动」的常规行为。
   */
  fitViewport?: boolean
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

/** 首页二级导航中「自定义大屏」的占位 key（v0.2 预留，非可跳转路由） */
const RESERVED_DASHBOARD_KEY = 'reserved-custom-dashboard'

/** 预留项版本标注：口径待与 M05 PRD 收敛（用户侧提法 v0.2，PRD 现写 v0.3），集中一处便于改口径 */
const RESERVED_DASHBOARD_VERSION = 'v0.2'

/** 可折叠子菜单组定义：key 与归属路由（用于首次进入自动展开判断） */
const COLLAPSIBLE_GROUPS = [
  { key: ACCESS_PLANE_KEY, routes: ['/domain-onboarding', '/node-status', '/targets'] },
  { key: DELIVERY_PLANE_KEY, routes: ['/config-preview', '/deployments'] },
]

const MODULES: ModuleDef[] = [
  {
    key: 'home',
    label: '首页',
    path: '/',
    /**
     * 首页二级导航（用户 2026-09-18 反馈）：首页此前无左侧栏，与其余模块观感不一致，
     * 且 v0.2「自定义可视化大屏」需要一个落位处，故补齐二级导航。
     * 预留项 disabled（不可跳转、不新增路由），仅表达「此处将承载大屏」；
     * 是否解除豁免需与 M05 PRD §3.1「MVP 不提供可视化大屏入口」一并收敛（见模块 dev-feedback）。
     */
    subItems: [
      { key: '/', label: '概览 Dashboard', icon: <DashboardOutlined /> },
      {
        key: RESERVED_DASHBOARD_KEY,
        label: (
          // 版本标签与文案同排：一眼看出「已规划但未开放」，避免用户反复点击无效入口
          <span className="app-sider-reserved-label">
            自定义大屏
            <Tag className="app-sider-reserved-tag">{RESERVED_DASHBOARD_VERSION}</Tag>
          </span>
        ),
        icon: <FundProjectionScreenOutlined />,
        disabled: true,
      },
    ],
  },
  {
    key: 'platform-admin',
    label: '系统与平台管理',
    path: '/admin/domains',
    subItems: [
      { key: '/admin/tenants', label: '租户管理', icon: <CloudServerOutlined /> },
      { key: '/admin/domains', label: '网域管理', icon: <AppstoreOutlined /> },
      { key: '/admin/users', label: '用户管理', icon: <DesktopOutlined /> },
      { key: '/admin/login-logs', label: '登录日志', icon: <FileSearchOutlined /> },
      // 外观设置（用户 2026-09-18 补充）：界面皮肤 + 产品名称。
      // 落在「系统与平台管理」而非顶栏——观感配置是低频设置项，不该占用高频操作区，
      // 与租户 / 用户 / 登录日志等平台级设置同属一处。
      { key: '/admin/appearance', label: '外观设置', icon: <BgColorsOutlined /> },
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
      // 应用字典维护页（M07 §5.19 / 决策 92，与业务管理同构：编码不可变 + 停用不删除）
      { key: '/application-dict', label: '应用管理', icon: <AppstoreOutlined /> },
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
    path: '/alert-status',
    // 原型对齐（Module_08 原型 MainLayout 左侧栏）：告警状态置顶（第一），
    // 告警配置落底（最后）；中间为静默管理、历史告警。
    subItems: [
      // M08 v1.12 增量：告警状态双视图页（T08-F7），原型中为侧栏首项
      { key: '/alert-status', label: '告警状态', icon: <RadarChartOutlined /> },
      { key: '/silences', label: '静默管理', icon: <BellOutlined /> },
      // M08 v1.13 增量：历史告警独立页（Track B+）
      { key: '/alert-history', label: '历史告警', icon: <ClockCircleOutlined /> },
      { key: '/alert-config', label: '告警配置', icon: <FileSearchOutlined /> },
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
 * /admin/*（网域、用户、租户、登录日志、外观设置）→ 系统与平台管理；/domain-onboarding、/node-status、/targets、/config-preview、/deployments → 网域与边缘配置中心；
 * /resources、/label-templates、/business-domains、/application-dict → 监控对象管理；/collectors、/scrape-jobs、/rules、/metric-library → 采集策略；
 * /alert-config、/silences、/alert-status、/alert-history → 告警收敛与通知管理；其余 → 首页。
 */
function resolveActiveModule(locationPath: string): ModuleDef {
  // /admin/* 全部归属「系统与平台管理」（M06）：按前缀收口而非逐个枚举路由，
  // 避免将来新增平台级页面（如本次的 /admin/appearance）时漏改此处而落到首页。
  if (locationPath.startsWith('/admin/')) return findModuleByKey('platform-admin')
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
    locationPath.startsWith('/business-domains') ||
    locationPath.startsWith('/application-dict')
  )
    return findModuleByKey('monitoring-object')
  if (
    locationPath.startsWith('/collectors') ||
    locationPath.startsWith('/scrape-jobs') ||
    locationPath.startsWith('/rules') ||
    locationPath.startsWith('/metric-library')
  )
    return findModuleByKey('monitoring-strategy')
  if (
    locationPath.startsWith('/alert-config') ||
    locationPath.startsWith('/silences') ||
    locationPath.startsWith('/alert-status') ||
    locationPath.startsWith('/alert-history')
  )
    return findModuleByKey('alert')
  return MODULES[0]
}

/**
 * 主布局（Header 一级模块导航 + Sider 二级导航 + Content）。
 * 参考业界管控台三层导航：Header 承载一级功能模块切换（紧跟品牌右侧），
 * Sider 展示当前模块的二级页面。
 *
 * 侧栏折叠（用户 2026-09-18 反馈）：Sider 支持用户折叠/展开，偏好持久化到
 * localStorage（跨模块、跨刷新共用一份），折叠后仅保留图标列（56px），为内容区让出
 * 宽度——既是首页「为 v0.2 自定义大屏预留」的前置能力，也服务后续宽表/大屏页面。
 * 折叠开关放在顶部栏品牌左侧（Sider 自带底部 trigger 会跟随菜单高度浮动，
 * 页面滚动时位置不稳定，故关闭自带 trigger 改用固定位置开关）。
 *
 * 内容区高度：`min-height: 100vh` 撑满背景，**不锁定视口**（用户 2026-09-18 二次反馈）。
 * 页面按内容自然排布，超出视口即滚动——不同电脑尺寸/分辨率下版式一致，不做拉伸与裁切。
 * （首版曾提供 fitViewport 单屏铺满开关，因其把「内容量」与「视口高度」强绑定而移除。）
 */
export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  // 品牌位文案随「外观设置 · 产品名称」变化（用户 2026-09-18 补充，见 productNamePreference.ts）
  const { productName } = useProductName()
  const active = resolveActiveModule(location.pathname)
  const leafKeys = collectLeafKeys(active.subItems)
  const selectedSubKey = leafKeys.some((k) => location.pathname.startsWith(k))
    ? location.pathname
    : leafKeys[0]

  // 侧栏折叠偏好：初始值来自 localStorage（服务端渲染 / 隐私模式下回落展开）
  const [siderCollapsed, setSiderCollapsed] = useState(() => readSiderCollapsed())
  const toggleSider = () =>
    setSiderCollapsed((prev) => {
      writeSiderCollapsed(!prev)
      return !prev
    })

  const hasSider = Boolean(active.subItems && active.subItems.length > 0)

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
          {/* 侧栏折叠开关：无二级导航的模块不渲染（避免无效控件） */}
          {hasSider && (
            <Tooltip title={siderCollapsed ? '展开侧边导航' : '折叠侧边导航'}>
              <button
                type="button"
                className="app-sider-toggle"
                data-testid="sider-toggle"
                aria-label={siderCollapsed ? '展开侧边导航' : '折叠侧边导航'}
                aria-expanded={!siderCollapsed}
                onClick={toggleSider}
              >
                {siderCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              </button>
            </Tooltip>
          )}
          <Title level={3} className="app-title">
            {productName}
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
        {/* 顶栏右上角常驻：已登录时的角色标签 + 账号名。
            外观设置（皮肤 / 产品名称）不在此处——见「系统与平台管理 · 外观设置」页。 */}
        <div className="app-header-right">
          {authUser ? (
            <>
              {roleLabel && (
                <Tag
                  className="app-header-role"
                  color={authUser?.role === 'admin' ? 'gold' : 'default'}
                >
                  {roleLabel}
                </Tag>
              )}
              <span className="app-header-account">{authUser.username}</span>
            </>
          ) : null}
        </div>
      </Header>
      {hasSider ? (
        <Layout>
          <Sider
            width={SIDER_WIDTH}
            collapsedWidth={SIDER_COLLAPSED_WIDTH}
            collapsed={siderCollapsed}
            collapsible
            trigger={null}
            className="app-sider"
            theme="light"
          >
            <Menu
              mode="inline"
              selectedKeys={[selectedSubKey ?? '']}
              openKeys={siderCollapsed ? [] : openKeys}
              onOpenChange={(keys) => setUserOpenKeys(keys)}
              onClick={({ key }) => navigate(key)}
              items={active.subItems as MenuProps['items']}
            />
          </Sider>
          <Content className="app-content">
            {children}
          </Content>
        </Layout>
      ) : (
        <Content className="app-content">{children}</Content>
      )}
    </Layout>
  )
}