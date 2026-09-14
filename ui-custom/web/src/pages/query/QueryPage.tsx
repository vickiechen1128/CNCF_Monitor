/**
 * 指标查询页（Module_05 §3.1 决策 72-1 / M05-T10）。
 *
 * 首页使用指引第 6 步「查指标」深链目标；最小 PromQL 查询能力：
 * - 调用 M02 已上线的 `/api/v1/query` 代理（原生透传 Prometheus 响应，见 `src/api/query.ts`）；
 * - vector 结果以表格呈现（指标名 / 实例 / 采集 Job / 其它标签 / 值 / 查询时间）；
 * - matrix / scalar / string 以 JSON 折叠区兜底；
 * - 覆盖加载中 / 空态 / 错误态（Prometheus `status: 'error'` 信封与网络异常均显式呈现）。
 *
 * 不引入图表库（决策 72-2）：区间趋势图能力待 v0.3 提供。
 *
 * 布局：本页自包 `MainLayout`（与 TargetStatusPage / AlertConfigPage 一致）——
 * 路由层 `RequireAuth` 只返回 `<Outlet />`，不自包会丢失 Header / Sider / 内容内边距，
 * 用户从首页深链进来后无法回到其它页面。
 */
import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Alert, Button, Card, Collapse, Empty, Input, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlayCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { queryApi } from '../../api/query'
import { MainLayout } from '../../layouts/MainLayout'
import { EllipsisText } from '../../components/EllipsisText'
import { LoadingPlaceholder } from '../../components/LoadingPlaceholder'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import type { PromQueryData, PromVectorItem } from '../../types/query'

/** 示例表达式：覆盖瞬时向量与聚合两种常见形态 */
const SAMPLE_QUERIES = ['up', 'count(up) by (job)']

const JSON_PRE_STYLE = { margin: 0, maxHeight: 360, overflow: 'auto' } as const

/** 样本时间：Prometheus 时间戳为 unix 秒（可含小数），本地化为可读时间 */
function formatSampleTime(ts: number): string {
  if (!Number.isFinite(ts)) return '-'
  return dayjs(Math.round(ts * 1000)).format('YYYY-MM-DD HH:mm:ss')
}

/** 除指标名（`__name__`）外的标签拼接为 `键="值"` 串，便于对照原始序列 */
function otherLabels(metric: Record<string, string>): string {
  const entries = Object.entries(metric).filter(([key]) => key !== '__name__')
  return entries.length === 0 ? '-' : entries.map(([key, value]) => `${key}="${value}"`).join(', ')
}

/** 结果条数：vector / matrix 为序列条数，scalar / string 单值 */
function resultCount(result: PromQueryData): number {
  if (result.resultType === 'vector' || result.resultType === 'matrix') {
    // 契约外形态（result 非数组）时不把 undefined 拼进文案
    return Array.isArray(result.result as unknown) ? result.result.length : 0
  }
  return 1
}

const VECTOR_COLUMNS: ColumnsType<PromVectorItem> = [
  {
    title: '指标名',
    key: 'metric_name',
    render: (_value: unknown, record: PromVectorItem) => (
      <Typography.Text strong>{record.metric.__name__ || '-'}</Typography.Text>
    ),
  },
  {
    title: '实例',
    key: 'instance',
    render: (_value: unknown, record: PromVectorItem) => (
      <EllipsisText>{record.metric.instance || '-'}</EllipsisText>
    ),
  },
  {
    title: '采集 Job',
    key: 'job',
    render: (_value: unknown, record: PromVectorItem) => (
      <EllipsisText>{record.metric.job || '-'}</EllipsisText>
    ),
  },
  {
    title: '其它标签',
    key: 'labels',
    render: (_value: unknown, record: PromVectorItem) => (
      <EllipsisText maxWidth={280}>{otherLabels(record.metric)}</EllipsisText>
    ),
  },
  {
    title: '值',
    key: 'value',
    render: (_value: unknown, record: PromVectorItem) => (
      <Typography.Text data-testid="prom-sample-value">{record.value[1]}</Typography.Text>
    ),
  },
  {
    title: '查询时间',
    key: 'timestamp',
    render: (_value: unknown, record: PromVectorItem) => (
      <Typography.Text>{formatSampleTime(record.value[0])}</Typography.Text>
    ),
  },
]

/** 原始返回数据兜底展示：matrix / scalar / string 形态不固定，折叠区完整呈现 */
function RawResultCollapse({ result }: { result: PromQueryData }) {
  return (
    <Collapse
      items={[
        {
          key: 'raw',
          label: '原始返回数据',
          children: <pre style={JSON_PRE_STYLE}>{JSON.stringify(result, null, 2)}</pre>,
        },
      ]}
    />
  )
}

