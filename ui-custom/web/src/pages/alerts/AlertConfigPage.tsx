/**
 * 告警配置页（决策 59/60 + 设计提案 alert-config-three-layer-model.md §7.3 方案 A）。
 *
 * 页面职责（2026-10-13 收敛，提案 alert-config-policy-split-migration.md §2.2）：
 * 由「策略 + 动线 + 现状 + 历史 + 高级」五段收敛为三件事——
 *   ① 当前生效（只读 YAML）；
 *   ② 配置版本历史（内容侧留痕，常驻）；
 *   ③ 导入整份配置文件（**常驻独立卡**，三层模型第③ 层永久逃生舱，PRD §11.6 / 决策 113）。
 *
 * 2026-10-13 迁移（提案 §2.1 / §2.2）：原「路由与收敛策略」卡（未匹配规则的告警发给谁 +
 * 路由规则由谁维护）与「动线卡」已**整块迁出**——
 *   - 两个策略控件 → 「路由规则」页常驻「路由设置」卡（与顶层路由同屏）；
 *   - 「哪个渠道是兜底」→ 「通知渠道」页新增「兜底渠道」列。
 * 迁出理由：策略控件与本页职责（查看当前生效 + 版本历史 + 导入）不符，且兜底控件与顶层路由
 * 分处两页——用户改一处、另一处会被后端 `materializeRootRouteReceiver` 静默覆盖（该函数不判 mode）。
 * 「导入整份配置文件」由高级 Collapse **提为常驻卡**（A11）：决策 113 / §7.6 C3 要求手写逃生门
 * 任何模式下都可达，收进默认收起的折叠区等于在主路径下被降级隐藏。
 * 随之删除：原 PageIntro 第 5 条「两开关独立性」说明（已随决策五原句落位到路由规则页兜底控件旁）。
 *
 * 2026-10-02 用户意见（已落地）：
 *   - 「配置版本历史」是全局留痕能力，从高级区提出为常驻卡（现状卡之后、高级区之前）；
 *   - 删除「重新挂载此版本」：历史配置重新提交走「打开版本内容→改→导入」即可，
 *     专用remount 端点 + 二次确认 + 行级错误区属过度设计，且与「通知模板」页的
 *     「重新挂载（模板回滚）」语义同名易混——后者保留（那是模板版本回滚，有独立价值）；
 *   - 「平台自动生成的接收人」只读面板迁出本页 → 「通知渠道」页表格的「平台接收人」列
 *     （明细/复制仍走该页行内「接收人配置」抽屉）：它是**渠道的产物**，只在渠道上下文里有意义，
 *     放在本页高级区既割裂又与渠道页的片段能力形成「同源能力两份」。
 *     本页仅在手写说明的「接收人」块保留前往渠道页的链接（常量 ALERT_CONFIG_REQUIRED_BLOCKS）。
 *
 * 三层模型与 UI 的对应（提案 §1.3）：三层模型里「导入整份文件」是第 ③ 层（永久逃生舱，PRD §11.6），
 * 因此**页头不再挂type="primary" 主按钮**——降级不删除，入口移入高级区。
 *
 * 状态口径（dev-feedback §25 方案 A 前端侧）：展示一律按 `applied_at` 派生——有值「已生效」，
 * 为空「已提交，待确认下发」+ 配置变更确认入口；不再直读 `status=applied` 冒充「已生效」
 * （提交只落库收录，真正写盘 + reload 在 M09 确认下发之后）。
 *
 * 术语口径（提案 §7.5）：用户视图一律不出「派生 / 兜底 / 作者模式 / 收敛（复合词）」与
 * `route`/`receivers` 等字段名；字段名只在高级区的手写说明与 YAML 里出现。
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import {
  EyeOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { alertmanagerConfigApi } from '../../api/alertmanager'
import { triggerConfigDrafts } from '../config-center/preview/triggerConfigDraft'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { PageIntro } from '../../components/PageIntro'
import { RuleGuideLink } from '../../components/RuleGuideLink'
import { useAlertConfig } from './useAlertConfig'
import { AlertConfigDrawer } from './AlertConfigDrawer'
import {
  ALERTMANAGER_MIN_SKELETON,
  ALERT_ADVANCED_GUIDE_HANDWRITTEN_INTRO,
  ALERT_ADVANCED_GUIDE_MANAGED,
  ALERT_ADVANCED_GUIDE_TITLE,
  ALERT_IMPORT_CARD_TITLE,
  ALERT_IMPORT_LABEL,
  ALERT_CONFIG_EXEMPT_BLOCKS,
  ALERT_CONFIG_REQUIRED_BLOCKS,
  CONFIG_PREVIEW_PATH,
  CONFIG_STATUS_DISCARDED_TIP,
  CONFIG_STATUS_PENDING_TIP,
  CURRENT_USER,
  configStatusView,
} from './alertmanagerConstants'
import { useRouteSetting } from './useRouteSetting'
import { shortChecksum } from '../../utils/shortChecksum'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'

const { Text } = Typography

/** 配置状态展示所需的字段子集（当前生效 / 版本列表 / 版本详情三处同构；#44 起含 status 废弃态判定） */
type ConfigStatusSource = Pick<AlertmanagerConfigVersionListItem, 'applied_at' | 'source_change_no' | 'status'>

