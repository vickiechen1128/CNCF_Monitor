import { useState, type ReactNode } from 'react'
import { Layout, Menu, Typography, Space, Tag, Tooltip, Divider, Alert, Collapse, App, Select } from 'antd'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AppstoreOutlined,
  CloudOutlined,
  ClusterOutlined,
  FileTextOutlined,
  DashboardOutlined,
  BellOutlined,
  SettingOutlined,
  NodeIndexOutlined,
  DeploymentUnitOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { USER_ROLE_MAP, type UserRole } from '../mocks/module-09'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

/**
 * 菜单（决策 34/35）：菜单分为两个一级组——
 * 网域与节点管理（接入面）：网域纳管 / 采集节点状态（常驻，无实例时展示空态引导）
 * 配置下发（配置面）：配置变更确认 / 下发记录
 * 不依赖「单/多网域模式」运行时开关，页面入口由数据驱动。
 */
function buildMenu(): MenuItem[] {
  const accessPlaneItems: MenuItem = {
    key: 'access-plane',
    label: '网域与节点管理',
    icon: <NodeIndexOutlined />,
    children: [
      { key: '/domain-onboarding', icon: <CloudOutlined />, label: '网域纳管' },
      // 决策 34/35：采集节点状态子菜单常驻，无实例时展示空态引导
      { key: '/node-status', icon: <ClusterOutlined />, label: '采集节点状态' },
    ],
  }

  const configPlaneItems: MenuItem = {
    key: 'config-plane',
    label: '配置下发',
    icon: <DeploymentUnitOutlined />,
    children: [
      { key: '/config-preview', icon: <FileTextOutlined />, label: '配置变更确认' },
      { key: '/deployments', icon: <AppstoreOutlined />, label: '下发记录' },
    ],
  }

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
        { key: '/global/alerts', icon: <BellOutlined />, label: <Tooltip title="Module 08 告警收敛与通知管理">告警状态</Tooltip>, disabled: true },
        { key: '/global/settings', icon: <SettingOutlined />, label: <Tooltip title="Module 06 系统设置">系统设置</Tooltip>, disabled: true },
      ],
    },
  ]

  return [accessPlaneItems, configPlaneItems, ...globalItems]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showDesignTip, setShowDesignTip] = useState(true)
  // 当前角色（动线分离演示）：按用户职责区分运维工程师1/2，URL ?role=ops2 → 运维工程师2，默认运维工程师1
  const role: UserRole = searchParams.get('role') === 'ops2' ? 'ops2' : 'ops1'

  const switchRole = (next: UserRole) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'ops2') params.set('role', 'ops2')
    else params.delete('role')
    setSearchParams(params)
    message.info(next === 'ops2' ? '已切换为运维工程师2' : '已切换为运维工程师1')
  }

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
          <Title level={4} className="app-title" style={{ margin: 0, color: '#fff' }}>
            <span className="app-title-accent">◆</span>
            MetricCenter
          </Title>
          <Tag color="#0ECDEB" style={{ color: '#0B1B2A', fontWeight: 600 }}>
            原型验证版
          </Tag>
        </Space>
        <Space size="large" align="center">
          {/* 决策 31：移除全局「单/多网域模式」Switch —— multi_site_enabled 为 M06 租户级行政开关，
              不在 UI 提供运行时切换；页面入口与字段展示由数据驱动 */}
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
        <Sider theme="light" width={240} style={{ borderRight: '1px solid #E5E6EB' }}>
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
                  下发通道按采集节点位置分层（{`{v1.34}`}）：local 通道走本地文件集 / agent_pull 通道走 zip 配置包；
                  <Text strong>审批分级（{`{v1.32}`}）</Text>——
                  <Text code>alertmanager.yml</Text> 由 Module_08（告警收敛与通知管理）直接管理、不进入本模块变更确认流程。
                  <br />
                  <Text strong>菜单结构（{`{v1.35}`}）：</Text>
                  「网域与节点管理」（接入面：网域纳管 / 采集节点状态）与「配置下发」（配置面：配置变更确认 / 下发记录）两个一级组。
                  采集节点状态子菜单常驻，无实例时展示空态引导。
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
                    决策清单：决策 6 配置产物形态分层（{'{v1.33}'} 改按下发通道 local/agent_pull 分层，决策 32）；决策 7 targets 前端数据驱动；决策 8 rules 按作用域生成；
                    决策 9 / 11 安装指引（Edge Sync Agent 部署定位 / 3 步人工步骤）；决策 12 MVP 固定 vmagent；
                    决策 14 注册登记制闭环（Token 前置签发 / Remote Write 自动推导）；决策 15 Agent 状态页「网域为主 + 组件分类」；
                    决策 16 字段语义对齐 / default 无 Agent / 组件类型筛选；决策 17 安装指引页面顶部提示区；
                    决策 18 配置变更确认心智（自动生成 + 人工审批、变更摘要 / 清单）；决策 19 受影响文件高亮 / 风险与确认人 / 下发记录定位；
                    决策 20 变更单号 / 抽屉式详情 / 检测状态引导性 / 确认人预置；决策 21 状态筛选 / 提示分区规范；
                    决策 22 变更对象 = 源数据对象（采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板）+「影响的配置文件」派生列 / 变更单级确认（不逐行）/ 全链路关联（change_no → 配置版本 → 下发记录，双向可追溯、回滚入口）。
                    {'{v1.31}'} 网闸拓扑：center_endpoint（边缘域纳管必填，合成配置包绝对下载地址）/ zone_type（M06 行政字段，配置生成注入 external_labels.zone_type）/ 网闸隔离区连接约束（禁止中心→边缘主动连接，全部边缘发起）。
                    {'{v1.32}'} M01/M08/M09 告警规则职责重构：rules.yml 按 Prometheus group 语法组织（M09 自动派生分组，MVP 不暴露 RuleGroup 实体）；审批分级——prometheus.yml / targets / rules.yml / blackbox.yml 人工确认，alertmanager.yml 由 Module_08 直接管理、不进入本模块变更确认流程（配置包不含 alertmanager.yml）。
                    {'{v1.33}/{v1.34}'} 决策 31/32/33：移除全局「单/多网域模式」运行时切换（multi_site_enabled 为 M06 租户级行政开关）；下发通道按采集节点位置分层（local / agent_pull，与域类型解耦）；MVP 通道按网域固定（default=local，其他=agent_pull）、不提供通道切换、不支持同域混合通道；Token / Agent 类型 / 安装指引 / 运行态字段仅 agent_pull 展示；「Agent 状态」入口按是否存在 EdgeAgent 实例渐进呈现。
                    {'{v1.35}'} 决策 34/35：纳管入口单一化（仅行内「纳管」、移除右上角按钮）；菜单分为「网域与节点管理」（接入面：网域纳管 + 采集节点状态常驻）与「配置下发」（配置面：配置变更确认 + 下发记录）两个一级组；采集节点状态子菜单常驻 + 空态引导；配置同步列扩展四档状态 + 引导按钮（「去配置采集 Job」「前往配置确认」）。
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