function ResultPanel({ result }: { result: PromQueryData }) {
  // 上游 resultType 未知 / 契约外形态时 result 可能不是数组（如对象、字符串），
  // 直接当 React child 渲染会命中 "Objects are not valid as a React child" 白屏，
  // 故在分支渲染前统一守卫，不满足即回落 JSON 折叠区。
  if (!Array.isArray(result.result as unknown)) {
    return <RawResultCollapse result={result} />
  }

  if (result.resultType === 'vector') {
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Table
          rowKey={(_record: PromVectorItem, index?: number) => String(index)}
          size="small"
          columns={VECTOR_COLUMNS}
          dataSource={result.result}
          pagination={TABLE_PAGINATION}
          scroll={TABLE_SCROLL_X}
        />
        {result.result.length === 0 && (
          <Typography.Text type="secondary">
            查询成功但没有匹配到指标序列，可检查表达式或采集状态
          </Typography.Text>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          区间趋势图能力待 v0.3 提供。
        </Typography.Text>
      </Space>
    )
  }

  if (result.resultType === 'matrix') {
    return (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary">
          当前结果为区间数据，共 {result.result.length} 条时间序列；区间趋势图能力待 v0.3 提供。
        </Typography.Text>
        <RawResultCollapse result={result} />
      </Space>
    )
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <div>
        <Typography.Text type="secondary" style={{ fontSize: 14 }}>
          结果值
        </Typography.Text>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>{result.result[1]}</div>
        <Typography.Text type="secondary" style={{ fontSize: 14 }}>
          查询时间 {formatSampleTime(result.result[0])}
        </Typography.Text>
      </div>
      <RawResultCollapse result={result} />
    </Space>
  )
}

export function QueryPage() {
  const [promql, setPromql] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PromQueryData | null>(null)
  // 请求序号：连按 Ctrl/Cmd+Enter 时只接受最后一次请求的响应，过期响应直接丢弃
  const requestSeq = useRef(0)

  const runQuery = async () => {
    // loading 期间不重复发请求（快捷键一键触发路径在此短路，按钮侧另有 disabled 兜底）
    if (loading) return

    const expr = promql.trim()
    if (!expr) {
      requestSeq.current += 1
      setResult(null)
      setError('请输入 PromQL 表达式后再执行查询')
      return
    }

    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await queryApi.query({ query: expr })
      if (seq !== requestSeq.current) return
      if (res.status === 'success') {
        setResult(res.data)
      } else {
        // Prometheus 错误信封（status: 'error'）显式呈现，不静默吞成空结果
        setResult(null)
        setError(res.error || '查询失败')
      }
    } catch (err) {
      if (seq !== requestSeq.current) return
      setResult(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      // 仅由最新一次请求收尾 loading，避免过期响应把新请求的 loading 提前关掉
      if (seq === requestSeq.current) setLoading(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void runQuery()
    }
  }

  const handleClear = () => {
    // 使在途请求的响应失效，避免清空后旧结果回填
    requestSeq.current += 1
    setPromql('')
    setResult(null)
    setError(null)
    setLoading(false)
  }

  return (
    <MainLayout>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            指标查询
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            输入 PromQL 表达式查询指标数据（查询时刻由服务端确定）
          </Typography.Text>
        </div>

        <Card title="查询条件">
          <Input.TextArea
            value={promql}
            onChange={(event) => setPromql(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="例如：up"
            aria-label="PromQL 表达式"
          />
          <Space size={12} style={{ marginTop: 12 }} wrap>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={loading}
              disabled={loading}
              onClick={runQuery}
            >
              执行查询
            </Button>
            <Button onClick={handleClear} disabled={loading}>
              清空
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              支持 Ctrl / Cmd + Enter 快捷执行
            </Typography.Text>
          </Space>
        </Card>

        <Card
          title="查询结果"
          extra={
            result && !loading && !error ? (
              <Typography.Text type="secondary">共 {resultCount(result)} 条结果</Typography.Text>
            ) : null
          }
        >
          {loading && <LoadingPlaceholder tip="查询中..." />}

          {!loading && error && (
            <Alert message="查询失败" description={error} type="error" showIcon />
          )}

          {!loading && !error && !result && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="输入 PromQL 表达式并执行查询，结果将显示在这里"
            >
              <Space size={8} wrap>
                <Typography.Text type="secondary">示例：</Typography.Text>
                {SAMPLE_QUERIES.map((sample) => (
                  <Button key={sample} size="small" onClick={() => setPromql(sample)}>
                    {sample}
                  </Button>
                ))}
              </Space>
            </Empty>
          )}

          {!loading && !error && result && <ResultPanel result={result} />}
        </Card>
      </Space>
    </MainLayout>
  )
}

export default QueryPage
