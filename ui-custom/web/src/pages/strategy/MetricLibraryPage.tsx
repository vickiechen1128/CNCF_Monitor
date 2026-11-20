import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Empty, Input, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd'
import { DatabaseOutlined, LockOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { getStoredUser } from '../../api/client'
import { metricLibraryApi } from '../../api/metricLibrary'
import type { ExporterMetricLibraryItem, MetricType } from '../../types/strategy'
import type { ResourceCategory } from '../../types/resource'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'
import { CATEGORY_MAP, METRIC_TYPE_MAP } from './strategyConstants'
import { MetricLibraryDrawer } from './MetricLibraryDrawer'
import { useCollectionTemplateCatalog } from './useCollectionTemplateCatalog'

const { Text } = Typography

interface MetricLibraryState {
  list: ExporterMetricLibraryItem[]
  total: number
}

const EMPTY_LIBRARY: MetricLibraryState = { list: [], total: 0 }

/**
 * 技术指标库页（Module_01 §3.1/§5.3/§9.1/§11.1，F7）。
 * - 筛选：资源类别 → 采集模板两级 / 指标类型 / 关键字；分页默认 20/页；
 *   采集模板下拉读 `useCollectionTemplateCatalog()`（模板为数据，可新增/停用，禁止前端写死）；
 * - 列名与筛选条件一一对应：资源类别 / 采集模板 / 指标类型；其余为指标元数据与来源标注；
 * - 用户扩展：仅管理员可新增/编辑/删除（内置指标只读），保存后即可为新建的采集模板挂指标；
 * - 顶部统计：共 n 个指标（服务端筛选后的总数）；
 * - 加载 / 空态 / 错误态。
 *
 * M01 重构（v2.0）：指标锚点由「监控对象类型」改为「采集模板」，
 * 锚点结构为 `{template_code, source_exporter}`，列表载荷字段 `collection_templates`。
 */
export function MetricLibraryPage() {
  const templateCatalog = useCollectionTemplateCatalog()
  // 品牌色走皮肤 token（单一来源，见 skins.ts 设计约束）
  const { tokens } = useSkin()
  // 指标库写入仅管理员（2026-11-19 用户裁定；后端 Routes 同步挂 RequireAdmin）
  const isAdmin = getStoredUser()?.role === 'admin'
  const [items, setItems] = useState<MetricLibraryState>(EMPTY_LIBRARY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useState<ResourceCategory>()
  const [templateCode, setTemplateCode] = useState<string | undefined>()
  const [metricType, setMetricType] = useState<MetricType | undefined>()
  const [keyword, setKeyword] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ExporterMetricLibraryItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await metricLibraryApi.list({
        resource_category: category,
        template_code: templateCode,
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
  }, [category, templateCode, metricType, keyword, page, pageSize])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => setRefresh((n) => n + 1), [])

  const openCreate = useCallback(() => {
    setEditing(null)
    setDrawerOpen(true)
  }, [])

  const openEdit = useCallback((record: ExporterMetricLibraryItem) => {
    setEditing(record)
    setDrawerOpen(true)
  }, [])

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  const saved = useCallback(() => {
    setDrawerOpen(false)
    reload()
  }, [reload])

  const remove = useCallback(
    async (record: ExporterMetricLibraryItem) => {
      try {
        await metricLibraryApi.remove(record.id)
        message.success('指标已删除')
        reload()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
      }
    },
    [reload],
  )

  /** 采集模板 code → 展示名；模板已删除时回落展示 code，避免历史指标显示空白 */
  const templateName = useCallback(
    (code: string) => templateCatalog.templates.find((t) => t.code === code)?.name ?? code,
    [templateCatalog.templates],
  )

  // 资源类别由指标锚点的采集模板反查（模板自带 resource_category），保证「资源类别」筛选与列展示同源
  const categoryText = useCallback(
    (item: ExporterMetricLibraryItem) => {
      const names = new Set<string>()
      item.collection_templates.forEach((anchor) => {
        const resolved = templateCatalog.templates.find((t) => t.code === anchor.template_code)?.resource_category
        if (resolved) names.add(CATEGORY_MAP[resolved])
      })
      return [...names].join(', ')
    },
    [templateCatalog.templates],
  )

  // 当前类别下的采集模板；未选类别时给全量模板（与采集模板目录同步）
  const templateOptions = useMemo(() => {
    const list = category
      ? templateCatalog.templates.filter((t) => t.resource_category === category)
      : templateCatalog.templates
    return list.map((t) => ({ value: t.code, label: t.name }))
  }, [templateCatalog.templates, category])

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
      // 列名与筛选条件「采集模板」对应（M01 重构：锚点即采集模板）
      title: '采集模板',
      key: 'collection_templates',
      width: 190,
      render: (_: unknown, r: ExporterMetricLibraryItem) =>
        r.collection_templates.length > 0 ? (
          <EllipsisText>
            {r.collection_templates.map((anchor) => templateName(anchor.template_code)).join(', ')}
          </EllipsisText>
        ) : (
          <Text type="secondary">未挂接采集模板</Text>
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
        const s = [...new Set(r.collection_templates.map((a) => a.source_exporter).filter(Boolean))].join(', ')
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
    ...(isAdmin
      ? [
          {
            title: '操作',
            key: 'actions',
            width: 140,
            fixed: 'right' as const,
            render: (_: unknown, r: ExporterMetricLibraryItem) =>
              r.is_builtin ? (
                <Text type="secondary">内置只读</Text>
              ) : (
                <Space size={4}>
                  <Button size="small" type="link" onClick={() => openEdit(r)} data-testid={`edit-metric-${r.id}`}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除该指标？"
                    description="删除后将从指标库（用户扩展）中移除，内置指标不受影响。"
                    okText="删除"
                    cancelText="取消"
                    onConfirm={() => void remove(r)}
                  >
                    <Button size="small" type="link" danger data-testid={`delete-metric-${r.id}`}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
          },
        ]
      : []),
  ]

  // 空态按当前筛选项给出可行动说明：模板无指标时解释「挂接后才有数据」
  const emptyDescription = templateCode
    ? `「${templateName(templateCode)}」暂无指标`
    : category
      ? `「${CATEGORY_MAP[category]}」暂无指标`
      : '暂无指标'

  return (
    <MainLayout>
      <Card
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            {isAdmin && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} data-testid="create-metric">
                新增指标
              </Button>
            )}
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          技术指标库（ExporterMetricLibrary）：面向采集目标的标准指标字典；筛选维度为「资源类别 / 采集模板 /
          指标类型」。内置指标只读，管理员可新增用户扩展指标并挂接到采集模板。
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
                setTemplateCode(undefined)
                setPage(1)
              }}
            >
              {Object.entries(CATEGORY_MAP).map(([value, label]) => (
                <Select.Option key={value} value={value}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="采集模板" width={230}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部模板"
              style={{ width: 190 }}
              value={templateCode}
              // 采集模板是数据（可新增/停用）：每次展开下拉都重新拉取，避免选项滞后
              onOpenChange={(open) => {
                if (open) templateCatalog.reload()
              }}
              onChange={(v: string | undefined) => {
                setTemplateCode(v)
                setPage(1)
              }}
              options={templateOptions}
            />
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
                {templateCode && (
                  <Text type="secondary">
                    该采集模板还没有挂接指标；管理员可点「新增指标」创建用户扩展指标并选择该模板
                  </Text>
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

      {isAdmin && (
        <MetricLibraryDrawer open={drawerOpen} editing={editing} onClose={closeDrawer} onSaved={saved} />
      )}
    </MainLayout>
  )
}

export default MetricLibraryPage
