import { Layout, Menu, Typography, Space, Badge, Tag, Tooltip, Collapse } from 'antd'
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
            <Tooltip title="本模块仅维护监控对象、资源标签与标签模板数据，作为监控策略与配置中心的数据提供方，不生成/下发采集配置">
              <Text type="secondary" style={{ fontSize: 11 }}>
                模块边界：本模块仅维护监控对象 / 资源标签 / 标签模板数据
              </Text>
            </Tooltip>
          </div>
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
                    docs/04-execution-records/module-07/design-decisions.md 与 Module_07 PRD（对应原型目录上级）。
                    决策清单：
                    3.1 v0.4+ 预留字段处理策略（cmdb / orphan / cmdb_field 类型存在、MVP 不使用，UI 标注 {'v0.4+'}）；
                    3.2 模块边界可视化（被动数据提供方、is_monitored 由 Module_01 维护只读展示、不生成下发 Prometheus 配置、CMDB 同步由 Module_04 负责）；
                    3.3 状态映射可配置说明放置位置（标签模板页 + 导入记录页，UI 配置入口 P2）；
                    3.4 保护 Prometheus label 校验（composite→instance 映射为例外允许）；
                    3.5 跨模块导航占位（非本模块菜单 disabled + 版本标注）；
                    3.6 模板列表只有「默认 / 自定义」类别（is_default），示例模板已清理；
                    3.7 Prometheus 内置字段由 Prometheus 原生注入，MVP 模板不做内置字段透传映射（prometheus_builtin 枚举保留，v0.2+ 服务发现启用，MVP 新增映射隐藏）；
                    3.8 新增映射目标标签默认 = 来源字段（resource_field），composite 默认 instance；
                    3.9 同一模板内 target_label 唯一，保存时校验（编辑自身排除）；
                    3.10 模板管理归属保持 Module_07；模板列表展示 template_id（可复制）；Module_01 只读关联预览 + 跨模块跳转；
                    3.11 组合字段为跨层解析契约：instance = Resource.instance_ip + Module_01 default_port（host 无 port 字段），MVP 单一预设 instance_ip:port → instance，出值在 Module_09 生成配置时；
                    3.12 标签模板页左右分栏 + 搜索/筛选 + 抽屉编辑 + 映射按来源类型分组（资源字段 / 组合字段）；
                    3.13 MVP 不做分页（搜索/筛选优先）；
                    3.14 资源新增/编辑改右侧抽屉；资源列表保持「Tab + 表格 + 详情抽屉」结构；
                    3.15 资源列表「列显隐配置」（P1，MVP 占位）；
                    3.16 Excel 状态映射 MVP 配置层 + UI 只读（v0.4+ Module_05 提供管理入口）；Excel 枚举一致性：status 可映射，其他枚举列强制一致；
                    3.17 转换规则 transform 下拉可留空（无/lower/upper，prefix/replace 需参数后续版本开放）；
                    3.18 组合字段取值时序：port 取映射 default_port，与 Job/Exporter 无关，唯一风险为端口不一致（见 Module_01 5.1 端口一致性说明）；
                    3.19 prometheus_builtin MVP 隐藏、数据模型保留。
                    实现细节与数据契约见 PRD 对应章节（6 接口设计 / 5.12 C 组合字段 / 12 验收标准）与代码注释。
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
