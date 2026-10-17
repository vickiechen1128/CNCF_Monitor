/**
 * 首页「整体率」圆环几何（2026-10-17 第七轮走查定稿）。
 *
 * 首页有两个结构完全同构的圆环：04「整体纳管完成率」与拨测「正常率」。
 * 走查前两者各写一份几何——120×120 / r=47 / stroke=11 与 100×100 / r=42 / stroke=9——
 * 并排时直径与环厚都不同，同屏两个「整体率」看起来像两张图拼在一起。
 *
 * 现收口为本模块的**唯一定义**：两环共用 120×120 视图、半径 47、描边 11、圆心 (60,60)，
 * 心字号共用 `HOME_FONT.hero`。要调环的大小只改这里，两环永远同步。
 */
export const DONUT_GEOMETRY = {
  /** svg 边长（width/height/viewBox 三处共用） */
  size: 120,
  /** 圆心坐标（size / 2） */
  center: 60,
  /** 环半径：47 + 11/2 = 52.5 → 外沿 112.5，不越出 120 视框 */
  radius: 47,
  /** 环厚：11px 在 120 视图内粗细适中（100 视图下的 9 换算后偏细） */
  stroke: 11,
} as const

/** 圆周长（dasharray 基数） */
export const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_GEOMETRY.radius
