/**
 * 首页告警治理态大卡片（Module_05 §3.1 决策 72 / 72-3 / 73 首页视觉密度与告警卡重构）。
 *
 * 受控展示型组件：数据由 HomePage 的 useAlertGovernance 单次请求持有，
 * 本组件不再自行取数（避免与首页指标卡重复请求同一接口），只负责渲染：
 *   四格统计条（当日 / 近 7 天为主数字，通知中 / 已静默·已抑制为次）
 *   → 最新告警（近 8 条两行制，行 2 携带告警具体内容）→ Prometheus 原始求值参考行 → 通知配置深链。
 *
 * 版式（用户 2026-09-18 三次修订，最终「方案乙」）：
 * - 卡片**允许被双列区拉伸**（`height:100%` + 卡内纵向 flex + 页脚 `margin-top:auto`）：
 *   两列等高时落差吸收到列表下方的白底，页脚始终贴卡底；告警极少时由双列区
 *   `min-height: 420px` 兜底，不会被压成窄卡（见 HomePage 双列区注释）；
 * - 列表为**固定分页约束**：每页最多 homeLayout.ALERT_PAGE_SIZE（5）行，超出才出现分页器，
 *   与视口高度彻底解耦（二版按实测高度反推行数，版式随分辨率漂移，已废弃）；
 * - 数据池仍为「最新 8 条」（决策 73），因此满池时是「5 行 + 第 2 页 3 行」。
 * 「查看全部 →」指向 /alert-status 兜底；卡内不再重复「查看告警中心」入口（用户反馈 2026-09-14）。
 *
 * 口径（M08 契约 §10.2 四态 + M02 /api/v1/alerts + M02 /api/v1/alerts/history）：
 * - 主数字 = 当日告警 / 近 7 天告警（M02 history 按 fired_at 前端计数，含已恢复，决策 73）；
 * - 次数字 = Alertmanager 治理态「通知中」（notify_status === 'active'，红色语义）与
 *   「已静默 · 已抑制」（合并一格，值串 '3 · 2'）；Prometheus firing / pending 属求值原始
 *   数据，仅作 11px 参考小字；
 * - AM `unprocessed` 不计数、不进列表（其治理闭环 MVP 未实现），仅在 N > 0 时以一行
 *   灰字提示「另有 N 条告警仍在计算通知状态」，避免「通知中 0」被误读为「真的没告警」；
 * - 空态判定覆盖 AM 四态 + Prom 两态 + 当日 / 近 7 天（history 有告警即不得引导
 *   「尚未挂载通知配置」），且 history 取数失败时判定未知、不误报空态。
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
  /** 当日告警：今日 0 点起触发过的告警条数（含已恢复；M02 history 按 fired_at 前端计数，决策 73） */
  today: number
  /** 近 7 天告警：fired_at ≥ now-7d 的告警条数（含已恢复，决策 73） */
  week: number
  active: number
  silenced: number
  inhibited: number
  /** AM 待处理：刚进入 Alertmanager，尚未完成路由 / 静默 / 抑制计算（契约 §10.2 四态之一） */
  unprocessed: number
  firing: number
  pending: number
}

/**
 * 首页告警卡「最新告警」展示条数（决策 73 §3）：
 * 由 10 条单行改为 8 条两行制（单条信息量翻倍，总信息量不降，「查看全部 →」兜底）。
 * 由 HomePage 取数时按此上限截断，本组件用它渲染标题（两边不得各写一份数字）。
 */
export const LATEST_ALERT_LIMIT = 8

/**
 * 最新告警列表条数上限与标题共用一份常量（标题「最新告警（近 N 条）」）。
 */
export const LATEST_ALERT_TITLE = `最新告警（近 ${LATEST_ALERT_LIMIT} 条）`

interface AlertStatusCardProps {
  counts: AlertCounts
  /** 最新告警（HomePage 已按 starts_at 倒序取前 LATEST_ALERT_LIMIT 条、并剔除 unprocessed） */
  latestAlerts: AmAlertItem[]
  /** 行 2 告警具体内容回查表（key 由 alertMatchKey 生成；M02 history summary 优先） */
  summaryByAlert?: Record<string, string>
  loading?: boolean
  /** Prometheus 告警链路错误（M02 /api/v1/alerts） */
  promError?: string | null
  /** Alertmanager 通知链路错误（M08 /alertmanager/alerts） */
  amError?: string | null
  /**
   * 历史告警链路错误（M02 /api/v1/alerts/history）。
   * 决策 73 局部降级：当日 / 近 7 天两格显示 '-'，不阻塞 AM / Prom 数据展示，
   * 也不并入「告警状态加载失败」判定（避免一条辅助链路把整卡打成错误态）。
   */
  historyError?: string | null
  onRetry?: () => void
  /** 静态预览环境（无后端）：数据来自注入的 mock，不提供重试动作 */
  isStaticPreview?: boolean
}

