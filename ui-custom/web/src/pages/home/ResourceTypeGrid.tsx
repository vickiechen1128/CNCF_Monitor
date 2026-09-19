/**
 * L1 采集覆盖区（Module_05 §3.1 决策 93 / PRD v1.8；版式按**排版定版**对齐原型）。
 *
 * 一行五卡（5 列 Flex，5 卡等宽不溢出）：前 5 格为 `dashboard.by_category` 的五类资源卡
 * （**固定顺序**：主机 / 数据库 / 中间件 / 应用服务 / 其他监控目标）。决策 93 **删除**旧版
 * 的「按应用查看」入口卡（L2 应用覆盖区前移承接跳转）与每卡右上角「未恢复」告警胶囊
 * （告警信息收口 L0 告警卡 + L4 告警状态卡，本区只体现采集覆盖口径）。
 *
 * 卡片自上而下：单字徽标 + 类型名 → 32px 已采数 + `/ N 量词已采` → 覆盖率进度条 +
 * 「覆盖率 X%」/「未采 N」→ 细分隔线 → 子类小标题 + 子类 chip 列表（+ 卡内脚注）。
 *
 * 版式要点（视觉定版 v3，决策 93）：
 * - **徽标用类型首字**而非线性图标（见 resourceTypeMeta 注释）；
 * - **量词只给主机**（「台」）；`未采 N` 不重复量词；
 * - **子类封顶 3 条**：第 4 条起聚合为「更多 +N」虚线品牌青 chip（`more` 态），
 *   行高有确定性上界，同行五卡等高不再被子类数量拉爆（一行五卡布局的前提）；
 * - **应用服务不设子类**：渲染一行规则说明 + `application_http` 指标 chip，**不再**渲染采集
 *   形态示例 chip（空态减负，决策 93）；「为什么不拆」由规则说明 + Tooltip 自解释。
 */
import { Col, Row, Tooltip, Typography, theme } from 'antd'
import { Link } from 'react-router-dom'
import type { CategorySummary } from '../../api/dashboard'
import { SurfaceCard } from './SurfaceCard'
import {
  APPLICATION_SUBTYPE_LABEL,
  APPLICATION_SUBTYPE_TIP,
  coveragePercent,
  coverageText,
  L1_CATEGORY_META,
  L1_CATEGORY_ORDER,
  resourceListHref,
  SUBTYPE_COVERAGE_WARN_THRESHOLD,
  uncoveredCount,
} from './resourceTypeMeta'
import type { ResourceCategoryKey } from './resourceTypeMeta'

/** 子类取值为空串时（该资源未填细分类型）的展示占位 */
const EMPTY_SUBTYPE_LABEL = '未标注'

/** 子类明细最多展示 3 条，第 4 条起聚合为「更多 +N」（决策 93） */
const MAX_SUBTYPES = 3

interface ResourceTypeGridProps {
  /** `dashboard.by_category`；接口未返回某类型时按 0 值卡渲染 */
  byCategory: CategorySummary[]
}

/**
 * 子类明细 chip（与原型同款）：白底细边，左子类名、右「已采/总数 · 覆盖率」。
 * 覆盖率 <70% 换橙底橙边；纯说明性 chip（`muted`）用浅灰底且不渲染右侧数值；
 * 聚合 chip（`more`，决策 93）用虚线品牌青边——子类封顶后第 4 条起收进「更多 +N」。
 */
function SubtypeChip({
  label,
  value,
  warn,
  muted,
  more,
  testId,
}: {
  label: string
  value?: string
  warn?: boolean
  muted?: boolean
  /** 聚合态：虚线品牌青边（决策 93「更多 +N」） */
  more?: boolean
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
        color: more ? token.colorPrimary : undefined,
        background: more ? token.colorBgContainer : muted ? token.colorFillQuaternary : warn ? token.colorWarningBg : token.colorBgContainer,
        border: `1px ${more ? 'dashed' : 'solid'} ${
          more ? token.colorPrimaryBorder : !muted && warn ? token.colorWarningBorder : token.colorBorderSecondary
        }`,
      }}
    >
      <span
        style={{
          color: more ? token.colorPrimary : muted ? token.colorTextTertiary : token.colorTextSecondary,
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
            color: more ? token.colorPrimary : warn ? token.colorWarningText : token.colorTextTertiary,
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
}: {
  category: ResourceCategoryKey
  summary: CategorySummary | undefined
}) {
  const { token } = theme.useToken()
  const meta = L1_CATEGORY_META[category]
  const total = summary?.resource_count ?? 0
  const monitored = summary?.monitored_count ?? 0
  const subtypes = summary?.by_subtype ?? []
  const percent = coveragePercent(monitored, total)
  const warn = percent !== null && percent < SUBTYPE_COVERAGE_WARN_THRESHOLD
  const extraSubtypes = Math.max(0, subtypes.length - MAX_SUBTYPES)

  return (
    <SurfaceCard
      hoverShadow
      data-testid={`l1-card-${category}`}
      style={{ height: '100%', borderRadius: 12 }}
      styles={{ body: { padding: 16, display: 'flex', flexDirection: 'column' } }}
    >
      {/* 单字徽标 + 类型名（决策 93：告警胶囊已删，徽标行不再混排告警口径） */}
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
            <Tooltip title={APPLICATION_SUBTYPE_TIP}>
              <span data-testid={`l1-no-subtype-${category}`}>
                <SubtypeChip
                  label={APPLICATION_SUBTYPE_LABEL}
                  value={`${monitored}/${total} · ${coverageText(monitored, total)}`}
                  warn={warn}
                />
              </span>
            </Tooltip>
          ) : subtypes.length === 0 ? (
            <div style={{ fontSize: 12, color: token.colorTextTertiary }}>暂无子类数据</div>
          ) : (
            <div data-testid={`l1-subtypes-${category}`}>
              {subtypes.slice(0, MAX_SUBTYPES).map((s) => {
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
              {extraSubtypes > 0 && (
                <Tooltip title={`其余 ${extraSubtypes} 个采集类型，点击查看资源清单`}>
                  <Link
                    to={resourceListHref(category)}
                    data-testid={`l1-subtype-more-${category}`}
                    style={{ display: 'block' }}
                  >
                    <SubtypeChip label={`更多 +${extraSubtypes}`} value="→" more />
                  </Link>
                </Tooltip>
              )}
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

export function ResourceTypeGrid({ byCategory }: ResourceTypeGridProps) {
  const summaryOf = new Map(byCategory.map((c) => [c.resource_category, c]))

  return (
    <Row gutter={[16, 16]} data-testid="l1-grid">
      {L1_CATEGORY_ORDER.map((category) => (
        <Col key={category} flex="1">
          <CategoryCard category={category} summary={summaryOf.get(category) as CategorySummary | undefined} />
        </Col>
      ))}
    </Row>
  )
}

export default ResourceTypeGrid