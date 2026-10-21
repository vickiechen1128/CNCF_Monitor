/**
 * 「采集健康」面板（M05 反馈 10，路线 B；2026-10-17 走查：解释文案整合；
 * 第五轮走查：上移与告警状态 2:1 并排）。
 *
 * 工程师视角：回答「已下发的这批数据采到了吗、哪些没在采」，与领导视角的 04 段
 * 「监控对象纳管进度」（下发配置进度）分开展示。
 *
 * **位置（2026-10-17 第六轮走查定）**：与拨测态势并排（home-health-probe-row，
 * 采集 1 : 拨测 2）。这与反馈 11 §11.2 ⑧「采集健康不与 04 相邻」的原约定冲突——
 * 产品负责人重新裁定：并排后两者仍是不同卡、不同口径、有 Tooltip 分隔，
 * 「分开展示」的实质不变；且工程师视角的「数据到没到」与「探测通不通」同属
 * 采集链路运行态，并排阅读更顺（裁定记录见 design-proposal §7）。
 * 与 04 的口径分工文案（可见副标题）保持原状，未随位置改动。
 *
 * 口径（见 dev-feedback 反馈 10 §10.5 / 反馈 12 / `api/dashboard.ts` 的 `CollectionHealth`）：
 * - 分母 = **已选中资源数**（= `monitored_count`），**不含未下发**——未下发进度归 04 段；
 * - 两态 = 采集中 / 已下发未采到，与「监控对象管理」页采集状态**完全同一口径**；**拨测目标不参与**；
 * - 判定由后端一次聚合（`collection_health`），前端零聚合逻辑；字段缺失 → 按「不可用」呈现，
 *   绝不误报 0（决策 68-2）。
 *
 * **解释整合（2026-10-17 走查，产品负责人裁定）**：原面板「顶部副标题 + 底部脚注」
 * 两段长解释讲的是同一件事（与上方纳管率的口径分工），上下夹击信息过载。
 * 现只保留**一行可见副标题**讲清分工；「拨测目标不参与统计」等次要口径进**标题
 * Tooltip**；各图例项的判定口径进该项 Tooltip（原本就在）。
 *
 * 移动适配（手机竖屏 ≤767px，见 homeResponsive.ts）：分布条整宽；两态图例在
 * 窄屏不变（行式本就窄屏友好）；标题行的「查看资源明细 →」保持右对齐（短文本不
 * 溢出）。与拨测的并排行在窄容器（≈936px 以下）经 flex-wrap 自动折为上下堆叠，
 * 堆叠后卡高即内容高、两行回到自然行高（minHeight），无需额外断点。
 */
import { Link } from 'react-router-dom'
import { InfoCircleOutlined } from '@ant-design/icons'
import { Tooltip, Typography, theme } from 'antd'
import { SurfaceCard } from './SurfaceCard'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'
import type { CollectionHealth } from '../../api/dashboard'

const { Text } = Typography

/** 资源清单页深链：采集状态列即本面板明细（M07「资源管理中心」） */
const RESOURCE_LIST_HREF = '/resources'
/** 无已下发资源时的引导入口：建采集 Job */
const SCRAPE_JOB_HREF = '/scrape-jobs'

/** 标题 Tooltip：只讲**边界**（分母、判定口径、谁不参与），
 *  「与 04 的分工」由可见副标题一句话说完——两处不重复同一段口径（第六轮走查） */
const HEALTH_SCOPE_TIP =
  '分母＝已被采集任务选中的资源；判定与「监控对象管理」页同一口径：5 分钟内有成功采集为「采集中」，否则为「已下发未采到」；拨测目标不参与统计。'

interface CollectionHealthPanelProps {
  /** 后端采集健康两态聚合；缺失（后端未实现 / 查询失败）时为 undefined */
  health?: CollectionHealth
}

/** 两态展示元数据：key → 展示名 + 语义色 + Tooltip 口径（与「监控对象管理」页同色） */
interface StateMeta {
  key: keyof Pick<CollectionHealth, 'collecting_count' | 'down_count'>
  label: string
  color: (token: ReturnType<typeof theme.useToken>['token']) => string
  hint: string
}

