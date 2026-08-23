import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Input, Select, Table, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { metricLibraryApi } from '../../api/metricLibrary'
import type { ExporterMetricLibraryItem, MetricType } from '../../types/strategy'
import type { ResourceCategory } from '../../types/resource'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { CATEGORY_MAP, METRIC_TYPE_MAP, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'

const { Text } = Typography

interface MetricLibraryState {
  list: ExporterMetricLibraryItem[]
  total: number
}

const EMPTY_LIBRARY: MetricLibraryState = { list: [], total: 0 }

/**
 * 技术指标库页（Module_01 §3.1/§5.3/§9.1/§11.1，F7，只读列表）。
 * - 筛选：资源类别 → 类型两级 / metric_type；分页默认 20/页；
 * - 列：指标名 / 类型 / HELP / 单位 / 所属类型 / 来源采集器(source_exporter) / 启用状态；
 * - 加载骨架 / 空态 / 错误态；MVP 内置只读不做编辑/导入 UI（P1）。
 */
export function MetricLibraryPage() {
  const [items, setItems] = useState<MetricLibraryState>(EMPTY_LIBRARY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<ResourceCategory>()
  const [monitorType, setMonitorType] = useState<string | undefined>()
  const [metricType, setMetricType] = useState<MetricType | undefined>()
  const [keyword, setKeyword] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await metricLibraryApi.list({
        monitor_type: monitorType,
        metric_type: metricType,
        keyword,
        page,
        page_size: pageSize,
      })
      setItems(res.data ?? EMPTY_LIBRARY)
    } catch (e) {
      setError(e instanceof Error ? e.message : '指标库加载失败，请稍后重试')
      setItems(EMPTY_LIBRARY)
    } finally {
      setLoading(false)
    }
  }, [monitorType, metricType, keyword, page, pageSize])

  useEffect(() => {
    // 异步请求回调后 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => setRefresh((n) => n + 1), [])

  const columns: ColumnsType<ExporterMetricLibraryItem> = [
    {
      title: '指标名',
      dataIndex: 'metric_name',
      key: 'metric_name',
      fixed: 'left',
      width: 220,
      render: (v: string) => <EllipsisText code>{v}</EllipsisText>,
    },
    {
      title: '类型',
      dataIndex: 'metric_type',
      key: 'metric_type',
      width: 90,
      render: (v: string) => METRIC_TYPE_MAP[v] ?? v,
    },
    {
      title: 'HELP',
      dataIndex: 'help',
      key: 'help',
      width: 240,
      render: (v: string) => (v ? <EllipsisText>{v}</EllipsisText> : '-'),
    },
    { title: '单位', dataIndex: 'unit', key: 'unit', width: 90, render: (v: string) => v || '-' },
    {
      title: '所属类型',
      key: 'monitor_types',
      width: 140,
      render: (_: unknown, r: ExporterMetricLibraryItem) => (
        <EllipsisText>{r.monitor_types.map((m) => MONITOR_TYPE_MAP[m.monitor_type as keyof typeof MONITOR_TYPE_MAP] ?? m.monitor_type).join(', ')}</EllipsisText>
      ),
    },
    {
      title: '来源采集器',
      key: 'source_exporter',
      width: 150,
      render: (_: unknown, r: ExporterMetricLibraryItem) => {
        const s = [...new Set(r.monitor_types.map((m) => m.source_exporter).filter(Boolean))].join(', ')
        return s ? <EllipsisText>{s}</EllipsisText> : <Text type="secondary">-</Text>
      },
    },
    {
      title: '启用状态',
      key: 'enabled',
      width: 90,
      render: (_: unknown, r: ExporterMetricLibraryItem) => (
        <Badge status={r.enabled ? 'success' : 'default'} text={r.enabled ? '启用' : '停用'} />
      ),
    },
  ]

  // 当前类别下的细粒度类型
  const currentTypes = MONITOR_TYPE_CASCADE.find((g) => g.category === category)?.types ?? []

  return (
    <MainLayout>
      <Card
        extra={
          <Button icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>
        }
      >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        技术指标库（ExporterMetricLibrary）：面向采集目标的标准指标字典，仅供查看。业务指标库预留后续版本。
      </Typography.Paragraph>
      {error && (
        <Alert
          type="error"
          showIcon
          message="指标库加载失败，请稍后重试"
          description={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
              重新加载
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}
      <FilterBar>
        <FilterItem label="资源类别" width={150}>
          <Select
            allowClear
            placeholder="全部类别"
            style={{ width: 110 }}
            value={category}
            onChange={(v: ResourceCategory | undefined) => {
              setCategory(v)
              setMonitorType(undefined)
              setPage(1)
            }}
          >
            {MONITOR_TYPE_CASCADE.map((g) => (
              <Select.Option key={g.category} value={g.category}>
                {CATEGORY_MAP[g.category]}
              </Select.Option>
            ))}
          </Select>
        </FilterItem>
        <FilterItem label="监控类型" width={190}>
          <Select
            allowClear
            placeholder="全部类型"
            style={{ width: 150 }}
            value={monitorType}
            onChange={(v: string | undefined) => {
              setMonitorType(v)
              setPage(1)
            }}
          >
            {(currentTypes.length > 0 ? currentTypes : MONITOR_TYPE_CASCADE.flatMap((g) => g.types)).map((t) => (
              <Select.Option key={t} value={t}>
                {MONITOR_TYPE_MAP[t]}
              </Select.Option>
            ))}
          </Select>
        </FilterItem>
        <FilterItem label="指标类型" width={160}>
          <Select
            allowClear
            placeholder="全部类型"
            style={{ width: 120 }}
            value={metricType}
            onChange={(v: MetricType | undefined) => {
              setMetricType(v)
              setPage(1)
            }}
          >
            {Object.entries(METRIC_TYPE_MAP).map(([value, label]) => (
              <Select.Option key={value} value={value}>
                {label}
              </Select.Option>
            ))}
          </Select>
        </FilterItem>
        <FilterItem label="关键字" width={260}>
          <Input.Search
            allowClear
            placeholder="搜索指标名 / HELP"
            style={{ width: 220 }}
            value={keyword}
            onSearch={(v) => {
              setKeyword(v || undefined)
              setPage(1)
            }}
          />
        </FilterItem>
      </FilterBar>

      <Table<ExporterMetricLibraryItem>
        rowKey="id"
        dataSource={items.list}
        loading={loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{ emptyText: <Empty description="暂无指标" /> }}
        pagination={{
          ...TABLE_PAGINATION,
          current: page,
          pageSize,
          total: items.total,
          onChange: setPage,
          onShowSizeChange: (_c, s) => setPageSize(s),
        }}
      />
    </Card>
    </MainLayout>
  )
}

export default MetricLibraryPage