/**
 * 告警配置页（决策 59/60）。
 *
 * 页面职责（2026-10-22 收敛）：只读查看——
 *   ① 当前生效（只读 YAML）；
 *   ② 配置版本历史（内容侧留痕，常驻）。
 *
 * 2026-10-22 用户裁决：**删除「导入整份 alertmanager.yml」能力**。告警路由的唯一作者是
 * 「路由规则」页的路由树；本页不再提供任何写入口，也不再有手写配置说明 / 导入抽屉。
 * 路由树保存仍走 `POST /api/v2/platform/alertmanager/config` 生成整份配置，因此版本历史
 * 继续由路由保存、通知渠道变更等链路产生，本页保留为内容侧的只读留痕。
 *
 * 状态口径（dev-feedback §25 方案 A 前端侧）：展示一律按 `applied_at` 派生——有值「已生效」，
 * 为空「已提交，待确认下发」+ 配置变更确认入口；不再直读 `status=applied` 冒充「已生效」
 * （提交只落库收录，真正写盘 + reload 在 M09 确认下发之后）。
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
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
import { EyeOutlined, HistoryOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { alertmanagerConfigApi } from '../../api/alertmanager'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { PageIntro } from '../../components/PageIntro'
import { RuleGuideLink } from '../../components/RuleGuideLink'
import { useAlertConfig } from './useAlertConfig'
import {
  CONFIG_PREVIEW_PATH,
  CONFIG_STATUS_DISCARDED_TIP,
  CONFIG_STATUS_PENDING_TIP,
  ROUTES_PATH,
  configStatusView,
} from './alertmanagerConstants'
import { shortChecksum } from '../../utils/shortChecksum'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'

const { Text } = Typography

/** 配置状态展示所需的字段子集（当前生效 / 版本列表 / 版本详情三处同构；#44 起含 status 废弃态判定） */
type ConfigStatusSource = Pick<AlertmanagerConfigVersionListItem, 'applied_at' | 'source_change_no' | 'status'>

export function AlertConfigPage() {
  const { tokens } = useSkin()
  const { message } = App.useApp()
  const { current, versions, total, loading, error, permissionDenied, reload, page, pageSize, onPageSizeChange } =
    useAlertConfig()

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
      // 2026-10-02 用户意见：删除「重新挂载此版本」。
      // 2026-10-22：本页已无导入入口，历史版本仅作内容留痕查看；要改配置请到「路由规则」页。
      // 操作列只保留只读查看。
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
            本页只读：路由在「路由规则」页通过路由树直接配置，渠道在「通知渠道」页维护；
            本页只展示已收录的配置版本及其内容留痕。 */}
        <PageIntro
          testId="alert-config-intro"
          title="告警配置"
          subtitle="只读查看当前生效的告警配置与历史版本；告警路由在「路由规则」页直接配置"
          points={[
            '本页是只读视图：看当前生效的是哪一版配置，以及历史上过哪些版本（可查看内容留痕）。',
            <>
              要改路由分发，去「路由规则」页直接编辑路由树并保存；要改接收渠道，去「通知渠道」页维护。
              本页不提供任何配置入口。 <RuleGuideLink />
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
            <Empty
              description={
                <span>
                  当前无生效配置。请先到<Link to={ROUTES_PATH}>「路由规则」</Link>
                  页直接配置路由树，保存并确认下发后这里会显示生效版本。
                </span>
              }
            />
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
          extra={<Text type="secondary" style={{ fontSize: 12 }}>每次配置变更都会存一版，可查看内容留痕</Text>}
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