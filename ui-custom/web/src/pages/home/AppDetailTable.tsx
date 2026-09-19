/**
 * L2 应用覆盖表（Module_05 §3.1 决策 93 / PRD v1.8）。
 *
 * 列：应用名称 / 业务域 / 实例 / 已采 / 覆盖率 + 操作。
 * 数据源 `dashboard.by_app`（`app_code` 非空的资源按应用聚合）：
 * - `应用名称` = `app_name`（应用字典展示名，主），`app_code` 内联其后（次要色小字）作为应用简称；
 * - **覆盖率列改「进度条 + 百分比」**（窄进度条约 52px），<70% 橙色语义（颜色不作为唯一语义，
 *   行内仍并列百分数）；
 * - **按覆盖率升序**排列（缺口最大的应用排最前），覆盖率相同按实例数降序；
 * - `未归类应用` 行**置底**：操作为「去补填」引导补录应用归属。
 *
 * 决策 93 **删除**「未恢复」「应用简称」两列：告警口径收口 L0 告警卡 + L4 告警状态卡，
 * 本表只承载采集覆盖（不再按 `app` 标签分组告警）。
 */
import { Empty, Table, Typography, theme } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link } from 'react-router-dom'
import type { AppSummary } from '../../api/dashboard'
import { TABLE_SCROLL_X } from '../../components/tablePresets'
import { SurfaceCard } from './SurfaceCard'
import {
  appResourceListHref,
  coveragePercent,
  coverageText,
  SUBTYPE_COVERAGE_WARN_THRESHOLD,
  RESOURCE_IMPORT_HREF,
} from './resourceTypeMeta'

/** 表格行（应用行 + 未归类行统一形状，便于排序与渲染） */
interface AppRow {
  key: string
  /** 未归类行为 true，操作列给「去补填」、置底 */
  unclassified: boolean
  appName: string
  appCode: string
  /** 业务域编码（多数归因，决策 92/93/95；空值时业务域列显示 '-'） */
  bizCode: string
  /** 业务域展示名：业务字典解析，空时回落 bizCode */
  bizName: string
  resourceCount: number
  monitoredCount: number
}

interface AppDetailTableProps {
  byApp: AppSummary[]
  unclassifiedResourceCount: number
  unclassifiedMonitoredCount: number
}

const UNCLASSIFIED_KEY = '__unclassified__'

/** 覆盖率窄进度条（约 52px）：<70% 用橙色语义（颜色不作为唯一语义，右侧仍有百分数） */
function CoverageBar({ percent }: { percent: number | null }) {
  const { token } = theme.useToken()
  const value = percent ?? 0
  const warn = percent !== null && percent < SUBTYPE_COVERAGE_WARN_THRESHOLD
  return (
    <span
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        display: 'inline-block',
        width: 52,
        height: 6,
        borderRadius: 3,
        background: token.colorFillSecondary,
        overflow: 'hidden',
        verticalAlign: 'middle',
      }}
    >
      <span
        style={{
          display: 'block',
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: '100%',
          borderRadius: 3,
          background: percent === null ? 'transparent' : warn ? token.colorWarning : token.colorPrimary,
        }}
      />
    </span>
  )
}

export function AppDetailTable({
  byApp,
  unclassifiedResourceCount,
  unclassifiedMonitoredCount,
}: AppDetailTableProps) {
  const rows: AppRow[] = byApp.map((a) => ({
    key: a.app_code,
    unclassified: false,
    appName: a.app_name || a.app_code,
    appCode: a.app_code,
    // by_app biz 维度为多数归因（决策 92/93/95）；biz_name 为空时回落 biz_code，仍空则 ''
    bizCode: a.biz_code ?? '',
    bizName: a.biz_name || (a.biz_code ?? ''),
    resourceCount: a.resource_count,
    monitoredCount: a.monitored_count,
  }))

  if (unclassifiedResourceCount > 0) {
    rows.push({
      key: UNCLASSIFIED_KEY,
      unclassified: true,
      appName: '未归类应用',
      appCode: '',
      bizCode: '',
      bizName: '',
      resourceCount: unclassifiedResourceCount,
      monitoredCount: unclassifiedMonitoredCount,
    })
  }

  // 覆盖率升序（缺口最大的排最前）；同覆盖率按实例数降序；未归类行恒置底。
  const sorted = [...rows].sort((a, b) => {
    if (a.unclassified !== b.unclassified) return a.unclassified ? 1 : -1
    const pa = coveragePercent(a.monitoredCount, a.resourceCount)
    const pb = coveragePercent(b.monitoredCount, b.resourceCount)
    // 覆盖率为 null（无资源）视为最差，排最前
    const va = pa === null ? -1 : pa
    const vb = pb === null ? -1 : pb
    if (va !== vb) return va - vb
    return b.resourceCount - a.resourceCount
  })

  const columns: ColumnsType<AppRow> = [
    {
      title: '应用名称',
      dataIndex: 'appName',
      key: 'appName',
      render: (value: string, row) =>
        row.unclassified ? (
          <Typography.Text type="secondary">{value}</Typography.Text>
        ) : (
          <span>
            <Typography.Text>{value}</Typography.Text>
            {/* app_code 内联在应用名称后，作应用简称（次要小字） */}
            {row.appCode && (
              <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                {row.appCode}
              </Typography.Text>
            )}
          </span>
        ),
    },
    {
      // by_app biz 维度为多数归因（决策 92/93/95）；空值显示 '-'
      title: '业务域',
      key: 'bizDomain',
      render: (_, row) =>
        row.bizName ? (
          <Typography.Text>{row.bizName}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    { title: '实例', dataIndex: 'resourceCount', key: 'resourceCount', align: 'right' },
    { title: '已采', dataIndex: 'monitoredCount', key: 'monitoredCount', align: 'right' },
    {
      title: '覆盖率',
      key: 'coverage',
      render: (_, row) => {
        if (row.unclassified) {
          return <Typography.Text type="secondary">-</Typography.Text>
        }
        const pct = coveragePercent(row.monitoredCount, row.resourceCount)
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CoverageBar percent={pct} />
            <Typography.Text
              type={pct !== null && pct < SUBTYPE_COVERAGE_WARN_THRESHOLD ? 'danger' : 'secondary'}
            >
              {coverageText(row.monitoredCount, row.resourceCount)}
            </Typography.Text>
          </span>
        )
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_, row) =>
        row.unclassified ? (
          <Link to={RESOURCE_IMPORT_HREF}>去补填</Link>
        ) : (
          <Link to={appResourceListHref(row.appCode)}>看明细</Link>
        ),
    },
  ]

  return (
    <SurfaceCard title="应用覆盖" data-testid="l2-app-table">
      {sorted.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              暂无资源，
              <Link to={RESOURCE_IMPORT_HREF}>去导入资源 →</Link>
            </span>
          }
        />
      ) : (
        <Table
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={sorted}
          pagination={false}
          scroll={TABLE_SCROLL_X}
        />
      )}
    </SurfaceCard>
  )
}

export default AppDetailTable