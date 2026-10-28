/**
 * 首页告警治理态大卡片（Module_05 §3.1 决策 72 / 72-3 / 73 首页视觉密度与告警卡重构）。
 *
 * 受控展示型组件：数据由 HomePage 的 useAlertGovernance 单次请求持有，
 * 本组件不再自行取数（避免与首页指标卡重复请求同一接口），只负责渲染：
 *   四格历史指标（今日告警 / 今日恢复 / 历史遗留告警 / 历史遗留今日恢复）
 *   → 正在告警（近 8 条两行制，行 2 携带告警具体内容）。
 *
 * 版式（design-proposal §2.3，2026-10-17 定稿）：卡体**两栏**——左统计块（220px 固定，
 * 四格**纵排**）/ 右列表（正在告警，flex:1）。整宽单列下四格被拉通全宽
 * （每格过疏）、告警行宽过长把两行制文案拉薄，故改为两栏；**第五轮走查（方案 A）起与
 * 「采集健康」按 2:1 并排**（不再是独立整宽卡，见 HomePage 的 home-alert-health-row），
 * 2/3 宽度（桌面约 776px+）下两栏结构原样保留。
 * **第六轮走查（2026-10-17）**：改与「监控对象纳管进度」**对分**一行，统计块由 280px
 * 收窄为 **220px**（产品负责人走查：原列宽在 ≈568px 的半幅卡里过宽，压缩后右栏列表
 * 更透气）；「配置告警通知」深链按产品负责人要求**移除**
 * （通知配置入口收敛到告警状态页 / 使用指引）。
 * 窄屏（≤767px）左栏统计条维持 **2×2** 并与右栏**上下堆叠**。
 *
 * 版式（用户 2026-09-18 三次修订，最终「方案乙」）：
 * - 卡片**允许被所在行拉伸**（`height:100%` + 卡内纵向 flex + 左统计块参考行
 *   `margin-top:auto`）：与「监控对象纳管进度」对分时两卡等高（align-items: stretch），
 *   告警卡撑满行高，残余落差由左栏参考行 margin-top:auto 吸收、沉在统计块底部
 *   （落在白底上，不悬在卡片中段）（旧布局「双列区 min-height 420px 兜底」随独立整宽
 *   形态一同废止，本行不再需要）；
 * - 列表为**固定分页约束**：每页最多 homeLayout.ALERT_PAGE_SIZE（5）行，超出才出现分页器，
 *   与视口高度彻底解耦（二版按实测高度反推行数，版式随分辨率漂移，已废弃）；
 * - 数据池仍为「最新 8 条」（决策 73），因此满池时是「5 行 + 第 2 页 3 行」。
 * 「查看全部 →」指向 /alert-status 兜底；卡内不再重复「查看告警中心」入口（用户反馈 2026-09-14）。
 *
 * 口径（M08 历史告警统计 /alert-events/stats + M08 通知状态 + M02 /api/v1/alerts）：
 * - 四格 = 今日告警 / 今日恢复 / 历史遗留告警 / 历史遗留今日恢复，任何数据状态下都保留；
 * - 历史遗留告警 = 今天 0 点前触发，且当前未关闭或今天关闭；历史遗留今日恢复是其中今天关闭的子集；
 * - 今日恢复 / 历史遗留今日恢复悬浮提示拆分为「真实恢复 + 恢复时间未知」；
 * - 右栏只展示 AM `notify_status=active` 的通知中告警，不展示静默、抑制、待处理及其汇总；
 * - 无通知中告警时右栏仅显示「当前无通知中的告警」，不影响左侧四格。
 *
 * 权威设计：docs/02-product-requirements/Modules/Module_05_Custom_UI.md §3.1 / §5.2、
 * docs/05-execution-records/module-05/design-decisions.md「决策 73」。
 */
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Alert, Button, Empty, List, Pagination, Spin, Tag, Tooltip, Typography, theme } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { useSkin } from '../../skinContext'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'
import type { AmAlertItem } from '../../types/alertmanager'
import { formatLocalTime, formatRelativeTime } from '../config-center/configCenterConstants'
import {
  alertMatchKey,
  notifyStatusLabel,
  severityBg,
  severityLabel,
  severityText,
  severityTone,
} from '../alerts/alertmanagerConstants'
import { computeAlertPageSize } from './homeLayout'
import { useNarrowLayout } from './homeResponsive'
import { SurfaceCard } from './SurfaceCard'