export function AlertConfigPage() {
  const { tokens } = useSkin()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { current, versions, total, loading, error, permissionDenied, reload, page, pageSize, onPageSizeChange, submit } =
    useAlertConfig()
  // 迁移后本页**不再有任何策略控件**（兜底渠道 / 路由维护模式已迁至「路由规则」页），
  // 因此只读 mode 一个字段：用于「手写配置说明」按模式条件化引导（提案 §7.4 口径保留）。
  const { setting: routeSetting } = useRouteSetting()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOpenSeq, setDrawerOpenSeq] = useState(0)
  const [drawerContent, setDrawerContent] = useState('')
  const [detail, setDetail] = useState<AlertmanagerConfigVersionListItem | null>(null)
  const [detailLoaded, setDetailLoaded] = useState<{ id: string; content: string } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // YAML / 配置正文统一排版（一处定义、多处复用）：等宽、可滚动、同圆角同内边距，
  // 避免此前四处各写一套内联样式造成的视觉不一致。配色取皮肤 token（支持运行时换肤）。
  const yamlBlockStyle = {
    margin: 0,
    overflow: 'auto',
    background: tokens.colorBgBase,
    padding: 12,
    borderRadius: 8,
    fontSize: 13,
  } as const

  const openMount = (content = '') => {
    setDrawerOpenSeq((s) => s + 1)
    setDrawerContent(content)
    setDrawerOpen(true)
  }

  const handleSubmit = async (content: string) => {
    await submit(content, CURRENT_USER)
    // 决策 60：告警配置仅作用于管理域 default；挂载成功后同步触发变更单生成
    void triggerConfigDrafts(['default'], { prefix: '配置已挂载', onNavigate: () => navigate(CONFIG_PREVIEW_PATH) })
    reload()
  }

  /**
   * 是否为「平台管理」模式（提案 §7.4）：决定高级区「手写配置说明」的内容——
   * managed 只讲「抑制规则是三块必写中唯一未 UI 化项」；handwritten 才展开完整三块必写 + 两块豁免。
   */
  const isManagedMode = routeSetting?.mode === 'managed'

  const openVersionDetail = async (record: AlertmanagerConfigVersionListItem) => {
    setDetail(record)
    setDetailLoading(true)
    setDetailLoaded(null)
    try {
      const res = await alertmanagerConfigApi.getVersion(record.id)
      setDetailLoaded({ id: record.id, content: res.data.content })
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载版本内容失败，请稍后重试')
    } finally {
      setDetailLoading(false)
    }
  }

  /**
   * 配置状态展示（dev-feedback §25 方案 A + #44 废弃联动）：按 `status` + `applied_at` 派生，
   * **不直读 status 声称生效**。status=applied 只表示「已收录为 M09 下发源」（挂载落库那一刻
   * 即置位，此时 AM 仍加载旧文件），唯一真实生效信号是 M09 确认下发写盘成功后回填的
   * `applied_at`；status=discarded 为废弃终态（后端废弃联动标记），此时已无在途单可确认，
   * 只呈现终态与恢复指引，**不再给「前往确认」入口**（不造死链）。
   */
  const renderConfigStatus = (v: ConfigStatusSource) => {
    const view = configStatusView(v.applied_at, v.status)
    if (view.discarded) {
      return (
        <Space direction="vertical" size={2}>
          <Tag color={view.color}>{view.label}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {CONFIG_STATUS_DISCARDED_TIP}
          </Text>
        </Space>
      )
    }
    if (view.applied) {
      return <Tag color={view.color}>{view.label}</Tag>
    }
    const confirmPath = v.source_change_no
      ? `${CONFIG_PREVIEW_PATH}?change_no=${encodeURIComponent(v.source_change_no)}`
      : CONFIG_PREVIEW_PATH
    return (
      <Space direction="vertical" size={2}>
        <Tag color={view.color}>{view.label}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {CONFIG_STATUS_PENDING_TIP}
          <Link to={confirmPath}>{v.source_change_no ? `变更单 ${v.source_change_no}` : '「配置变更确认」'}</Link>
          确认下发。
        </Text>
      </Space>
    )
  }

  const columns: ColumnsType<AlertmanagerConfigVersionListItem> = [
    {
      title: '版本 ID',
      dataIndex: 'id',
      key: 'id',
      width: 160,
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      // 状态列改由 applied_at 派生（§25）：展示与「Alertmanager 是否已加载本版本」对齐。
      title: '状态',
      dataIndex: 'applied_at',
      key: 'status',
      width: 230,
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => renderConfigStatus(r),
    },
    {
      title: '生效时间',
      dataIndex: 'applied_at',
      key: 'applied_at',
      width: 180,
      render: (v?: string) => <Text type="secondary">{v ?? '-'}</Text>,
    },
    {
      title: '应用人',
      dataIndex: 'applied_by',
      key: 'applied_by',
      width: 130,
      render: (v?: string) => <Text>{v ?? '-'}</Text>,
    },
    {
      title: 'M09 变更单',
      dataIndex: 'source_change_no',
      key: 'source_change_no',
      width: 170,
      // 决策 69-③（决策 60 补充块）：变更单号直达 M09 该单详情（?change_no= 深链）。
      // 纯展示层增强——source_change_no 字段既已存在，不引入 change_status 依赖、不新增路由。
      render: (v?: string) =>
        v ? (
          <Link to={`${CONFIG_PREVIEW_PATH}?change_no=${encodeURIComponent(v)}`}>{v}</Link>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '校验和（sha256）',
      dataIndex: 'checksum',
      key: 'checksum',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{shortChecksum(v)}</Text>,
    },
    {
      // 2026-10-02 用户意见：删除「重新挂载此版本」——重新提交历史配置改走
      // 「查看内容 → 在抽屉里改 → 导入整份配置文件」，与首屏导入入口同一条路径。
      // 操作列随之收窄为只读查看（宽度同步下调）。
      title: '操作',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_: unknown, r: AlertmanagerConfigVersionListItem) => (
        <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openVersionDetail(r)}>
          查看
        </Button>
      ),
    },
  ]

  if (permissionDenied) {
    return (
      <MainLayout>
        <Card>
          <Empty description="当前账号无此页面查看权限" />
        </Card>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        {/* 页头 + 说明区（四页统一，见 components/PageIntro.tsx）。
            **页头不挂主按钮**——「导入整份配置文件」是三层模型第③ 层（永久逃生舱，PRD §11.6），
            但已从高级折叠区提为下方**常驻独立卡**（提案 §2.2 卡③），`extra` 留空即为此故。

            2026-10-13 迁移：副标与三条要点重写为「查看当前生效的配置与历史版本」。
            原副标「设置『告警发给谁、按什么条件分』」与前两条要点描述的正是迁走的两个策略控件，
            继续保留会让用户在本页找已不存在的控件；原第 5 条「两开关独立性」已随决策五
            原句落位到「路由规则」页兜底控件旁（见 ROUTE_SETTING_MODE_INDEPENDENCE_TIP）。*/}
        <PageIntro
          testId="alert-config-intro"
          title="告警配置"
          subtitle="查看当前生效的告警配置与历史版本；改动经配置中心（M09）变更单，确认后统一下发生效"
          points={[
            '本页是只读视图：看当前生效的是哪一版配置，以及历史上过哪些版本（可查看内容留痕）。',
            <>
              告警规则（什么情况下算告警）在「规则编辑」维护；谁收到告警（通知渠道）、按什么条件分发（路由规则）
              都在各自页面维护，本页不再承载策略配置。 <RuleGuideLink />
            </>,
            '所有改动都不会即时生效：提交后进入配置中心（M09）变更单，人工确认后统一下发。',
          ]}
        />

        {/* 错误条置于数据区之前：问题优先可见。 */}
        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="配置信息加载失败，请稍后重试"
            description={error}
            action={<Button size="small" onClick={reload}>重新加载</Button>}
          />
        )}

        {/* ① 现状卡（2026-10-13 迁移后为首屏第一卡，提案 §2.2 卡①）：只讲「现在生效的是什么」——一行状态摘要 + 版本元数据；
            完整 YAML 降为默认折叠（原为 maxHeight 420 常驻展开，是首屏YAML 散落的源头之一）。 */}
        <Card
          title="当前生效"
          extra={
            current && current.applied_at ? (
              <Tag color="processing">生效于 {current.applied_at} 由 {current.applied_by ?? '-'} 提交</Tag>
            ) : null
          }
          style={{ marginBottom: 16 }}
          data-testid="alert-current-card"
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Text type="secondary">加载中…</Text>
            </div>
          ) : current && current.content ? (
            <>
              <Descriptions size="small" column={{ xs: 1, md: 3 }} style={{ marginBottom: 12 }}>
                <Descriptions.Item label="状态">{renderConfigStatus(current)}</Descriptions.Item>
                <Descriptions.Item label="版本 ID">
                  <Text code>{current.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="生效时间">{current.applied_at ?? '-'}</Descriptions.Item>
              </Descriptions>
              {/* 完整配置改为默认折叠：多数用户只需知道「生效了哪一版」，YAML 属高级查看诉求。 */}
              <Collapse
                ghost
                size="small"
                items={[
                  {
                    key: 'yaml',
                    label: (
                      <Space size={8}>
                        <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                        <Text>查看完整配置内容</Text>
                        <Tag>只读</Tag>
                      </Space>
                    ),
                    children: (
                      <>
                        <Space size={8} style={{ marginBottom: 8 }} wrap>
                          <Text type="secondary" style={{ fontSize: 12 }}>应用人：{current.applied_by ?? '-'}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            变更单：{current.source_change_no ?? '-'}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            校验和：<Text code>{shortChecksum(current.checksum)}</Text>
                          </Text>
                        </Space>
                        <pre style={yamlBlockStyle}>{current.content}</pre>
                      </>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Empty description="当前无生效配置。可在下方「希望直接编辑整份 alertmanager.yml？」卡导入整份配置文件，或先用「通知渠道」「路由规则」在界面上配置。" />
          )}
        </Card>

        {/* ④ 配置版本历史（2026-10-02 用户意见：从高级区提出为常驻卡）：内容侧留痕是全局能力，
            与「平台为渠道生成的接收人」（那是渠道页的产物列）和手写逃生舱都无关，故不藏在高级折叠里。
            位置：现状卡之后（先看现在生效什么 → 再看历史上过什么）、高级区之前。*/}
        <Card
          title={
            <Space size={8} wrap>
              <HistoryOutlined />
              配置版本历史
              <Tag>内容侧留痕</Tag>
            </Space>
          }
          extra={<Text type="secondary" style={{ fontSize: 12 }}>每次导入都会存一版，可查看内容留痕</Text>}
          style={{ marginBottom: 16 }}
          data-testid="alert-versions-card"
        >
          <Table<AlertmanagerConfigVersionListItem>
            rowKey="id"
            dataSource={versions}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            pagination={{
              ...TABLE_PAGINATION,
              current: page,
              // ⚠️ 必须把 hook 的 pageSize 回传给受控分页对象：
              // TABLE_PAGINATION.pageSize 写死为 20，若不覆盖，受控分页的 pageSize 永远是 20，
              // 用户选「10 条/页」会被 antd 还原回 20（选择不生效），表现为「点 10 没反应、反复转圈」。
              // 与 NetworkDomainsPage 的成熟写法保持一致（分页对象同时受控 current 与 pageSize）。
              pageSize,
              pageSizeOptions: ['10', '20', '50', '100'],
              total,
              onChange: (p, pz) => onPageSizeChange(p, pz),
            }}
          />
        </Card>

        {/* ④ 导入整份配置文件（2026-10-13 迁移：提为**常驻卡**，提案 §2.2 卡③）。
            三层模型第③ 层（永久逃生舱，PRD §11.6 / 决策 113）——降级不删除，但**不能降级到默认收起的
            折叠区**：收进高级区等于在主路径下被隐藏，与「任何模式下逃生门都可达」的承诺相悖（验收 A11）。
            故从高级 Collapse 提出，与「当前生效」「版本历史」并列常驻。 */}
        <Card
          title={ALERT_IMPORT_CARD_TITLE}
          style={{ marginBottom: 16 }}
          data-testid="alert-import-card"
        >
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              上传或粘贴完整 alertmanager.yml，覆盖当前配置；校验通过后进入变更确认
            </Text>
            <div>
              <Button icon={<UploadOutlined />} onClick={() => openMount()} data-testid="import-config-button">
                {ALERT_IMPORT_LABEL}
              </Button>
            </div>
          </Space>
        </Card>

        {/* ⑤ 手写配置说明（默认收起）：手写逃生门的使用说明。
            抑制规则是「三块必写」中唯一未 UI 化项（dev-feedback #37），故不得整体删除本区。
            2026-10-13 迁移：导入入口提为常驻卡后，本区只剩这一个折叠项，故**展平为单层**
            （原为「高级区 → 手写说明」两层嵌套；嵌套已无必要，`stopHeaderClick` 随之移除）。 */}
        <Collapse
          size="small"
          style={{ marginBottom: 16 }}
          data-testid="alert-advanced-collapse"
          items={[
            {
              key: 'guide',
              label: (
                <Space size={8} wrap data-testid="advanced-collapse-label">
                  <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                  <Text>{ALERT_ADVANCED_GUIDE_TITLE}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    导入整份 alertmanager.yml 时，必写 / 不用你写的内容说明
                  </Text>
                </Space>
              ),
              children: (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                  data-testid="handwritten-guide-content"
                >
                  {isManagedMode ? (
                    <Text type="secondary">{ALERT_ADVANCED_GUIDE_MANAGED}</Text>
                  ) : (
                    <>
                      <Text>{ALERT_ADVANCED_GUIDE_HANDWRITTEN_INTRO}</Text>
                      <div>
                        <ol style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                          {ALERT_CONFIG_REQUIRED_BLOCKS.map((block) => (
                            <li key={block.key} style={{ marginBottom: 4 }}>
                              <Text strong>{block.title}</Text>
                              <Text code style={{ margin: '0 6px' }}>{block.fields}</Text>
                              <Text type="secondary">{block.desc}</Text>
                              {block.path ? (
                                <Text type="secondary">
                                  ，前往<Link to={block.path}>{block.linkText ?? '详情'}</Link>
                                </Text>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <Text strong>这两块不用你写：</Text>
                        <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                          {ALERT_CONFIG_EXEMPT_BLOCKS.map((block) => (
                            <li key={block.key} style={{ marginBottom: 4 }}>
                              <Text strong>{block.title}</Text>
                              <Text type="secondary">
                                ：{block.desc}
                                {block.path ? (
                                  <>
                                    ，前往<Link to={block.path}>{block.linkText ?? '详情'}</Link>
                                  </>
                                ) : null}
                              </Text>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <Space size={8} style={{ marginBottom: 8 }}>
                          <Text strong>最小可运行 alertmanager.yml 骨架</Text>
                          <Tag color="processing">已通过配置校验</Tag>
                        </Space>
                        <pre style={{ ...yamlBlockStyle, maxHeight: 320 }}>{ALERTMANAGER_MIN_SKELETON}</pre>
                        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                          点上方「{ALERT_IMPORT_LABEL}」后，可在抽屉里用「插入骨架示例」一键填入这份骨架。
                        </Text>
                      </div>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />

        <AlertConfigDrawer
          key={drawerOpenSeq}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          initialContent={drawerContent}
          onSubmit={handleSubmit}
        />

        <Drawer
          title={detail ? `配置版本 ${detail.id} 内容` : '配置版本内容'}
          width={760}
          open={detail !== null}
          loading={detailLoading}
          onClose={() => setDetail(null)}
        >
          {detail && (
            <>
              <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="版本 ID">
                  <Text code>{detail.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">{renderConfigStatus(detail)}</Descriptions.Item>
                <Descriptions.Item label="生效时间">{detail.applied_at ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="应用人">{detail.applied_by ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="M09 变更单">
                  {detail.source_change_no ? <Text code>{detail.source_change_no}</Text> : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="校验和（sha256）">
                  <Text code style={{ fontSize: 12 }}>{shortChecksum(detail.checksum)}</Text>
                </Descriptions.Item>
              </Descriptions>
              <pre style={{ ...yamlBlockStyle, maxHeight: 520 }}>
                {detailLoaded?.id === detail.id ? detailLoaded.content : ''}
              </pre>
            </>
          )}
        </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}