/**
 * 拨测「正常率」整体健康度圆环（2026-10-17 第六轮走查新增，产品负责人要求：
 * 「正常率可以仿照整体纳管进度的样式，体现整体情况」）。
 *
 * 与 04「整体纳管完成率」圆环（CoverageDonut）同构：圆环 + 圆心百分数 + 环下标签 +
 * 对账值行。区别在语义色——纳管完成率恒品牌色（配置口径只报数、不预警），
 * **正常率是健康度指标**：100% 转语义绿（全部正常）、其余转品牌色（报数）、
 * 无拨测目标转中性灰且圆心 '-'（决策 68-2：不把「没有数据」表达成「健康度零」）。
 *
 * 与两个子分区的四格统计条的分工：分区条给**分区内**明细（共 N · 正常 X · 异常 Y ·
 * 未知 Z），本圆环给**整体**健康度——领导一眼看「百分之多少的拨测是好的」，
 * 不必自己拿 X 除 N。原区头汇总行（「拨测目标 N · 正常 X · 异常 Y · 未知 Z」）
 * 按产品负责人要求移除，其对账数字收进本圆环的值行与 Tooltip。
 *
 * 无障碍契约与 CoverageDonut 一致：svg 挂 role=progressbar + aria-valuenow/min/max +
 * 带口径的 aria-label；圆心百分数为 SVG <text>（RTL 可断言）。
 */
import { theme } from 'antd'
import { Tooltip } from 'antd'
import { DONUT_CIRCUMFERENCE, DONUT_GEOMETRY } from './homeDonut'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'

/**
 * 圆环几何：**与 04 纳管完成率圆环共用 homeDonut.ts 的唯一定义**（2026-10-17 第七轮走查）。
 * 本环原为 100×100 / r=42 / stroke=9、心字号 20，与 04 的 120×120 / r=47 / stroke=11 / 24
 * 并排时「两个整体率」直径与环厚都不同——同屏出现两个大小不一的同类指标，是版面
 * 最扎眼的一处不整齐。现两环几何与心字号完全一致，只保留语义色差异
 * （正常率 100% 转绿、其余品牌色；纳管率恒品牌色）。
 */
const { size: DONUT_SIZE, center: DONUT_CENTER, radius: DONUT_RADIUS, stroke: DONUT_STROKE } =
  DONUT_GEOMETRY

interface ProbeHealthDonutProps {
  /** 正常率百分数（取整）；undefined → 圆心 '-'、圆环空置（aria-valuenow 记 0） */
  percent: number | undefined
  /** 正常拨测目标数（值行对账） */
  normal: number
  /** 拨测目标总数（值行对账） */
  total: number
  /** 异常数（Tooltip 对账） */
  abnormal: number
  /** 未知数（Tooltip 对账） */
  unknown: number
}

export function ProbeHealthDonut({
  percent,
  normal,
  total,
  abnormal,
  unknown,
}: ProbeHealthDonutProps) {
  const { token } = theme.useToken()
  const value = percent ?? 0
  // 弧长 = 占比 × 周长；percent 缺失时 dash 为 0（只显示轨道）
  const dash = `${(Math.min(100, Math.max(0, value)) / 100) * DONUT_CIRCUMFERENCE} ${DONUT_CIRCUMFERENCE}`
  // 语义色：100% 绿（健康）/ 其余品牌色（报数）/ 无数据中性灰
  const arcColor =
    percent === undefined
      ? token.colorTextQuaternary
      : percent === 100
        ? token.colorSuccess
        : token.colorPrimary

  return (
    <Tooltip
      title={`正常 ${normal} / 共 ${total} · 异常 ${abnormal} · 未知 ${unknown}；正常率 = 正常的拨测目标 ÷ 拨测目标总数`}
    >
      <div
        data-testid="probe-health-donut"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}
      >
        <svg
          data-testid="probe-health-rate"
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`拨测正常率 ${percent ?? '-'}%`}
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
        >
          {/* 轨道：置底灰环，percent 缺失时仅剩它（不误报 0%） */}
          <circle
            cx={DONUT_CENTER}
            cy={DONUT_CENTER}
            r={DONUT_RADIUS}
            fill="none"
            stroke={token.colorFillSecondary}
            strokeWidth={DONUT_STROKE}
          />
          {/* 进度弧：12 点钟方向起笔（rotate -90），圆头收边 */}
          <circle
            cx={DONUT_CENTER}
            cy={DONUT_CENTER}
            r={DONUT_RADIUS}
            fill="none"
            stroke={arcColor}
            strokeWidth={DONUT_STROKE}
            strokeLinecap="round"
            strokeDasharray={dash}
            transform={`rotate(-90 ${DONUT_CENTER} ${DONUT_CENTER})`}
          />
          {/* 圆心百分数：等宽数字，色值与弧同源；字号与 04 环心一致（HOME_FONT.hero） */}
          <text
            data-testid="probe-health-rate-percent"
            x={DONUT_CENTER}
            y={DONUT_CENTER + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={HOME_FONT.hero}
            fontWeight={HOME_WEIGHT.number}
            fill={arcColor}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {percent !== undefined ? `${percent}%` : '-'}
          </text>
        </svg>
        {/* 环下两行：标签 + 对账值（锚点结构同 CoverageDonut，字号同 body 级） */}
        <div style={{ marginTop: 8, fontSize: HOME_FONT.body, color: token.colorTextSecondary }}>
          正常率
        </div>
        <div
          data-testid="probe-health-rate-value"
          style={{
            fontSize: HOME_FONT.body,
            color: token.colorTextSecondary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          正常 {normal} / 共 {total}
        </div>
      </div>
    </Tooltip>
  )
}

export default ProbeHealthDonut