export interface AlertCounts {
  /** 今日告警：今天 0 点后开始触发的告警条数（严格按开始时间，不含昨天开始今天仍在持续的） */
  todayTotal: number
  /** 今日恢复：今天触发且今天关闭的终态条数（真实恢复 + 恢复时间未知） */
  todayResolvedTotal: number
  todayResolvedReal: number
  todayResolvedInferred: number
  /** 历史遗留告警：今天 0 点前触发，且当前未关闭或今天关闭 */
  legacyOpenTotal: number
  /** 历史遗留今日恢复：开始时间早于今天 0 点、且今天关闭 */
  legacyResolvedTodayTotal: number
  legacyResolvedTodayReal: number
  legacyResolvedTodayInferred: number
  /** AM 通知中数量：不进入四格统计，仅用于卡片边框状态 */
  active: number
}

/**
 * 首页告警卡「正在告警」展示条数（决策 73 §3）：
 * 由 10 条单行改为 8 条两行制（单条信息量翻倍，总信息量不降，「查看全部 →」兜底）。
 * 由 HomePage 取数时按此上限截断，本组件用它渲染标题（两边不得各写一份数字）。
 */
export const LATEST_ALERT_LIMIT = 8

/**
 * 正在告警列表标题：数据来自 Alertmanager 通知中告警，按开始时间倒序取前 8 条。
 */
export const LATEST_ALERT_TITLE = '正在告警'

interface AlertStatusCardProps {
  counts: AlertCounts
  /** 通知中告警（HomePage 已过滤 active、按 starts_at 倒序取前 LATEST_ALERT_LIMIT 条） */
  latestAlerts: AmAlertItem[]
  /** 行 2 告警具体内容回查表（key 由 alertMatchKey 生成；M02 history summary 优先） */
  summaryByAlert?: Record<string, string>
  loading?: boolean
  /** Alertmanager 通知链路错误（M08 /alertmanager/alerts） */
  amError?: string | null
  /**
   * 历史告警统计链路错误（GET /alert-events/stats）。
   * 局部降级：四格统计统一显示 '-'，不阻塞 AM 正在告警列表展示，
   * 也不并入「告警状态加载失败」判定（避免一条统计链路把整卡打成错误态）。
   */
  statsError?: string | null
  onRetry?: () => void
  /** 静态预览环境（无后端）：数据来自注入的 mock，不提供重试动作 */
  isStaticPreview?: boolean
}

interface StatCell {
  key: string
  testId: string
  value: string | number
  label: string
  tip: string
  /** 数字色：今日告警/遗留今日恢复用基础文字色，今日恢复用成功绿，历史遗留用告警红 */
  color: string
}

/**
 * 告警状态四格统计条（2026-10-26 指标替换）：
 * 今日告警 / 今日恢复 / 历史遗留告警 / 历史遗留今日恢复，格间竖分隔线，每格悬浮显示口径注释。
 *
 * 两种排布（design-proposal §2.3，四格语义 / 取值 / Tooltip / 降级口径三种排布完全一致，
 * 只有几何形态不同）：
 * - `vertical`：宽屏两栏布局的**左栏统计块**——四格纵排（标签左、数字右，行间细分隔线）；
 * - `compact`：窄屏（≤767px）**2×2 两行两格**——「历史遗留今日恢复」等长标签在窄屏一行四格下
 *   （每格约 75px）必然溢出到相邻格，故仅在此断点换行；分隔线按列位置重排（第 2、4 格带左分隔线）；
 * - 默认：一行四格（横向变体，保留给仍按整宽呈现的场景）。
 */
