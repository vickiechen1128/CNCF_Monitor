import { useState } from 'react'
import { Layout, Menu, Typography, Space, Badge, Tag, Switch, Tooltip, Divider, Alert, Collapse } from 'antd'
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
        { key: '/config-preview', icon: <FileTextOutlined />, label: '配置变更确认' },
        { key: '/deployments', icon: <AppstoreOutlined />, label: '下发记录' },
      ]
    : [
        { key: '/config-preview', icon: <FileTextOutlined />, label: '配置变更确认' },
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
                  监控对象、采集策略与告警规则变更后，配置会<Text strong>自动生成</Text>并汇总为待确认的变更；
                  运维在「配置变更确认」页做<Text strong>发布审批（go/no-go）</Text>——平台保证生成内容与策略一致，
                  运维确认变更影响后决定是否发布到监控。配置按网域生成（<Text code>prometheus.yml</Text> +{' '}
                  <Text code>targets/*.json</Text> + <Text code>rules.yml</Text> + <Text code>blackbox.yml</Text>），
                  中心管理域走本地文件集 / 边缘域走 zip 配置包。
                </span>
              }
              style={{ margin: 16 }}
              onClose={() => setShowDesignTip(false)}
            />
          )}
          {children}
          {/* 提示分区规范（决策 21）：用户可见文案不含设计决策 / PRD 引用；本折叠区集中承载设计依据，供产品 / 技术评审与开发参考 */}
          <Collapse
            ghost
            style={{ margin: '0 16px 16px' }}
            items={[
              {
                key: 'review',
                label: (
                  <Space size={4}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      原型与实现说明（面向产品 / 技术评审，不影响功能体验）
                    </Text>
                  </Space>
                ),
                children: (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                    页面文案面向运维工程师，不含实现细节；设计决策与 PRD 引用详见
                    docs/05-execution-records/module-09/design-decisions.md 与 Module_09 PRD（对应原型目录上级）。
                    决策清单：决策 6 配置产物形态按域类型分层；决策 7 targets 前端数据驱动；决策 8 rules 按作用域生成；
                    决策 9 / 11 安装指引（Edge Sync Agent 部署定位 / 3 步人工步骤）；决策 12 MVP 固定 vmagent；
                    决策 14 注册登记制闭环（Token 前置签发 / Remote Write 自动推导）；决策 15 Agent 状态页「网域为主 + 组件分类」；
                    决策 16 字段语义对齐 / default 无 Agent / 组件类型筛选；决策 17 安装指引页面顶部提示区；
                    决策 18 配置变更确认心智（自动生成 + 人工审批、变更摘要 / 清单）；决策 19 受影响文件高亮 / 风险与确认人 / 下发记录定位；
                    决策 20 变更单号 / 抽屉式详情 / 检测状态引导性 / 确认人预置；决策 21 状态筛选 / 提示分区规范；
                    决策 22 变更对象 = 源数据对象（采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板）+「影响的配置文件」派生列 / 变更单级确认（不逐行）/ 全链路关联（change_no → 配置版本 → 下发记录，双向可追溯、回滚入口）。
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
