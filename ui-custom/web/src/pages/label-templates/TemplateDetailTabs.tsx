/**
 * 标签模板右栏详情三 Tab（T07-F8，Module_07 §3.2 / §11.1）。
 *
 * Tab1 映射明细：按来源类型分组展示（composite / resource_field / 其他），
 *   新增/编辑/删除映射走 MappingDrawer（保留模板上下文）；默认模板只读保护。
 * Tab2 关联实例：labelTemplateApi.resources 服务端分页（pageSize=10）+ 关键字搜索 + 状态筛选
 *   （MVP 阶段后端仅支持 page/page_size，搜索与状态筛选在前端对当前页过滤，见 §3.2 分页策略）；
 *   Tab 顶部隐式关联说明（§3.2）；空态「该类型下暂无实例」。
 * Tab3 被引用 Job：数据源为 Module_01 只读接口（GET /api/v1/scrape-jobs?label_template_id=，
 *   §3.2 / §6.6.3）未实现，本阶段展示空态占位 + 说明文案，接 M01 后替换为表格渲染。
 *
 * 映射保存后展示「保存后影响反馈」Alert（§3.2 / §11.2）：
 * 「本模板被 N 个采集 Job 引用，将按新映射重新生成标签；MVP 重新生成并立即生效；
 * 无版本回滚能力，修改立即生效」+「查看引用 Job」跳转 Tab3。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { TableProps } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { labelTemplateApi } from '../../api/labelTemplates'
import { EllipsisText } from '../../components/EllipsisText'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { TABLE_SCROLL_X } from '../../components/tablePresets'
import type { LabelTemplate, Mapping, TemplateInstanceItem } from '../../types/label'
import {
  INSTANCE_LEVEL_CUSTOM_CATEGORIES,
  INSTANCE_STATUS_MAP,
  INSTANCE_STATUS_OPTIONS,
  RESOURCE_TYPE_MAP,
  SOURCE_TYPE_COLOR,
  SOURCE_TYPE_LABEL,
} from './labelTemplateConstants'
import MappingDrawer from './MappingDrawer'

const { Text } = Typography

/** 关联实例列表分页 pageSize（§11.1：pageSize=10） */
const INSTANCE_PAGE_SIZE = 10

/** 右栏 Tab key */
type DetailTabKey = 'mappings' | 'instances' | 'jobs'

interface TemplateDetailTabsProps {
  /** 左栏选中的模板；null 时展示「请选择左侧模板查看详情」 */
  template: LabelTemplate | null
  /** 引用本模板的采集 Job 数（数据源 M01 GET /api/v1/scrape-jobs?label_template_id=，未实现时默认 0） */
  referencingJobCount?: number
  /** 映射变更后回调（携带最新 mappings，供上级刷新左栏映射数 badge） */
  onMappingsChange: (mappings: Mapping[]) => void
}

/** 分组映射行：映射本身 + 在模板全量 mappings 中的 0-based 下标（→ 1-based mapping_id） */
interface GroupedMapping {
  mapping: Mapping
  globalIndex: number
}

/**
 * 标签模板右栏详情三 Tab（T07-F8）。
 * 无选中模板时展示引导占位；选中后按模板 id 加载关联实例并支持映射增删改。
 */
