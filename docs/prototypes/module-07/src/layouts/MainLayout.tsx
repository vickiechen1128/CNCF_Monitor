import { Layout, Menu, Typography, Space, Tag, Tooltip, Select, App } from 'antd'
import { type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { USER_ROLE_MAP, type UserRole } from '../mocks/module-07'
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
import { ReviewNotesProvider } from '../contexts/ReviewNotesContext'
import { ReviewNote } from '../components/ReviewNote'
import { ReviewNoteSwitch } from '../components/ReviewNoteSwitch'

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
        { key: '/business-management', icon: <AppstoreOutlined />, label: '业务管理 {v2.23}' },
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
  const { message } = App.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  // {v2.10} M07 不采用全局网域上下文切换器：网域仅作为资源列表内的筛选维度
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
            <ReviewNote title="设计意图（面向产品 / 技术评审）" style={{ margin: '16px 16px 0' }}>
              本模块维护监控对象（资源）、资源标签与标签模板数据，作为监控策略与配置中心的数据提供方：
              采集策略由「监控策略」模块负责，配置生成与下发由「配置中心」模块负责，「采集状态（采集中 / 已下发未采到 / 未监控）」由监控策略与查询中心模块计算、本页只读展示；业务分组字典由「业务管理」页维护。
              标签模板按资源类别定义「字段 → 监控标签」的映射，模板按资源类别隐式关联该类型全部实例；
              静态资源（主机 / 中间件 / 通用目标）标签由 CMDB / Excel 治理、平台只读，应用服务资源开放实例级自定义标签。
            </ReviewNote>
            {children}
            {/* [DECISION 3.2] 提示分区规范：用户可见文案不含决策编号 / PRD 引用 / 版本标记；
                评审说明统一由 <ReviewNote> 承载，受全局「评审说明」开关控制。 */}
            <ReviewNote>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                页面文案面向运维工程师，不含实现细节；设计决策与 PRD 引用详见
                docs/05-execution-records/module-07/design-decisions.md 与 Module_07 PRD（对应原型目录上级）。
                决策清单：
                3.1 v0.4+ 预留字段处理策略（cmdb / orphan / cmdb_field 类型存在、MVP 不使用，UI 标注 {'v0.4+'}）；
                3.2 模块边界可视化（被动数据提供方、采集/监控状态归 M01/M02（M07 只读映射 is_monitored，见 3.20）、不生成下发 Prometheus 配置、CMDB 同步由 Module_04 负责）；
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
                3.20 {'{v2.20}'} 决策 31-M1：is_monitored 由 M01 维护、M07 只读映射（资源列表「采集状态」列只读展示 + 「未监控」筛选，M07 不计算不写回，且 is_monitored 与 status 维度独立）；
                3.21 {'{v2.20}'} 决策 29：offline 资源下一配置生成周期即从 targets/*.json 移除、不触发采集器 reload（批量下线动线为真）。
                3.22 {'{v2.23}'} 决策 47-3（修订 31-M1）：资源列表「采集状态」升级为三态 badge——采集中 / 已下发未采到 / 未监控；数据 = M01 选中关系（is_monitored）+ M02 健康度/覆盖率 API（按 resource_id 回连，列表级聚合、禁止逐行查询 TQ-6）。
                3.23 {'{v2.23}'} 决策 48：业务分组字典提级 MVP——新增「业务管理」页（列表 / 登记 / 受限编辑 / 停用），字典落 DB、business_domains.yaml 仅首次启动 seed；红线：biz_code 创建后不可改、仅 biz_name/description/status 可编辑、停用不删除、infra 禁止停用/删除。
                3.24 {'{v2.24}'} 决策 52：网域归属四级解析链——显式指定 &gt; 冲突告警 &gt; 按 IP 与网域已登记网段（ip_cidrs，契约 M06 v2.5）最长前缀推导 &gt; 默认兜底；网域字段可留空由平台推导；Blackbox 拨测例外 = 取发起侧（采集 Job）网域、不推导。列表与详情标注「归属来源」（显式/冲突/网段推导/默认/发起侧）以显性化该平台派生信息。
                3.25 {'{v2.25}'} coverage 三态口径修订（2026-09-02，planner 阻塞项闭环）：选中关系取 DB 当前值、不感知 M09 下发时序；「已下发未采到」含变更未确认下发情形，提醒文案同步；「待采集 vs 已下发未采到」细分归 M01 Job 回显（M01 §5.10）。五类默认标签模板补 resource_id → resource_id 稳定身份映射（决策 47-3 coverage 回连前置）。
                3.26 {'{v2.27}'} 开发反馈 F-34 / L-2：①静态资源（host / database / middleware / generic_target）实例级标签在 CMDB 侧只读治理，标签模板页「关联实例」Tab 与 badge 仅业务类型资源（application）展示，右栏 Tab 随类别动态 2~3 个；②LabelTemplate.description 必须落库（创建 / 更新请求体不再静默丢弃），新增 / 编辑模板表单含「模板说明」并回填、克隆保留。
                3.27 {'{v2.31}'} 决策 68-5：①命名规约（跨模块基线）——target_label 一律不带 _id 后缀，resource_id → resource_id 为约定俗成例外；②tenant_id → tenant 为 v0.2 起五类默认模板的内置默认映射（MVP 单租户不注入），前端默认启用；缺该映射将被 M09 生成期门禁阻断（M02 硬隔离 matcher 名为 tenant）。
                3.28 {'{v2.32}'} 决策 77：K8s 集群不设第六资源类型——集群按部署形态处理，四归属为网络边界（独立建网域）/ 分组维度（cluster 字段·标签）/ 发现源（M04 KubernetesProvider）/ 集群健康监控（generic_target + M01 monitor_type=k8s）；纯文档注记、原型行为不变。
                3.29 {'{v2.32}'} 前端设计优化（对齐《前端标准》§8 交互选型 / §9 列表与长文本规范）：①资源列表列数治理——五类 Tab 统一收敛为 8 列（主标识 fixed left / 类型或身份 / 网域 / 归属来源 / 业务 / 运行状态 / 采集状态 / 操作 fixed right），原 11~14 列；端口 / 版本 / 操作系统 / 应用·环境·集群 / 健康检查 URL / 协议 / 端点 / 采集路径 / 自定义标签 / 数据来源 / 负责人 / CMDB 预留字段下沉详情 Drawer；类型字段改为随主标识行内 Tag；②状态语义统一 Badge 语义色 + 文字（采集状态由彩色 Tag 改 Badge）；③操作层次——主操作「详情」品牌色加粗且全行唯一，次要「编辑」灰色文字，低频破坏性「删除」收进「更多」菜单（业务管理页的停用 / 启用同理）；④新增 / 编辑资源抽屉 560 → 720px 并按「资源信息 / 归属与状态」分组（字段 12~14 项，&gt;6 且需分组）；详情抽屉 680 → 720px；⑤全页提示统一为 Callout 单块容器（替换 Alert，消除多风格拼盘）；⑥运行状态用户语言按 PRD §10 术语表收敛为「运行中 / 已停止 / 维护中」（原 mock 误用「在线 / 离线」）。
                实现细节与数据契约见 PRD 对应章节（6 接口设计 / 5.12 C 组合字段 / 12 验收标准）与代码注释。
              </Typography.Paragraph>
            </ReviewNote>
          </Content>
        </Layout>
      </Layout>
    </ReviewNotesProvider>
  )
}
