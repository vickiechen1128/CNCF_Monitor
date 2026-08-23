import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Input, Select, Segmented, Space, Table, Tag, Typography } from 'antd'
import { DatabaseOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons'
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

/** 分组浏览 / 列表浏览视图（E3：按 CI 类型分组浏览为浏览增强，F1-7） */
type LibraryView = 'group' | 'list'

interface MetricLibraryState {
  list: ExporterMetricLibraryItem[]
  total: number
}

const EMPTY_LIBRARY: MetricLibraryState = { list: [], total: 0 }

/** 分组用全量抓取分页上限（契约 §8 page_size 上限 100）；超出部分顶部统计提示截断 */
const GROUP_PAGE_SIZE = 100

/**
 * 技术指标库页（Module_01 §3.1/§5.3/§9.1/§11.1，F7，只读列表）。
 * - 筛选：资源类别 → 类型两级 / metric_type / 关键字；分页默认 20/页（列表视图）；
 * - 视图切换：分组浏览（按 CI 类型 Card + Badge 计数，对齐原型 E3/F1-7）/ 列表（现有分页扁平表）；
 * - 列：指标名 / 类型 / HELP / 单位 / 标签(F4) / 所属类型 / 来源采集器 / 内置或用户扩展(F4) / 启用状态；
 * - 顶部统计：共 n 个指标（内置 x / 用户扩展 y），按 n 个 CI 类型组织（F4）；
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
  // Q2/F1-7/E3/F4：分组浏览视图 + 分组用全量数据（契约上限内）+ 视图切换
  const [view, setView] = useState<LibraryView>('list')
  const [aggItems, setAggItems] = useState<ExporterMetricLibraryItem[]>([])
  const [aggTotal, setAggTotal] = useState(0)
  const [aggLoading, setAggLoading] = useState(false)

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

  // E3/F1-7/F4：分组与顶部统计依赖全量数据（受当前筛选影响），契约上限内拉取；
  // 仅在分组视图时需要全量（统计/分组），列表视图仅分页，避免多余请求。
  const loadAgg = useCallback(async () => {
    setAggLoading(true)
    try {
      const res = await metricLibraryApi.list({
        monitor_type: monitorType,
        metric_type: metricType,
        keyword,
        page: 1,
        page_size: GROUP_PAGE_SIZE,
      })
      setAggItems(res.data?.list ?? [])
      setAggTotal(res.data?.total ?? 0)
    } catch {
      // 分组全量加载失败不阻断主列表；顶部统计回落为当前页可统计值
      setAggItems([])
      setAggTotal(0)
    } finally {
      setAggLoading(false)
    }
  }, [monitorType, metricType, keyword])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    if (view === 'group') void loadAgg()
  }, [load, loadAgg, view, refresh])

  const reload = useCallback(() => setRefresh((n) => n + 1), [])

  // 顶部统计源：全量 aggItems 已加载则用之（受当前筛选影响），否则回落当前页
  const statsSource = aggItems.length > 0 ? aggItems : items.list

  const stats = useMemo(() => {
    const builtin = statsSource.filter((m) => m.is_builtin).length
    const user = statsSource.length - builtin
    const typeKeys = new Set<string>()
    statsSource.forEach((m) => m.monitor_types.forEach((a) => typeKeys.add(a.monitor_type)))
    const total = aggTotal > statsSource.length ? aggTotal : statsSource.length
    return { total, builtin, user, types: typeKeys.size }
  }, [statsSource, aggTotal])

  // F1-7/E3：按 CI 类型（monitor_type 锚点，多对多）分组；受筛选影响
  const groupedData = useMemo(() => {
    const groups = new Map<string, ExporterMetricLibraryItem[]>()
    // 按级联顺序稳定输出分组
    const ordered = MONITOR_TYPE_CASCADE.flatMap((g) => g.types)
    aggItems.forEach((m) => {
      const anchors = m.monitor_types ?? []
      if (anchors.length === 0) return
      anchors.forEach((a) => {
        const arr = groups.get(a.monitor_type) ?? []
        arr.push(m)
        groups.set(a.monitor_type, arr)
      })
    })
    return ordered.filter((t) => groups.has(t)).map((t) => ({ monitorType: t, metrics: groups.get(t)! }))
  }, [aggItems])

  // 当前类别下的细粒度类型（列表 / 分组视图共用筛选）
  const currentTypes = MONITOR_TYPE_CASCADE.find((g) => g.category === category)?.types ?? []

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
      width: 220,
      render: (v: string) => (v ? <EllipsisText>{v}</EllipsisText> : '-'),
    },
    { title: '单位', dataIndex: 'unit', key: 'unit', width: 84, render: (v: string) => v || '-' },
    {
      // F4：标签列（常见标签键）
      title: '标签',
      dataIndex: 'labels',
      key: 'labels',
      width: 160,
      render: (v: string[]) =>
        Array.isArray(v) && v.length > 0 ? (
          <Space size={[4, 4]} wrap>
            {v.map((l) => (
              <Tag key={l} color="blue" style={{ marginInlineEnd: 0 }}>
                {l}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
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
      width: 140,
      render: (_: unknown, r: ExporterMetricLibraryItem) => {
        const s = [...new Set(r.monitor_types.map((m) => m.source_exporter).filter(Boolean))].join(', ')
        return s ? <EllipsisText>{s}</EllipsisText> : <Text type="secondary">-</Text>
      },
    },
    {
      // F4：内置 / 用户扩展标注（F1-7 内置标注）；内置标识只读
      title: '来源',
      key: 'is_builtin',
      width: 96,
      render: (_: unknown, r: ExporterMetricLibraryItem) =>
        r.is_builtin ? (
          <Tag color="gold" icon={<LockOutlined />}>
            内置
          </Tag>
        ) : (
          <Tag>用户扩展</Tag>
        ),
    },
    {
      title: '启用状态',
      key: 'enabled',
      width: 88,
      render: (_: unknown, r: ExporterMetricLibraryItem) => (
        <Badge status={r.enabled ? 'success' : 'default'} text={r.enabled ? '启用' : '停用'} />
      ),
    },
  ]

  return (
    <MainLayout>
      <Card
        extra={
          <Space>
            <Segmented
              options={[
                { label: '分组浏览', value: 'group' },
                { label: '列表', value: 'list' },
              ]}
              value={view}
              onChange={(v) => setView(v as LibraryView)}
            />
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
          </Space>
        }
      >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        技术指标库（ExporterMetricLibrary）：面向采集目标的标准指标字典，仅供查看，按 CI 类型分组浏览；业务指标库预留后续版本。
      </Typography.Paragraph>

      {/* F4：顶部统计 */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <DatabaseOutlined style={{ color: '#0ECDEB', fontSize: 18 }} />
        <Text type="secondary">
          共 {stats.total} 个指标（内置 {stats.builtin} / 用户扩展 {stats.user}），按 {stats.types} 个 CI 类型组织
          {view === 'group' && aggTotal > aggItems.length ? `（当前筛选取前 ${aggItems.length} 条统计，完整 ${aggTotal} 条）` : ''}
        </Text>
      </div>

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

      {view === 'group' ? (
        // F1-7/E3：按 CI 类型分组浏览（原型 MetricLibraryPage 对齐）
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {groupedData.length === 0 && <Empty description="暂无指标" />}
          {groupedData.map((group) => (
            <Card
              key={group.monitorType}
              type="inner"
              size="small"
              title={
                <Space wrap size={6}>
                  <Text strong>{MONITOR_TYPE_MAP[group.monitorType as keyof typeof MONITOR_TYPE_MAP] ?? group.monitorType}</Text>
                  <Badge count={group.metrics.length} color="#0ECDEB" overflowCount={999} />
                </Space>
              }
            >
              <Table<ExporterMetricLibraryItem>
                rowKey="id"
                dataSource={group.metrics}
                loading={aggLoading}
                columns={columns}
                size="small"
                scroll={TABLE_SCROLL_X}
                pagination={false}
              />
            </Card>
          ))}
        </Space>
      ) : (
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
      )}
    </Card>
    </MainLayout>
  )
}

export default MetricLibraryPage