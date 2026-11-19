import { useCallback, useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Input, Select, Space, Table, Tag, Typography } from 'antd'
import { DatabaseOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { metricLibraryApi } from '../../api/metricLibrary'
import type { ExporterMetricLibraryItem, MetricType } from '../../types/strategy'
import type { ResourceCategory } from '../../types/resource'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'
import { CATEGORY_MAP, METRIC_TYPE_MAP } from './strategyConstants'
import { refreshMonitorTypeCatalog, useMonitorTypeCatalog } from './useMonitorTypeCatalog'

const { Text } = Typography

interface MetricLibraryState {
  list: ExporterMetricLibraryItem[]
  total: number
}

const EMPTY_LIBRARY: MetricLibraryState = { list: [], total: 0 }

/**
 * 技术指标库页（Module_01 §3.1/§5.3/§9.1/§11.1，F7，只读列表）。
 * - 筛选：资源类别 → 监控对象类型两级 / 指标类型 / 关键字；分页默认 20/页；
 *   监控对象类型下拉读注册表（类型可手动新增/停用），打开下拉时重新拉取，选项随注册表同步更新；
 * - 列名与筛选条件一一对应：资源类别 / 监控对象类型 / 指标类型；其余为指标元数据与来源标注；
 * - 顶部统计：共 n 个指标（服务端筛选后的总数）；
 * - 加载 / 空态 / 错误态；MVP 内置只读不做编辑/导入 UI（P1）。
 */
export function MetricLibraryPage() {
  const catalog = useMonitorTypeCatalog()
  // 品牌色走皮肤 token（单一来源，见 skins.ts 设计约束）
  const { tokens } = useSkin()
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
        resource_category: category,
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
  }, [category, monitorType, metricType, keyword, page, pageSize])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => setRefresh((n) => n + 1), [])

  // 资源类别由监控对象类型反查（M07 资源类别），保证「资源类别」筛选与列展示同源
  const categoryText = useCallback(
    (item: ExporterMetricLibraryItem) => {
      const names = new Set<string>()
      item.monitor_types.forEach((anchor) => {
        const resolved = catalog.categoryFor(anchor.monitor_type)
        if (resolved) names.add(CATEGORY_MAP[resolved])
      })
      return [...names].join(', ')
    },
    [catalog],
  )

  // 当前类别下的监控对象类型；未选类别时给全量启用类型（与注册表同步）
  const currentTypes = catalog.optionsForCategory(category)

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
      // 列名与筛选条件「指标类型」对应
      title: '指标类型',
      dataIndex: 'metric_type',
      key: 'metric_type',
      width: 96,
      render: (v: string) => METRIC_TYPE_MAP[v] ?? v,
    },
    {
      // 列名与筛选条件「资源类别」对应（由监控对象类型反查）
      title: '资源类别',
      key: 'resource_category',
      width: 110,
      render: (_: unknown, r: ExporterMetricLibraryItem) => {
        const text = categoryText(r)
        return text ? <EllipsisText>{text}</EllipsisText> : <Text type="secondary">-</Text>
      },
    },
    {
      // 列名与筛选条件「监控对象类型」对应
      title: '监控对象类型',
      key: 'monitor_types',
      width: 170,
      render: (_: unknown, r: ExporterMetricLibraryItem) => (
        <EllipsisText>{r.monitor_types.map((m) => catalog.nameOf(m.monitor_type)).join(', ')}</EllipsisText>
      ),
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

  // 空态按当前筛选项给出可行动说明：新类型无指标时解释「挂接后才有数据」
  const emptyDescription = monitorType
    ? `「${catalog.nameOf(monitorType)}」暂无指标`
    : category
      ? `「${CATEGORY_MAP[category]}」暂无指标`
      : '暂无指标'

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
          技术指标库（ExporterMetricLibrary）：面向采集目标的标准指标字典，仅供查看；筛选维度为「资源类别 /
          监控对象类型 / 指标类型」，业务指标库预留后续版本。
        </Typography.Paragraph>

        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DatabaseOutlined style={{ color: tokens.colorPrimary, fontSize: 18 }} />
          <Text type="secondary">共 {items.total} 个指标</Text>
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
              {catalog.cascade.map((g) => (
                <Select.Option key={g.category} value={g.category}>
                  {CATEGORY_MAP[g.category]}
                </Select.Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="监控对象类型" width={230}>
            <Select
              allowClear
              placeholder="全部类型"
              style={{ width: 190 }}
              value={monitorType}
              // 类型可手动新增/停用：每次展开下拉都向注册表取最新列表，避免选项滞后
              onOpenChange={(open) => {
                if (open) refreshMonitorTypeCatalog()
              }}
              onChange={(v: string | undefined) => {
                setMonitorType(v)
                setPage(1)
              }}
            >
              {(currentTypes.length > 0 ? currentTypes : catalog.allCodes()).map((t) => (
                <Select.Option key={t} value={t}>
                  {catalog.nameOf(t)}
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
          locale={{
            emptyText: (
              <Empty description={emptyDescription}>
                {monitorType && (
                  <Text type="secondary">指标库为平台内置只读字典，监控对象类型挂接指标后才会产生数据</Text>
                )}
              </Empty>
            ),
          }}
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