/**
 * Prometheus 求值态参考行文案。
 * 不复用 `promAlertStateLabel`：其 pending 展示名为「待处理」，与 AM `unprocessed` 撞名，
 * 会把已消除的歧义带回首页（§6.2 验收「页面不出现『待处理』字样」）。
 * M08 侧对 pending 的统一改名见设计说明 §8.2。
 */
const PROM_EVAL_LABEL = { firing: '触发中', pending: '求值中' } as const

interface StatCell {
  key: string
  testId: string
  value: string | number
  label: string
  tip: string
  /** 数字色：主数字用基础文字色，通知中用告警红，已静默·已抑制用次级文字色 */
  color: string
}

/**
 * 告警状态四格统计条（决策 73 §2）：
 * 当日告警 / 近 7 天告警为主数字（24px/700 基础色），通知中（红）/ 已静默 · 已抑制（'3 · 2'）为次，
 * 格间竖分隔线，每格悬浮显示口径注释。
 *
 * 移动适配（手机竖屏 ≤767px）：`compact` 为真时由「一行四格」改为 **2×2 两行两格**——
 * 「已静默 · 已抑制」这类长标签在窄屏一行四格下（每格约 75px）必然溢出到相邻格，
 * 故仅在此断点换行；分隔线按列位置重排（第 2、4 格带左分隔线）。
 */
