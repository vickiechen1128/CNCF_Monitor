/**
 * 指标查询页纯逻辑：时间范围、步长、matrix → 图表网格、序列摘要、URL 状态。
 *
 * 与 React / ECharts 解耦，便于单测覆盖「断点不连线」「0 与无数据可区分」
 * 等交互契约（见 docs/07-design/design-notes/m09-query-page-ux.md）。
 */
import type { PromMatrixItem, PromSamplePair } from '../../types/query'

/** 常用快捷时间范围（秒） */
export const QUICK_RANGES = [
  { value: '15m', label: '最近 15 分钟', seconds: 15 * 60 },
  { value: '1h', label: '最近 1 小时', seconds: 60 * 60 },
  { value: '6h', label: '最近 6 小时', seconds: 6 * 60 * 60 },
  { value: '24h', label: '最近 24 小时', seconds: 24 * 60 * 60 },
  { value: '7d', label: '最近 7 天', seconds: 7 * 24 * 60 * 60 },
  { value: '30d', label: '最近 30 天', seconds: 30 * 24 * 60 * 60 },
] as const

export type QuickRangeValue = (typeof QUICK_RANGES)[number]['value']

/** 默认表达式与默认时间范围（设计专题 §3） */
export const DEFAULT_QUERY = 'up'
export const DEFAULT_RANGE_SECONDS = 6 * 60 * 60
export const MIN_STEP_SECONDS = 15
export const MAX_QUERY_POINTS = 11000
export const MAX_QUERY_LENGTH = 8 * 1024
export const TARGET_QUERY_POINTS = 1000

/** 预设模板（设计专题 §8） */
export const QUERY_PRESETS = [
  { value: 'health', label: '采集健康', expr: 'up' },
  { value: 'scrape-duration', label: '采集耗时', expr: 'scrape_duration_seconds' },
  { value: 'scrape-samples', label: '采集样本数', expr: 'scrape_samples_scraped' },
  {
    value: 'cpu',
    label: 'CPU 使用率',
    expr: '100 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100',
  },
] as const

export type QueryPresetValue = (typeof QUERY_PRESETS)[number]['value']

const PRESET_BY_VALUE = new Map(QUERY_PRESETS.map((preset) => [preset.value, preset]))
const QUICK_RANGE_BY_VALUE = new Map(QUICK_RANGES.map((range) => [range.value, range]))

/** 图表序列：x 为毫秒时间戳，y 为 null 表示该点无数据（断点） */
export interface ChartSeries {
  label: string
  data: [number, number | null][]
}

/** 单条序列的摘要统计（只统计有限值，0 参与统计） */
export interface SeriesStats {
  latest: number | null
  min: number | null
  max: number | null
  avg: number | null
  count: number
}

/** 查询页 URL 状态 */
export interface QueryState {
  expr: string
  from: number
  to: number
  step: number
  preset?: QueryPresetValue
}

/** 常见步长序列：15s ~ 7d，保证图表可读且点数受控 */
const NICE_STEPS = [
  15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 21600, 43200, 86400,
  172800, 604800,
]

/**
 * 将任意秒数向上归一到常见步长。
 * 例如 16 → 30、1000 → 1800、21600/1000=22 → 30。
 */
export function niceStep(seconds: number): number {
  const raw = Math.max(MIN_STEP_SECONDS, Math.ceil(Number.isFinite(seconds) ? seconds : MIN_STEP_SECONDS))
  return NICE_STEPS.find((step) => step >= raw) ?? NICE_STEPS[NICE_STEPS.length - 1]
}

/** 按目标点数计算步长（设计专题 §4：约 1000 点） */
export function computeStep(from: number, to: number): number {
  const span = Math.max(1, Math.floor(to) - Math.floor(from))
  return niceStep(Math.max(MIN_STEP_SECONDS, Math.ceil(span / TARGET_QUERY_POINTS)))
}

/** 快捷范围 → 起止时间（unix 秒） */
export function resolveQuickRange(
  value: QuickRangeValue,
  nowSeconds = Math.floor(Date.now() / 1000),
): { from: number; to: number } {
  const range = QUICK_RANGE_BY_VALUE.get(value) ?? QUICK_RANGE_BY_VALUE.get('6h')
  const seconds = range?.seconds ?? DEFAULT_RANGE_SECONDS
  return { from: nowSeconds - seconds, to: nowSeconds }
}

/** 当前起止时间对应的快捷范围；不匹配时返回 undefined（自定义范围） */
export function matchQuickRange(from: number, to: number): QuickRangeValue | undefined {
  const span = Math.floor(to) - Math.floor(from)
  return QUICK_RANGES.find((range) => range.seconds === span)?.value
}

/**
 * matrix → 图表网格。按查询 step 生成完整时间轴，缺失点补 null，
 * `connectNulls=false` 时形成断点；0 是有效值，必须保留。
 */
