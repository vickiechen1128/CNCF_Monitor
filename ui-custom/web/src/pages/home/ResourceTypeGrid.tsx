/**
 * L1 资源类型区（Module_05 §3.1 决策 91 / PRD v1.7；版式按**排版定版**对齐原型）。
 *
 * 3 列网格共 6 格：前 5 格为 `dashboard.by_category` 的五类资源卡（**固定顺序**：
 * 主机 / 数据库 / 中间件 / 应用服务 / 其他监控目标），第 6 格为虚线边框「按应用查看」入口卡。
 *
 * 卡片自上而下：
 * 单字徽标 + 类型名 + 右上角**未恢复告警胶囊** → 32px 已采数 + `/ N 量词已采` →
 * 覆盖率进度条 + 「覆盖率 X%」/「未采 N」→ 细分隔线 → 子类小标题 + 子类 chip 列表（+ 卡内脚注）。
 *
 * 版式要点（视觉定版）：
 * - **徽标用类型首字**而非线性图标：数据库 / 中间件 / 应用服务的线性图标形态接近，26px 内辨识成本高；
 * - **量词只给主机**（「台」）：其余类型的「个」只增噪音不增信息，`未采 N` 也不重复量词；
 * - **卡高由内容决定**（不锁死），子类多的卡自然更高，不靠留白硬凑等高；
 * - **子类 chip**：白底细边；覆盖率 <70% 换橙底橙边 + 橙色数字（颜色不是唯一语义，右侧仍有数字）。
 *
 * 口径要点：
 * - **未恢复胶囊**取 `/api/v1/alerts` 里 `state === 'firing'` 且 `resource_category`
 *   命中本类型卡的条数（前端分组，后端零改动）；零告警显示「无未恢复」而非 0；
 * - **拨测目标永不进五类卡**——只在入口卡附注里单独呈现（不变量见 summary_test.go）；
 * - **应用服务不设子类**（`by_subtype` 恒为空数组）：该卡不渲染子类列表，改渲染
 *   一行规则说明 + `application_http` 指标 chip + 采集形态示例 chip，让「为什么不拆」卡内自解释。
 */
import { Col, Row, Tooltip, Typography, theme } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import type { CategorySummary } from '../../api/dashboard'
import type { PromAlertItem } from '../../types/alertmanager'
import { SurfaceCard } from './SurfaceCard'
import {
  APPLICATION_SUBTYPE_EXAMPLES,
  APPLICATION_SUBTYPE_LABEL,
  APPLICATION_SUBTYPE_TIP,
  coveragePercent,
  coverageText,
  firingCountByCategory,
  firingUnclassifiedCount,
  L1_CATEGORY_META,
  L1_CATEGORY_ORDER,
  resourceListHref,
  SUBTYPE_COVERAGE_WARN_THRESHOLD,
  uncoveredCount,
} from './resourceTypeMeta'
import type { ResourceCategoryKey } from './resourceTypeMeta'

/** 子类取值为空串时（该资源未填细分类型）的展示占位 */
const EMPTY_SUBTYPE_LABEL = '未标注'

/** 拨测目标说明的深链（PRD §「拨测口径」④：入口卡附注 + 深链采集 Job 列表） */
const PROBE_HREF = '/scrape-jobs'

interface ResourceTypeGridProps {
  /** `dashboard.by_category`；接口未返回某类型时按 0 值卡渲染 */
  byCategory: CategorySummary[]
  /** 应用数（`dashboard.by_app.length`），入口卡文案用 */
  appCount: number
  /** 拨测目标数（`dashboard.probe_target_count`） */
  probeTargetCount: number
  /** 拨测异常数（`dashboard.probe_target_abnormal_count`，MVP 恒 0） */
  probeAbnormalCount: number
  /** Prometheus 当前告警全量（`/api/v1/alerts` 单次请求结果），用于「未恢复」分组 */
  alerts: PromAlertItem[]
}

/**
 * 子类明细 chip（与原型同款）：白底细边，左子类名、右「已采/总数 · 覆盖率」。
 * 覆盖率 <70% 换橙底橙边；纯说明性 chip（`muted`）用浅灰底且不渲染右侧数值。
 */
