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
            alertmanager.yml 作为管理域 default scope 产物纳入本模块变更确认（告警通知模块文件挂载提交），人工确认后由本模块写中心 Alertmanager 配置路径并触发 reload，不参与按网域扇出、不进入 agent_pull 配置包。
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
              v1.50（决策 31/30/31-M2/31-M3 契约同步呈现，2026-08-21）：①采集认证 / TLS 透传（决策 31，MVP 必实现）——
              ScrapeJob 认证 / TLS 字段由 M01 配置，本模块仅透传映射（auth_type=basic→basic_auth、auth_type=bearer→authorization、
              tls_skip_verify→tls_config.insecure_skip_verify、ca_file→tls_config.ca_file），blackbox HTTP/HTTPS 模块同理透传 tls_config；
              ②冻结（禁用）网域不生成新变更单（决策 30），存量下发与回滚不受影响；③变更状态回写 deployed 提前到 MVP（决策 31-M2），
              成功下发即 deployed；④删除「未指定网域资源自动归 default」兜底（决策 31-M3），network_domain_id 由 M07 导入校验强制必填。
              本批为 M01 / M07 契约的同步呈现，无新机制。
              v1.49（决策 28/29 契约落版 + 原型同步）：①网域契约结构性对齐（决策 28）——NetworkDomain 行政模型以 Module_06 为单一事实来源、
              本模块不再重复声明行政字段表（ID 规则 / 租户归属 / 跨租户共享见 Module_06）；②offline 排除提级 MVP 必实现（决策 29）——
              生成 targets/*.json 时按 Resource.status=offline 过滤已下线实例（offline 后下一配置生成周期即从 targets 移除），
              maintenance 排除口径与 Module_07 8.1 一并对齐（MVP 不保证）。
              v1.48（决策 38-1 规则文件挂载，MVP 补齐 M01↔M09 规则链路契约）：rules.yml 生成改为「透传并入」——
              MVP 阶段 M01 规则编辑页以文件挂载（content_mode=yaml_passthrough）把整份 rules.yml 存于
              MonitoringRule.rule_content，M09 生成 rules.yml 时原样并入（不按字段派生），保存 / 启停 / 删除后
              进入变更检测 → 变更单人工确认 → 下发，change_status 全链路回写 M01；v0.3 字段级编辑（structured）后
              恢复按字段派生分组。本轮联动 M01 原型 v3.24，不改变本模块行为逻辑。
              v1.47（MVP 缺憾补漏，2026-08-21 决策 42 系列）：同域 pending 草稿「后单取代前单」superseded 防堆积；
              校验失败草稿提供「重新校验 / 废弃」闭环；local 通道 failed 下发记录提供「重试」入口（agent_pull 不提供）；
              configgen 生成异常新增「生成失败」态且不推进版本、下轮重试；9 验收收敛 MVP 边界标注 {'{v0.2}'}。本轮为契约与闭环补口子、不改原型行为。
              v1.46 契约由 v1.49 提级取代：offline 过滤已由「目标语义、MVP 不保证」提级为「MVP 必实现」（决策 29，见 v1.49 说明）。
              v1.45（标签注入收敛，2026-08-19 决策 19/23）：external_labels 移除 tenant_id，仅注入部署级元数据
              network_domain_id / zone_type / replica；biz 与 tenant 均由 Module_07 LabelTemplate 以 target 级注入
              targets/*.json 的 static_configs[].labels，M09 不单独注入；配置产物按 network_domain 分目录（MVP），
              多租户命名空间 {'{v0.2+}'} 占位不实现。
              v1.44（业务-网域正交性对齐，2026-08-19 决策）：biz 等实例级业务标签由 Module_07 LabelTemplate
              注入 targets/*.json 的 static_configs[].labels，不经本模块 external_labels；网域与业务正交——
              多业务共用 1 网域为正常状态，业务归属变更只原子重写 targets/*.json（新增待确认草稿 draft-gov-004 演示）。
              v1.43（联动 M01 草稿）：配置生成候选集过滤 draft_status=ready，草稿对象（draft）不生成配置变更；
              change_status 全链路回写 M01（pending / confirmed / deployed / none，PRD 3.3/3.4/3.5），
              v1.50 起 deployed 提前为 MVP 必实现（成功下发即回写，见上方 v1.50 说明；v1.43 原文「MVP 由 none 占位」由 v1.50 取代）。
              实现细节与数据契约见 PRD 对应章节与代码注释。
            </Typography.Paragraph>
          </ReviewNote>
        </Content>
      </Layout>
    </Layout>
    </ReviewNotesProvider>
  )
}