export function toGrid(matrix: PromMatrixItem[], start: number, end: number, step: number): ChartSeries[] {
  const startSec = Math.floor(start)
  const endSec = Math.floor(end)
  const stepSec = Math.max(1, Math.floor(step))
  const grid: number[] = []
  for (let t = startSec; t <= endSec; t += stepSec) grid.push(t)

  return matrix.map((series) => {
    const byTimestamp = new Map<number, number>()
    for (const [timestamp, raw] of series.values) {
      const value = raw === '' ? Number.NaN : Number(raw)
      if (!Number.isFinite(value)) continue
      byTimestamp.set(Math.round(timestamp), value)
    }
    return {
      label: formatLabels(series.metric),
      data: grid.map((t) => [t * 1000, byTimestamp.has(t) ? (byTimestamp.get(t) as number) : null]),
    }
  })
}

/** 序列摘要：最新 / 最小 / 最大 / 平均，只统计有限值 */
export function summarizeSeries(values: PromSamplePair[]): SeriesStats {
  const finite: number[] = []
  for (const [, raw] of values) {
    const value = raw === '' ? Number.NaN : Number(raw)
    if (Number.isFinite(value)) finite.push(value)
  }
  if (finite.length === 0) {
    return { latest: null, min: null, max: null, avg: null, count: 0 }
  }
  const sum = finite.reduce((total, value) => total + value, 0)
  return {
    latest: finite[finite.length - 1],
    min: Math.min(...finite),
    max: Math.max(...finite),
    avg: sum / finite.length,
    count: finite.length,
  }
}

/** 标签格式化：`up{instance="x", job="node"}`，键排序保证稳定 */
export function formatLabels(metric: Record<string, string>): string {
  const name = metric.__name__ ?? ''
  const labels = Object.entries(metric)
    .filter(([key]) => key !== '__name__')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${promqlString(value)}"`)
    .join(', ')
  if (!name) return labels ? `{${labels}}` : '{}'
  return labels ? `${name}{${labels}}` : name
}

/** PromQL 字符串字面量转义 */
export function promqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

/** 仅由指标名组成的表达式（可用于辅助选择器回填） */
export function parseBareMetric(expr: string): string | undefined {
  const trimmed = expr.trim()
  return /^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(trimmed) ? trimmed : undefined
}

/**
 * 快速构造指标选择器：`metric{job="...", instance="..."}`。
 * 未提供标签时只返回指标名；标签值按 PromQL 字符串字面量转义。
 */
export function buildSelector(
  metric: string,
  labels: { job?: string; instance?: string } = {},
): string {
  const matchers: string[] = []
  if (labels.job) matchers.push(`job="${promqlString(labels.job)}"`)
  if (labels.instance) matchers.push(`instance="${promqlString(labels.instance)}"`)
  return matchers.length > 0 ? `${metric}{${matchers.join(', ')}}` : metric
}

/** 解析 URL 状态；非法参数回落默认值（设计专题 §3） */
export function parseQueryState(
  searchParams: URLSearchParams,
  nowSeconds = Math.floor(Date.now() / 1000),
): QueryState {
  const presetValue = searchParams.get('preset')
  const preset = presetValue && PRESET_BY_VALUE.has(presetValue as QueryPresetValue)
    ? (presetValue as QueryPresetValue)
    : undefined

  const expr = preset
    ? (PRESET_BY_VALUE.get(preset)?.expr ?? DEFAULT_QUERY)
    : (searchParams.get('expr')?.trim() || DEFAULT_QUERY)

  const rawFrom = Number(searchParams.get('from'))
  const rawTo = Number(searchParams.get('to'))
  const hasValidWindow =
    Number.isFinite(rawFrom) &&
    Number.isFinite(rawTo) &&
    rawTo > rawFrom &&
    rawTo - rawFrom <= 30 * 24 * 60 * 60

  const from = hasValidWindow ? Math.floor(rawFrom) : nowSeconds - DEFAULT_RANGE_SECONDS
  const to = hasValidWindow ? Math.floor(rawTo) : nowSeconds

  const rawStep = Number(searchParams.get('step'))
  const step = Number.isFinite(rawStep) && rawStep >= MIN_STEP_SECONDS
    ? Math.floor(rawStep)
    : computeStep(from, to)

  return { expr, from, to, step, preset }
}

/** 查询状态 → URL 参数（分享/刷新复现） */
export function buildQuerySearch(state: QueryState): Record<string, string> {
  const params: Record<string, string> = {
    expr: state.expr,
    from: String(Math.floor(state.from)),
    to: String(Math.floor(state.to)),
    step: String(Math.floor(state.step)),
  }
  if (state.preset) params.preset = state.preset
  return params
}

/** AbortController 取消的请求不应展示为错误 */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError')
  )
}

/** 表达式是否超过后端 8 KiB 护栏（按 UTF-8 字节数） */
export function queryLengthBytes(expr: string): number {
  return new TextEncoder().encode(expr).length
}