function SubtypeChip({
  label,
  value,
  warn,
  muted,
  testId,
}: {
  label: string
  value?: string
  warn?: boolean
  muted?: boolean
  /** 行级测试锚点：橙色语义底挂在 chip 本身（外层 Link 只负责跳转，不承载底色） */
  testId?: string
}) {
  const { token } = theme.useToken()
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        padding: '5px 8px',
        borderRadius: 6,
        fontSize: 12,
        background: muted ? token.colorFillQuaternary : warn ? token.colorWarningBg : token.colorBgContainer,
        border: `1px solid ${!muted && warn ? token.colorWarningBorder : token.colorBorderSecondary}`,
      }}
    >
      <span
        style={{
          color: muted ? token.colorTextTertiary : token.colorTextSecondary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {value && (
        <span
          style={{
            color: warn ? token.colorWarningText : token.colorTextTertiary,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </span>
      )}
    </div>
  )
}

/** 单张资源类型卡 */
function CategoryCard({
  category,
  summary,
  alerts,
}: {
  category: ResourceCategoryKey
  summary: CategorySummary | undefined
  alerts: PromAlertItem[]
}) {
  const { token } = theme.useToken()
  const meta = L1_CATEGORY_META[category]
  const total = summary?.resource_count ?? 0
  const monitored = summary?.monitored_count ?? 0
  const subtypes = summary?.by_subtype ?? []
  const alertCount = firingCountByCategory(alerts, category)
  const percent = coveragePercent(monitored, total)
  const warn = percent !== null && percent < SUBTYPE_COVERAGE_WARN_THRESHOLD

  return (
    <SurfaceCard
      hoverShadow
      data-testid={`l1-card-${category}`}
      style={{ height: '100%', borderRadius: 12 }}
      styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column' } }}
    >
      {/* 单字徽标 + 类型名 + 右上角未恢复胶囊 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: token.colorPrimaryBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 13, lineHeight: 1, fontWeight: 700, color: token.colorPrimary }}>
              {meta.badge}
            </span>
          </span>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {meta.label}
          </Typography.Text>
        </div>
        <AlertCapsule
          category={category}
          count={alertCount}
          tip={`${meta.label}类型的当前未恢复告警条数（取 Prometheus 当前告警并按资源类型分组）`}
        />
      </div>

      {/* 已采数 / 总数（量词只给主机；非主机不写量词，故 unit 为空串时自然成 `/ 26 已采`） */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          data-testid={`l1-monitored-${category}`}
          style={{
            fontSize: 32,
            fontWeight: 800,
            lineHeight: 1.1,
            color: token.colorText,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {monitored}
        </span>
        <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
          / {total} {meta.unit}已采
        </span>
      </div>

      {/* 覆盖率进度条 + 覆盖率 / 未采 */}
      <div style={{ marginTop: 10 }}>
        <CoverageBar percent={percent} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 5,
            fontSize: 12,
            color: token.colorTextSecondary,
          }}
        >
          <span data-testid={`l1-coverage-${category}`}>覆盖率 {coverageText(monitored, total)}</span>
          <span data-testid={`l1-uncovered-${category}`} style={{ color: token.colorTextTertiary }}>
            未采 {uncoveredCount(total, monitored)}
          </span>
        </div>
      </div>

      {/* 采集类型子类 / 单一采集类型说明 + 卡内脚注 */}
      <div
        style={{
          marginTop: 12,
          paddingTop: 10,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: token.colorTextTertiary }}>
          {meta.subtypeTitle ?? meta.subtypeNote}
        </div>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {meta.subtypeTitle === null ? (
            <>
              <Tooltip title={APPLICATION_SUBTYPE_TIP}>
                <span data-testid={`l1-no-subtype-${category}`}>
                  <SubtypeChip
                    label={APPLICATION_SUBTYPE_LABEL}
                    value={`${monitored}/${total} · ${coverageText(monitored, total)}`}
                    warn={warn}
                  />
                </span>
              </Tooltip>
              <SubtypeChip label={APPLICATION_SUBTYPE_EXAMPLES} muted />
            </>
          ) : subtypes.length === 0 ? (
            <div style={{ fontSize: 12, color: token.colorTextTertiary }}>暂无子类数据</div>
          ) : (
            <div data-testid={`l1-subtypes-${category}`}>
              {subtypes.map((s) => {
                const subWarn =
                  (coveragePercent(s.monitored_count, s.resource_count) ?? 100) <
                  SUBTYPE_COVERAGE_WARN_THRESHOLD
                return (
                  <Link
                    key={s.subtype || EMPTY_SUBTYPE_LABEL}
                    to={resourceListHref(category, s.subtype || undefined)}
                    data-testid={`l1-subtype-${category}-${s.subtype || 'empty'}`}
                    style={{ display: 'block', marginBottom: 6 }}
                  >
                    <SubtypeChip
                      label={s.subtype || EMPTY_SUBTYPE_LABEL}
                      value={`${s.monitored_count}/${s.resource_count} · ${coverageText(s.monitored_count, s.resource_count)}`}
                      warn={subWarn}
                      testId={`l1-subtype-chip-${category}-${s.subtype || 'empty'}`}
                    />
                  </Link>
                )
              })}
            </div>
          )}
        </div>
        {meta.footnote && (
          <div
            data-testid={`l1-footnote-${category}`}
            style={{ marginTop: 'auto', paddingTop: 8, fontSize: 10, color: token.colorTextTertiary }}
          >
            {meta.footnote}
          </div>
        )}
      </div>
    </SurfaceCard>
  )
}

/** 覆盖率进度条：<70% 换橙色（与子类 chip 同一阈值，颜色不作为唯一语义——下方仍有百分数） */
function CoverageBar({ percent }: { percent: number | null }) {
  const { token } = theme.useToken()
  const value = percent ?? 0
  const warn = percent !== null && percent < SUBTYPE_COVERAGE_WARN_THRESHOLD
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: 6,
        borderRadius: 3,
        background: token.colorFillSecondary,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: '100%',
          borderRadius: 3,
          background: percent === null ? 'transparent' : warn ? token.colorWarning : token.colorPrimary,
          transition: 'width 0.2s',
        }}
      />
    </div>
  )
}

