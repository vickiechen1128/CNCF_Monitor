import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { EllipsisText } from '../components/EllipsisText'
import { ReviewNote } from '../components/ReviewNote'
import {
  CMDB_FIELD_OPTIONS,
  COMPOSITE_OPTIONS,
  PROTECTED_PROMETHEUS_LABELS,
  RESOURCE_FIELD_OPTIONS,
  RESOURCE_TYPE_MAP,
  STATUS_MAP,
  TEMPLATE_REFERENCING_JOBS,
  mockLabelTemplates,
  mockResources,
} from '../mocks/module-07'
import type { LabelTemplate, LabelTemplateSource, Mapping, Resource, ResourceCategory, TemplateReferencingJob } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

// MVP 字段来源：prometheus_builtin 由 Prometheus 原生注入无需映射，隐藏（数据模型保留，v0.2+ 服务发现启用）；
// {v2.5} composite（组合字段）为 MVP 内部默认（自动生成 instance = 资源 IP + 端口，Prometheus 默认行为一致），前台不可新增，v0.2+ 身份定制（代理抓取/端口覆盖/服务发现）开放；cmdb_field v0.4+ 预留
const SOURCE_TYPE_OPTIONS: { value: LabelTemplateSource; label: string; disabled?: boolean }[] = [
  { value: 'resource_field', label: '资源字段' },
  { value: 'composite', label: '组合字段（内置默认，v0.2+ 开放）', disabled: true },
  { value: 'cmdb_field', label: 'CMDB 字段（后续版本开放）', disabled: true },
]

// 转换规则：MVP 支持 无/lower/upper（可留空=原样透传）；prefix/replace 需参数，后续版本开放
const TRANSFORM_OPTIONS: { value: string; label: string; disabled?: boolean }[] = [
  { value: '', label: '无（原样透传）' },
  { value: 'lower', label: 'lower（转小写）' },
  { value: 'upper', label: 'upper（转大写）' },
  { value: 'prefix', label: 'prefix（加前缀，后续开放）', disabled: true },
  { value: 'replace', label: 'replace（正则替换，后续开放）', disabled: true },
]

const SOURCE_TYPE_COLOR: Record<LabelTemplateSource, string> = {
  resource_field: 'blue',
  prometheus_builtin: 'purple',
  composite: 'cyan',
  cmdb_field: 'default',
}

const SOURCE_TYPE_LABEL: Record<LabelTemplateSource, string> = {
  resource_field: '资源字段',
  prometheus_builtin: 'Prometheus 内置字段',
  composite: '组合字段',
  cmdb_field: 'CMDB 字段',
}

