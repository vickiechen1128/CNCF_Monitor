/**
 * 指标查询页（Module_09 FR-22 / NFR-11 / NFR-12）。
 *
 * 页面不提供网域选择器：一次查询自动覆盖当前用户被授权的全部网域，
 * 服务端在转发前注入 `network_domain_id` 过滤（越权数据不可见）。
 *
 * 能力：
 * - PromQL 区间查询（`/api/v1/query_range`），快捷 / 自定义时间范围与自动步长；
 * - ECharts 时序图：缺失点断线、0 保留、图例、悬浮提示、缩放；
 * - 序列明细（最新 / 最小 / 最大 / 平均）与查询元信息（时间范围 / 步长 / 序列数 / 耗时 / 覆盖网域 / 新鲜度）；
 * - URL 复现（`/query?expr=&from=&to=&step=&preset=`）、预设、取消查询、空态 / 错误态。
 *
 * 交互契约见 docs/07-design/design-notes/m09-query-page-ux.md。
 * 布局自包 `MainLayout`：`RequireAuth` 只返回 `<Outlet />`，不自包会丢失 Header / Sider。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useSearchParams } from 'react-router-dom'
import { queryApi } from '../../api/query'
import { ApiError } from '../../api/client'
import { MainLayout } from '../../layouts/MainLayout'
import { EllipsisText } from '../../components/EllipsisText'
import { LoadingPlaceholder } from '../../components/LoadingPlaceholder'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { TimeSeriesChart } from './TimeSeriesChart'
import { formatChartValue } from './chartOption'
import {
  MAX_QUERY_LENGTH,
  MAX_QUERY_POINTS,
  MIN_STEP_SECONDS,
  QUERY_PRESETS,
  QUICK_RANGES,
  buildQuerySearch,
  buildSelector,
  computeStep,
  formatLabels,
  isAbortError,
  matchQuickRange,
  parseBareMetric,
  parseQueryState,
  queryLengthBytes,
  resolveQuickRange,
  summarizeSeries,
  toGrid,
} from './queryRange'
import type {
  ChartSeries,
  QueryPresetValue,
  QuickRangeValue,
  SeriesStats,
} from './queryRange'
import type { ApiMeta } from '../../types/api'
import type { PromMatrixItem } from '../../types/query'

const { Text } = Typography
const { RangePicker } = DatePicker

/** 与后端 NFR-11 护栏一致（前端先给出可读提示，最终以后端校验为准） */
const MAX_RANGE_SECONDS = 30 * 24 * 60 * 60
/** 序列过多时提示聚合 / 过滤（设计专题 §6） */
const SERIES_WARNING_THRESHOLD = 50

/** 已执行的查询快照：URL 与结果元信息都以它为准，避免表单改动污染已展示结果 */
interface ExecutedQuery {
  expr: string
  from: number
  to: number
  step: number
  preset?: QueryPresetValue
}

interface QueryResultState extends ExecutedQuery {
  matrix: PromMatrixItem[]
  series: ChartSeries[]
  meta?: ApiMeta
  elapsedMs: number
}

interface SeriesRow {
  key: string
  label: string
  stats: SeriesStats
  points: number
}