/** 右上角「未恢复」胶囊：红色语义（>0）/ 灰色「无未恢复」（=0），点击进告警状态页并带类型筛选 */
function AlertCapsule({
  category,
  count,
  tip,
}: {
  category: ResourceCategoryKey
  count: number
  tip: string
}) {
  const { token } = theme.useToken()
  const active = count > 0
  return (
    <Tooltip title={tip}>
      <Link
        to={`/alert-status?resource_category=${category}`}
        data-testid={`l1-alert-capsule-${category}`}
        style={{
          flexShrink: 0,
          fontSize: 12,
          lineHeight: '18px',
          padding: '1px 8px',
          borderRadius: 9,
          whiteSpace: 'nowrap',
          background: active ? token.colorErrorBg : token.colorFillQuaternary,
          color: active ? token.colorErrorText : token.colorTextTertiary,
        }}
      >
        {active ? `未恢复 ${count}` : '无未恢复'}
      </Link>
    </Tooltip>
  )
}

/** 第 6 格：虚线边框「按应用查看」入口卡（应用数 + 拨测附注 + 不属于台账对象的告警附注） */
function AppEntryCard({
  appCount,
  probeTargetCount,
  probeAbnormalCount,
  unclassifiedFiringCount,
}: {
  appCount: number
  probeTargetCount: number
  probeAbnormalCount: number
  unclassifiedFiringCount: number
}) {
  const { token } = theme.useToken()
  return (
    <SurfaceCard
      hoverShadow
      data-testid="l1-app-entry"
      style={{ height: '100%', borderRadius: 12, border: `1px dashed ${token.colorBorder}` }}
      styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* 圆形箭头是入口卡的主操作：可点击 + 可聚焦，锚点到下方 L2 应用明细表 */}
        <a
          href="#app-detail"
          aria-label="按应用查看（跳转到应用明细）"
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            background: token.colorPrimaryBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ArrowRightOutlined style={{ fontSize: 18, color: token.colorPrimary }} />
        </a>
        <Typography.Text strong style={{ marginTop: 12, fontSize: 16 }}>
          按应用查看
        </Typography.Text>
        <Typography.Text type="secondary" style={{ marginTop: 4, fontSize: 12 }}>
          {appCount} 个应用 · 按覆盖率升序
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          缺口最大的排最前
        </Typography.Text>
      </div>
      <div
        style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: 8,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 11, color: token.colorTextTertiary }} data-testid="l1-probe-note">
          另有拨测目标 {probeTargetCount} 个 · 异常 {probeAbnormalCount}
        </div>
        {/* 深链采集 Job 列表（PRD §「拨测口径」④）；句子本身即入口，视觉上仍是灰字说明 */}
        <Link
          to={PROBE_HREF}
          style={{ fontSize: 11, color: token.colorTextTertiary, display: 'inline-block', marginTop: 2 }}
        >
          拨测走 blackbox Job，不录入资源台账
        </Link>
        {/* 附注仅在有此类告警时出现（N=0 不渲染，避免无意义噪音） */}
        {unclassifiedFiringCount > 0 && (
          <div
            style={{ fontSize: 11, color: token.colorWarningText, marginTop: 2 }}
            data-testid="l1-unclassified-alert-note"
          >
            另有 {unclassifiedFiringCount} 条未恢复告警不属于资源台账对象
          </div>
        )}
      </div>
    </SurfaceCard>
  )
}

export function ResourceTypeGrid({
  byCategory,
  appCount,
  probeTargetCount,
  probeAbnormalCount,
  alerts,
}: ResourceTypeGridProps) {
  const summaryOf = new Map(byCategory.map((c) => [c.resource_category, c]))
  const unclassifiedFiringCount = firingUnclassifiedCount(alerts)

  return (
    <Row gutter={[16, 16]} data-testid="l1-grid">
      {L1_CATEGORY_ORDER.map((category) => (
        <Col key={category} xs={24} sm={12} xl={8}>
          <CategoryCard
            category={category}
            summary={summaryOf.get(category) as CategorySummary | undefined}
            alerts={alerts}
          />
        </Col>
      ))}
      <Col xs={24} sm={12} xl={8}>
        <AppEntryCard
          appCount={appCount}
          probeTargetCount={probeTargetCount}
          probeAbnormalCount={probeAbnormalCount}
          unclassifiedFiringCount={unclassifiedFiringCount}
        />
      </Col>
    </Row>
  )
}

export default ResourceTypeGrid