export function AlertStatStrip({
  counts,
  historyUnavailable,
  amUnavailable,
  compact = false,
}: {
  counts: AlertCounts
  /** history 取数失败：主数字两格显示 '-'（决策 73 局部降级，不显示 0） */
  historyUnavailable: boolean
  /** AM 取数失败：治理态两格显示 '-'，不把失败静默成 0 */
  amUnavailable: boolean
  /** 窄屏两行两格布局（见本组件头注释） */
  compact?: boolean
}) {
  const { token } = theme.useToken()

  const cells: StatCell[] = [
    {
      key: 'today',
      testId: 'alert-today-count',
      value: historyUnavailable ? '-' : counts.today,
      label: '当日告警',
      tip: '今日 0 点起触发过的告警条数（含已恢复）',
      color: token.colorText,
    },
    {
      key: 'week',
      testId: 'alert-week-count',
      value: historyUnavailable ? '-' : counts.week,
      label: '近 7 天告警',
      tip: '最近 7 天内触发过的告警条数（含已恢复）',
      color: token.colorText,
    },
    {
      key: 'active',
      testId: 'alert-active-count',
      value: amUnavailable ? '-' : counts.active,
      label: '通知中',
      tip: 'Alertmanager 当前仍在通知中的告警条数（已通过路由计算，运维的行动对象）',
      color: token.colorError,
    },
    {
      key: 'governed',
      testId: 'alert-governed-count',
      value: amUnavailable ? '-' : `${counts.silenced} · ${counts.inhibited}`,
      label: '已静默 · 已抑制',
      tip: '被静默规则屏蔽的通知条数 · 被抑制规则抑制（存在根因告警）的条数',
      color: token.colorTextSecondary,
    },
  ]

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
                  fontSize: 24,
                  fontWeight: 700,
                  lineHeight: 1.2,
                  color: cell.color,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {cell.value}
              </div>
              <div
                style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2, whiteSpace: 'nowrap' }}
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
 * 最新告警两行制行（决策 73 §3）：
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
                fontSize: 13,
                fontWeight: 500,
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
                fontSize: 12,
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
              fontSize: 12,
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
              fontSize: 12,
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
  promError = null,
  amError = null,
  historyError = null,
  onRetry,
  isStaticPreview = false,
}: AlertStatusCardProps) {
  const { token } = theme.useToken()
  // 窄屏（≤767px）版式开关：四格统计条由一行四格改为 2×2（见 AlertStatStrip 头注释）
  const narrow = useNarrowLayout()
  const allFailed = !loading && promError !== null && amError !== null
  const partialError = !loading && !allFailed && (promError !== null || amError !== null)
  const errorText = [promError, amError].filter(Boolean).join('；')

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

  // 空态只在「两条链路均取数成功且全为 0」时引导；部分失败时不误导。
  // 求和覆盖 AM 四态 + Prom 两态 + 当日 / 近 7 天：仅存在 unprocessed 告警、
  // 或 7 天内有过已恢复告警时，都不得判为空态（后者的引导文案与实际不符）。
  const isEmpty =
    counts.today +
      counts.week +
      counts.active +
      counts.silenced +
      counts.inhibited +
      counts.unprocessed +
      counts.firing +
      counts.pending ===
    0
  // history 取数失败时当日 / 近 7 天不可知，空态无从判定 → 不引导（宁缺不误导）
  const historyUnavailable = !loading && historyError !== null
  const showEmptyGuide = !loading && !allFailed && !partialError && !historyUnavailable && isEmpty

  const retryAction = onRetry ? (
    <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
      重试
    </Button>
  ) : null

  // 按数据源降级：该源取数失败时数字显示 '-'，不把失败静默成 0 让用户误当作真实值
  // （决策 68-2：AM 未挂载时数字恒为 0，必须与「请求失败」区分）。
  const amUnavailable = !loading && amError !== null
  const promUnavailable = !loading && promError !== null

  return (
    <SurfaceCard
      data-testid="alert-status-card"
      title="告警状态"
      /* 卡内只展示近 8 条，完整列表在 /alert-status（决策 73 §3「查看全部 →」兜底） */
      extra={
        <Link to="/alert-status" style={{ fontSize: 13 }}>
          查看全部 →
        </Link>
      }
      /* 高度：由内容决定，但**允许被双列区拉伸**（用户 2026-09-18 决策「方案乙」）——
         双列区两列等高（align-items: stretch）时告警卡撑满列高，残余落差由页脚
         margin-top:auto 吸收，落在「最新告警列表」下方（白底），而不是让两列底边参差。
         告警极少（如 2 条）时，列高由双列区 min-height 420px 兜底（见 HomePage）。 */
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

          {showEmptyGuide ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="当前无通知中的告警"
              style={{ margin: '12px 0' }}
            >
              <Link to="/alert-config">去配置通知规则 →</Link>
            </Empty>
          ) : (
            <>
              {/* 四格统计条：当日 / 近 7 天为主数字，治理态为次（决策 73 §2） */}
              <AlertStatStrip
                counts={counts}
                historyUnavailable={historyUnavailable}
                amUnavailable={amUnavailable}
                compact={narrow}
              />

              {/* unprocessed 不计数不列条，仅防「通知中 0」被误读为无告警 */}
              {!amUnavailable && counts.unprocessed > 0 && (
                <Typography.Text
                  type="secondary"
                  data-testid="alert-unprocessed-note"
                  style={{ display: 'block', marginTop: 6, fontSize: 11 }}
                >
                  <Tooltip title="告警刚进入通知队列，系统仍在计算是否通知、通知给谁">
                    <span>另有 {counts.unprocessed} 条告警仍在计算通知状态</span>
                  </Tooltip>
                </Typography.Text>
              )}

              <div data-testid="latest-alert-region" style={{ marginTop: 10, marginBottom: 10 }}>
                <Typography.Text
                  strong
                  style={{ display: 'block', fontSize: 13, marginBottom: 2 }}
                >
                  {LATEST_ALERT_TITLE}
                </Typography.Text>
                {amUnavailable ? (
                  <Typography.Text
                    type="secondary"
                    data-testid="latest-alert-unavailable"
                    style={{ display: 'block', marginTop: 8, fontSize: 12 }}
                  >
                    取数失败，暂无法展示最新告警
                  </Typography.Text>
                ) : latestAlerts.length === 0 ? (
                  <Typography.Text
                    type="secondary"
                    data-testid="latest-alert-empty"
                    style={{ display: 'block', marginTop: 8, fontSize: 12 }}
                  >
                    暂无通知中的告警
                  </Typography.Text>
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

              {/* 页脚：参考行 + 通知配置深链。
                  `marginTop: auto` 在卡被拉伸时把页脚推到卡底——落差落在列表下方（白底），
                  页脚不会悬在卡片中段；卡未被拉伸时 auto 解析为 0，
                  与列表的间距由 latest-alert-region 的 marginBottom 提供。 */}
              <div
                data-testid="alert-card-footer"
                style={{
                  marginTop: 'auto',
                  paddingTop: 10,
                  borderTop: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                {/* Prometheus 求值态仅供参考，视觉权重明显低于主数字（11px 灰字） */}
                <Typography.Text
                  type="secondary"
                  data-testid="prom-reference-line"
                  style={{ display: 'block', fontSize: 11 }}
                >
                  <Tooltip title="Prometheus 规则求值状态：触发中 / 求值中（尚未达到触发条件）">
                    <span>
                      Prometheus 原始求值 · {PROM_EVAL_LABEL.firing}{' '}
                      {promUnavailable ? '-' : counts.firing} / {PROM_EVAL_LABEL.pending}{' '}
                      {promUnavailable ? '-' : counts.pending}
                    </span>
                  </Tooltip>
                </Typography.Text>
                {/* 告警中心入口只保留标题右侧的「查看全部 →」，此处不再重复（用户反馈 2026-09-14） */}
                <div style={{ marginTop: 6 }}>
                  <Link to="/alert-config">配置告警通知</Link>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </SurfaceCard>
  )
}

export default AlertStatusCard
