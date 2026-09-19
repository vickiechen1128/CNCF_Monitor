/**
 * L2 应用明细表（Module_05 §3.1 决策 91 / PRD v1.7）。
 *
 * 列：应用名称 / 应用简称 / 业务域 / 实例 / 已采 / 覆盖率 / 未恢复 + 操作。
 * 数据源 `dashboard.by_app`（`app_code` 非空的资源按应用聚合）：
 * - `应用名称` = `app_name`（应用字典展示名，主）；`应用简称` = `app_code`（不可变编码）；
 * - **按覆盖率升序**排列（缺口最大的应用排最前），覆盖率相同按实例数降序，
 *   使「先补谁」一眼可见；
 * - `未归类应用` 行**置底**：`app_code` 为空的资源聚合（`unclassified_resource_count` /
 *   `unclassified_monitored_count`），操作为「去补填」引导补录应用归属。
 *
 * 未恢复数：取 `/api/v1/alerts` 中 `firing` 且标签 `app === app_code` 的条数
 * （`app` 标签由 M07 默认模板注入、恒取 `app_code`，见决策 92），前端分组、后端零改动。
 */
import { Empty, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link } from 'react-router-dom'
import type { AppSummary } from '../../api/dashboard'
import type { PromAlertItem } from '../../types/alertmanager'
import { TABLE_SCROLL_X } from '../../components/tablePresets'
import { SurfaceCard } from './SurfaceCard'
import {
  appResourceListHref,
  coveragePercent,
  coverageText,
  firingCountByApp,
  RESOURCE_IMPORT_HREF,
} from './resourceTypeMeta'

/** 表格行（应用行 + 未归类行统一形状，便于排序与渲染） */
interface AppRow {
  key: string
  /** 未归类行为 true，操作列给「去补填」、置底 */
  unclassified: boolean
  appName: string
  appCode: string
  resourceCount: number
  monitoredCount: number
  alertCount: number | null
}

interface AppDetailTableProps {
  byApp: AppSummary[]
  unclassifiedResourceCount: number
  unclassifiedMonitoredCount: number
  alerts: PromAlertItem[]
}

const UNCLASSIFIED_KEY = '__unclassified__'

export function AppDetailTable({
  byApp,
  unclassifiedResourceCount,
  unclassifiedMonitoredCount,
  alerts,
}: AppDetailTableProps) {
  const rows: AppRow[] = byApp.map((a) => ({
    key: a.app_code,
    unclassified: false,
    appName: a.app_name || a.app_code,
    appCode: a.app_code,
    resourceCount: a.resource_count,
    monitoredCount: a.monitored_count,
    alertCount: firingCountByApp(alerts, a.app_code),
  }))

  if (unclassifiedResourceCount > 0) {
    rows.push({
      key: UNCLASSIFIED_KEY,
      unclassified: true,
      appName: '未归类应用',
      appCode: '-',
      resourceCount: unclassifiedResourceCount,
      monitoredCount: unclassifiedMonitoredCount,
      // 未归类资源无 app_code，无法按 `app` 标签归属告警 → 用 null 渲染 `-`（不臆造 0）
      alertCount: null,
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
          <Typography.Text>{value}</Typography.Text>
        ),
    },
    {
      title: '应用简称',
      dataIndex: 'appCode',
      key: 'appCode',
      render: (value: string) => <Typography.Text type="secondary">{value}</Typography.Text>,
    },
    {
      // `by_app` 暂无 biz_code（后端待补），此列恒为 `-`，不臆造业务归属
      title: '业务域',
      key: 'bizDomain',
      render: () => <Typography.Text type="secondary">-</Typography.Text>,
    },
    { title: '实例', dataIndex: 'resourceCount', key: 'resourceCount', align: 'right' },
    { title: '已采', dataIndex: 'monitoredCount', key: 'monitoredCount', align: 'right' },
    {
      title: '覆盖率',
      key: 'coverage',
      align: 'right',
      render: (_, row) => <span>{coverageText(row.monitoredCount, row.resourceCount)}</span>,
    },
    {
      title: '未恢复',
      key: 'alertCount',
      align: 'right',
      render: (_, row) =>
        row.alertCount === null || row.alertCount === 0 ? (
          <Typography.Text type="secondary">-</Typography.Text>
        ) : (
          <Tag color="error">{row.alertCount}</Tag>
        ),
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
    <SurfaceCard title="应用明细" data-testid="l2-app-table">
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
