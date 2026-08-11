import { Layout, Menu, Typography, Space, Badge, Tag, Switch, message, Collapse } from 'antd'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppstoreOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useTenant } from '../contexts/TenantContext'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

function buildMenu(): MenuItem[] {
  return [
    {
      key: 'group-query',
      type: 'group',
      label: '查询中心（Module_02）',
      children: [
        { key: '/query', icon: <AppstoreOutlined />, label: 'PromQL 查询' },
        { key: '/targets', icon: <AppstoreOutlined />, label: '目标状态' },
        {
          key: '/alert-status',
          icon: <AppstoreOutlined />,
          label: (
            <Space size={4}>
              当前告警
              <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>
                v0.3
              </Tag>
            </Space>
          ),
        },
      ],
    },
    { type: 'divider' },
    {
      key: 'group-cross',
      type: 'group',
      label: '其他模块（原型占位）',
      children: [
        { key: 'cross-m07', icon: <AppstoreOutlined />, label: '资源管理（Module_07）' },
        { key: 'cross-m01', icon: <AppstoreOutlined />, label: '监控策略（Module_01）' },
        { key: 'cross-m09', icon: <AppstoreOutlined />, label: '配置中心（Module_09）' },
        { key: 'cross-m06', icon: <AppstoreOutlined />, label: '系统设置（Module_06）' },
      ],
    },
  ]
}

const crossModuleHint: Record<string, string> = {
  'cross-m07': '资源管理原型位于 docs/prototypes/module-07/（Module_07 监控对象管理）',
  'cross-m01': '监控策略原型位于 docs/prototypes/module-01/（Module_01 监控策略与指标管理）',
  'cross-m09': '配置中心原型位于 docs/prototypes/module-09/（Module_09 网域与边缘配置中心）',
  'cross-m06': '系统设置原型位于 docs/prototypes/module-06/（Module_06 系统与平台管理）',
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { multiSiteEnabled, setMultiSiteEnabled } = useTenant()
  const menuItems = buildMenu()

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('/')) {
      navigate(key)
      return
    }
    const hint = crossModuleHint[key]
    if (hint) {
      message.info(hint)
    }
  }

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
        <Space size="large">
          {multiSiteEnabled ? (
            <Badge
              status="processing"
              text={<Text style={{ color: 'rgba(255,255,255,0.85)' }}>多网域模式：覆盖 2 个网域（default、gov-cloud-a）</Text>}
            />
          ) : (
            <Badge status="success" text={<Text style={{ color: 'rgba(255,255,255,0.85)' }}>default 网域在线（单网域）</Text>} />
          )}
          <Space size="small">
            <Text style={{ color: 'rgba(255,255,255,0.65)' }}>多网域模式</Text>
            <Switch size="small" checked={multiSiteEnabled} onChange={setMultiSiteEnabled} />
          </Space>
          <Text style={{ color: 'rgba(255,255,255,0.65)' }}>运维工程师</Text>
        </Space>
      </Header>
      <Layout>
        <Sider theme="light" width={240} style={{ borderRight: '1px solid #E5E6EB' }}>
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{ borderRight: 0, paddingTop: 8 }}
          />
        </Sider>
        <Content className="app-content">
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
                    docs/04-execution-records/module-02/design-decisions.md 与 Module_02 PRD（对应原型目录上级）。
                    决策清单（决策 4 版本落位，2026-08-06）：4.1 /api/v1/alerts 代理 v0.3；4.2 PromQL 校验 / 指标实时预览 v0.3；
                    4.3 租户 / 网域上下文注入 MVP 机制、多网域语义 v0.2；4.4 注入标签 key 统一 network_domain / tenant_id（MVP）；
                    4.5 目标状态展示新增 MVP（承接 M01 3.3 移交）；4.6 envelope 支持多网域数组、data_source 细化到网域；
                    4.7 采集健康度 / 覆盖率 v0.2（M07 三态 badge）；4.8 批量查询 / 查询辅助 / Dashboard 数据 / Open API 鉴权 v0.3；
                    4.9 目标详情 ScrapeLog 独立日志存储 v0.3。
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
