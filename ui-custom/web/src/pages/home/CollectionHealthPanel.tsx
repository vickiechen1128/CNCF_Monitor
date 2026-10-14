/**
 * 「采集健康」独立面板（M05 反馈 10，路线 B）。
 *
 * 工程师视角：回答「已下发的这批数据采到了吗、哪些没在采」，与领导视角的 L0「纳管覆盖率」
 * （下发进度）**分开展示**。位置固定在「告警状态」区块之前（HomePage 中位于 L3 拨测面板之后、
 * L4/L5 告警 + 使用指引行之前）。
 *
 * 口径（见 dev-feedback 反馈 10 §10.5 / `api/dashboard.ts` 的 `CollectionHealth`）：
 * - 分母 = **已下发资源数**（= `monitored_count`），**不含未下发**——未下发进度归 L0「纳管覆盖率」；
 * - 四态 = 采集中 / 回传延迟中（stale，独立一态）/ 已下发未采到 / 待采集；**拨测目标不参与**；
 * - 判定由后端一次聚合（`collection_health`），前端零聚合逻辑；字段缺失 → 按「不可用」呈现，
 *   绝不误报 0（决策 68-2）。
 *
 * 移动适配（手机竖屏 ≤767px，见 homeResponsive.ts）：分布条整宽；图例由一行折为多行；标题行
 * 的「查看资源明细 →」保持右对齐（短文本不溢出）。
 */
import { Link } from 'react-router-dom'
import { Tooltip, Typography, theme } from 'antd'
import { SurfaceCard } from './SurfaceCard'
import type { CollectionHealth } from '../../api/dashboard'
import { useNarrowLayout } from './homeResponsive'

const { Text } = Typography

/** 资源清单页深链：采集状态列即本面板明细（M07「资源管理中心」） */
const RESOURCE_LIST_HREF = '/resources'
/** 无已下发资源时的引导入口：建采集 Job */
const SCRAPE_JOB_HREF = '/scrape-jobs'

interface CollectionHealthPanelProps {
  /** 后端采集健康四态聚合；缺失（后端未实现 / 查询失败）时为 undefined */
  health?: CollectionHealth
}

/** 四态展示元数据：key → 展示名 + 语义色 + Tooltip 口径 */
interface StateMeta {
  key: keyof Pick<
    CollectionHealth,
    'collecting_count' | 'stale_count' | 'down_count' | 'pending_count'
  >
  label: string
  color: (token: ReturnType<typeof theme.useToken>['token']) => string
  hint: string
}

const STATE_METAS: StateMeta[] = [
  {
    key: 'collecting_count',
    label: '采集中',
    color: (t) => t.colorSuccess,
    hint: '5 分钟内有 up 样本且采集成功（=1）。',
  },
  {
    key: 'stale_count',
    label: '回传延迟中',
    color: (t) => t.colorWarning,
    hint: '5 分钟内无样本、但 1 小时内有历史样本：样本在途（边缘回传积压），非采集失败，请查采集节点回传状态。',
  },
  {
    key: 'down_count',
    label: '已下发未采到',
    color: (t) => t.colorError,
    hint: '5 分钟内有 up 样本且采集失败（=0）：已下发但未采到数据。',
  },
  {
    key: 'pending_count',
    label: '待采集',
    color: (t) => t.colorTextQuaternary,
    hint: '1 小时内无任何样本：下发生效后尚未首采，或采集器未产生样本。',
  },
]

export function CollectionHealthPanel({ health }: CollectionHealthPanelProps) {
  const { token } = theme.useToken()
  const narrow = useNarrowLayout()

  const unavailable = health === undefined
  const dispatched = health?.dispatched_count ?? 0

  return (
    <SurfaceCard
      data-testid="collection-health-panel"
      title="采集健康"
      extra={
        <Link to={RESOURCE_LIST_HREF} data-testid="ch-detail-link">
          查看资源明细 →
        </Link>
      }
    >
      {/* 口径副标题：与 L0「纳管覆盖率」（下发进度）明确区分 */}
      <Text type="secondary" style={{ fontSize: 12 }}>
        仅统计**已下发资源**（被启用采集任务覆盖）的实际采集情况，与上方「纳管覆盖率」口径不同
        （该值为下发进度、不代表已采到）；拨测目标不参与。
      </Text>

      {unavailable ? (
        <div
          data-testid="ch-unavailable"
          style={{ marginTop: 16, padding: '20px 0', textAlign: 'center', color: token.colorTextTertiary, fontSize: 13 }}
        >
          采集健康数据暂不可用
        </div>
      ) : dispatched === 0 ? (
        <div style={{ marginTop: 16, padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>暂无已下发资源</div>
          <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
            建立并下发采集任务后，这里将展示已下发资源的实际采集健康度。
          </Text>
          <Link to={SCRAPE_JOB_HREF} style={{ display: 'inline-block', marginTop: 10 }} data-testid="ch-empty-link">
            去建采集任务 →
          </Link>
        </div>
      ) : (
        <>
          {/* 四态分布条：各段宽度按计数占比，段间 2px 间隙保证相邻段可辨 */}
          <div
            data-testid="ch-bar"
            style={{
              display: 'flex',
              width: '100%',
              height: 10,
              borderRadius: 5,
              overflow: 'hidden',
              marginTop: 14,
              background: token.colorFillSecondary,
            }}
          >
            {STATE_METAS.map((m) => {
              const count = health[m.key]
              if (count <= 0) return null
              return (
                <Tooltip key={m.key} title={`${m.label} ${count}（${m.hint}）`}>
                  <div
                    data-testid={`ch-seg-${m.key}`}
                    style={{
                      width: `${(count / dispatched) * 100}%`,
                      height: '100%',
                      background: m.color(token),
                      borderRight: `1px solid ${token.colorBgContainer}`,
                    }}
                  />
                </Tooltip>
              )
            })}
          </div>

          {/* 图例计数：窄屏自动折行 */}
          <div
            data-testid="ch-legend"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: narrow ? '8px 16px' : '8px 24px',
              marginTop: 14,
            }}
          >
            {STATE_METAS.map((m) => (
              <div
                key={m.key}
                data-testid={`ch-legend-${m.key}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: '50%', background: m.color(token), flexShrink: 0 }}
                />
                <Tooltip title={m.hint}>
                  <span style={{ fontSize: 12, color: token.colorTextSecondary, cursor: 'help' }}>{m.label}</span>
                </Tooltip>
                <span style={{ fontSize: 14, fontWeight: 700, color: token.colorText, fontVariantNumeric: 'tabular-nums' }}>
                  {health[m.key]}
                </span>
              </div>
            ))}
          </div>

          {/* 底部口径说明 */}
          <div
            data-testid="ch-footnote"
            style={{ marginTop: 14, paddingTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}`, fontSize: 11, color: token.colorTextTertiary }}
          >
            本面板只表达已下发资源内部的采集健康度；未下发资源的纳管进度见上方「纳管覆盖率」。
            「回传延迟中」为独立一态——样本在途（边缘回传积压），不代表采集失败。
          </div>
        </>
      )}
    </SurfaceCard>
  )
}

export default CollectionHealthPanel