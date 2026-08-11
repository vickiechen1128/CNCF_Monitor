import { Layout, Menu, Typography, Space, Badge, Tag, Tooltip, Divider, Alert, Switch, App, Collapse } from 'antd'
import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AppstoreOutlined,
  DashboardOutlined,
  CloudOutlined,
  BellOutlined,
  SettingOutlined,
  SearchOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { currentTenant } from '../mocks/module-01'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(): MenuItem[] {
  const module01Items: MenuItem[] = [
    { key: '/ci-exporter-mapping', icon: <AppstoreOutlined />, label: 'CI-Exporter 模板映射' },
    { key: '/scrape-jobs', icon: <AppstoreOutlined />, label: '采集 Job' },
    { key: '/metric-library', icon: <AppstoreOutlined />, label: '指标库' },
    { key: '/rules', icon: <AppstoreOutlined />, label: '规则编辑' },
  ]

  // 全局跨模块导航占位：当前模块高亮，其他模块以 disabled + Tooltip 提示
  const globalItems: MenuItem[] = [
    {
      key: 'global-divider',
      label: <Divider style={{ margin: '8px 0' }} />,
      disabled: true,
    },
    {
      key: 'global',
      label: '全局导航',
      icon: <DashboardOutlined />,
      children: [
        { key: '/global/resources', icon: <AppstoreOutlined />, label: <Tooltip title="Module 07 资源管理（由 Module_07 提供）">资源管理</Tooltip>, disabled: true },
        { key: '/global/strategy', icon: <AppstoreOutlined />, label: <Tooltip title="当前模块：监控策略">监控策略</Tooltip>, disabled: true },
        { key: '/global/config', icon: <CloudOutlined />, label: <Tooltip title="Module 09 配置中心（由 Module_09 负责）">配置中心</Tooltip>, disabled: true },
        { key: '/global/query', icon: <SearchOutlined />, label: <Tooltip title="Module 02 指标查询">指标查询</Tooltip>, disabled: true },
        { key: '/global/alerts', icon: <BellOutlined />, label: <Tooltip title="Module 08 告警状态">告警状态</Tooltip>, disabled: true },
        { key: '/global/settings', icon: <SettingOutlined />, label: <Tooltip title="Module 06 系统设置">系统设置</Tooltip>, disabled: true },
      ],
    },
  ]

  return [...module01Items, ...globalItems]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [showGlobalTip, setShowGlobalTip] = useState(true)
  const [multiSite, setMultiSite] = useState(currentTenant.multi_site_enabled)
  const menuItems = buildMenu()

  // 租户级多网域开关：直接改写 currentTenant，供各页面读取（与 Module_09 原型一致）
  const toggleMultiSite = (checked: boolean) => {
    currentTenant.multi_site_enabled = checked
    setMultiSite(checked)
    window.dispatchEvent(
      new CustomEvent('tenant-mode-change', { detail: { multiSiteEnabled: checked } })
    )
    message.info(checked ? '已切换为多网域模式：Job 可绑定 default 或边缘网域' : '已切换为单网域模式：Job 仅绑定 default 管理域')
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
            原型验证版
          </Tag>
        </Space>
        <Space size="middle">
          <Switch
            checked={multiSite}
            checkedChildren="多网域"
            unCheckedChildren="单网域"
            onChange={toggleMultiSite}
          />
          <Badge
            status={multiSite ? 'success' : 'processing'}
            text={
              <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
                {multiSite ? '多网域模式' : '单网域模式 · default 管理域'}
              </Text>
            }
          />
          <Text style={{ color: 'rgba(255,255,255,0.65)' }}>运维工程师</Text>
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
          {showGlobalTip && (
            <Alert
              type="info"
              showIcon
              closable
              message="Module_01 设计意图"
              description={
                <span>
                  本模块负责监控策略与指标库维护；所有 ScrapeJob 必须绑定单一网域，实例选择已按网域过滤。
                  配置变更由 Module_09 通过异步轮询（pull 模式）感知并生成对应网域的配置包，Module_01 不直接触发下发。
                </span>
              }
              style={{ margin: 16 }}
              onClose={() => setShowGlobalTip(false)}
            />
          )}
          {children}
          {/* 提示分区规范：用户可见文案不含设计决策 / PRD 引用；本折叠区集中承载设计依据，供产品 / 技术评审与开发参考 */}
          <Collapse
            ghost
            style={{ margin: '0 16px 16px' }}
            items={[
              {
                key: 'review',
                label: (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    原型与实现说明（面向产品 / 技术评审，不影响功能体验）
                  </Text>
                ),
                children: (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                    页面文案面向运维工程师，不含实现细节；设计决策与 PRD 引用详见
                    docs/04-execution-records/module-01/design-decisions.md 与 Module_01 PRD（对应原型目录上级）。
                    决策清单：决策 4 拨测配置合并为 ScrapeJob 的 blackbox 类型（job_type=standard / blackbox，生成 blackbox.yml）；
                    决策 5 先有指标库才能写 PromQL（规则保存时校验 expr 引用指标必须存在于指标库）；
                    决策 6 保留「指标元数据」概念、内部实现为「指标库」；
                    决策 14 采集参数可从 CI-Exporter 映射继承、且可被手动覆盖（「同步映射默认值」跳过已覆盖字段）；
                    决策 15 选中 CI 类型后自动匹配映射默认 Exporter 模板（继承链）。
                    实现细节与数据契约见 PRD 对应章节与代码注释。
                  </Typography.Paragraph>
                ),
              },
            ]}
          />
        </Content>
      </Layout>
    </Layout>
  )
}
