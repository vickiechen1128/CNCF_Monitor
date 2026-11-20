import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { collectionTemplateApi } from '../../api/collectionTemplates'
import { exporterTemplateApi } from '../../api/exporterTemplates'
import type { ResourceCategory } from '../../types/resource'
import type { ExporterSource, ExporterTemplate } from '../../types/strategy'
import type { CollectionTemplate, CollectionTemplateInput } from '../../types/collectionTemplate'
import { normalizeSelector } from '../../types/collectionTemplate'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { CATEGORY_MAP } from './strategyConstants'
import { CollectionTemplateDrawer } from './CollectionTemplateDrawer'
import { useCollectionTemplateCatalog } from './useCollectionTemplateCatalog'

const { Text } = Typography

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_MAP) as ResourceCategory[]).map((value) => ({
  value,
  label: CATEGORY_MAP[value],
}))

const SOURCE_MAP: Record<ExporterSource, string> = {
  official: '官方',
  third_party: '第三方',
  internal: '内部自建',
}

/** 模板行 → 更新载荷：启停只翻转 enabled，其余字段原样回传（后端 PUT 是整模板替换）。 */
function toTemplateInput(
  record: CollectionTemplate,
  overrides: Partial<CollectionTemplateInput> = {},
): CollectionTemplateInput {
  return {
    name: record.name,
    resource_category: record.resource_category,
    exporter_template_id: record.exporter_template_id,
    default_port: record.default_port,
    metrics_path: record.metrics_path,
    scheme: record.scheme,
    scrape_interval: record.scrape_interval,
    scrape_timeout: record.scrape_timeout,
    label_template_id: record.label_template_id ?? '',
    default_selector: normalizeSelector(record.default_selector),
    description: record.description ?? '',
    sort_order: record.sort_order,
    enabled: record.enabled,
    ...overrides,
  }
}

/**
 * 采集模板 Tab（SRS Module_01 v1.5 FR-21 / FR-24）。
 *
 * M01 重构后「监控对象类型」概念已下线：模板只回答「这类对象怎么采」
 * （采集实现 + 参数 + 标签模板），「采哪些对象」由任务自己的 selector 表达，
 * 所以本页不再出现任何类型↔实现映射，只维护模板本身。
 *
 * 页内两个 Tab：
 * - 采集模板（默认）：模板列表 + 新建 / 编辑 / 启停 / 删除；
 * - 采集实现：exporter 池清单（模板绑定的实现来源，只读）。
 */
export function CollectorTemplatesTab() {
  return (
    <Card styles={{ body: { paddingTop: 4 } }}>
      <Tabs
        defaultActiveKey="templates"
        items={[
          { key: 'templates', label: '采集模板', children: <CollectionTemplatePane /> },
          { key: 'implementations', label: '采集实现', children: <ExporterPoolPane /> },
        ]}
      />
    </Card>
  )
}

