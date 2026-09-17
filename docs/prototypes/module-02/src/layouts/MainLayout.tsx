import { Layout, Menu, Typography, Space, Tag, Switch, message, Collapse, Select, Tooltip, Divider } from 'antd'
import type { ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AppstoreOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { useTenant } from '../contexts/TenantContext'
import { ReviewNotesProvider } from '../contexts/ReviewNotesContext'
import { ReviewNoteSwitch } from '../components/ReviewNoteSwitch'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

type UserRole = 'ops1' | 'ops2'
const USER_ROLE_MAP: Record<UserRole, string> = {
  ops1: '运维工程师1',
  ops2: '运维工程师2',
}

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
        {
          key: '/targets',
          icon: <AppstoreOutlined />,
          label: (
            <Space size={4}>
              目标状态
              <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>
                P1
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
        { key: 'cross-m08', icon: <AppstoreOutlined />, label: '告警工作台（Module_08）' },
        { key: 'cross-m09', icon: <AppstoreOutlined />, label: '配置中心（Module_09）' },
        { key: 'cross-m06', icon: <AppstoreOutlined />, label: '系统设置（Module_06）' },
      ],
    },
  ]
}

const crossModuleHint: Record<string, string> = {
  'cross-m07': '资源管理原型位于 docs/prototypes/module-07/（Module_07 监控对象管理）',
  'cross-m01': '监控策略原型位于 docs/prototypes/module-01/（Module_01 监控策略与指标管理）',
  'cross-m08': '告警工作台原型位于 docs/prototypes/module-08/（Module_08 告警收敛与通知管理；告警状态页归此模块，M02 仅提供 /api/v1/alerts 注入代理 API）',
  'cross-m09': '配置中心原型位于 docs/prototypes/module-09/（Module_09 网域与边缘配置中心）',
  'cross-m06': '系统设置原型位于 docs/prototypes/module-06/（Module_06 系统与平台管理）',
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { multiSiteEnabled, setMultiSiteEnabled } = useTenant()
  const menuItems = buildMenu()

  const [searchParams, setSearchParams] = useSearchParams()
  const role: UserRole = searchParams.get('role') === 'ops2' ? 'ops2' : 'ops1'

  const switchRole = (next: UserRole) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'ops2') params.set('role', 'ops2')
    else params.delete('role')
    setSearchParams(params)
    message.info(next === 'ops2' ? '已切换为运维工程师2' : '已切换为运维工程师1')
  }

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
    <ReviewNotesProvider>
      <Layout className="app-layout">
        <Header className="app-header">
        <Space size="large">
          <Title level={4} className="app-title" style={{ margin: 0, color: '#fff' }}>
            <span className="app-title-accent">◆</span>
            MetricCenter
          </Title>
          <Menu
            mode="horizontal"
            theme="dark"
            selectedKeys={['query-center']}
            style={{ background: 'transparent', borderBottom: 'none', minWidth: 120, lineHeight: '64px' }}
            items={[{ key: 'query-center', label: '查询中心' }]}
          />
          <Tag color="#0ECDEB" style={{ color: '#0B1B2A', fontWeight: 600 }}>
            原型验证版
          </Tag>
        </Space>
        <Space size="large" align="center">
          <ReviewNoteSwitch />
          <Space size="small" align="center">
            <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>网域模式</Text>
            <Tooltip title={multiSiteEnabled ? '多网域模式：覆盖多个网域' : '单网域模式：仅 default 管理域'}>
              <Switch
                checked={multiSiteEnabled}
                checkedChildren="多网域"
                unCheckedChildren="单网域"
                onChange={setMultiSiteEnabled}
              />
            </Tooltip>
          </Space>
          <Divider type="vertical" style={{ borderColor: 'rgba(255,255,255,0.25)', height: 22, margin: 0 }} />
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
                    docs/05-execution-records/module-02/design-decisions.md 与 Module_02 PRD（对应原型目录上级）。
                    决策清单（对齐 PRD v1.6，决策 47/50/51/52，2026-08-31）：
                    4.1 /api/v1/alerts 代理 v0.3（与 Module_08 对齐）；4.2 PromQL 校验 / 指标实时预览 v0.3（随 M01 规则编辑 UI）；
                    4.3 租户 / 网域上下文注入 MVP 落地骨架（恒 `default` 网域 + `platform_admin` 租户）、多租户/多网域语义 v0.2；
                    4.4 注入标签 key 统一 `network_domain` / `tenant_id`（与 Module_09 external_labels 对齐，MVP，决策 47-2）；
                    4.5 `/api/v1/targets` 代理 P0/MVP、承接 M01 移交，同时作 M01 Job 实例回显（47-2）与 M07 三态 badge（47-3）数据源；独立目标状态页降 P1（极简全局排障列表，47-4）；
                    4.6 envelope 支持多网域数组 `network_domains` + `data_source` 网域细化（v1.2）；MVP envelope 最小口径（决策 50 / v1.5）：`data_source` 恒 `central_scrape`、`network_domains` 恒 `["default"]`、`freshness_at` 取最新样本时间戳；
                    4.7 采集健康度 / 覆盖率查询 API 由 v0.2 提前到 MVP（决策 47-3，供 M07 三态 badge）；
                    4.8 批量查询 / 查询辅助 / Dashboard 数据 / Open API 鉴权 v0.3；目标详情 ScrapeLog 独立日志存储 v0.3；
                    4.9 决策 50（v1.5）：不自研拖拽式面板编辑器 / 可视化大屏，大屏走 Grafana iframe 嵌入且数据源必须指向 M02 查询代理（禁止直连 Prometheus）。
                    5.0 决策 51（v1.6）：可视化三层归属（自研查询=M02 / 大屏嵌入=M05 / 告警规则=M08，全文见 module-05 design-decisions）；跨网域业务看板不受网域注入影响（授权集合收敛语义，`sum by (biz)` 跨域聚合天然成立）。
                    5.1 决策 52（v1.6）：blackbox 拨测网域语义——拨测指标 `network_domain` 表示发起侧网域（探测路径），目标归属不参与网域推导（全文见 module-07 design-decisions）。
                    实现细节与数据契约见 PRD 对应章节与代码注释。
                  </Typography.Paragraph>
                ),
              },
            ]}
          />
        </Content>
      </Layout>
    </Layout>
    </ReviewNotesProvider>
  )
}
