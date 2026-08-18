import { ReviewNotesProvider } from '../contexts/ReviewNotesContext'
import { ReviewNote } from '../components/ReviewNote'
import { ReviewNoteSwitch } from '../components/ReviewNoteSwitch'
import type { ReactNode } from 'react'
import { Layout, Menu, Typography, Space, Tag, Tooltip, Divider, App, Select } from 'antd'
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

/* [DECISION D34/D35] 菜单分为两个一级组——
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
      // [DECISION D34/D35] 采集节点状态子菜单常驻，无实例时展示空态引导
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
        </Space>
        <Space size="large" align="center">
          <ReviewNoteSwitch />
          {/* [DECISION D31] 移除全局「单/多网域模式」Switch —— multi_site_enabled 为 M06 租户级行政开关，
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
          <ReviewNote title="设计意图（面向产品 / 技术评审）" style={{ margin: '16px 16px 0' }}>
            监控对象、采集策略与告警规则变更后，配置会自动生成并汇总为待确认的变更；
            运维在「配置变更确认」页做发布审批（go/no-go）——平台保证生成内容与策略一致，
            运维确认变更影响后决定是否发布到监控。配置按网域生成（prometheus.yml + targets/*.json + rules.yml + blackbox.yml），
            下发通道按采集节点位置分层：local 通道走本地文件集，agent_pull 通道走 zip 配置包；
            alertmanager.yml 由告警收敛与通知管理模块直接管理，不进入本模块变更确认流程。
            菜单结构：「网域与节点管理」（接入面：网域纳管 / 采集节点状态）与「配置下发」（配置面：配置变更确认 / 下发记录）两个一级组，
            采集节点状态子菜单常驻，无实例时展示空态引导。
          </ReviewNote>
          {children}
          {/* [DECISION D21] 提示分区规范：用户可见文案不含决策编号 / PRD 引用 / 版本标记；
              评审说明统一由 <ReviewNote> 承载，受全局「评审说明」开关控制。 */}
          <ReviewNote>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
              设计决策与 PRD 引用详见 docs/05-execution-records/module-09/design-decisions.md 与 Module_09 PRD。
              本模块关键决策：配置产物形态分层（D6/D32）、下发通道按采集节点位置分层（D31/D32/D33）、
              配置变更确认心智（自动生成 + 人工审批，D18）、变更对象与影响文件（D22）、
              提示分区规范（D21）。
              v1.43（联动 M01 草稿）：配置生成候选集过滤 draft_status=ready，草稿对象（draft）不生成配置变更；
              change_status 全链路回写 M01（pending / confirmed / deployed / none，PRD 3.3/3.4/3.5），
              MVP 阶段 deployed 由 none 占位（确认下发成功后直接回写 none，v0.2 起精确回写）。
              实现细节与数据契约见 PRD 对应章节与代码注释。
            </Typography.Paragraph>
          </ReviewNote>
        </Content>
      </Layout>
    </Layout>
    </ReviewNotesProvider>
  )
}
