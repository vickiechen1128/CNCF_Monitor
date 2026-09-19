/**
 * L3 拨测态势面板（Module_05 §3.1 决策 93 / PRD v1.8）。
 *
 * 整宽卡片：标题「拨测态势」+ extra 显示「拨测目标 N · 正常 X · 异常 Y」+
 * 「异常排前 · 同状态按最近拨测倒序」+「拨测任务管理 →」深链 /strategy。
 *
 * 数据源：**受控组件**，由 HomePage 注入 `probeTargets`（后端 `summary.probe_targets[]`，
 * 决策 93 明细口径）。前端负责排序 / 分页（PRD §5.1：接口不承担排序）。
 * 列：拨测目标（url，ellipsis）/ 状态（异常红 / 正常绿 / **MVP 未知态中性色**）/ 业务域(
 * biz_name，空显 -)/ 应用（app_name，空显 -）/ 最近拨测（相对时间，空显 -）。
 * 分页每页 5 行，仅数据超过 5 行时显示分页器。空数据 / 字段缺失显示空态并给去配置深链。
 *
 * 字段降级（决策 93 口径，诚实展示）：
 * - url 缺失 → '-'；
 * - status 空串（后端 MVP 恒未知）→ 中性「未知」态，不渲染成 up/down 绿红；
 * - biz_name / app_name 空串 → '-'；
 * - last_probe_at 缺失（后端 nil）→ '最近拨测' 显示 '-'。
 * 排序：只有明确的 down 强制排最前；未知态不强制排前，同未知态按原序（稳定排序）。
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Badge, Table, Tooltip, Typography, theme } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { formatRelativeTime } from '../config-center/configCenterConstants'
import type { ProbeTargetItem } from '../../api/dashboard'
import { SurfaceCard } from './SurfaceCard'

/** 拨测目标分页每页行数（对齐告警列表节奏，决策 89 / 93） */
const PROBE_PAGE_SIZE = 5

/** 拨测目标深链（配置拨测任务 / 任务管理） */
const PROBE_STRATEGY_HREF = '/strategy'

/**
 * 排序时间戳：缺失 / 非法计最小安全值（排到同组末位），避免 `dayjs(undefined)` 视作
 * 「当前时间」把无时间条目顶到最前、或 NaN 比较器导致顺序不定。
 */
function probeTime(iso?: string): number {
  if (!iso) return Number.MIN_SAFE_INTEGER
  const d = dayjs(iso)
  return d.isValid() ? d.valueOf() : Number.MIN_SAFE_INTEGER
}

/** 拨测目标排序：只有明确的 down 强制固定排最前；其余按最近拨测倒序（未知态不强制前置，
 *  同未知态（空时间）由于比较器相等走稳定排序 → 保持原序，决策 93）。 */
function sortProbeTargets(targets: ProbeTargetItem[]): ProbeTargetItem[] {
  return [...targets].sort((a, b) => {
    const aDown = a.status === 'down'
    const bDown = b.status === 'down'
    if (aDown !== bDown) return aDown ? -1 : 1
    return probeTime(b.last_probe_at) - probeTime(a.last_probe_at)
  })
}

/** 状态语义色：异常红 / 正常绿 / 未知中性（不渲染绿红，决策 93 MVP 未知）。 */
function statusBadge(status: string, token: ReturnType<typeof theme.useToken>['token']): ReactNode {
  if (status === 'down') {
    return <Badge status="error" text={<span style={{ color: token.colorErrorText }}>异常</span>} />
  }
  if (status === 'up') {
    return <Badge status="success" text={<span style={{ color: token.colorTextSecondary }}>正常</span>} />
  }
  return <Badge status="default" text={<span style={{ color: token.colorTextSecondary }}>未知</span>} />
}

export function ProbePanel({ probeTargets = [] }: { probeTargets?: ProbeTargetItem[] }) {
  const { token } = theme.useToken()

  const sorted = useMemo(() => sortProbeTargets(probeTargets), [probeTargets])
  const normalCount = sorted.filter((t) => t.status === 'up').length
  const abnormalCount = sorted.filter((t) => t.status === 'down').length

  const columns: ColumnsType<ProbeTargetItem> = [
    {
      title: '拨测目标',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url: string) =>
        url ? (
          <Tooltip title={url}>
            <span style={{ color: token.colorText }}>{url}</span>
          </Tooltip>
        ) : (
          <span style={{ color: token.colorTextTertiary }}>-</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => statusBadge(status, token),
    },
    {
      title: '业务域',
      dataIndex: 'biz_name',
      key: 'biz_name',
      width: 120,
      render: (name?: string) =>
        name ? (
          <span style={{ color: token.colorText }}>{name}</span>
        ) : (
          <span style={{ color: token.colorTextTertiary }}>-</span>
        ),
    },
    {
      title: '应用',
      dataIndex: 'app_name',
      key: 'app_name',
      width: 120,
      render: (name?: string) =>
        name ? (
          <span style={{ color: token.colorText }}>{name}</span>
        ) : (
          <span style={{ color: token.colorTextTertiary }}>-</span>
        ),
    },
    {
      title: '最近拨测',
      dataIndex: 'last_probe_at',
      key: 'last_probe_at',
      width: 110,
      render: (raw?: string) => (
        <span style={{ color: token.colorTextTertiary, fontVariantNumeric: 'tabular-nums' }}>
          {raw ? formatRelativeTime(raw) : '-'}
        </span>
      ),
    },
  ]

  if (sorted.length === 0) {
    return (
      <SurfaceCard title="拨测态势" data-testid="probe-panel">
        <div
          style={{
            padding: '28px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
          data-testid="probe-empty"
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: token.colorText }}>暂无拨测目标</div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            拨测由 blackbox 采集 Job 承载，不录入资源台账：先创建拨测采集任务并登记目标。
          </Typography.Text>
          <Link to={PROBE_STRATEGY_HREF}>去配置拨测任务 →</Link>
        </div>
      </SurfaceCard>
    )
  }

  return (
    <SurfaceCard
      title="拨测态势"
      data-testid="probe-panel"
      extra={
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
          <Typography.Text type="secondary">
            拨测目标 {sorted.length} · 正常 {normalCount} ·{' '}
            <span style={{ color: abnormalCount > 0 ? token.colorErrorText : token.colorTextTertiary }}>
              异常 {abnormalCount}
            </span>
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            异常排前 · 同状态按最近拨测倒序
          </Typography.Text>
          <Link to={PROBE_STRATEGY_HREF}>拨测任务管理 →</Link>
        </span>
      }
      styles={{ body: { paddingTop: 8, paddingBottom: 8 } }}
    >
      <Table
        data-testid="probe-table"
        rowKey="url"
        size="small"
        columns={columns}
        dataSource={sorted}
        pagination={{ pageSize: PROBE_PAGE_SIZE, showSizeChanger: false, hideOnSinglePage: true }}
        rowClassName={(row) => (row.status === 'down' ? 'probe-row-down' : '')}
      />
    </SurfaceCard>
  )
}

export default ProbePanel