/**
 * 04「监控对象纳管完成率」整体圆环（2026-10-17 第五轮走查定稿，产品负责人确认；
 * 第六轮走查改词：「纳管进度」→「纳管完成率」——进度是过程量、完成率是结果量，
 * 领导要的是「百分之多少纳完了」）。
 *
 * 由「32px 大数字 + 8px 进度条」改为**百分比圆环**：整体纳管进度是首页唯一呈现点
 * （反馈 11 §11.2 ⑤），圆环比进度条更省纵向高度；更重要的是它与右侧六类表格
 * 构成「一个整体 + 六行明细」的共同体读法——旧版六张卡与区块头部大数字平级排布，
 * 用户看不出「整体与部分」的关系（第五轮反馈原话：看不出是一个共同的关系）。
 *
 * 口径与旧实现逐字一致（R1 不变量不变）：
 * - percent = 已下发 ÷ 资源总数（取整），由 HomePage 计算后传入；
 * - 任一字段缺失 / 总数为 0 → 圆心显示 '-'，**绝不渲染 0%**（不把「无数据」
 *   表达成「覆盖率为零」）；
 * - 颜色恒取品牌色 `token.colorPrimary`：整体口径只报数、不预警
 *   （<70% 转橙是六类表格**行**的语义，整体进度不适用，与旧进度条同口径）。
 *
 * 无障碍契约与原进度条一致：`overall-coverage-bar` 锚点保留在圆环 svg 上，
 * role="progressbar" + aria-valuenow/min/max + 带百分比口径的 aria-label；
 * `overall-coverage-percent` 锚点保留在圆心文字上（SVG <text>，RTL 可断言）。
 */
import { theme } from 'antd'
import { DONUT_CIRCUMFERENCE, DONUT_GEOMETRY } from './homeDonut'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'

/** 圆环几何统一由 homeDonut.ts 定义（与拨测正常率圆环共用，见该文件注释） */
const { size: DONUT_SIZE, center: DONUT_CENTER, radius: DONUT_RADIUS, stroke: DONUT_STROKE } =
  DONUT_GEOMETRY

interface CoverageDonutProps {
  /** 整体纳管完成率百分数（取整）；undefined → 圆心 '-'、圆环空置（aria-valuenow 记 0，同旧进度条） */
  percent: number | undefined
  /** 已下发资源数（缺失显示 '-'，不静默成 0——决策 68-2） */
  monitored: number | undefined
  /** 资源总数（缺失显示 '-'） */
  total: number | undefined
}

export function CoverageDonut({ percent, monitored, total }: CoverageDonutProps) {
  const { token } = theme.useToken()
  const value = percent ?? 0
  // 弧长 = 占比 × 周长；percent 缺失时 dash 为 0（只显示轨道），与旧进度条「空条」同态
  const dash = `${(Math.min(100, Math.max(0, value)) / 100) * DONUT_CIRCUMFERENCE} ${DONUT_CIRCUMFERENCE}`

  return (
    <div
      data-testid="overall-coverage-donut"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}
    >
      <svg
        data-testid="overall-coverage-bar"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`监控对象纳管完成率 ${percent ?? '-'}%`}
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
          stroke={token.colorPrimary}
          strokeWidth={DONUT_STROKE}
          strokeLinecap="round"
          strokeDasharray={dash}
          transform={`rotate(-90 ${DONUT_CENTER} ${DONUT_CENTER})`}
        />
        {/* 圆心百分比：等宽数字，色值与弧同源（token.colorPrimary） */}
        <text
          data-testid="overall-coverage-percent"
          x={DONUT_CENTER}
          y={DONUT_CENTER + 1}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={HOME_FONT.hero}
          fontWeight={HOME_WEIGHT.number}
          fill={token.colorPrimary}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {percent !== undefined ? `${percent}%` : '-'}
        </text>
      </svg>
      {/* 环下两行：标签 + 已配置 / 共（锚点 overall-coverage-value 保留旧文本结构）。
          第六轮走查改词：「已下发」被产品负责人指出「下发什么说不清」，随 L1 表格
          一并改为「已配置」——完整口径（采集任务配置）由环下注解一句说清。 */}
      <div style={{ marginTop: 8, fontSize: HOME_FONT.body, color: token.colorTextSecondary }}>
        整体纳管完成率
      </div>
      <div
        data-testid="overall-coverage-value"
        style={{
          fontSize: HOME_FONT.body,
          color: token.colorTextSecondary,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        已配置 {monitored ?? '-'} / 共 {total ?? '-'}
      </div>
    </div>
  )
}

export default CoverageDonut