export function AlertStatStrip({
  counts,
  statsUnavailable,
  compact = false,
  vertical = false,
}: {
  counts: AlertCounts
  /** 统计接口取数失败：四格统一显示 '-'，不把失败静默成 0 */
  statsUnavailable: boolean
  /** 窄屏两行两格布局（见本组件头注释） */
  compact?: boolean
  /** 纵排变体：四格上下排列（宽屏两栏布局的左统计块） */
  vertical?: boolean
}) {
  const { token } = theme.useToken()

  const cells: StatCell[] = [
    {
      key: 'today',
      testId: 'alert-today-count',
      value: statsUnavailable ? '-' : counts.todayTotal,
      label: '今日告警',
      tip: '今天 0 点后开始触发的告警条数（严格按开始时间；昨天开始今天仍在持续的不计入，见「历史遗留告警」）',
      color: token.colorText,
    },
    {
      key: 'resolved',
      testId: 'alert-today-resolved-count',
      value: statsUnavailable ? '-' : counts.todayResolvedTotal,
      label: '今日告警今日恢复',
      tip: statsUnavailable
        ? '今天触发且今天结束的告警条数（真实恢复 + 恢复时间未知）'
        : `今天触发且今天结束的告警条数：真实恢复 ${counts.todayResolvedReal} 条 + 恢复时间未知 ${counts.todayResolvedInferred} 条`,
      color: token.colorSuccess,
    },
    {
      key: 'legacy',
      testId: 'alert-legacy-open-count',
      value: statsUnavailable ? '-' : counts.legacyOpenTotal,
      label: '历史遗留告警',
      tip: '今天 0 点前触发，且当前仍未关闭或今天关闭的告警条数（今天 0 点时的历史遗留量）',
      color: token.colorError,
    },
    {
      key: 'legacyResolved',
      testId: 'alert-legacy-resolved-count',
      value: statsUnavailable ? '-' : counts.legacyResolvedTodayTotal,
      label: '历史遗留今日恢复',
      tip: statsUnavailable
        ? '今天结束、且开始时间早于今天 0 点的告警条数'
        : `今天结束、且开始时间早于今天 0 点：真实恢复 ${counts.legacyResolvedTodayReal} 条 + 恢复时间未知 ${counts.legacyResolvedTodayInferred} 条`,
      color: token.colorText,
    },
  ]

  // 数字样式三种排布共用（primary 级 20px/600/等宽数字，仅色值按格语义变化）。
  // 2026-10-17 第七轮走查（产品负责人选定「标准档」）：24px/700 → **20px/600**——
  // 首页只留两个 24px 圆环作 hero，告警四格降到主数字档，层级变成「环 → 告警 → 计数」；
  // 24px 的 700 在大屏上偏粗黑，数字统一 600 后两卡并排时笔画粗细一致。
  const valueStyle: CSSProperties = {
    fontSize: HOME_FONT.primary,
    fontWeight: HOME_WEIGHT.number,
    lineHeight: 1.2,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  }

  // 纵排变体（宽屏两栏布局的左统计块）：四格上下排列，标签在左、数字右对齐，行间细分隔线。
  // 2026-10-17 第六轮走查：条与四格都 flex:1 —— 统计块被行拉伸时四格**分摊卡高、不留白**
  // （产品负责人：「这一列撑满高度，不要留白」）；内容在格内纵向居中。
  if (vertical) {
    return (
      <div
        data-testid="alert-stat-strip"
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      >
        {cells.map((cell, index) => (
          <Tooltip key={cell.key} title={cell.tip}>
            <div
              data-testid={`alert-stat-cell-${cell.key}`}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                minHeight: 0,
                padding: '6px 0',
                borderBottom:
                  index === cells.length - 1
                    ? 'none'
                    : `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <span
                style={{
                  fontSize: HOME_FONT.label,
                  fontWeight: HOME_WEIGHT.label,
                  color: token.colorTextSecondary,
                  minWidth: 0,
                }}
              >
                {cell.label}
              </span>
              <span data-testid={cell.testId} style={{ ...valueStyle, color: cell.color }}>
                {cell.value}
              </span>
            </div>
          </Tooltip>
        ))}
      </div>
    )
  }

  return (
    <div
      data-testid="alert-stat-strip"
      style={{
        display: 'flex',
        flexWrap: compact ? 'wrap' : undefined,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        padding: '8px 0 7px',
      }}
    >
      {cells.map((cell, index) => {
        // 窄屏 2×2：右列（奇数下标）带左分隔线、下排（下标 ≥2）加行距；宽屏维持一行四格原逻辑
        const cellStyle = compact
          ? {
              flex: '0 0 50%',
              minWidth: 0,
              marginTop: index >= 2 ? 8 : undefined,
              padding: index % 2 === 1 ? '0 0 0 12px' : '0 12px 0 0',
              borderLeft: index % 2 === 1 ? `1px solid ${token.colorBorderSecondary}` : undefined,
            }
          : {
              flex: 1,
              minWidth: 0,
              padding: index === 0 ? '0 12px 0 0' : '0 12px',
              borderLeft: index === 0 ? undefined : `1px solid ${token.colorBorderSecondary}`,
            }
        return (
          <Tooltip key={cell.key} title={cell.tip}>
            <div style={cellStyle}>
              <div
                data-testid={cell.testId}
                style={{
                  ...valueStyle,
                  color: cell.color,
                }}
              >
                {cell.value}
              </div>
              <div
                style={{
                  fontSize: HOME_FONT.body,
                  fontWeight: HOME_WEIGHT.label,
                  color: token.colorTextSecondary,
                  marginTop: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                {cell.label}
              </div>
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}

/** 合法 ISO 时间才交给共享格式化函数；非法值返回 undefined 由调用方回落 '-'（避免机器格式串进界面） */
function safeTime(iso?: string): string | undefined {
  if (!iso || Number.isNaN(Date.parse(iso))) return undefined
  return iso
}

/**
 * 正在告警两行制行（决策 73 §3）：
 * 行 1 = 级别浅底 Tag + 告警名 + 相对时间 + 状态；行 2 = 实例名 · 告警具体内容（12px 灰字）。
 * 两行均超长省略并悬浮全文；行间细分隔线（末行不加）。
 */
export function AlertRow({
  item,
  index,
  isLast,
  summary,
}: {
  item: AmAlertItem
  index: number
  isLast: boolean
  /** 告警具体内容（history summary 优先，AM annotations.summary 兜底；为空则行 2 只显示实例名） */
  summary?: string
}) {
  const { token } = theme.useToken()
  // 级别 Tag 的浅底 / 深字取自皮肤 token（随皮肤切换）；antd 的 token 取不到
  // colorErrorBg 这类需要逐字保真的语义浅底，故走 useSkin。
  const { tokens: skinTokens } = useSkin()
  const alertname = item.labels?.alertname || '-'
  // 决策 70：实例名只认 resource_name，缺失显示 '-'，不回落成采集地址（instance_address）
  const instanceName = item.resource_name?.trim() ? item.resource_name : '-'
  const relativeTime = formatRelativeTime(safeTime(item.starts_at)) || '-'
  const statusLabel =
    (notifyStatusLabel as Record<string, string>)[item.notify_status] ?? item.notify_status
  const tone = severityTone(item.labels?.severity)
  const content = summary?.trim() ? summary.trim() : ''
  const secondLine = content ? `${instanceName} · ${content}` : instanceName

  const ellipsis: CSSProperties = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  }

  return (
    <List.Item
      data-testid={`latest-alert-${index}`}
      style={{
        padding: '6px 0',
        borderBottom: isLast ? 'none' : `0.5px solid ${token.colorSplit}`,
      }}
    >
      <div style={{ width: '100%', minWidth: 0 }}>
        <div
          data-testid={`latest-alert-${index}-line1`}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {/* 级别 Tag：浅底 + 深字（决策 73；未命中色调回落 antd 中性 Tag，不猜语义） */}
          <Tag
            data-testid={`latest-alert-${index}-severity`}
            data-severity-tone={tone ?? 'default'}
            style={{
              marginInlineEnd: 0,
              flexShrink: 0,
              border: 'none',
              ...(tone
                ? {
                    background: severityBg(tone, skinTokens),
                    color: severityText(tone, skinTokens),
                  }
                : undefined),
            }}
          >
            {/* 复用共享字典的级别展示名，与 Tag 色调保持同一套同义归并 */}
            {severityLabel(item.labels?.severity)}
          </Tag>
          <Tooltip title={alertname}>
            <span
              style={{
                flex: 1,
                fontSize: HOME_FONT.label,
                fontWeight: HOME_WEIGHT.label,
                color: token.colorText,
                ...ellipsis,
              }}
            >
              {alertname}
            </span>
          </Tooltip>
          <Tooltip title={formatLocalTime(safeTime(item.starts_at))}>
            <span
              style={{
                flexShrink: 0,
                fontSize: HOME_FONT.body,
                color: token.colorTextTertiary,
                textAlign: 'right',
              }}
            >
              {relativeTime}
            </span>
          </Tooltip>
          <span
            style={{
              flexShrink: 0,
              width: 48,
              fontSize: HOME_FONT.body,
              color: token.colorTextSecondary,
              textAlign: 'right',
            }}
          >
            {statusLabel}
          </span>
        </div>
        <Tooltip title={secondLine}>
          <div
            data-testid={`latest-alert-${index}-line2`}
            style={{
              marginTop: 2,
              fontSize: HOME_FONT.body,
              lineHeight: '17px',
              color: token.colorTextTertiary,
              ...ellipsis,
            }}
          >
            {secondLine}
          </div>
        </Tooltip>
      </div>
    </List.Item>
  )
}

export function AlertStatusCard({
  counts,
  latestAlerts,
  summaryByAlert,
  loading = false,
  amError = null,
  statsError = null,
  onRetry,
  isStaticPreview = false,
}: AlertStatusCardProps) {
  const { token } = theme.useToken()
  // 窄屏（≤767px）版式开关：四格统计条由一行四格改为 2×2（见 AlertStatStrip 头注释）
  const narrow = useNarrowLayout()
  // 首页告警卡只剩两条主链路：AM 正在告警列表 + 历史四指标统计。
  // 两条都失败才整卡报错；单条失败进入部分降级，另一条仍展示。
  const allFailed = !loading && amError !== null && statsError !== null
  const partialError = !loading && !allFailed && (amError !== null || statsError !== null)
  const errorText = [amError, statsError].filter(Boolean).join('；')

  /**
   * 固定分页约束（用户 2026-09-18 二次反馈）：每页行数由常量 ALERT_PAGE_SIZE 决定，
   * 与窗口高度、分辨率无关——同一份数据在任何电脑上都渲染成同一版式。
   * 数据池仍是「最新 8 条」（决策 73）：池子 ≤ 上限时单页展示、分页器不出现。
   */
  const [page, setPage] = useState(1)
  const pageSize = computeAlertPageSize(latestAlerts.length)
  const pageCount = Math.max(1, Math.ceil(latestAlerts.length / pageSize))
  // 数据刷新（条数变少）后停在越界页会渲染空列表，直接夹取到最后一页，不引入额外 effect
  const currentPage = Math.min(page, pageCount)
  const pageOffset = (currentPage - 1) * pageSize
  const visibleAlerts = latestAlerts.slice(pageOffset, pageOffset + pageSize)

  // 卡片左边框仅表示是否存在告警数据，不再用整卡空态替换四格指标。
  const isEmpty =
    counts.todayTotal +
      counts.todayResolvedTotal +
      counts.legacyOpenTotal +
      counts.legacyResolvedTodayTotal +
      counts.active ===
    0
  const statsUnavailable = !loading && statsError !== null

  const retryAction = onRetry ? (
    <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
      重试
    </Button>
  ) : null

  // 按数据源降级：该源取数失败时数字显示 '-'，不把失败静默成 0 让用户误当作真实值
  // （决策 68-2：AM 未挂载时数字恒为 0，必须与「请求失败」区分）。
  const amUnavailable = !loading && amError !== null

  return (
    <SurfaceCard
      data-testid="alert-status-card"
      title="告警状态"
      /* 卡内只展示近 8 条，完整列表在 /alert-status（决策 73 §3「查看全部 →」兜底） */
      extra={
        <Link to="/alert-status" style={{ fontSize: HOME_FONT.label }}>
          查看全部 →
        </Link>
      }
      /* 高度：由内容决定，但**允许被所在行拉伸**（第五轮起与采集健康并排，行内
         align-items: stretch）——告警卡撑满行高，残余落差由页脚 margin-top:auto
         吸收，落在「正在告警列表」下方（白底），而不是让两卡底边参差。 */
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `3px solid ${isEmpty ? token.colorBorder : token.colorError}`,
      }}
      styles={{ body: { padding: 20, flex: 1, display: 'flex', flexDirection: 'column' } }}
    >
      {loading && <Spin />}

      {!loading && allFailed && (
        <Alert
          message="告警状态加载失败"
          description={errorText}
          type="error"
          showIcon
          action={retryAction}
        />
      )}

      {!loading && !allFailed && (
        <>
          {partialError && (
            <Alert
              message="部分告警数据加载失败"
              description={errorText}
              type="warning"
              showIcon
              action={isStaticPreview ? null : retryAction}
              style={{ marginBottom: 12 }}
            />
          )}

          {/* 四格指标始终展示；右栏只展示通知中告警及其空态。
              窄屏（≤767px）：统计块维持 2×2，与列表上下堆叠。 */}
          <div
              data-testid="alert-card-columns"
              style={{
                display: 'flex',
                flexDirection: narrow ? 'column' : 'row',
                gap: narrow ? 12 : 24,
                flex: 1,
                minWidth: 0,
              }}
            >
              <div
                data-testid="alert-stat-column"
                style={{
                  flex: narrow ? 'none' : '0 0 220px',
                  width: narrow ? undefined : 220,
                  minWidth: 0,
                  // 纵向 flex：四格 flex:1 分摊卡高，统计块被行拉伸时不留白。
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {/* 四格统计条：今日告警 / 今日恢复 / 历史遗留告警 / 历史遗留今日恢复 */}
                <AlertStatStrip
                  counts={counts}
                  statsUnavailable={statsUnavailable}
                  compact={narrow}
                  vertical={!narrow}
                />

              </div>

              <div
                data-testid="alert-list-column"
                style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}
              >
                <div
                  data-testid="latest-alert-region"
                  style={{ marginTop: narrow ? 4 : 0, marginBottom: 10 }}
                >
                  <Typography.Text
                    strong
                    style={{
                      display: 'block',
                      fontSize: HOME_FONT.label,
                      fontWeight: HOME_WEIGHT.title,
                      marginBottom: 2,
                    }}
                  >
                    {LATEST_ALERT_TITLE}
                  </Typography.Text>
                  {amUnavailable ? (
                    <Typography.Text
                      type="secondary"
                      data-testid="latest-alert-unavailable"
                      style={{ display: 'block', marginTop: 8, fontSize: HOME_FONT.body }}
                    >
                      取数失败，暂无法展示正在告警
                    </Typography.Text>
                  ) : latestAlerts.length === 0 ? (
                    <div data-testid="latest-alert-empty">
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="当前无通知中的告警"
                        style={{ margin: '12px 0' }}
                      />
                    </div>
                  ) : (
                    /* 固定分页：每页最多 ALERT_PAGE_SIZE 行，列表高度随行数自然增减，
                       不再测量高度、不再 overflow 兜底（页面按内容滚动，见 HomePage） */
                    <div>
                      <List
                        size="small"
                        split={false}
                        data-testid="latest-alert-list"
                        dataSource={visibleAlerts}
                        renderItem={(item, index) => (
                          <AlertRow
                            item={item}
                            /* 测试 id 用数据池内的全局序号（翻页后不重复、不重置） */
                            index={pageOffset + index}
                            isLast={index === visibleAlerts.length - 1}
                            /* 行 2 告警具体内容：M02 history summary 优先，AM annotations.summary 兜底 */
                            summary={
                              summaryByAlert?.[
                                alertMatchKey(item.labels?.alertname, item.labels?.instance)
                              ] ?? item.annotations?.summary
                            }
                          />
                        )}
                      />
                      {/* 分页器仅在池子超过单页上限时出现（少量告警时保持单页观感） */}
                      {pageCount > 1 && (
                        <div
                          data-testid="latest-alert-pager"
                          style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}
                        >
                          <Pagination
                            size="small"
                            showSizeChanger={false}
                            current={currentPage}
                            pageSize={pageSize}
                            total={latestAlerts.length}
                            onChange={setPage}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 列表区即卡体结尾：右栏无页脚；「配置告警通知」深链按产品负责人要求
                    移除（通知配置入口收敛到告警状态页与首页使用指引）。 */}
              </div>
          </div>
        </>
      )}
    </SurfaceCard>
  )
}

export default AlertStatusCard