type TemplateFilter = 'all' | 'default' | 'custom'

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export default function LabelTemplatesPage() {
  const { message, modal, notification } = App.useApp()
  const [activeType, setActiveType] = useState<ResourceCategory>('host')
  const [templates, setTemplates] = useState<LabelTemplate[]>(mockLabelTemplates)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(mockLabelTemplates[0].template_id)
  const [templateSearch, setTemplateSearch] = useState('')
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>('all')
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null)
  const [mappingDrawerOpen, setMappingDrawerOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<Mapping | null>(null)
  const [templateForm] = Form.useForm()
  const [mappingForm] = Form.useForm()
  const watchedSourceType = Form.useWatch('source_type', mappingForm)
  const watchedSourceField = Form.useWatch('source_field', mappingForm)

  // {v2.3} / {v2.7} 右栏 Tab：映射明细 / 关联实例 / 被引用采集 Job
  const [detailTab, setDetailTab] = useState<string>('mappings')
  // {v2.3} 关联实例 Table：搜索 + 状态筛选
  const [instanceSearch, setInstanceSearch] = useState('')
  const [instanceStatusFilter, setInstanceStatusFilter] = useState<string>('all')

  // 左侧模板列表：按资源类别 + 搜索 + 默认/自定义筛选
  const typeTemplates = useMemo(() => templates.filter((t) => t.resource_category === activeType), [templates, activeType])
  const filteredTypeTemplates = useMemo(() => {
    const keyword = templateSearch.trim().toLowerCase()
    return typeTemplates.filter((t) => {
      if (templateFilter === 'default' && !t.is_default) return false
      if (templateFilter === 'custom' && t.is_default) return false
      if (!keyword) return true
      return t.name.toLowerCase().includes(keyword) || t.template_id.toLowerCase().includes(keyword)
    })
  }, [typeTemplates, templateSearch, templateFilter])

  const selectedTemplate =
    templates.find((t) => t.template_id === selectedTemplateId) ?? typeTemplates[0] ?? null

  // {v2.3} 关联实例：模板按 resource_category 隐式关联该类型全部资源
  const relatedResourcesOf = (tpl: LabelTemplate) => mockResources.filter((r) => r.resource_category === tpl.resource_category)

  // {v2.7} 被引用 Job：引用本模板的采集 Job（策略层消费方，只读展示）
  const referencingJobsOf = (tpl: LabelTemplate): TemplateReferencingJob[] => TEMPLATE_REFERENCING_JOBS[tpl.template_id] ?? []

  // {v2.7} 保存后影响提示：告知「影响哪些采集任务、何时生效」；
  // MVP = 重新生成配置并立即生效；v0.2+ = 前往配置中心确认（评审说明见 MainLayout 折叠区）
  const notifyTemplateImpact = (tpl: LabelTemplate, actionLabel: string) => {
    const jobs = referencingJobsOf(tpl)
    if (jobs.length === 0) {
      message.success(`${actionLabel}，暂无采集 Job 引用本模板`)
      return
    }
    const domainCount = new Set(jobs.map((j) => j.network_domain_id)).size
    const pendingCount = jobs.filter((j) => j.change_status === 'pending').length
    notification.success({
      message: `${actionLabel}，配置将重新生成`,
      description: (
        <Space direction="vertical" size={4}>
          <Text style={{ fontSize: 13 }}>
            本模板被 <Text strong>{jobs.length}</Text> 个采集 Job 引用（{domainCount} 个网域），将按新映射重新生成标签，重新生成配置并立即生效。
          </Text>
          <Text style={{ fontSize: 12, color: '#86909C' }}>
            {pendingCount > 0 ? `其中 ${pendingCount} 个 Job 显示「模板已变更」状态，可在下方「被引用采集 Job」查看。` : '所有引用 Job 状态正常。'}
          </Text>
          <Text style={{ fontSize: 12, color: '#86909C' }}>MVP 无版本回滚能力，修改立即生效（每次变更落只读修改快照）。</Text>
        </Space>
      ),
      btn: (
        <Button size="small" onClick={() => { setDetailTab('jobs'); notification.destroy() }}>
          查看引用 Job
        </Button>
      ),
      duration: 8,
    })
  }

  // {v2.3} 关联实例 Table 数据：搜索 + 状态筛选
  const relatedInstances = useMemo(() => {
    if (!selectedTemplate) return []
    const kw = instanceSearch.trim().toLowerCase()
    return relatedResourcesOf(selectedTemplate).filter((r) => {
      if (instanceStatusFilter !== 'all' && r.status !== instanceStatusFilter) return false
      if (!kw) return true
      return [r.instance_name, r.hostname, r.instance_ip, r.app_name].some((t) => (t ?? '').toLowerCase().includes(kw))
    })
  }, [selectedTemplate, instanceSearch, instanceStatusFilter])

  const instanceColumns: TableProps<Resource>['columns'] = [
    { title: '实例名', dataIndex: 'instance_name', key: 'instance_name', render: (v: string, r) => <Text strong style={{ fontSize: 12 }}>{v || r.resource_id}</Text> },
    { title: '目标 IP', dataIndex: 'instance_ip', key: 'instance_ip', render: (v?: string) => v || '-' },
    { title: '环境', dataIndex: 'env', key: 'env', render: (v?: string) => v || '-' },
    { title: '应用', dataIndex: 'app_name', key: 'app_name', render: (v?: string) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: Resource['status']) => <Badge status={v === 'online' ? 'success' : v === 'maintenance' ? 'warning' : 'default'} text={STATUS_MAP[v]} />,
    },
  ]

  // {v2.7} 被引用采集 Job 列：Job 名 / 网域 / 启用状态 / 变更状态
  const jobColumns: TableProps<TemplateReferencingJob>['columns'] = [
    { title: '采集 Job', dataIndex: 'job_name', key: 'job_name', render: (v: string) => <Text strong style={{ fontSize: 12 }}>{v}</Text> },
    { title: '网域', dataIndex: 'network_domain_id', key: 'network_domain_id', render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '启用状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (v: boolean) => (v ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />),
    },
    {
      title: '变更状态',
      dataIndex: 'change_status',
      key: 'change_status',
      render: (v: TemplateReferencingJob['change_status']) =>
        v === 'pending' ? <Tag color="orange">模板已变更，待确认</Tag> : <Badge status="success" text="已确认" />,
    },
  ]

  const handleTabChange = (key: string) => {
    const type = key as ResourceCategory
    setActiveType(type)
    setTemplateSearch('')
    setTemplateFilter('all')
    const first = templates.find((t) => t.resource_category === type)
    setSelectedTemplateId(first?.template_id ?? '')
  }

  // ---------- 模板级操作 ----------
  const openTemplateDrawer = (tpl?: LabelTemplate) => {
    setEditingTemplate(tpl ?? null)
    templateForm.resetFields()
    if (tpl) {
      templateForm.setFieldsValue({ name: tpl.name, resource_category: tpl.resource_category })
    } else {
      templateForm.setFieldsValue({ resource_category: activeType })
    }
    setTemplateDrawerOpen(true)
  }

  const closeTemplateDrawer = () => {
    setTemplateDrawerOpen(false)
    setEditingTemplate(null)
    templateForm.resetFields()
  }

  // P1：克隆模板（占位，PRD 未明确编号，作为模板管理增强）
  const handleCloneTemplate = (tpl: LabelTemplate) => {
    const now = nowStr()
    const cloned: LabelTemplate = {
      template_id: `tpl-${tpl.resource_category}-${Date.now()}`,
      name: `${tpl.name}（副本）`,
      resource_category: tpl.resource_category,
      is_default: false,
      mappings: tpl.mappings.map((m) => ({
        ...m,
        mapping_id: `mp-${tpl.resource_category}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })),
      created_at: now,
      updated_at: now,
    }
    setTemplates((prev) => [...prev, cloned])
    setActiveType(cloned.resource_category)
    setSelectedTemplateId(cloned.template_id)
    message.success(`已克隆模板「${tpl.name}」为「${cloned.name}」`)
  }

  // 删除模板：默认模板不可删除（PRD 7.1 模板规则）
  const handleDeleteTemplate = (tpl: LabelTemplate) => {
    if (tpl.is_default) {
      message.warning('默认模板不可删除（每类资源保留一个默认模板）')
      return
    }
    modal.confirm({
      title: '删除模板',
      content: `确认删除模板「${tpl.name}」？该操作不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setTemplates((prev) => prev.filter((t) => t.template_id !== tpl.template_id))
        if (selectedTemplateId === tpl.template_id) {
          const remaining = templates.filter((t) => t.resource_category === tpl.resource_category && t.template_id !== tpl.template_id)
          setSelectedTemplateId(remaining[0]?.template_id ?? '')
        }
        message.success('模板已删除')
      },
    })
  }

  const handleSaveTemplate = () => {
    templateForm.validateFields().then((values) => {
      const now = nowStr()
      if (editingTemplate) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === editingTemplate.template_id
              ? { ...t, name: values.name as string, resource_category: values.resource_category as ResourceCategory, updated_at: now }
              : t
          )
        )
        closeTemplateDrawer()
        // {v2.7} 保存后影响反馈：模板被引用 Job 变更配置
        notifyTemplateImpact({ ...editingTemplate, ...values } as LabelTemplate, '模板已更新')
      } else {
        const tpl: LabelTemplate = {
          template_id: `tpl-${values.resource_category}-${Date.now()}`,
          name: values.name as string,
          resource_category: values.resource_category as ResourceCategory,
          is_default: false,
          mappings: [],
          created_at: now,
          updated_at: now,
        }
        setTemplates((prev) => [...prev, tpl])
        setActiveType(tpl.resource_category)
        setSelectedTemplateId(tpl.template_id)
        closeTemplateDrawer()
        message.success('模板已新增')
      }
    })
  }

  // ---------- 映射级操作 ----------
  const getSourceFieldOptions = (type: ResourceCategory, sourceType?: LabelTemplateSource) => {
    if (sourceType === 'composite') return COMPOSITE_OPTIONS.map((f) => ({ value: f, label: f }))
    if (sourceType === 'cmdb_field') return CMDB_FIELD_OPTIONS.map((f) => ({ value: f, label: `${f}（后续版本开放）` }))
    return RESOURCE_FIELD_OPTIONS[type].map((f) => ({ value: f, label: f }))
  }

  const openMappingDrawer = (mapping?: Mapping) => {
    if (!selectedTemplate) return
    setEditingMapping(mapping ?? null)
    mappingForm.resetFields()
    if (mapping) {
      mappingForm.setFieldsValue({ ...mapping })
    } else {
      mappingForm.setFieldsValue({ source_type: 'resource_field', transform: '', enabled: true })
    }
    setMappingDrawerOpen(true)
  }

  const closeMappingDrawer = () => {
    setMappingDrawerOpen(false)
    setEditingMapping(null)
    mappingForm.resetFields()
  }

  // UX：切换来源类型时重置来源字段，并按类型预填目标标签
  const handleSourceTypeChange = (value: LabelTemplateSource) => {
    mappingForm.setFieldsValue({ source_field: undefined })
    if (value === 'composite') {
      // 组合字段 MVP 仅 instance_ip:port，目标固定 instance
      mappingForm.setFieldValue('target_label', 'instance')
    } else {
      mappingForm.setFieldValue('target_label', '')
    }
  }

  // UX：resource_field 来源新增映射时，目标标签默认 = 来源字段（可修改）
  const handleSourceFieldChange = (value: string) => {
    const sourceType = mappingForm.getFieldValue('source_type') as LabelTemplateSource
    const currentTarget = mappingForm.getFieldValue('target_label') as string | undefined
    // 仅当目标标签为空或仍为上一次自动预填值时刷新，不覆盖用户手输值
    if (!currentTarget || currentTarget === watchedSourceField) {
      mappingForm.setFieldValue('target_label', sourceType === 'composite' ? 'instance' : value)
    }
  }

  const handleSaveMapping = () => {
    if (!selectedTemplate) return
    mappingForm.validateFields().then((values) => {
      const now = nowStr()
      // PRD 5.3 / 3.3 / 决策 3.4：保护 Prometheus 内置 label，不允许覆盖；
      // 例外：composite → instance 为 Prometheus 标准 instance 映射方式（决策 3.4），允许
      const targetLabel = values.target_label as string
      const isCompositeInstance = values.source_type === 'composite' && targetLabel === 'instance'
      if (PROTECTED_PROMETHEUS_LABELS.includes(targetLabel) && !isCompositeInstance) {
        message.warning(`「${targetLabel}」是 Prometheus 内置保护 label，不允许作为目标标签`)
        return
      }
      // 同一模板内 target_label 不允许重复（含编辑自身时排除当前映射）
      const duplicated = selectedTemplate.mappings.some(
        (m) => m.target_label === targetLabel && m.mapping_id !== editingMapping?.mapping_id
      )
      if (duplicated) {
        message.warning(`目标标签「${targetLabel}」在该模板中已存在，请更换或先删除原映射`)
        return
      }
      const field = {
        source_field: values.source_field as string,
        source_type: values.source_type as LabelTemplateSource,
        target_label: targetLabel,
        transform: (values.transform as string | undefined) ?? '',
        enabled: (values.enabled as boolean | undefined) ?? true,
      }
      if (editingMapping) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === selectedTemplate.template_id
              ? {
                  ...t,
                  mappings: t.mappings.map((m) => (m.mapping_id === editingMapping.mapping_id ? { ...m, ...field } : m)),
                  updated_at: now,
                }
              : t
          )
        )
        closeMappingDrawer()
        // {v2.7} 保存后影响反馈
        notifyTemplateImpact(selectedTemplate, '映射已更新')
      } else {
        const mapping: Mapping = {
          mapping_id: `mp-${selectedTemplate.resource_category}-${Date.now()}`,
          ...field,
        }
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === selectedTemplate.template_id
              ? { ...t, mappings: [...t.mappings, mapping], updated_at: now }
              : t
          )
        )
        closeMappingDrawer()
        // {v2.7} 保存后影响反馈
        notifyTemplateImpact(selectedTemplate, '映射已新增')
      }
    })
  }

  const handleDeleteMapping = (mapping: Mapping) => {
    if (!selectedTemplate) return
    modal.confirm({
      title: '删除映射',
      content: `确认删除映射「${mapping.source_field} → ${mapping.target_label}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === selectedTemplate.template_id
              ? { ...t, mappings: t.mappings.filter((m) => m.mapping_id !== mapping.mapping_id), updated_at: nowStr() }
              : t
          )
        )
        message.success('映射已删除')
      },
    })
  }

  const mappingColumns: TableProps<Mapping>['columns'] = [
    { title: '来源字段', dataIndex: 'source_field', key: 'source_field', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '来源类型',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (value: LabelTemplateSource) => (
        <Space size={4}>
          <Tag color={SOURCE_TYPE_COLOR[value]}>{SOURCE_TYPE_LABEL[value]}</Tag>
          {/* {v2.5} 组合字段为内置默认：instance = 资源 IP + 端口（Prometheus 默认行为一致），前台不可新增、无需配置 */}
          {value === 'composite' && (
            <Tooltip title="采集目标身份（instance）自动生成：资源 IP + 端口；Prometheus 默认行为一致，无需配置，v0.2+ 身份定制开放">
              <Tag style={{ fontSize: 11 }}>内置默认</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '目标标签',
      dataIndex: 'target_label',
      key: 'target_label',
      render: (v: string) => <Text strong style={{ color: '#0ECDEB' }}>{v}</Text>,
    },
    { title: '转换规则', dataIndex: 'transform', key: 'transform', render: (v?: string) => (v ? <Tag>{v}</Tag> : '-') },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (v: boolean) => (v ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Mapping) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openMappingDrawer(record)}>
            编辑
          </Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteMapping(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const renderMappingTable = (data: Mapping[]) => (
    <Table
      rowKey="mapping_id"
      dataSource={data}
      columns={mappingColumns}
      pagination={false}
      size="small"
      locale={{ emptyText: '无' }}
    />
  )

  // 映射明细按来源类型分组（资源字段 / 组合字段）
  const renderMappingsGrouped = (tpl: LabelTemplate) => {
    const composites = tpl.mappings.filter((m) => m.source_type === 'composite')
    const resourceFields = tpl.mappings.filter((m) => m.source_type === 'resource_field')
    const others = tpl.mappings.filter((m) => m.source_type !== 'composite' && m.source_type !== 'resource_field')
    if (tpl.mappings.length === 0) return <Empty description="该模板暂无映射，点击「新增映射」添加" />
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {composites.length > 0 && (
          <div>
            <Divider plain orientation="left" style={{ margin: '4px 0 8px' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>组合字段（{composites.length}）</Text>
            </Divider>
            {renderMappingTable(composites)}
          </div>
        )}
        {resourceFields.length > 0 && (
          <div>
            <Divider plain orientation="left" style={{ margin: '4px 0 8px' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>资源字段（{resourceFields.length}）</Text>
            </Divider>
            {renderMappingTable(resourceFields)}
          </div>
        )}
        {others.length > 0 && (
          <div>
            <Divider plain orientation="left" style={{ margin: '4px 0 8px' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>其他（{others.length}）</Text>
            </Divider>
            {renderMappingTable(others)}
          </div>
        )}
      </Space>
    )
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>标签模板</Title>
        <Text type="secondary">按资源类别管理字段到 Prometheus Label 的映射（模板级管理）</Text>
      </div>

      {/* 模块边界说明（用户语言，技术细节见 MainLayout 全局折叠区） */}
      <Alert
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
        message="标签模板怎么用"
        description={
          <Space direction="vertical" size={4}>
            <Text style={{ fontSize: 13 }}>
              • 标签模板按资源类别定义「字段 → 监控标签」的映射，本页负责模板的创建与维护。
            </Text>
            <Text style={{ fontSize: 13 }}>
              • 字段来源支持「资源字段 / 组合字段」；CMDB 字段后续版本开放。监控任务自带的标签由采集系统原生注入，无需在此配置。
            </Text>
            <Text style={{ fontSize: 13 }}>
              • 每类资源预置一个默认模板，默认模板不可删除。
            </Text>
            <Text style={{ fontSize: 13 }}>
              • 状态映射（Excel 中文 → 运行中/已停止/维护中）为 Excel 导入的系统规则，规则明细见「导入记录」页。
            </Text>
          </Space>
        }
      />

      <ReviewNote title="设计说明（面向产品 / 技术评审）" style={{ margin: '0 0 16px' }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>字段来源中的「prometheus_builtin」由 Prometheus 原生注入，无需映射，MVP 隐藏（数据模型保留，v0.2+ 服务发现启用）。</li>
          <li>组合字段 composite 为 MVP 内部默认（自动生成 instance = 资源 IP + 端口，Prometheus 默认行为一致），前台不可新增，v0.2+ 身份定制开放。</li>
          <li>保护标签（instance/job 等）不允许作为目标标签；composite → instance 为例外允许。</li>
          <li>同一模板内 target_label 唯一，保存时校验（编辑自身排除）。</li>
          <li>标签来源口径：模板映射生成的标签 = 资源详情中的「系统」标签；用户手工添加 = 「用户」标签（在资源详情添加，不在此配置）；CMDB 字段（v0.4+）= 「CMDB」标签。监控任务自带的标签由采集系统原生注入，无需在此配置。</li>
          <li>转换规则「prefix/replace」需参数，后续版本开放。</li>
        </ul>
      </ReviewNote>

      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Tabs
              activeKey={activeType}
              onChange={handleTabChange}
              items={RESOURCE_TYPES.map((type) => ({
                key: type,
                label: `${RESOURCE_TYPE_MAP[type]} (${templates.filter((t) => t.resource_category === type).length})`,
              }))}
            />
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }} onClick={() => openTemplateDrawer()}>
              新增模板
            </Button>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={9}>
            <Card
              size="small"
              title="模板列表"
              style={{ minHeight: 420 }}
              extra={<Text type="secondary" style={{ fontSize: 12 }}>{filteredTypeTemplates.length} 个</Text>}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Input.Search
                  placeholder="搜索模板名称 / ID"
                  allowClear
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                />
                <Select value={templateFilter} onChange={(v) => setTemplateFilter(v as TemplateFilter)} style={{ width: '100%' }}>
                  <Option value="all">全部模板</Option>
                  <Option value="default">默认模板</Option>
                  <Option value="custom">自定义模板</Option>
                </Select>
              </Space>
              <div style={{ marginTop: 12 }}>
                {filteredTypeTemplates.length === 0 ? (
                  <Empty description="无匹配模板" />
                ) : (
                  <List
                    dataSource={filteredTypeTemplates}
                    renderItem={(tpl) => {
                      const active = tpl.template_id === selectedTemplate?.template_id
                      return (
                        <List.Item
                          onClick={() => setSelectedTemplateId(tpl.template_id)}
                          style={{
                            cursor: 'pointer',
                            padding: '10px 12px',
                            borderRadius: 6,
                            background: active ? '#E6FAFD' : undefined,
                            border: active ? '1px solid #0ECDEB' : '1px solid transparent',
                          }}
                        >
                          <List.Item.Meta
                            title={
                              <Space size={6}>
                                <EllipsisText maxWidth={140}>{tpl.name}</EllipsisText>
                                {tpl.is_default && <Tag color="gold">默认</Tag>}
                              </Space>
                            }
                            description={
                              <Space size={8} wrap>
                                <Badge count={tpl.mappings.length} showZero color="#185FA5" />
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {tpl.mappings.length} 条映射
                                </Text>
                                {/* {v2.3} 关联实例数 badge：不弹窗，点击选中后右侧 Tab「关联实例」查看明细 */}
                                <Badge count={relatedResourcesOf(tpl).length} showZero color="#0F6E56" />
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  关联实例 {relatedResourcesOf(tpl).length}
                                </Text>
                                {/* {v2.7} 被引用 Job 数 badge：模板变更影响哪些采集任务，右侧 Tab「被引用采集 Job」查看明细 */}
                                <Badge count={referencingJobsOf(tpl).length} showZero color="#7F77DD" />
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  被引用 {referencingJobsOf(tpl).length}
                                </Text>
                              </Space>
                            }
                          />
                        </List.Item>
                      )
                    }}
                  />
                )}
              </div>
            </Card>
          </Col>
          <Col span={15}>
            {selectedTemplate ? (
              <Card
                size="small"
                title={
                  <Space size={6}>
                    <Text strong>{selectedTemplate.name}</Text>
                    {selectedTemplate.is_default && <Tag color="gold">默认</Tag>}
                    <Tag>{RESOURCE_TYPE_MAP[selectedTemplate.resource_category]}</Tag>
                    <Text code style={{ fontSize: 11 }}>
                      {selectedTemplate.template_id}
                    </Text>
                  </Space>
                }
                extra={
                  <Space>
                    <Button icon={<EditOutlined />} onClick={() => openTemplateDrawer(selectedTemplate)}>
                      编辑模板
                    </Button>
                    {/* P1：克隆模板占位 */}
                    <Tooltip title="克隆当前模板（含全部映射），用于快速创建变体模板">
                      <Button icon={<CopyOutlined />} onClick={() => handleCloneTemplate(selectedTemplate)}>
                        克隆
                      </Button>
                    </Tooltip>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      style={{ backgroundColor: '#0ECDEB' }}
                      onClick={() => openMappingDrawer()}
                    >
                      新增映射
                    </Button>
                    {!selectedTemplate.is_default && (
                      <Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteTemplate(selectedTemplate)}>
                        删除模板
                      </Button>
                    )}
                  </Space>
                }
              >
                <Space direction="vertical" size={2} style={{ marginBottom: 12 }}>
                  <Text style={{ fontSize: 13 }}>
                    标签模板只与资源类别绑定，不绑定具体采集任务；字段来源支持「资源字段 / 组合字段」，映射按来源类型分组展示。
                  </Text>
                  <Text style={{ fontSize: 12, color: '#86909C' }}>
                    保护标签（不可作为目标标签）：{PROTECTED_PROMETHEUS_LABELS.join(', ')}
                  </Text>
                </Space>
                {/* {v2.3} 右栏 Tab 化：映射明细 / 关联实例（实例用完整 Table 承载，支持分页/搜索/状态筛选） */}
                <Tabs
                  activeKey={detailTab}
                  onChange={setDetailTab}
                  items={[
                    {
                      key: 'mappings',
                      label: `映射明细（${selectedTemplate.mappings.length}）`,
                      children: renderMappingsGrouped(selectedTemplate),
                    },
                    {
                      key: 'instances',
                      label: `关联实例（${relatedResourcesOf(selectedTemplate).length}）`,
                      children: (
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          {/* {v2.5} 隐式关联说明：让用户理解模板通过 resource_category 自动关联，无需手动逐台配置 */}
                          <Text style={{ fontSize: 13 }}>
                            本模板适用于「{RESOURCE_TYPE_MAP[selectedTemplate.resource_category]}」类型，该类型下所有{' '}
                            <Text strong>{relatedResourcesOf(selectedTemplate).length}</Text> 个实例自动适用本模板的标签映射，无需手动关联。
                            如需查看具体实例清单，请浏览下方列表。
                          </Text>
                          <FilterBar>
                            <FilterItem label="搜索" width={360}>
                              <Input.Search
                                placeholder="搜索实例名 / IP / 应用"
                                allowClear
                                value={instanceSearch}
                                onChange={(e) => setInstanceSearch(e.target.value)}
                                style={{ width: 300 }}
                              />
                            </FilterItem>
                            <FilterItem label="状态" width={240}>
                              <Select
                                placeholder="按状态筛选"
                                allowClear
                                style={{ width: 180 }}
                                value={instanceStatusFilter}
                                onChange={(v) => setInstanceStatusFilter(v ?? 'all')}
                              >
                                <Option value="all">全部状态</Option>
                                <Option value="online">运行中</Option>
                                <Option value="offline">已停止</Option>
                                <Option value="maintenance">维护中</Option>
                              </Select>
                            </FilterItem>
                          </FilterBar>
                          <Table
                            rowKey="resource_id"
                            size="small"
                            dataSource={relatedInstances}
                            columns={instanceColumns}
                            pagination={{ pageSize: 10, showSizeChanger: false }}
                            locale={{ emptyText: '无关联实例' }}
                          />
                        </Space>
                      ),
                    },
                    {
                      // {v2.7} 被引用采集 Job Tab：模板变更影响哪些采集任务（规则层 → 策略层显性化）
                      key: 'jobs',
                      label: `被引用采集 Job（${referencingJobsOf(selectedTemplate).length}）`,
                      children: (
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          <Text style={{ fontSize: 13 }}>
                            本模板被 <Text strong>{referencingJobsOf(selectedTemplate).length}</Text> 个采集 Job 引用。
                            修改模板后，引用的 Job 会按新映射重新生成标签，配置变更需在配置中心确认后生效（后续版本开放；当前版本重新生成配置并立即生效）。
                            MVP 无版本回滚能力，修改立即生效，每次变更落只读修改快照（操作人 / 时间 / 旧值 / 新值）。
                            如需查看具体清单，请浏览下方列表。
                          </Text>
                          <Table
                            rowKey="job_id"
                            size="small"
                            dataSource={referencingJobsOf(selectedTemplate)}
                            columns={jobColumns}
                            pagination={{ pageSize: 10, showSizeChanger: false }}
                            locale={{ emptyText: '暂无采集 Job 引用本模板' }}
                          />
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ) : (
              <Card size="small" style={{ minHeight: 420 }}>
                <Empty description="请选择左侧模板查看详情" />
              </Card>
            )}
          </Col>
        </Row>
      </Card>

      {/* 模板编辑抽屉 */}
      <Drawer
        title={editingTemplate ? '编辑模板' : '新增模板'}
        width={400}
        open={templateDrawerOpen}
        onClose={closeTemplateDrawer}
        extra={
          <Space>
            <Button onClick={closeTemplateDrawer}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSaveTemplate}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={templateForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            label="模板名称"
            name="name"
            rules={[{ required: true, message: '请输入模板名称' }]}
            extra="模板名称用于展示，同一资源类别下名称可重复"
          >
            <Input placeholder="如 主机默认模板" />
          </Form.Item>
          <Form.Item
            label="资源类别"
            name="resource_category"
            rules={[{ required: true, message: '请选择资源类别' }]}
            extra="模板与资源类别绑定，创建后不可修改"
          >
            <Select disabled={!!editingTemplate} placeholder="请选择">
              {RESOURCE_TYPES.map((type) => (
                <Option key={type} value={type}>
                  {RESOURCE_TYPE_MAP[type]}
                </Option>
              ))}
            </Select>
          </Form.Item>
          {!editingTemplate && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              新增模板默认为自定义模板，映射列表为空。创建后可通过「新增映射」添加字段映射。
            </Text>
          )}
        </Form>
      </Drawer>

      {/* 映射编辑抽屉 */}
      <Drawer
        title={editingMapping ? '编辑映射' : '新增映射'}
        width={520}
        open={mappingDrawerOpen}
        onClose={closeMappingDrawer}
        extra={
          <Space>
            <Button onClick={closeMappingDrawer}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSaveMapping}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={mappingForm} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="来源类型"
                name="source_type"
                rules={[{ required: true, message: '请选择来源类型' }]}
                extra="字段来源决定标签取值：「资源字段 / 组合字段」生成的标签在资源详情中显示为「系统」来源；用户自定义标签在资源详情直接添加，不在此配置；CMDB 字段为后续版本预留，接入后启用"
              >
                <Select placeholder="请选择" onChange={(v) => handleSourceTypeChange(v as LabelTemplateSource)}>
                  {SOURCE_TYPE_OPTIONS.map((opt) => (
                    <Option key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label} {opt.disabled ? '（后续版本开放）' : ''}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="来源字段"
                name="source_field"
                rules={[{ required: true, message: '请选择来源字段' }]}
                extra={
                  watchedSourceType === 'resource_field'
                    ? '从资源固定字段中选取'
                    : watchedSourceType === 'composite'
                    ? '组合字段，由多个字段拼接生成标签'
                    : watchedSourceType === 'cmdb_field'
                    ? 'CMDB 字段，后续版本由 CMDB 同步'
                    : undefined
                }
              >
                <Select
                  placeholder={watchedSourceType === 'cmdb_field' ? '后续版本开放' : '请选择'}
                  showSearch
                  options={getSourceFieldOptions(selectedTemplate?.resource_category ?? activeType, watchedSourceType)}
                  disabled={watchedSourceType === 'cmdb_field'}
                  onChange={(v) => handleSourceFieldChange(v as string)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="目标标签"
                name="target_label"
                rules={[{ required: true, message: '请输入目标标签' }]}
                extra={
                  watchedSourceType === 'composite'
                    ? '组合字段固定生成 instance 标签（Prometheus 标准实例标识），无需修改'
                    : '资源字段来源默认取来源字段，可修改；保护标签（instance/job 等）不允许使用'
                }
              >
                <Input placeholder="如 instance" disabled={watchedSourceType === 'composite'} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="转换规则"
                name="transform"
                extra="可留空（原样透传）；加前缀 / 正则替换需参数，后续版本开放"
              >
                <Select placeholder="无（原样透传）">
                  {TRANSFORM_OPTIONS.map((o) => (
                    <Option key={o.value} value={o.value} disabled={o.disabled}>
                      {o.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked" extra="关闭后该映射不参与标签生成">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </MainLayout>
  )
}