export default function TemplateDetailTabs({
  template,
  referencingJobCount = 0,
  onMappingsChange,
}: TemplateDetailTabsProps) {
  const templateId = template?.id ?? null

  // 双场景治理边界（PRD §3.3/§5.2/§6.2）：仅允许实例级自定义的类别（application）展示「关联实例」，
  // 静态资源实例级标签只读、无实例级能力，隐藏该 Tab（F-34）。
  const canShowInstances = template != null && INSTANCE_LEVEL_CUSTOM_CATEGORIES.includes(template.resource_category)

  // 右栏 Tab / 映射抽屉 / 影响反馈 Alert
  const [detailTab, setDetailTab] = useState<DetailTabKey>('mappings')
  const [mappingDrawerOpen, setMappingDrawerOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<Mapping | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GroupedMapping | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [impactVisible, setImpactVisible] = useState(false)

  // 关联实例（服务端分页 + 前端搜索/状态过滤）
  const [instances, setInstances] = useState<TemplateInstanceItem[]>([])
  const [instanceTotal, setInstanceTotal] = useState(0)
  const [instancesLoading, setInstancesLoading] = useState(false)
  const [instancesError, setInstancesError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [instanceSearch, setInstanceSearch] = useState('')
  const [instanceStatus, setInstanceStatus] = useState('all')

  // 模板切换时重置右栏本地状态（渲染期间调整派生状态，React 官方推荐模式，避免 effect 双请求）
  const [prevTemplateId, setPrevTemplateId] = useState<number | null>(templateId)
  if (prevTemplateId !== templateId) {
    setPrevTemplateId(templateId)
    setDetailTab('mappings')
    setMappingDrawerOpen(false)
    setEditingMapping(null)
    setEditingIndex(null)
    setDeleteTarget(null)
    setImpactVisible(false)
    setPage(1)
    setInstanceSearch('')
    setInstanceStatus('all')
    setInstancesError(null)
  }

  const loadInstances = useCallback(async (id: number, p: number) => {
    setInstancesLoading(true)
    setInstancesError(null)
    try {
      const res = await labelTemplateApi.resources(id, { page: p, page_size: INSTANCE_PAGE_SIZE })
      setInstances(res.data.items)
      setInstanceTotal(res.data.total)
    } catch (e) {
      setInstancesError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      setInstances([])
      setInstanceTotal(0)
    } finally {
      setInstancesLoading(false)
    }
  }, [])

  useEffect(() => {
    if (templateId == null || !canShowInstances) return
    // 数据请求回调内在异步完成后才 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInstances(templateId, page)
  }, [templateId, page, loadInstances, canShowInstances])

  // ---------- 映射分组（Tab1） ----------
  const mappingGroups = useMemo<{ key: string; label: string; items: GroupedMapping[] }[]>(() => {
    const composite: GroupedMapping[] = []
    const resourceField: GroupedMapping[] = []
    const others: GroupedMapping[] = []
    ;(template?.mappings ?? []).forEach((m, i) => {
      if (m.source_type === 'composite') composite.push({ mapping: m, globalIndex: i })
      else if (m.source_type === 'resource_field') resourceField.push({ mapping: m, globalIndex: i })
      else others.push({ mapping: m, globalIndex: i })
    })
    return [
      { key: 'composite', label: `组合字段（${composite.length}）`, items: composite },
      { key: 'resource_field', label: `资源字段（${resourceField.length}）`, items: resourceField },
      { key: 'others', label: `其他（${others.length}）`, items: others },
    ].filter((g) => g.items.length > 0)
  }, [template])

  // 前端过滤后的关联实例（MVP：对当前服务端页过滤，§3.2 分页策略）
  const displayedInstances = useMemo(() => {
    const kw = instanceSearch.trim().toLowerCase()
    return instances.filter((it) => {
      if (instanceStatus !== 'all' && it.status !== instanceStatus) return false
      if (!kw) return true
      return (
        (it.instance_name ?? '').toLowerCase().includes(kw) ||
        (it.resource_id ?? '').toLowerCase().includes(kw)
      )
    })
  }, [instances, instanceSearch, instanceStatus])

  const openAddMapping = () => {
    setEditingMapping(null)
    setEditingIndex(null)
    setMappingDrawerOpen(true)
  }

  const openEditMapping = (row: GroupedMapping) => {
    setEditingMapping(row.mapping)
    setEditingIndex(row.globalIndex + 1)
    setMappingDrawerOpen(true)
  }

  // 映射保存（新增/编辑）成功后：刷新映射并展示影响反馈
  const handleMappingsSaved = (mappings: Mapping[]) => {
    setImpactVisible(true)
    onMappingsChange(mappings)
  }

  const handleDeleteMapping = async () => {
    if (!template || !deleteTarget) return
    setDeleting(true)
    try {
      await labelTemplateApi.removeMapping(template.id, deleteTarget.globalIndex + 1)
      const newMappings = template.mappings.filter((_, i) => i !== deleteTarget.globalIndex)
      message.success('映射已删除')
      setDeleteTarget(null)
      setImpactVisible(true)
      onMappingsChange(newMappings)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }

  const mappingColumns: TableProps<GroupedMapping>['columns'] = [
    {
      title: '来源字段',
      key: 'source_field',
      render: (_, row) => (
        <Text code style={{ fontSize: 12 }}>
          {row.mapping.source_field}
        </Text>
      ),
    },
    {
      title: '来源类型',
      key: 'source_type',
      render: (_, row) => (
        <Tag color={SOURCE_TYPE_COLOR[row.mapping.source_type]}>{SOURCE_TYPE_LABEL[row.mapping.source_type]}</Tag>
      ),
    },
    {
      title: '目标标签',
      key: 'target_label',
      render: (_, row) => <Text strong>{row.mapping.target_label}</Text>,
    },
    {
      title: '转换规则',
      key: 'transform',
      render: (_, row) => (row.mapping.transform ? <Tag>{row.mapping.transform}</Tag> : '-'),
    },
    {
      title: '启用',
      key: 'enabled',
      render: (_, row) =>
        row.mapping.enabled ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />,
    },
    ...(!template?.is_default
      ? [
          {
            title: '操作',
            key: 'actions',
            render: (_: unknown, row: GroupedMapping) => (
              <Space size={0}>
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditMapping(row)}>
                  编辑
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setDeleteTarget(row)}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]
      : []),
  ]

  const instanceColumns: TableProps<TemplateInstanceItem>['columns'] = [
    {
      title: '实例名',
      dataIndex: 'instance_name',
      key: 'instance_name',
      render: (v: string, r) => (
        <Text strong style={{ fontSize: 12 }}>
          {v || r.resource_id}
        </Text>
      ),
    },
    {
      title: '资源 ID',
      dataIndex: 'resource_id',
      key: 'resource_id',
      render: (v: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => (
        <Badge
          status={v === 'online' ? 'success' : v === 'maintenance' ? 'warning' : 'default'}
          text={INSTANCE_STATUS_MAP[v] ?? v}
        />
      ),
    },
  ]

  // ---------- 渲染 ----------
  if (!template) {
    return (
      <Card size="small" title="模板详情" style={{ minHeight: 420 }}>
        <Empty description="请选择左侧模板查看详情" />
      </Card>
    )
  }

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <EllipsisText maxWidth={180}>{template.name}</EllipsisText>
          {template.is_default && <Tag color="gold">默认</Tag>}
          <Tag>{RESOURCE_TYPE_MAP[template.resource_category]}</Tag>
        </Space>
      }
      style={{ minHeight: 420 }}
      extra={
        template.is_default ? (
          <Tooltip title="默认模板只读保护，映射变更请基于默认模板克隆后操作">
            {/* 禁用按钮 pointer-events:none 会吞掉鼠标事件，需外套 span 才能触发 Tooltip */}
            <span>
              <Button type="primary" icon={<PlusOutlined />} disabled>
                新增映射
              </Button>
            </span>
          </Tooltip>
        ) : (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddMapping}>
            新增映射
          </Button>
        )
      }
    >
      {impactVisible && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => setImpactVisible(false)}
          style={{ marginBottom: 12 }}
          message="保存已生效"
          description={
            <Space direction="vertical" size={4}>
              <Text style={{ fontSize: 13 }}>
                {referencingJobCount > 0 ? (
                  <>
                    本模板被 <Text strong>{referencingJobCount}</Text> 个采集 Job 引用，将按新映射重新生成标签；
                  </>
                ) : (
                  '暂无采集 Job 引用本模板，本次修改不影响现有采集任务；'
                )}
                MVP 重新生成配置并立即生效。
              </Text>
              <Text style={{ fontSize: 12, color: '#86909C' }}>
                无版本回滚能力，修改立即生效（每次变更落只读修改快照）。
              </Text>
            </Space>
          }
          action={
            <Button size="small" onClick={() => setDetailTab('jobs')}>
              查看引用 Job
            </Button>
          }
        />
      )}

      <Tabs
        activeKey={detailTab}
        onChange={(key) => setDetailTab(key as DetailTabKey)}
        items={[
          {
            key: 'mappings',
            label: `映射明细（${template.mappings.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Text style={{ fontSize: 13 }}>
                  字段来源支持「资源字段 / 组合字段」，映射按来源类型分组展示；保护标签（不可作为目标标签）：
                  instance / job / scheme / __address__ 等（composite→instance 例外）。
                </Text>
                {template.mappings.length === 0 ? (
                  <Empty description="该模板暂无映射，点击「新增映射」添加" />
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {mappingGroups.map((group) => (
                      <div key={group.key}>
                        <Divider plain orientation="left" style={{ margin: '4px 0 8px' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {group.label}
                          </Text>
                        </Divider>
                        <Table
                          rowKey={(row) => String(row.globalIndex + 1)}
                          size="small"
                          dataSource={group.items}
                          columns={mappingColumns}
                          pagination={false}
                          locale={{ emptyText: '无' }}
                          scroll={TABLE_SCROLL_X}
                        />
                      </div>
                    ))}
                  </Space>
                )}
              </Space>
            ),
          },
          ...(canShowInstances
            ? [
                {
                  key: 'instances',
                  label: `关联实例（${instanceTotal}）`,
                  children: (
                    <Space direction="vertical" style={{ width: '100%' }} size={12}>
                      <Text style={{ fontSize: 13 }}>
                        本模板适用于「{RESOURCE_TYPE_MAP[template.resource_category]}」类型，该类型下所有{' '}
                        <Text strong>{instanceTotal}</Text> 个实例自动适用本模板的标签映射，无需手动关联。
                        如需查看具体实例清单，请浏览下方列表。
                      </Text>
                      <FilterBar>
                        <FilterItem label="搜索" width={360}>
                          <Input.Search
                            placeholder="搜索实例名 / 资源 ID"
                            allowClear
                            value={instanceSearch}
                            onChange={(e) => {
                              setInstanceSearch(e.target.value)
                              setPage(1)
                            }}
                            style={{ width: 300 }}
                          />
                        </FilterItem>
                        <FilterItem label="状态" width={240}>
                          <Select
                            placeholder="按状态筛选"
                            allowClear
                            style={{ width: 180 }}
                            value={instanceStatus}
                            onChange={(v) => {
                              setInstanceStatus(v ?? 'all')
                              setPage(1)
                            }}
                            options={INSTANCE_STATUS_OPTIONS}
                          />
                        </FilterItem>
                      </FilterBar>
                      {instancesError ? (
                        <Alert
                          type="error"
                          showIcon
                          message="关联实例加载失败，请稍后重试"
                          description={instancesError}
                          action={
                            <Button
                              size="small"
                              icon={<ReloadOutlined />}
                              onClick={() => {
                                if (templateId != null) void loadInstances(templateId, page)
                              }}
                            >
                              重新加载
                            </Button>
                          }
                        />
                      ) : instancesLoading && instances.length === 0 ? (
                        <Skeleton active paragraph={{ rows: 4 }} />
                      ) : instanceTotal === 0 ? (
                        <Empty description="该类型下暂无实例" />
                      ) : (
                        <Table
                          rowKey="resource_id"
                          size="small"
                          dataSource={displayedInstances}
                          columns={instanceColumns}
                          loading={instancesLoading}
                          pagination={{
                            current: page,
                            pageSize: INSTANCE_PAGE_SIZE,
                            total: instanceTotal,
                            showSizeChanger: false,
                            onChange: (p) => setPage(p),
                          }}
                          locale={{ emptyText: '无匹配实例' }}
                          scroll={TABLE_SCROLL_X}
                        />
                      )}
                    </Space>
                  ),
                },
              ]
            : []),
          {
            key: 'jobs',
            label: `被引用采集 Job（${referencingJobCount}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Text style={{ fontSize: 13 }}>
                  本模板被 <Text strong>{referencingJobCount}</Text> 个采集 Job 引用。修改模板后，引用的 Job
                  会按新映射重新生成标签，配置变更需在配置中心确认后生效（MVP 阶段重新生成配置并立即生效）。
                </Text>
                <Text style={{ fontSize: 12, color: '#86909C' }}>
                  MVP 无版本回滚能力，修改立即生效，每次变更落只读修改快照（操作人 / 时间 / 旧值 / 新值）。
                </Text>
                {/* M01 未实现：被引用 Job 数据源为 Module_01 只读接口
                    GET /api/v1/scrape-jobs?label_template_id={template_id}（§3.2 / §6.6.3），
                    M07 不直接暴露聚合接口。接 M01 后替换为完整 Table（Job 名 / 网域 / 启用状态 / 变更状态，
                    分页 pageSize=10）。本阶段展示空态占位。 */}
                <Empty description="暂无采集 Job 引用本模板" />
              </Space>
            ),
          },
        ]}
      />

      <MappingDrawer
        open={mappingDrawerOpen}
        template={template}
        editingMapping={editingMapping}
        editingIndex={editingIndex}
        onClose={() => setMappingDrawerOpen(false)}
        onSaved={handleMappingsSaved}
      />

      <Modal
        title="删除映射"
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        onOk={handleDeleteMapping}
        confirmLoading={deleting}
        okText="删除"
        okType="danger"
        cancelText="取消"
        destroyOnHidden
      >
        <p>
          确认删除映射「{deleteTarget?.mapping.source_field} → {deleteTarget?.mapping.target_label}」？
        </p>
      </Modal>
    </Card>
  )
}
