/**
 * 首页告警治理态大卡片（Module_05 §3.1 决策 72 / 决策 72-3 内容重构）。
 *
 * 受控展示型组件：数据由 HomePage 的 useAlertGovernance 单次请求持有，
 * 本组件不再自行取数（避免与首页指标卡重复请求同一接口），只负责渲染：
 *   主数字（通知中）→ 状态分布（已静默 / 已抑制）→ 最新告警（近 10 条，带表头）
 *   → Prometheus 原始求值参考行 → 通知配置深链。
 *
 * 条数口径：标题「查看全部 →」已指向 /alert-status，卡内不再重复「查看告警中心」入口
 * （用户反馈 2026-09-14）；列表行数 10 条用于填满左列高度，与右侧「快捷入口 + 最近下发」
 * 两卡总高基本齐平（避免卡内底部大片留白）。
 *
 * 口径（M08 契约 §10.2 四态 + M02 /api/v1/alerts）：
 * - 主数字 = Alertmanager 治理态「通知中」（notify_status === 'active'，红色语义），
 *   即运维的行动对象；Prometheus firing / pending 属求值原始数据，仅作 11px 参考小字；
 * - AM `unprocessed` 不计数、不进列表（其治理闭环 MVP 未实现），仅在 N > 0 时以一行
 *   灰字提示「另有 N 条告警仍在计算通知状态」，避免「通知中 0」被误读为「真的没告警」；
 * - 空态判定仍覆盖 AM 四态 + Prom 两态（六项计数全 0 且两条链路均取数成功）。
 *
 * 权威设计：docs/05-execution-records/module-05/design-proposals/homepage-mvp-content-restructure.md §3.3 / §3.4
 */
import type { CSSProperties, ReactNode } from 'react'
import { Alert, Button, Col, Divider, Empty, List, Row, Spin, Tag, Tooltip, Typography, theme } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import type { AmAlertItem } from '../../types/alertmanager'
import { formatLocalTime, formatRelativeTime } from '../config-center/configCenterConstants'
import {
  notifyStatusColor,
  notifyStatusLabel,
  notifyStatusTip,
  severityColor,
  severityLabel,
} from '../alerts/alertmanagerConstants'
import { SurfaceCard } from './SurfaceCard'

export interface AlertCounts {
  active: number
  silenced: number
  inhibited: number
  /** AM 待处理：刚进入 Alertmanager，尚未完成路由 / 静默 / 抑制计算（契约 §10.2 四态之一） */
  unprocessed: number
  firing: number
  pending: number
}

/**
 * 首页告警卡「最新告警」展示条数（决策 72-3 §3.4）。
 * 由 HomePage 取数时按此上限截断，本组件用它渲染表头下方标题（两边不得各写一份数字）。
 */
export const LATEST_ALERT_LIMIT = 10

/**
 * 最新告警表格列宽（表头与数据行共用同一组常量）。
 * 不共用会导致表头与各行列位错开，形同没有表头。
 */
const ALERT_COL_WIDTH = {
  severity: 44,
  instance: 66,
  time: 62,
  status: 48,
} as const

interface AlertStatusCardProps {
  counts: AlertCounts
  /** 最新告警（HomePage 已按 starts_at 倒序取前 LATEST_ALERT_LIMIT 条、并剔除 unprocessed） */
  latestAlerts: AmAlertItem[]
  loading?: boolean
  /** Prometheus 告警链路错误（M02 /api/v1/alerts） */
  promError?: string | null
  /** Alertmanager 通知链路错误（M08 /alertmanager/alerts） */
  amError?: string | null
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

/** 数值 + 标签的并列展示行（辅助说明 14px colorTextSecondary，数字 16px/700） */
function CountRow({
  label,
  tooltip,
  testId,
  children,
}: {
  label: string
  tooltip?: string
  testId?: string
  children: ReactNode
}) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 14 }}>
        {tooltip ? (
          <Tooltip title={tooltip}>
            <span>{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </Typography.Text>
      <div data-testid={testId} style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.4 }}>
        {children}
      </div>
    </div>
  )
}

/** 合法 ISO 时间才交给共享格式化函数；非法值返回 undefined 由调用方回落 '-'（避免机器格式串进界面） */
function safeTime(iso?: string): string | undefined {
  if (!iso || Number.isNaN(Date.parse(iso))) return undefined
  return iso
}

