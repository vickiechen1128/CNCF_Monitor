import { Layout, Menu, Typography, Space, Badge, Tag, Tooltip } from 'antd'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AppstoreOutlined,
  DashboardOutlined,
  SettingOutlined,
  AlertOutlined,
  SearchOutlined,
  CloudServerOutlined,
  ControlOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

/**
 * 全局导航映射表（prototype-designer Phase 4）
 * 区分 MVP 页面（可点击）与未来版本占位（disabled，标注版本标签）
 * 跨模块入口保持完整，避免模块原型成为孤岛
 */
function buildMenu(): MenuItem[] {
  return [
    // ---- Module_07 监控对象管理（MVP，当前模块，可点击） ----
    {
      key: 'grp-m07',
      icon: <AppstoreOutlined />,
      label: '监控对象管理',
      children: [
        { key: '/resources', icon: <AppstoreOutlined />, label: '资源管理' },
        { key: '/label-templates', icon: <AppstoreOutlined />, label: '标签模板' },
        { key: '/import-history', icon: <AppstoreOutlined />, label: '导入记录' },
      ],
    },
    // ---- Module_01 监控策略与指标管理（MVP，跨模块占位） ----
    {
      key: 'grp-m01',
      icon: <ControlOutlined />,
      label: '监控策略',
      children: [
        { key: 'm01-scrape', icon: <ControlOutlined />, label: '采集 Job {MVP}', disabled: true },
        { key: 'm01-rules', icon: <ControlOutlined />, label: '规则编辑 {MVP}', disabled: true },
        { key: 'm01-metrics', icon: <ControlOutlined />, label: '指标库 {P1}', disabled: true },
      ],
    },
    // ---- Module_09 网域与边缘配置中心（MVP/v0.2，跨模块占位） ----
    {
      key: 'grp-m09',
      icon: <CloudServerOutlined />,
      label: '配置中心',
      children: [
        { key: 'm09-domains', icon: <CloudServerOutlined />, label: '网域管理 {MVP}', disabled: true },
        { key: 'm09-agents', icon: <CloudServerOutlined />, label: '边缘 Agent {MVP}', disabled: true },
        { key: 'm09-config', icon: <CloudServerOutlined />, label: '配置生成/下发 {v0.2}', disabled: true },
      ],
    },
    // ---- Module_02 查询中心（MVP/v0.3，跨模块占位） ----
    {
      key: 'grp-m02',
      icon: <SearchOutlined />,
      label: '指标查询',
      children: [
        { key: 'm02-query', icon: <SearchOutlined />, label: 'PromQL 查询 {MVP}', disabled: true },
        { key: 'm02-targets', icon: <SearchOutlined />, label: '目标状态 {v0.3}', disabled: true },
      ],
    },
    // ---- Module_08 告警规则管理（v0.3，跨模块占位） ----
    {
      key: 'grp-m08',
      icon: <AlertOutlined />,
      label: '告警状态',
      children: [
        { key: 'm08-rules', icon: <AlertOutlined />, label: '告警规则 {v0.3}', disabled: true },
        { key: 'm08-silences', icon: <AlertOutlined />, label: '静默管理 {v0.3}', disabled: true },
      ],
    },
    // ---- Module_06 系统与平台管理（v0.4+，跨模块占位） ----
    {
      key: 'grp-m06',
      icon: <SettingOutlined />,
      label: '系统设置',
      children: [
        { key: 'm06-tenants', icon: <SettingOutlined />, label: '租户管理 {v0.2}', disabled: true },
        { key: 'm06-users', icon: <SettingOutlined />, label: '用户/角色 {v0.2}', disabled: true },
        { key: 'm06-audit', icon: <SettingOutlined />, label: '审计日志 {v0.4+}', disabled: true },
      ],
    },
    // ---- Dashboard 占位 ----
    { key: 'dashboard', icon: <DashboardOutlined />, label: '首页 Dashboard {v0.2}', disabled: true },
  ]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const menuItems = buildMenu()

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
          <Title level={4} className="app-title" style={{ margin: 0 }}>
            <span className="app-title-accent">◆</span>
            MetricCenter
          </Title>
          <Tag color="#0ECDEB" style={{ color: '#0B1B2A', fontWeight: 600 }}>
            原型验证版
          </Tag>
        </Space>
        <Space size="middle">
          <Badge status="success" text={<Text style={{ color: 'rgba(255,255,255,0.85)' }}>default 网域在线</Text>} />
          <Text style={{ color: 'rgba(255,255,255,0.65)' }}>运维工程师</Text>
        </Space>
      </Header>
      <Layout>
        <Sider theme="light" width={240} style={{ borderRight: '1px solid #E5E6EB' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            defaultOpenKeys={[...openKeys, 'grp-m07']}
            items={menuItems}
            onClick={(e) => {
              // 仅可点击项（非 disabled）才导航
              if (!e.key.startsWith('/')) return
              navigate(e.key)
            }}
            style={{ borderRight: 0, paddingTop: 8 }}
          />
          <div style={{ padding: '12px 16px' }}>
            <Tooltip title="Module_07 是 Module_01（监控策略）和 Module_09（配置中心）的被动数据提供方，不生成/下发 Prometheus 配置">
              <Text type="secondary" style={{ fontSize: 11 }}>
                模块边界：本模块仅维护 Resource / LabelTemplate / ResourceLabel，作为被动数据提供方
              </Text>
            </Tooltip>
          </div>
        </Sider>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  )
}
