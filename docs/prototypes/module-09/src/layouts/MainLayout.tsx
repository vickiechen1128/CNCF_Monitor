import { useState } from 'react'
import { Layout, Menu, Typography, Space, Badge, Tag, Switch, Tooltip, Divider, Alert } from 'antd'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AppstoreOutlined,
  CloudOutlined,
  ClusterOutlined,
  FileTextOutlined,
  DashboardOutlined,
  BellOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { currentTenant } from '../mocks/module-09'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(multiSite: boolean): MenuItem[] {
  const module09Items: MenuItem[] = multiSite
    ? [
        { key: '/network-domains', icon: <CloudOutlined />, label: '网域管理' },
        { key: '/edge-agents', icon: <ClusterOutlined />, label: 'Agent 状态' },
        { key: '/config-preview', icon: <FileTextOutlined />, label: '配置生成' },
        { key: '/deployments', icon: <AppstoreOutlined />, label: '下发记录' },
      ]
    : [
        { key: '/config-preview', icon: <FileTextOutlined />, label: '配置生成' },
        { key: '/deployments', icon: <AppstoreOutlined />, label: '下发记录' },
      ]

  // 全局跨模块导航占位：当前模块高亮，其他模块以 disabled 或 Tooltip 提示
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
        { key: '/global/resources', icon: <AppstoreOutlined />, label: <Tooltip title="Module 07 资源管理">资源管理</Tooltip>, disabled: true },
        { key: '/global/strategy', icon: <AppstoreOutlined />, label: <Tooltip title="Module 01 监控策略">监控策略</Tooltip>, disabled: true },
        { key: '/global/config', icon: <AppstoreOutlined />, label: <Tooltip title="当前模块：配置中心">配置中心</Tooltip>, disabled: true },
        { key: '/global/query', icon: <AppstoreOutlined />, label: <Tooltip title="Module 02 指标查询">指标查询</Tooltip>, disabled: true },
        { key: '/global/alerts', icon: <BellOutlined />, label: <Tooltip title="Module 08 告警状态">告警状态</Tooltip>, disabled: true },
        { key: '/global/settings', icon: <SettingOutlined />, label: <Tooltip title="Module 06 系统设置">系统设置</Tooltip>, disabled: true },
      ],
    },
  ]

  return [...module09Items, ...globalItems]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [multiSite, setMultiSite] = useState(currentTenant.multi_site_enabled)
  const [showDesignTip, setShowDesignTip] = useState(true)
  const menuItems = buildMenu(multiSite)

  const handleModeChange = (checked: boolean) => {
    setMultiSite(checked)
    currentTenant.multi_site_enabled = checked
    // 单网域模式下若当前位于被隐藏的页面，则跳转到配置生成页
    if (!checked && (location.pathname === '/network-domains' || location.pathname === '/edge-agents')) {
      navigate('/config-preview', { replace: true })
    }
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
          <Title level={4} className="app-title" style={{ margin: 0 }}>
            <span className="app-title-accent">◆</span>
            MetricCenter
          </Title>
          <Tag color="#0ECDEB" style={{ color: '#0B1B2A', fontWeight: 600 }}>
            原型验证版
          </Tag>
        </Space>
        <Space size="middle">
          <Badge
            status={multiSite ? 'processing' : 'success'}
            text={
              <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
                {multiSite ? '多网域模式' : '单网域模式'}
              </Text>
            }
          />
          <Text style={{ color: 'rgba(255,255,255,0.65)' }}>{currentTenant.name}</Text>
        </Space>
      </Header>
      <Layout>
        <Sider theme="light" width={240} style={{ borderRight: '1px solid #E5E6EB' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E5E6EB' }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                租户级模式开关
              </Text>
              <Switch
                checked={multiSite}
                onChange={handleModeChange}
                checkedChildren="多网域"
                unCheckedChildren="单网域"
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {multiSite
                  ? '展示网域管理、Agent 状态、按网域下发'
                  : '隐藏网域管理，仅面向中心 Prometheus 下发'}
              </Text>
            </Space>
          </div>
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
          {showDesignTip && (
            <Alert
              type="info"
              showIcon
              closable
              message="Module_09 设计意图"
              description={
                <span>
                  配置变更采用 <Text strong>pull 模式</Text>：Module_09 异步轮询（默认 30s）检测 Module_01/07 各源表{' '}
                  <Text code>updated_at</Text> 变化触发配置重算，Module_01/07 不主动通知。
                  变更检测采用「源数据版本触发预筛 + 生成后联合 checksum 裁决」，避免无谓轮询与草稿噪音。
                  配置按网域生成（<Text code>prometheus.yml</Text> + <Text code>targets/*.json</Text> +{' '}
                  <Text code>rules.yml</Text> + <Text code>blackbox.yml</Text> + <Text code>metadata.json</Text>）；
                  规则按 scope 分发（中心 central/both，边缘 edge/both v0.4+）。
                </span>
              }
              style={{ margin: 16 }}
              onClose={() => setShowDesignTip(false)}
            />
          )}
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
