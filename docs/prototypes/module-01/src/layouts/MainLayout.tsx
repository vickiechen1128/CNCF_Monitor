import { Layout, Menu, Typography, Space, Tag, Tooltip, Divider, Select, App } from 'antd'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  AppstoreOutlined,
  DashboardOutlined,
  CloudOutlined,
  BellOutlined,
  SettingOutlined,
  SearchOutlined,
  TeamOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { USER_ROLE_MAP, type UserRole } from '../mocks/module-01'
import { ReviewNotesProvider } from '../contexts/ReviewNotesContext'
import { ReviewNote } from '../components/ReviewNote'
import { ReviewNoteSwitch } from '../components/ReviewNoteSwitch'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

interface MainLayoutProps {
  children: ReactNode
}

type MenuItem = Required<MenuProps>['items'][number]

// {v3.6} 动线分离：导航按角色过滤——业务负责人仅见业务指标库/业务视图；运维见全部（含业务指标库只读+状态推进）
// {v3.7} 动线归组：指标库（技术指标库 / 业务指标库 / 业务视图）放入同一「指标库」分组，技术/业务二分、动线放一起
function buildMenu(role: UserRole): MenuItem[] {
  // {v3.8} 采集分组（父+子，样式对齐指标库分组）：采集器管理（安装动线起点）/ 采集 Job；承载于 /scrape-jobs 页内下拉视图（?view= 区分）
  const collectItem: MenuItem = { key: '/scrape-jobs?view=collectors', icon: <AppstoreOutlined />, label: '采集器管理' }
  const jobsItem: MenuItem = { key: '/scrape-jobs?view=jobs', icon: <AppstoreOutlined />, label: '采集 Job' }
  const collectGroup: MenuItem = {
    key: 'collect',
    icon: <AppstoreOutlined />,
    label: '采集',
    children: [collectItem, jobsItem],
  }
  // 指标库分组：技术指标库（技术元数据）+ 业务指标库（业务语义契约登记表）+ 业务视图（独立页，业务域聚合）
  const techItem: MenuItem = { key: '/metric-library', icon: <DatabaseOutlined />, label: '技术指标库' }
  const bizItem: MenuItem = { key: '/business-metrics', icon: <TeamOutlined />, label: '业务指标库' }
  const bizViewItem: MenuItem = { key: '/business-view', icon: <TeamOutlined />, label: '业务视图' }
  const metricLibGroup: MenuItem = {
    key: 'metric-lib',
    icon: <DatabaseOutlined />,
    label: '指标库',
    children: role === 'ops' ? [techItem, bizItem, bizViewItem] : [bizItem, bizViewItem],
  }
  const rulesItem: MenuItem = { key: '/rules', icon: <AppstoreOutlined />, label: '规则编辑' }
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
        { key: '/global/alerts', icon: <BellOutlined />, label: <Tooltip title="Module 08 告警收敛与通知管理">告警状态</Tooltip>, disabled: true },
        { key: '/global/settings', icon: <SettingOutlined />, label: <Tooltip title="Module 06 系统设置">系统设置</Tooltip>, disabled: true },
      ],
    },
  ]
  const base = role === 'ops' ? [collectGroup, metricLibGroup, rulesItem] : [metricLibGroup]
  return [...base, ...globalItems]
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { message } = App.useApp()
  // {v3.6} 当前角色（动线分离演示）：URL ?role=biz → 业务负责人，默认运维工程师
  const role: UserRole = searchParams.get('role') === 'biz' ? 'biz_owner' : 'ops'
  const menuItems = buildMenu(role)

  const switchRole = (next: UserRole) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'biz_owner') params.set('role', 'biz')
    else params.delete('role')
    setSearchParams(params)
    // 业务负责人视角仅业务指标库可访问：切换后跳转
    if (next === 'biz_owner' && location.pathname !== '/business-metrics') {
      navigate('/business-metrics')
    }
    message.info(next === 'biz_owner' ? '已切换为业务负责人：可登记/更新业务指标，不可配置采集任务' : '已切换为运维工程师：可配置采集任务、查看全部指标库')
  }

  // {v3.7} 业务视图为独立路由页；{v3.8} 采集分组子项按 ?view= 区分（采集器管理默认 / 采集 Job）
  const selectedKey =
    location.pathname === '/scrape-jobs'
      ? new URLSearchParams(location.search).get('view') === 'jobs'
        ? '/scrape-jobs?view=jobs'
        : '/scrape-jobs?view=collectors'
      : location.pathname
  const openKeys = menuItems
    .filter((item): item is Exclude<typeof item, null> => {
      if (!item || !('children' in item) || !Array.isArray(item.children)) return false
      return item.children.some((c) => c && 'key' in c && c.key === selectedKey)
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
          <Sider theme="light" width={220} style={{ borderRight: '1px solid #E5E6EB' }}>
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              defaultOpenKeys={openKeys}
              items={menuItems}
              onClick={(e) => navigate(e.key)}
              style={{ borderRight: 0, paddingTop: 8 }}
            />
          </Sider>
          <Content className="app-content">
            {/* 提示分区规范：用户可见文案不含设计决策 / PRD 引用；设计意图 / 模块边界说明统一进 ReviewNote，受「评审说明」开关控制 */}
            <ReviewNote title="设计意图（面向产品 / 技术评审）" style={{ margin: '0 0 8px' }}>
              本模块负责监控策略与指标库维护；所有采集 Job 必须绑定单一网域，实例选择已按网域过滤。
              配置变更由配置中心通过异步轮询（pull 模式）感知并生成对应网域的配置包，本模块不直接触发下发。
            </ReviewNote>
            {children}
            <ReviewNote>
              <Typography.Paragraph style={{ fontSize: 12, margin: 0 }}>
                页面文案面向运维工程师，不含实现细节；设计决策与 PRD 引用详见
                docs/05-execution-records/module-01/design-decisions.md 与 Module_01 PRD（对应原型目录上级）。
                决策清单：决策 4 拨测配置合并为 ScrapeJob 的 blackbox 类型（job_type=standard / blackbox，生成 blackbox.yml）；
                决策 5 先有指标库才能写 PromQL（规则保存时校验 expr 引用指标必须存在于指标库）；
                决策 6 保留「指标元数据」概念、内部实现为「指标库」；
                决策 14 采集参数可从 CI-Exporter 映射继承、且可被手动覆盖（「同步映射默认值」跳过已覆盖字段）；
                决策 15 选中 CI 类型后自动匹配映射默认 Exporter 模板（继承链）。
                v3.22（决策 D29 原型侧）：状态列四态聚合（草稿/待下发/已生效/已停用，草稿 MVP 灰显 + Tooltip「v0.2 支持保存草稿」）；
                保存/启停/删除改乐观更新（本地先标「待下发」，toast 附「前往配置变更确认」跳转 M09）；
                操作列新增「克隆」（v0.2，同网域直接改选实例分组、跨网域实例清空重选 + 安装确认需重新进行）；
                多选 + toolbar「批量提交生效」（v0.2，弹结果抽屉成功/失败逐错误清单）；
                Job/规则表单双按钮「保存草稿（v0.2，基础校验，不入下发管线）/ 提交生效（完整校验，失败错误定位到字段下方）」。
                实现细节与数据契约见 PRD 对应章节与代码注释。
              </Typography.Paragraph>
            </ReviewNote>
          </Content>
        </Layout>
      </Layout>
    </ReviewNotesProvider>
  )
}