/**
 * 最新告警表头：级别 | 告警名 | 实例名 | 时间 | 状态。
 * 列宽与 LatestAlertRow 共用 ALERT_COL_WIDTH，保证表头与各行列位严格对齐；
 * 「状态」列加 tooltip 消歧（指 Alertmanager 通知状态，而非 Prometheus 求值状态）。
 */
function LatestAlertHeader() {
  const { token } = theme.useToken()
  const cell: CSSProperties = {
    fontSize: 12,
    color: token.colorTextTertiary,
    whiteSpace: 'nowrap',
  }

  return (
    <div
      data-testid="latest-alert-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        paddingBottom: 4,
        borderBottom: `0.5px solid ${token.colorSplit}`,
      }}
    >
      <span
        style={{ ...cell, flex: 'none', width: ALERT_COL_WIDTH.severity, textAlign: 'center' }}
      >
        级别
      </span>
      <span style={{ ...cell, flex: '1 1 auto', minWidth: 0 }}>告警名</span>
      <span style={{ ...cell, flex: 'none', width: ALERT_COL_WIDTH.instance }}>实例名</span>
      <span
        style={{ ...cell, flex: 'none', width: ALERT_COL_WIDTH.time, textAlign: 'right' }}
      >
        时间
      </span>
      <span
        style={{ ...cell, flex: 'none', width: ALERT_COL_WIDTH.status, textAlign: 'center' }}
      >
        <Tooltip title="Alertmanager 通知状态：通知中 / 已静默 / 已抑制">
          <span>状态</span>
        </Tooltip>
      </span>
    </div>
  )
}

/**
 * 最新告警单行：级别 | 告警名 | 实例名 | 相对时间 | 状态 **同排五列、左右贴边撑满**。
 * 级别 / 实例名 / 时间 / 状态为固定列宽（保证多行纵向对齐），告警名弹性伸缩并超长省略；
 * 列宽与胶囊宽度固定，避免各行列位错开。行间以细分隔线分隔（最后一行不加）。
 */