/** 采集模板列表：共享模板目录 + 客户端筛选（模板量小，全部由 useCollectionTemplateCatalog 一次性取回）。 */
function CollectionTemplatePane() {
  const catalog = useCollectionTemplateCatalog()
  const [category, setCategory] = useState<ResourceCategory>()
  const [keyword, setKeyword] = useState('')
  const [enabledFilter, setEnabledFilter] = useState<boolean>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<CollectionTemplate | null>(null)
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const openCreate = () => {
    setEditing(null)
    setDrawerOpen(true)
  }

  const openEdit = (record: CollectionTemplate) => {
    setEditing(record)
    setDrawerOpen(true)
  }

  /** 删除：被任务 / 指标锚点引用时后端返回 409，前端原样透出其引用计数文案。 */
  const removeTemplate = useCallback(
    async (record: CollectionTemplate) => {
      setRowBusy(record.code)
      try {
        await collectionTemplateApi.remove(record.code)
        message.success(`采集模板「${record.name}」已删除`)
        catalog.reload()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
      } finally {
        setRowBusy(null)
      }
    },
    [catalog],
  )

  /** 启停：内置模板不可删除，但可停用（builtin 恒可停用是本页唯一的「下线」手段）。 */
  const toggleEnabled = useCallback(
    async (record: CollectionTemplate) => {
      const next = !record.enabled
      setRowBusy(record.code)
      try {
        await collectionTemplateApi.update(record.code, toTemplateInput(record, { enabled: next }))
        message.success(next ? `采集模板「${record.name}」已启用` : `采集模板「${record.name}」已停用`)
        catalog.reload()
      } catch (err) {
        message.error(err instanceof Error ? err.message : '操作失败，请稍后重试')
      } finally {
        setRowBusy(null)
      }
    },
    [catalog],
  )

  const rows = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    return catalog.templates.filter((template) => {
      if (category && template.resource_category !== category) return false
      if (enabledFilter !== undefined && template.enabled !== enabledFilter) return false
      if (!text) return true
      return (
        template.name.toLowerCase().includes(text) ||
        template.code.toLowerCase().includes(text) ||
        (template.exporter_template_name ?? '').toLowerCase().includes(text)
      )
    })
  }, [catalog.templates, category, enabledFilter, keyword])

  const columns: ColumnsType<CollectionTemplate> = [
    {
      title: '模板名 / 编码',
      key: 'name',
      fixed: 'left',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.code}
          </Text>
        </Space>
      ),
    },
    {
      title: '资源类别',
      key: 'resource_category',
      width: 110,
      render: (_, record) => <Tag>{CATEGORY_MAP[record.resource_category] ?? record.resource_category}</Tag>,
    },
    {
      title: '采集实现',
      key: 'exporter',
      width: 180,
      render: (_, record) =>
        record.exporter_template_name ? (
          <Text>{record.exporter_template_name}</Text>
        ) : record.exporter_template_id ? (
          // 实现被删 / 未绑定名称时回落到 id，避免出现空白单元格
          <Text type="secondary">{record.exporter_template_id}</Text>
        ) : (
          <Text type="secondary">未绑定</Text>
        ),
    },
    {
      title: '默认端口 / 路径 / 协议',
      key: 'params',
      width: 200,
      render: (_, record) => (
        <Space size={4} wrap>
          <Text>{record.default_port || '-'}</Text>
          <Text type="secondary">·</Text>
          <Text>{record.metrics_path || '/'}</Text>
          <Text type="secondary">·</Text>
          <Text>{record.scheme || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '参数（间隔 / 超时）',
      key: 'timing',
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text type="secondary">间隔 {record.scrape_interval || '-'}</Text>
          <Text type="secondary">超时 {record.scrape_timeout || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '标签模板',
      key: 'label_template',
      width: 160,
      render: (_, record) =>
        record.label_template_name ? (
          <Text>{record.label_template_name}</Text>
        ) : record.label_template_id ? (
          <Text type="secondary">{record.label_template_id}</Text>
        ) : (
          <Text type="secondary">未关联</Text>
        ),
    },
    {
      title: '引用任务数',
      key: 'reference_job_count',
      width: 100,
      render: (_, record) => <Text>{record.reference_job_count ?? 0}</Text>,
    },
    {
      title: '状态',
      key: 'enabled',
      width: 120,
      render: (_, record) => (
        <Space size={4} wrap>
          {record.enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
          {/* 内置标记与启停同列：内置模板只能停用，不能删除 */}
          {record.is_builtin && <Tag color="blue">内置</Tag>}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 180,
      render: (_, record) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            loading={rowBusy === record.code}
            onClick={() => void toggleEnabled(record)}
          >
            {record.enabled ? '停用' : '启用'}
          </Button>
          {record.is_builtin ? (
            // 内置模板由平台 seed 维护：不允许删除，只能停用
            // （disabled 按钮不派发鼠标事件，故用 span 包裹承载 Tooltip 的 hover 触发）
            <Tooltip title="内置模板仅可停用">
              <span>
                <Button type="link" size="small" danger disabled>
                  删除
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Popconfirm
              title="删除采集模板"
              description={`删除后「${record.name}」不可再被采集任务引用；仍被任务或指标锚点引用时无法删除。`}
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => void removeTemplate(record)}
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      {catalog.error && (
        <Alert
          type="error"
          showIcon
          message="采集模板加载失败"
          description={catalog.error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={catalog.reload}>
              重新加载
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <FilterBar>
        <FilterItem label="资源类别" width={230}>
          <Select
            allowClear
            placeholder="全部资源类别"
            style={{ width: 170 }}
            value={category}
            onChange={(value) => setCategory((value as ResourceCategory) ?? undefined)}
            options={CATEGORY_OPTIONS}
          />
        </FilterItem>
        <FilterItem label="关键词" width={280}>
          <Input
            allowClear
            placeholder="模板名 / 编码 / 采集实现"
            style={{ width: 220 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </FilterItem>
        <FilterItem label="状态" width={200}>
          <Select
            allowClear
            placeholder="全部状态"
            style={{ width: 140 }}
            value={enabledFilter === undefined ? undefined : enabledFilter ? 'enabled' : 'disabled'}
            onChange={(value) =>
              setEnabledFilter(value === undefined ? undefined : value === 'enabled')
            }
            options={[
              { value: 'enabled', label: '启用' },
              { value: 'disabled', label: '停用' },
            ]}
          />
        </FilterItem>
        <FilterItem label=" " width={180}>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建模板
          </Button>
        </FilterItem>
      </FilterBar>

      <Table<CollectionTemplate>
        rowKey="code"
        dataSource={rows}
        loading={catalog.loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{
          emptyText: (
            <Empty description="暂无采集模板">
              <Button icon={<PlusOutlined />} onClick={openCreate}>
                新建模板
              </Button>
            </Empty>
          ),
        }}
        pagination={{ ...TABLE_PAGINATION, showTotal: undefined }}
      />

      <CollectionTemplateDrawer
        open={drawerOpen}
        record={editing}
        onCancel={() => setDrawerOpen(false)}
        onSaved={catalog.reload}
      />
    </div>
  )
}

/** 采集实现（exporter）池：只读清单，供模板选择时确认可选实现与默认参数。 */
function ExporterPoolPane() {
  const [templates, setTemplates] = useState<ExporterTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  // 加载态由「刷新」动作置位（事件内 setState），effect 只负责发起请求并在异步回调里落结果，
  // 避免在 effect 体内同步 setState 触发级联渲染。
  const reload = () => {
    setError(null)
    setLoading(true)
    setRefresh((value) => value + 1)
  }

  useEffect(() => {
    let cancelled = false
    exporterTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => {
        if (cancelled) return
        setTemplates(res.data?.list ?? [])
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '加载失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  const columns: ColumnsType<ExporterTemplate> = [
    {
      title: '采集实现',
      key: 'name',
      fixed: 'left',
      width: 200,
      render: (_, record) => (
        <Space size={4}>
          <Text strong>{record.name}</Text>
          {record.is_builtin && <Tag color="blue">内置</Tag>}
        </Space>
      ),
    },
    { title: '版本', dataIndex: 'version', key: 'version', width: 100, render: (value: string) => value || '-' },
    {
      title: '默认端口',
      dataIndex: 'default_port',
      key: 'default_port',
      width: 100,
      render: (value: number) => value || '-',
    },
    {
      title: '采集路径',
      dataIndex: 'metrics_path',
      key: 'metrics_path',
      width: 140,
      render: (value: string) => value || '/',
    },
    {
      title: '协议',
      dataIndex: 'scheme',
      key: 'scheme',
      width: 90,
      render: (value: string) => value || '-',
    },
    {
      title: '架构',
      dataIndex: 'arch',
      key: 'arch',
      width: 90,
      render: (value: string) => value || 'any',
    },
    {
      title: '来源',
      key: 'source',
      width: 100,
      render: (_, record) => <Tag>{SOURCE_MAP[record.source] ?? record.source}</Tag>,
    },
  ]

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message="采集实现（exporter）池"
        description="模板的「采集实现」从这里选取；采集实现由平台内置或独立登记维护，本清单只读。"
        style={{ marginBottom: 16 }}
        action={
          <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>
        }
      />
      {error && (
        <Alert type="error" showIcon message="采集实现加载失败" description={error} style={{ marginBottom: 16 }} />
      )}
      <Table<ExporterTemplate>
        rowKey={(record) => String(record.id)}
        dataSource={templates}
        loading={loading}
        columns={columns}
        size="small"
        scroll={TABLE_SCROLL_X}
        locale={{ emptyText: <Empty description="暂无采集实现" /> }}
        pagination={{ ...TABLE_PAGINATION, showTotal: undefined }}
      />
    </div>
  )
}

export default CollectorTemplatesTab