/** 步长展示：30s / 5m / 1h / 1d */
function formatStep(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

/** 数据新鲜度：查询时刻距现在的相对时间 */
function formatFreshness(iso?: string): string {
  if (!iso) return '-'
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return '-'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s 前`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m 前`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h 前`
  return `${Math.floor(seconds / 86_400)}d 前`
}

/** 客户端预检：与后端护栏同口径，命中即阻止请求并给出可执行提示 */
function validateQueryInput(
  expr: string,
  from: number,
  to: number,
  step: number,
): string | null {
  if (!expr) return '请输入 PromQL 表达式后再执行查询'
  const bytes = queryLengthBytes(expr)
  if (bytes > MAX_QUERY_LENGTH) {
    return `查询表达式长度 ${bytes} 字节，超过上限 ${MAX_QUERY_LENGTH} 字节，请简化表达式后重试`
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return '请选择有效的查询时间范围'
  }
  if (to <= from) return '结束时间必须晚于开始时间'
  if (to - from > MAX_RANGE_SECONDS) {
    return '查询时间范围超过 30 天，请缩小时间范围后重试'
  }
  if (step < MIN_STEP_SECONDS) return '查询步长不能小于 15 秒'
  if (Math.floor((to - from) / step) + 1 > MAX_QUERY_POINTS) {
    return '预计返回点数超过上限 11000，请增大步长或缩小时间范围后重试'
  }
  return null
}

/** 错误文案：`bad_data` 额外提示检查 PromQL，其余保留上游原文 */
function formatQueryError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.errorType === 'bad_data') {
      return `${error.message}（请检查 PromQL 语法与时间范围）`
    }
    return error.message
  }
  if (error instanceof Error) return error.message
  return String(error)
}

const SERIES_COLUMNS: ColumnsType<SeriesRow> = [
  {
    title: '指标序列',
    key: 'label',
    render: (_value: unknown, record: SeriesRow) => (
      <EllipsisText maxWidth={420}>{record.label}</EllipsisText>
    ),
  },
  {
    title: '最新',
    key: 'latest',
    render: (_value: unknown, record: SeriesRow) => formatChartValue(record.stats.latest),
  },
  {
    title: '最小',
    key: 'min',
    render: (_value: unknown, record: SeriesRow) => formatChartValue(record.stats.min),
  },
  {
    title: '最大',
    key: 'max',
    render: (_value: unknown, record: SeriesRow) => formatChartValue(record.stats.max),
  },
  {
    title: '平均',
    key: 'avg',
    render: (_value: unknown, record: SeriesRow) => formatChartValue(record.stats.avg),
  },
  {
    title: '点数',
    key: 'points',
    render: (_value: unknown, record: SeriesRow) => record.points,
  },
]

/** 查询元信息：时间范围 / 步长 / 序列数 / 耗时 / 覆盖网域 / 新鲜度 */
function QueryMetaBar({ result }: { result: QueryResultState }) {
  const domains = result.meta?.network_domains ?? []
  return (
    <Space size={16} wrap data-testid="query-meta">
      <Text type="secondary" data-testid="query-time-range">
        时间范围 {dayjs(result.from * 1000).format('MM-DD HH:mm')} ~{' '}
        {dayjs(result.to * 1000).format('MM-DD HH:mm')}
      </Text>
      <Text type="secondary">步长 {formatStep(result.step)}</Text>
      <Text type="secondary">序列 {result.matrix.length}</Text>
      <Text type="secondary">耗时 {result.elapsedMs}ms</Text>
      <Text type="secondary" data-testid="query-domains">
        覆盖网域 {domains.length > 0 ? domains.join(', ') : '-'}
      </Text>
      <Text type="secondary">新鲜度 {formatFreshness(result.meta?.freshness_at)}</Text>
    </Space>
  )
}

export function QueryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // 只在首次渲染解析 URL，避免执行查询后 setSearchParams 反向覆盖用户正在编辑的表单。
  const [initial] = useState(() => parseQueryState(searchParams))
  const hasUrlState = useMemo(
    () => ['expr', 'from', 'to', 'step', 'preset'].some((key) => searchParams.has(key)),
    [searchParams],
  )

  const [expr, setExpr] = useState(initial.expr)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [step, setStep] = useState(initial.step)
  const [preset, setPreset] = useState<QueryPresetValue | undefined>(initial.preset)
  const [result, setResult] = useState<QueryResultState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 指标名 / Job / 实例辅助选择：懒加载标签值，选择后快速构造简单选择器。
  const [metricName, setMetricName] = useState(() => parseBareMetric(initial.expr) ?? '')
  const [job, setJob] = useState<string>()
  const [instance, setInstance] = useState<string>()
  const [metricNames, setMetricNames] = useState<string[]>([])
  const [jobNames, setJobNames] = useState<string[]>([])
  const [instanceNames, setInstanceNames] = useState<string[]>([])
  const [labelLoading, setLabelLoading] = useState<'metric' | 'job' | 'instance' | null>(null)
  const loadedLabels = useRef(new Set<string>())

  // 请求序号：取消 / 新查询后，过期响应直接丢弃，避免旧结果覆盖新结果。
  const requestSeq = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const didAutoRun = useRef(false)

  const loadLabelValues = useCallback(async (kind: 'metric' | 'job' | 'instance') => {
    const label = kind === 'metric' ? '__name__' : kind
    if (loadedLabels.current.has(label)) return
    loadedLabels.current.add(label)
    setLabelLoading(kind)
    try {
      const res = await queryApi.labelValues(label)
      if (res.status !== 'success' || !Array.isArray(res.data)) {
        // 上游错误也允许下次展开时重试。
        loadedLabels.current.delete(label)
        return
      }
      const values = res.data
      if (kind === 'metric') setMetricNames(values)
      else if (kind === 'job') setJobNames(values)
      else setInstanceNames(values)
    } catch {
      // 辅助选择失败不阻塞手写 PromQL；允许下次展开时重试。
      loadedLabels.current.delete(label)
    } finally {
      setLabelLoading(null)
    }
  }, [])

  const runQuery = useCallback(async () => {
    const trimmed = expr.trim()
    const guardError = validateQueryInput(trimmed, from, to, step)
    if (guardError) {
      setError(guardError)
      setNotice(null)
      setResult(null)
      return
    }

    // 新查询取消在途旧查询；旧请求的 catch/finally 会因 seq 不匹配而跳过。
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++requestSeq.current
    const startedAt = performance.now()
    const executed: ExecutedQuery = { expr: trimmed, from, to, step, preset }

    setLoading(true)
    setError(null)
    setNotice(null)

    try {
      const res = await queryApi.queryRange(
        { query: trimmed, start: from, end: to, step },
        { signal: controller.signal },
      )
      if (seq !== requestSeq.current) return
      if (res.status !== 'success') {
        setResult(null)
        setError(res.error || '查询失败')
        return
      }
      if (res.data.resultType !== 'matrix' || !Array.isArray(res.data.result)) {
        setResult(null)
        setError('查询返回了非区间结果，请调整表达式后重试')
        return
      }

      const matrix = res.data.result
      setResult({
        ...executed,
        matrix,
        series: toGrid(matrix, from, to, step),
        meta: res.meta,
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
      })
      // URL 记录已执行查询，刷新 / 分享可复现；replace 避免每次查询都新增历史记录。
      setSearchParams(buildQuerySearch(executed), { replace: true })
    } catch (err) {
      if (seq !== requestSeq.current) return
      if (isAbortError(err)) {
        setNotice('已取消查询')
        return
      }
      setResult(null)
      setError(formatQueryError(err))
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false)
        abortRef.current = null
      }
    }
  }, [expr, from, to, step, preset, setSearchParams])

  // URL 带参进入（深链 / 刷新 / 分享）时自动执行一次；空 URL 保持未查询空态。
  // 用微任务推迟到 effect 之外，避免同步 setState 触发级联渲染。
  useEffect(() => {
    if (didAutoRun.current) return
    didAutoRun.current = true
    if (hasUrlState) queueMicrotask(() => void runQuery())
  }, [hasUrlState, runQuery])

  const handleQuery = () => {
    void runQuery()
  }

  const handleCancel = () => {
    if (!loading) return
    // 主动失效请求序号：即使底层忽略 AbortSignal，过期响应也不会回填。
    requestSeq.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setNotice('已取消查询')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      handleQuery()
    }
  }

  const resetBuilder = () => {
    setMetricName('')
    setJob(undefined)
    setInstance(undefined)
  }

  const handleExprChange = (value: string) => {
    setExpr(value)
    // 用户改写表达式后，URL 里的 preset 与辅助选择器都不再代表当前表达式。
    setPreset(undefined)
    resetBuilder()
  }

  const handleMetricChange = (value?: string) => {
    setMetricName(value ?? '')
    setJob(undefined)
    setInstance(undefined)
    if (!value) return
    setExpr(value)
    setPreset(undefined)
    setError(null)
    setNotice(null)
  }

  const handleJobChange = (value?: string) => {
    setJob(value)
    if (!metricName) return
    setExpr(buildSelector(metricName, { job: value, instance }))
    setPreset(undefined)
  }

  const handleInstanceChange = (value?: string) => {
    setInstance(value)
    if (!metricName) return
    setExpr(buildSelector(metricName, { job, instance: value }))
    setPreset(undefined)
  }

  const handleQuickRange = (value: QuickRangeValue) => {
    const next = resolveQuickRange(value)
    setFrom(next.from)
    setTo(next.to)
    setStep(computeStep(next.from, next.to))
  }

  const handleCustomRange = (values: [Dayjs | null, Dayjs | null] | null) => {
    if (!values || !values[0] || !values[1]) return
    const nextFrom = values[0].unix()
    let nextTo = values[1].unix()
    if (nextTo <= nextFrom) return
    if (nextTo - nextFrom > MAX_RANGE_SECONDS) {
      nextTo = nextFrom + MAX_RANGE_SECONDS
    }
    setFrom(nextFrom)
    setTo(nextTo)
    setStep(computeStep(nextFrom, nextTo))
  }

  const applyPreset = (value: QueryPresetValue) => {
    const target = QUERY_PRESETS.find((item) => item.value === value)
    if (!target) return
    setExpr(target.expr)
    setPreset(value)
    resetBuilder()
    setError(null)
    setNotice(null)
  }

  const applySample = (value: string) => {
    setExpr(value)
    setPreset(undefined)
    resetBuilder()
    setError(null)
    setNotice(null)
  }

  const handleClear = () => {
    requestSeq.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setExpr('')
    setPreset(undefined)
    resetBuilder()
    setResult(null)
    setError(null)
    setNotice(null)
    setLoading(false)
    // 清空后 URL 也回到未查询状态，避免刷新又复现旧查询。
    setSearchParams({}, { replace: true })
  }

  const currentQuickRange = matchQuickRange(from, to)
  const rangeOptions = useMemo(
    () => QUICK_RANGES.map((range) => ({ value: range.value, label: range.label })),
    [],
  )

  const rows = useMemo<SeriesRow[]>(() => {
    if (!result) return []
    return result.matrix.map((item, index) => {
      const label = formatLabels(item.metric)
      return {
        key: `${index}-${label}`,
        label,
        stats: summarizeSeries(item.values),
        points: item.values.length,
      }
    })
  }, [result])

  const emptyResult = result !== null && result.matrix.length === 0
  const tooManySeries = result !== null && result.matrix.length > SERIES_WARNING_THRESHOLD

  return (
    <MainLayout>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            指标查询
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            查询当前账号可见的全部网域指标（网域过滤由服务端按授权自动完成）
          </Typography.Text>
        </div>

        <Card title="查询条件">
          <Input.TextArea
            value={expr}
            onChange={(event) => handleExprChange(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="例如：up 或 100 - avg by(instance)(rate(node_cpu_seconds_total{mode=&quot;idle&quot;}[5m])) * 100"
            aria-label="PromQL 表达式"
          />
          <Space size={12} style={{ marginTop: 12 }} wrap align="center">
            <Select
              aria-label="指标名"
              placeholder="指标名（辅助选择）"
              style={{ width: 240 }}
              showSearch
              allowClear
              value={metricName || undefined}
              options={metricNames.map((name) => ({ value: name, label: name }))}
              loading={labelLoading === 'metric'}
              onFocus={() => void loadLabelValues('metric')}
              onChange={handleMetricChange}
            />
            <Select
              aria-label="Job"
              placeholder="Job（可选）"
              style={{ width: 180 }}
              showSearch
              allowClear
              disabled={!metricName}
              value={job}
              options={jobNames.map((name) => ({ value: name, label: name }))}
              loading={labelLoading === 'job'}
              onFocus={() => void loadLabelValues('job')}
              onChange={handleJobChange}
            />
            <Select
              aria-label="实例"
              placeholder="实例（可选）"
              style={{ width: 220 }}
              showSearch
              allowClear
              disabled={!metricName}
              value={instance}
              options={instanceNames.map((name) => ({ value: name, label: name }))}
              loading={labelLoading === 'instance'}
              onFocus={() => void loadLabelValues('instance')}
              onChange={handleInstanceChange}
            />
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              辅助构造表达式，也可直接手写 PromQL
            </Typography.Text>
          </Space>
          <Space size={12} style={{ marginTop: 12 }} wrap align="center">
            <Select
              aria-label="时间范围"
              style={{ width: 160 }}
              value={currentQuickRange}
              placeholder="自定义"
              options={rangeOptions}
              onChange={handleQuickRange}
            />
            <RangePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={[dayjs(from * 1000), dayjs(to * 1000)]}
              onChange={handleCustomRange}
              disabledDate={(current) => current && current > dayjs().endOf('day')}
            />
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={loading}
              onClick={handleQuery}
            >
              查询
            </Button>
            {loading && (
              <Button danger icon={<StopOutlined />} onClick={handleCancel}>
                取消
              </Button>
            )}
            <Button onClick={handleClear}>清空</Button>
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              支持 Ctrl / Cmd + Enter 快捷查询
            </Typography.Text>
          </Space>
          <Space size={8} style={{ marginTop: 12 }} wrap>
            <Typography.Text type="secondary">预设：</Typography.Text>
            {QUERY_PRESETS.map((item) => (
              <Button
                key={item.value}
                size="small"
                type={preset === item.value ? 'primary' : 'default'}
                onClick={() => applyPreset(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </Space>
        </Card>

        {notice && (
          <Alert
            type="info"
            showIcon
            message={notice}
            closable
            onClose={() => setNotice(null)}
          />
        )}

        {error && (
          <Alert
            type="error"
            showIcon
            message="查询失败"
            description={error}
            data-testid="query-error"
          />
        )}

        <Card
          title="查询结果"
          extra={
            loading ? (
              <Tag color="processing">查询中</Tag>
            ) : result ? (
              <Typography.Text type="secondary">共 {result.matrix.length} 条序列</Typography.Text>
            ) : null
          }
        >
          {loading && !result && <LoadingPlaceholder tip="查询中..." />}

          {!loading && !result && !error && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="输入 PromQL 表达式并执行查询，结果将显示在这里"
            >
              <Space size={8} wrap>
                <Typography.Text type="secondary">示例：</Typography.Text>
                <Button size="small" onClick={() => applySample('up')}>
                  up
                </Button>
                <Button size="small" onClick={() => applySample('count(up) by (job)')}>
                  count(up) by (job)
                </Button>
              </Space>
            </Empty>
          )}

          {result && (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <QueryMetaBar result={result} />

              {tooManySeries && (
                <Alert
                  type="warning"
                  showIcon
                  message={`当前返回 ${result.matrix.length} 条序列，图表可能拥挤，建议用聚合函数或标签过滤缩小范围`}
                />
              )}

              {emptyResult ? (
                <Alert
                  type="info"
                  showIcon
                  message="查询成功但没有匹配到指标序列"
                  description="可检查 PromQL 表达式、时间范围或目标采集状态；本次查询已覆盖全部授权网域。"
                />
              ) : (
                <TimeSeriesChart series={result.series} />
              )}

              {!emptyResult && (
                <Table
                  rowKey="key"
                  size="small"
                  columns={SERIES_COLUMNS}
                  dataSource={rows}
                  pagination={TABLE_PAGINATION}
                  scroll={TABLE_SCROLL_X}
                />
              )}
            </Space>
          )}
        </Card>
      </Space>
    </MainLayout>
  )
}

export default QueryPage