const STATE_METAS: StateMeta[] = [
  {
    key: 'collecting_count',
    label: '采集中',
    color: (t) => t.colorSuccess,
    // Tooltip 用人话（2026-10-17 走查）：原先写「5 分钟内有 up 样本且采集成功（=1）」，领导读不懂
    hint: '5 分钟内有数据上报，采集正常。',
  },
  {
    key: 'down_count',
    label: '已下发未采到',
    // 与「监控对象管理」页 `MonitorStatusBadge` 的 warning（橙）一致；反馈 12 前此处为红色
    color: (t) => t.colorWarning,
    hint: '已被采集任务选中，但 5 分钟内没有成功采集到数据（含尚未首次抓取、回传延迟、采集失败）。',
  },
]

export function CollectionHealthPanel({ health }: CollectionHealthPanelProps) {
  const { token } = theme.useToken()

  const unavailable = health === undefined
  const dispatched = health?.dispatched_count ?? 0

  return (
    <SurfaceCard
      data-testid="collection-health-panel"
      // 与拨测态势并排（home-health-probe-row，flex 1 1 360px）：行内 stretch 对齐，
      // 撑满行高；窄容器折行后 height:100% 解析为 auto（同 02/03 面板模式）。
      // 卡根 display:flex + 卡体 flex:1：两态图例的 flex:1 才生效（卡根非 flex 时
      // body 的 flex:1 不生效——卡高满而内容悬在卡顶）。
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { padding: 20, display: 'flex', flexDirection: 'column', flex: 1 } }}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          采集健康
          <Tooltip title={HEALTH_SCOPE_TIP}>
            <InfoCircleOutlined
              aria-label="采集健康口径说明"
              style={{ fontSize: 12, color: token.colorTextTertiary, cursor: 'help' }}
            />
          </Tooltip>
        </span>
      }
      extra={
        <Link to={RESOURCE_LIST_HREF} data-testid="ch-detail-link" style={{ fontSize: HOME_FONT.label }}>
          查看资源采集健康状态 →
        </Link>
      }
    >
      {/* 口径副标题（2026-10-17 整合后**唯一**的可见解释）：只讲与上方 04 段的分工，
          一句话说完；其余口径（拨测不参与 / 两态判定）进 Tooltip，不再上下两段夹击。 */}
      <Text type="secondary" style={{ fontSize: HOME_FONT.body }}>
        这里看的是实际采集情况；上方「监控对象纳管完成率」看的是配置完成度，两者口径不同。
      </Text>

      {unavailable ? (
        <div
          data-testid="ch-unavailable"
          style={{ marginTop: 16, padding: '20px 0', textAlign: 'center', color: token.colorTextTertiary, fontSize: HOME_FONT.label }}
        >
          采集健康数据暂不可用
        </div>
      ) : dispatched === 0 ? (
        <div style={{ marginTop: 16, padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: HOME_FONT.title, fontWeight: HOME_WEIGHT.title }}>
            暂无已配置采集任务的资源
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: HOME_FONT.body }}>
            创建并下发采集任务后，这里会展示这些资源的实际采集情况。
          </Text>
          <Link to={SCRAPE_JOB_HREF} style={{ display: 'inline-block', marginTop: 10 }} data-testid="ch-empty-link">
            去建采集任务 →
          </Link>
        </div>
      ) : (
        <>
          {/* 两态分布条：各段宽度按计数占比，段间 2px 间隙保证相邻段可辨 */}
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

          {/* 图例计数（反馈 12 起两态）：每格色点 + 状态名（左）、计数（右，14px/700）。
              两项各占约半行；格子 flex 双向拉伸，卡被行拉伸时分摊剩余高度、不留底部空白，
              卡未被拉伸时（窄屏堆叠）回到 minHeight 自然高度。
              每项 Tooltip 自带判定口径，不再需要面板底部脚注。 */}
          <div
            data-testid="ch-legend"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              flex: 1,
              alignContent: 'stretch',
              marginTop: 14,
            }}
          >
            {STATE_METAS.map((m) => (
              <div
                key={m.key}
                data-testid={`ch-legend-${m.key}`}
                style={{
                  flex: '1 1 45%',
                  minWidth: 0,
                  minHeight: 28,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: '50%', background: m.color(token), flexShrink: 0 }}
                />
                <Tooltip title={m.hint}>
                  <span
                    style={{
                      fontSize: HOME_FONT.body,
                      color: token.colorTextSecondary,
                      cursor: 'help',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.label}
                  </span>
                </Tooltip>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: HOME_FONT.title,
                    fontWeight: HOME_WEIGHT.number,
                    color: token.colorText,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {health[m.key]}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </SurfaceCard>
  )
}

export default CollectionHealthPanel