function LatestAlertRow({
  item,
  index,
  isLast,
}: {
  item: AmAlertItem
  index: number
  isLast: boolean
}) {
  const { token } = theme.useToken()
  const alertname = item.labels?.alertname || '-'
  // 决策 70：实例名只认 resource_name，缺失显示 '-'，不回落成采集地址（instance_address）
  const instanceName = item.resource_name?.trim() ? item.resource_name : '-'
  const relativeTime = formatRelativeTime(safeTime(item.starts_at)) || '-'
  const statusLabel =
    (notifyStatusLabel as Record<string, string>)[item.notify_status] ?? item.notify_status
  const statusColor = (notifyStatusColor as Record<string, string>)[item.notify_status] ?? 'default'

  const ellipsisCell: CSSProperties = {
    flex: 'none',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
  }

  return (
    <List.Item
      data-testid={`latest-alert-${index}`}
      style={{
        padding: '7px 0',
        borderBottom: isLast ? 'none' : `0.5px solid ${token.colorSplit}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
        <Tag
          color={severityColor(item.labels?.severity)}
          style={{
            marginInlineEnd: 0,
            flex: 'none',
            width: ALERT_COL_WIDTH.severity,
            textAlign: 'center',
          }}
        >
          {severityLabel(item.labels?.severity)}
        </Tag>
        {/* 弹性的告警名列：占满列宽余量，超长省略 + 悬浮全文 */}
        <Typography.Text ellipsis={{ tooltip: alertname }} style={{ flex: '1 1 auto', minWidth: 0, fontSize: 12 }}>
          {alertname}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ ...ellipsisCell, width: ALERT_COL_WIDTH.instance }}>
          {instanceName}
        </Typography.Text>
        <Tooltip title={formatLocalTime(safeTime(item.starts_at))}>
          <Typography.Text
            type="secondary"
            style={{ ...ellipsisCell, width: ALERT_COL_WIDTH.time, textAlign: 'right' }}
          >
            {relativeTime}
          </Typography.Text>
        </Tooltip>
        <Tag
          color={statusColor}
          style={{
            marginInlineEnd: 0,
            flex: 'none',
            width: ALERT_COL_WIDTH.status,
            textAlign: 'center',
          }}
        >
          {statusLabel}
        </Tag>
      </div>
    </List.Item>
  )
}

export function AlertStatusCard({
  counts,
  latestAlerts,
  loading = false,
  promError = null,
  amError = null,
  onRetry,
  isStaticPreview = false,
}: AlertStatusCardProps) {
  const { token } = theme.useToken()
  const allFailed = !loading && promError !== null && amError !== null
  const partialError = !loading && !allFailed && (promError !== null || amError !== null)
  const errorText = [promError, amError].filter(Boolean).join('；')

  // 空态只在「两条链路均取数成功且全为 0」时引导；部分失败时不误导。
  // 求和覆盖 AM 四态 + Prom 两态：仅存在 unprocessed 告警时不得判为空态。
  const isEmpty =
    counts.active +
      counts.silenced +
      counts.inhibited +
      counts.unprocessed +
      counts.firing +
      counts.pending ===
    0
  const showEmptyGuide = !loading && !allFailed && !partialError && isEmpty

  // 左侧 3px 色条只在「确有告警计数」时用告警红；空态 / 六项计数全 0 时降为中性边框色
  // （红色仅表达告警语义，不作为装饰；用 antd token 不硬编码）。
  const barColor = isEmpty ? token.colorBorder : token.colorError

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
      /* 卡内只展示近 10 条，完整列表在 /alert-status（决策 72-3 §3.1「右侧可放查看更多链接」） */
      extra={
        <Link to="/alert-status" style={{ fontSize: 13 }}>
          查看全部 →
        </Link>
      }
      /* body 设为纵向 flex 并撑满卡片：底部参考行与深链用 margin-top:auto 贴底，
         避免卡片被右侧内容撑高后底部留出大片空白 */
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: `3px solid ${barColor}`,
      }}
      styles={{
        body: {
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          minHeight: 0,
        },
      }}
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
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                  通知中
                </Typography.Text>
                <div
                  data-testid="alert-active-count"
                  style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.2, color: token.colorError }}
                >
                  {amUnavailable ? '-' : counts.active}
                </div>
              </div>

              <Row gutter={[16, 12]} style={{ marginTop: 12 }}>
                <Col xs={12}>
                  <CountRow
                    label={notifyStatusLabel.silenced}
                    tooltip={notifyStatusTip.silenced}
                    testId="alert-silenced-count"
                  >
                    {amUnavailable ? '-' : counts.silenced}
                  </CountRow>
                </Col>
                <Col xs={12}>
                  <CountRow
                    label={notifyStatusLabel.inhibited}
                    tooltip={notifyStatusTip.inhibited}
                    testId="alert-inhibited-count"
                  >
                    {amUnavailable ? '-' : counts.inhibited}
                  </CountRow>
                </Col>
              </Row>

              {/* unprocessed 不计数不列条，仅防「通知中 0」被误读为无告警 */}
              {!amUnavailable && counts.unprocessed > 0 && (
                <Typography.Text
                  type="secondary"
                  data-testid="alert-unprocessed-note"
                  style={{ display: 'block', marginTop: 8, fontSize: 11 }}
                >
                  <Tooltip title="告警刚进入通知队列，系统仍在计算是否通知、通知给谁">
                    <span>另有 {counts.unprocessed} 条告警仍在计算通知状态</span>
                  </Tooltip>
                </Typography.Text>
              )}

              <Divider style={{ margin: '12px 0' }} />

              <Typography.Text type="secondary" style={{ fontSize: 14 }}>
                最新告警（近 {LATEST_ALERT_LIMIT} 条）
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
                <div style={{ marginTop: 4 }}>
                  {/* 表头：无表头时列义不可知（用户反馈 2026-09-14），列宽与数据行共用常量 */}
                  <LatestAlertHeader />
                  <List
                    size="small"
                    split={false}
                    data-testid="latest-alert-list"
                    dataSource={latestAlerts}
                    renderItem={(item, index) => (
                      <LatestAlertRow
                        item={item}
                        index={index}
                        isLast={index === latestAlerts.length - 1}
                      />
                    )}
                  />
                </div>
              )}

              {/* marginTop:auto + paddingTop 让参考行与深链在卡内贴底（内容不足时不留底部空洞） */}
              <div style={{ marginTop: 'auto', paddingTop: 12 }}>
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
                <div style={{ marginTop: 8 }}>
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
