import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import {
  Card,
  Divider,
  Table,
  Steps,
  Button,
  Tag,
  Switch,
  Drawer,
  Form,
  Select,
  Input,
  InputNumber,
  Transfer,
  Space,
  Typography,
  Row,
  Col,
  Badge,
  Descriptions,
  Alert,
  App,
  Tooltip,
  Modal,
  List,
  Radio,
  Popover,
  Dropdown,
} from 'antd'
import type { TransferItem } from 'antd/es/transfer'
import {
  PlusOutlined,
  PlusCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  GlobalOutlined,
  SyncOutlined,
  SwapOutlined,
  DownloadOutlined,
  FileTextOutlined,
  ReadOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockScrapeJobs,
  mockExporterTemplates,
  mockResources,
  mockLabelTemplates,
  mockNetworkDomains,
  MONITORED_NETWORK_DOMAINS,
  mockExporterInstallations,
  mockCITypeExporterMappings,
  CI_TYPE_LABEL,
  CI_TYPE_CATEGORY_MAP,
  CI_TYPES,
  CI_TYPES_BY_CATEGORY,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_MAP,
  SCHEMES,
  ENV_VALUES,
  ENV_LABEL,
  BIZ_DOMAINS,
  INSTALL_STATUS_MAP,
  INSTALL_STATUS_CYCLE,
  BLACKBOX_MODULES,
  BLACKBOX_MODULE_LABEL,
  BLACKBOX_PROTOCOL_BY_MODULE,
  EXPORTER_SOURCE_LABEL,
  EXPORTER_SOURCES,
} from '../mocks/module-01'
import type {
  CiType,
  Scheme,
  ScrapeJob,
  ExporterInstallStatus,
  ExporterInstallationConfirmation,
  ScrapeJobType,
  BlackboxModule,
  BlackboxTarget,
  ProbeProtocol,
  ResourceCategory,
  CITypeExporterMapping,
  ExporterSource,
  ExporterTemplate,
  LabelTemplate,
} from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const now = () => new Date().toISOString()

// {v3.16} D23：跨模块跳转链接统一收拢为常量；原型演示用相对路径，实现期由统一路由/导航配置承载（不写死路径）
// {v3.17} 网域空态两步指引：M06 创建网域（行政）→ M09 完成纳管（监控）
const MODULE_LINKS = {
  module06: '../module-06/dist/index.html',
  module09: '../module-09/dist/index.html',
  module07: '../module-07/dist/index.html',
} as const

const PROTOCOL_COLOR: Record<ProbeProtocol, string> = {
  http: '#00B578',
  https: '#1481FD',
  tcp: '#FA8C16',
  icmp: '#0ECDEB',
  dns: '#722ED1',
}

const PROTOCOL_LABEL: Record<ProbeProtocol, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  tcp: 'TCP',
  icmp: 'ICMP',
  dns: 'DNS',
}

/** 决策 14：可从 CI-Exporter 映射继承、且可被手动覆盖的参数字段（同步映射默认值时跳过被覆盖字段） */
const MAPPING_OVERRIDE_FIELDS = ['scrape_interval', 'scrape_timeout', 'metrics_path', 'scheme', 'label_template_id'] as const
type MappingOverrideField = (typeof MAPPING_OVERRIDE_FIELDS)[number]

export default function ScrapeJobsPage() {
  const { modal, message } = App.useApp()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [jobs, setJobs] = useState<ScrapeJob[]>(() => [...mockScrapeJobs])
  const [installations, setInstallations] = useState<ExporterInstallationConfirmation[]>(() => [
    ...mockExporterInstallations,
  ])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScrapeJob | null>(null)
  const [targetKeys, setTargetKeys] = useState<string[]>([])
  const [filterEnv, setFilterEnv] = useState<string | undefined>(undefined)
  // {v3.4} 实例筛选补业务类型（label 别名 biz，见 PRD 5.4 filter 字段语义）
  const [filterBusinessDomain, setFilterBusinessDomain] = useState<string | undefined>(undefined)
  const [blackboxTargets, setBlackboxTargets] = useState<BlackboxTarget[]>([])
  const [confirmTarget, setConfirmTarget] = useState<ExporterInstallationConfirmation | null>(null)
  const [detailJob, setDetailJob] = useState<ScrapeJob | null>(null)
  // {v3.17} 标签模板映射详情 Modal（表格对应形式查看，替代表单内卡片堆砌）
  const [previewTemplate, setPreviewTemplate] = useState<LabelTemplate | null>(null)
  // 决策 14：当前编辑表单中手动覆盖过映射默认值的字段（「同步映射默认值」时跳过）
  const [overriddenFields, setOverriddenFields] = useState<MappingOverrideField[]>([])
  const [confirmForm] = Form.useForm()
  const [form] = Form.useForm()

  // {v3.12} 采集 Job 列表网域查询条件（取代顶部全局网域切换器）
  const [listDomainFilter, setListDomainFilter] = useState<string | undefined>(undefined)

  // {v3.8} 入口合一：视图由左侧导航「采集」分组子项驱动（?view=collectors/jobs，菜单即导航、页面无重复下拉）；
  // 默认采集器管理（安装动线起点）
  const view: 'collectors' | 'jobs' = searchParams.get('view') === 'jobs' ? 'jobs' : 'collectors'
  const [presets, setPresets] = useState<CITypeExporterMapping[]>(() => [...mockCITypeExporterMappings])
  // {v3.12} 采集器（ExporterTemplate）运行时容器：自研采集器登记后入池，可被映射引用
  const [exporterTemplates, setExporterTemplates] = useState(() => [...mockExporterTemplates])
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  // {v3.14} 登记上下文：记录从哪个表单发起登记（preset=默认采集配置抽屉 / job=Job 抽屉 / none=顶部按钮）
  // 用于打开时预填 supported_resource_types、保存成功后回选 exporter_template_id，闭合「选不到 → 登记 → 自动选中」动线
  const [registerCtx, setRegisterCtx] = useState<{ source: 'preset' | 'job' | 'none'; ciType?: CiType }>({
    source: 'none',
  })
  const [templateForm] = Form.useForm()
  const [presetDrawerOpen, setPresetDrawerOpen] = useState(false)
  const [editingPreset, setEditingPreset] = useState<CITypeExporterMapping | null>(null)
  const [presetForm] = Form.useForm()
  const watchPresetCategory = Form.useWatch('resource_category', presetForm) as ResourceCategory | undefined
  // {v3.16} D20：预设抽屉选中的采集器（用于只读展示安装指南）
  const watchPresetExporter = Form.useWatch('exporter_template_id', presetForm) as string | undefined
  const presetCategoryCiTypes = (watchPresetCategory ? CI_TYPES_BY_CATEGORY[watchPresetCategory] : []) as CiType[]
  // {v3.12} 采集器管理 Tab 筛选：按 监控对象类型 + 来源（official / third_party / internal）
  const [collectorCiTypeFilter, setCollectorCiTypeFilter] = useState<CiType | undefined>(undefined)
  const [collectorSourceFilter, setCollectorSourceFilter] = useState<ExporterSource | undefined>(undefined)

  // {v3.16} D22：支持从「未被引用采集器」行发起——预填采集器并自动带出参数/类别（去配置入口）
  const openPresetCreate = (prefillExporterId?: string) => {
    setEditingPreset(null)
    presetForm.resetFields()
    presetForm.setFieldsValue({ scheme: 'http', scrape_interval: '15s', scrape_timeout: '10s' })
    if (prefillExporterId) {
      const tpl = templateMap.get(prefillExporterId)
      if (tpl) {
        presetForm.setFieldsValue({
          exporter_template_id: prefillExporterId,
          default_port: tpl.default_port,
          metrics_path: tpl.metrics_path,
          scheme: tpl.scheme,
        })
        // 采集器支持类型唯一时自动预填资源类别 + 监控对象类型（两级级联联动）
        const firstType = tpl.supported_resource_types[0]
        if (firstType && tpl.supported_resource_types.length === 1) {
          presetForm.setFieldsValue({
            resource_category: CI_TYPE_CATEGORY_MAP[firstType],
            resource_type: firstType,
          })
        }
      }
    }
    setPresetDrawerOpen(true)
  }
  const openPresetEdit = (record: CITypeExporterMapping) => {
    setEditingPreset(record)
    presetForm.setFieldsValue({
      ...record,
      resource_category: CI_TYPE_CATEGORY_MAP[record.resource_type],
    })
    setPresetDrawerOpen(true)
  }
  // {v3.18} D26：从 Job 表单缺模板 Alert 带参跳转（?view=collectors&edit=<mapping_id>）而来时，自动打开对应映射编辑抽屉
  // （view 由 searchParams 派生，collectors 即默认视图，无需 setView）
  const editMappingId = searchParams.get('edit')
  useEffect(() => {
    if (editMappingId) {
      const mapping = mockCITypeExporterMappings.find((m) => m.mapping_id === editMappingId)
      if (mapping) openPresetEdit(mapping)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMappingId])
  const closePresetDrawer = () => {
    setPresetDrawerOpen(false)
    setEditingPreset(null)
    presetForm.resetFields()
  }
  const handlePresetSave = () => {
    presetForm.validateFields().then((values) => {
      if (editingPreset) {
        const updated: CITypeExporterMapping = {
          ...editingPreset,
          ...values,
          resource_type: values.resource_type as CiType,
          scheme: values.scheme as Scheme,
          // {v3.16} D20：映射行不再持有 install_guide（只读透传采集实现），删除时置空
          install_guide: undefined,
          updated_at: now(),
        }
        setPresets((prev) => prev.map((m) => (m.mapping_id === editingPreset.mapping_id ? updated : m)))
        message.success('默认采集配置已更新')
      } else {
        const created: CITypeExporterMapping = {
          mapping_id: `map-${Date.now()}`,
          resource_type: values.resource_type as CiType,
          exporter_template_id: values.exporter_template_id as string,
          default_port: values.default_port as number,
          metrics_path: values.metrics_path as string,
          scheme: values.scheme as Scheme,
          scrape_interval: values.scrape_interval as string,
          scrape_timeout: values.scrape_timeout as string,
          label_template_id: (values.label_template_id as string) || undefined,
          has_label_template: !!values.label_template_id,
          is_default: false,
          // {v3.16} D20：新建映射不写 install_guide（只读透传采集实现）
          install_guide: undefined,
          is_builtin: false,
          created_at: now(),
          updated_at: now(),
        }
        setPresets((prev) => [...prev, created])
        message.success('默认采集配置已新增')
      }
      closePresetDrawer()
    })
  }
  const handlePresetDelete = (record: CITypeExporterMapping) => {
    if (record.is_builtin) {
      message.warning('平台预置配置禁止删除')
      return
    }
    modal.confirm({
      title: '确认删除',
      content: `确定删除「${CI_TYPE_LABEL[record.resource_type]}」的默认采集配置？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setPresets((prev) => prev.filter((m) => m.mapping_id !== record.mapping_id))
        message.success('已删除')
      },
    })
  }

  // {v3.13} 默认采集配置列表「标签模板」列：更换 = 同资源类别其他模板（PRD v3.1：更换支持）
  const handlePresetLabelTemplateChange = (record: CITypeExporterMapping, templateId: string) => {
    setPresets((prev) =>
      prev.map((m) =>
        m.mapping_id === record.mapping_id
          ? { ...m, label_template_id: templateId, has_label_template: true, updated_at: now() }
          : m
      )
    )
    message.success(`已更换默认标签模板：${labelNameMap.get(templateId) ?? templateId}`)
  }

  // {v3.12} 登记自研采集器：创建 ExporterTemplate 并入池，之后可被映射引用
  // {v3.14} 动线闭环：保存成功后按发起上下文回选 exporter_template_id（预设抽屉 / Job 抽屉），登记即选中
  const handleTemplateSave = () => {
    templateForm.validateFields().then((values) => {
      const supported = (values.supported_resource_types as CiType[]) ?? []
      const created: ExporterTemplate = {
        exporter_template_id: `et-${Date.now()}`,
        name: values.name as string,
        version: (values.version as string) || '1.0.0',
        default_port: values.default_port as number,
        metrics_path: (values.metrics_path as string) || '/metrics',
        scheme: (values.scheme as Scheme) || 'http',
        supported_resource_types: supported,
        description: (values.description as string) || '',
        os: (values.os as 'linux' | 'windows' | 'any') || 'any',
        arch: (values.arch as 'amd64' | 'arm64' | 'any') || 'any',
        download_url: (values.download_url as string) || undefined,
        homepage: (values.homepage as string) || undefined,
        install_guide: (values.install_guide as string) || '',
        is_builtin: false,
        source: (values.source as ExporterSource) || 'internal',
      }
      setExporterTemplates((prev) => [...prev, created])

      // {v3.14} 回选到发起登记的表单：预设抽屉回填字段并自动填充参数（与「选择后自动填充」一致）；Job 抽屉回填并预填采集参数
      if (registerCtx.source === 'preset') {
        presetForm.setFieldsValue({ exporter_template_id: created.exporter_template_id })
        presetForm.setFieldsValue({
          default_port: created.default_port,
          metrics_path: created.metrics_path,
          scheme: created.scheme,
        })
        message.success(
          `采集器「${created.name}」已登记并自动选中为当前 监控对象类型的默认采集器`
        )
      } else if (registerCtx.source === 'job') {
        form.setFieldsValue({ exporter_template_id: created.exporter_template_id })
        handleTemplateChange(created.exporter_template_id)
        message.success(
          `采集器「${created.name}」已登记并自动选中，采集参数已预填`
        )
      } else {
        message.success(`采集器「${created.name}」已登记入池，可在默认采集配置中引用`)
      }
      setTemplateModalOpen(false)
      templateForm.resetFields()
      setRegisterCtx({ source: 'none' })
    })
  }

  // {v3.13} 登记采集器公共入口：顶部次级按钮 / 预设抽屉与 Job 抽屉采集器选择器空态内联按钮共用
  // {v3.14} 接收发起上下文 { source, ciType }：打开时预填 supported_resource_types 为当前 监控对象类型，
  // 保证登记完回到下拉即可看到（选择器按 supported_resource_types.includes(监控对象类型) 过滤）
  const openTemplateRegister = (ctx?: { source?: 'preset' | 'job' | 'none'; ciType?: CiType }) => {
    const { source = 'none', ciType } = ctx ?? {}
    setRegisterCtx({ source, ciType })
    templateForm.resetFields()
    templateForm.setFieldsValue({
      source: 'internal',
      os: 'any',
      arch: 'any',
      scheme: 'http',
      metrics_path: '/metrics',
      ...(ciType ? { supported_resource_types: [ciType] } : {}),
    })
    setTemplateModalOpen(true)
  }

  const templateMap = useMemo(() => {
    const map = new Map<string, (typeof exporterTemplates)[number]>()
    exporterTemplates.forEach((t) => map.set(t.exporter_template_id, t))
    return map
  }, [exporterTemplates])

  // {v3.12} 采集器管理 Tab 列表：按 监控对象类型 + 来源筛选（采集实现 source 挂在 ExporterTemplate 上）
  const filteredPresets = useMemo(() => {
    return presets.filter((p) => {
      if (collectorCiTypeFilter && p.resource_type !== collectorCiTypeFilter) return false
      if (collectorSourceFilter) {
        const tpl = templateMap.get(p.exporter_template_id)
        if (tpl?.source !== collectorSourceFilter) return false
      }
      return true
    })
  }, [presets, collectorCiTypeFilter, collectorSourceFilter, templateMap])

  // {v3.16} D22：列表 = 映射 ∪ 未被引用采集器（池全貌）——「登记即入池」对用户可见
  type CollectorRow =
    | { kind: 'mapping'; mapping: CITypeExporterMapping }
    | { kind: 'template'; template: ExporterTemplate }
  const collectorRows = useMemo<CollectorRow[]>(() => {
    const referencedIds = new Set(presets.map((p) => p.exporter_template_id))
    const mappings: CollectorRow[] = filteredPresets.map((m) => ({ kind: 'mapping', mapping: m }))
    const unreferenced: CollectorRow[] = exporterTemplates
      .filter((t) => t.supported_resource_types.length > 0)
      .filter((t) => !referencedIds.has(t.exporter_template_id))
      .filter((t) => (collectorSourceFilter ? t.source === collectorSourceFilter : true))
      .map((t) => ({ kind: 'template', template: t }))
    return [...mappings, ...unreferenced]
  }, [filteredPresets, presets, exporterTemplates, collectorSourceFilter])

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    exporterTemplates.forEach((t) => map.set(t.exporter_template_id, t.name))
    return map
  }, [exporterTemplates])

  const domainNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockNetworkDomains.forEach((d) => map.set(d.id, d.name))
    return map
  }, [])

  const labelNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockLabelTemplates.forEach((t) => map.set(t.template_id, t.name))
    return map
  }, [])

  const watchJobType = Form.useWatch('job_type', form) as ScrapeJobType | undefined
  const watchResourceType = Form.useWatch('resource_type', form)
  const watchResourceCategory = Form.useWatch('resource_category', form)
  const watchNetworkDomainId = Form.useWatch('network_domain_id', form)
  const watchMode = Form.useWatch('instance_selection_mode', form)
  const watchedLabelTemplateId = Form.useWatch('label_template_id', form)
  // {v3.14} 决策 D2：采集器模式显式二选一（使用默认采集器 / 手填采集参数），避免"下拉留空"歧义
  const watchCollectorMode = Form.useWatch('collector_mode', form) as 'use_default' | 'manual' | undefined

  // 当前表单选中的标签模板（用于只读预览映射内容，模板由 Module_07 维护）
  const selectedLabelTemplate = useMemo(
    () => mockLabelTemplates.find((t) => t.template_id === watchedLabelTemplateId) ?? null,
    [watchedLabelTemplateId]
  )

  // {v3.2} 当前表单选中 监控对象类型的映射是否未配置标签模板（Job 表单「标签待配置」引导：先补配 CI-Exporter 映射，Job 自动继承）
  const mappingMissingTemplate = useMemo(() => {
    if (!watchResourceType) return false
    const mapping = mockCITypeExporterMappings.find((m) => m.resource_type === watchResourceType)
    return !!mapping && !mapping.has_label_template
  }, [watchResourceType])

  // {v3.18} D26：当前资源类别下是否有任何标签模板（区分缺口类型：映射未关联 vs 类别无模板）
  const categoryHasTemplate = useMemo(
    () =>
      watchResourceCategory
        ? mockLabelTemplates.some((t) => t.resource_category === watchResourceCategory)
        : false,
    [watchResourceCategory]
  )
  // {v3.18} D26：当前监控对象类型对应的映射（供「立即补配」带参跳转打开编辑抽屉）
  const currentTypeMapping = useMemo(
    () =>
      watchResourceType
        ? mockCITypeExporterMappings.find((m) => m.resource_type === watchResourceType)
        : undefined,
    [watchResourceType]
  )

  // 资源类别 → 可选的细粒度 监控对象类型（两级级联）
  const categoryCiTypes = (watchResourceCategory as ResourceCategory | undefined)
    ? CI_TYPES_BY_CATEGORY[watchResourceCategory as ResourceCategory]
    : []

  // Transfer 数据源：按当前 resource_type + Job 网域 + 环境 + 业务类型筛选（{v3.4} 业务类型 = 筛选字段，label 名 biz 作 UI 别名）
  const transferData = useMemo<TransferItem[]>(() => {
    const rt = watchResourceType as CiType | undefined
    if (!rt) return []
    return mockResources
      .filter((r) => r.resource_type === rt)
      .filter((r) => r.network_domain_id === watchNetworkDomainId)
      .filter((r) => (filterEnv ? r.env === filterEnv : true))
      .filter((r) => (filterBusinessDomain ? r.business_domain === filterBusinessDomain : true))
      .map((r) => ({
        key: r.resource_id,
        title: `${r.instance_name} (${r.instance_ip})`,
        description: `${domainNameMap.get(r.network_domain_id) ?? r.network_domain_id} · ${ENV_LABEL[r.env]} · ${r.app_name}${r.business_domain ? ` · 业务类型(biz):${r.business_domain}` : ''}`,
      }))
  }, [watchResourceType, watchNetworkDomainId, filterEnv, filterBusinessDomain, domainNameMap])

  const openCreate = () => {
    setEditingJob(null)
    form.resetFields()
    setTargetKeys([])
    setBlackboxTargets([])
    setFilterEnv(undefined)
    setOverriddenFields([])
    form.setFieldsValue({
      job_type: 'standard',
      instance_selection_mode: 'manual',
      collector_mode: 'use_default',
      scheme: 'http',
      scrape_interval: '15s',
      scrape_timeout: '10s',
      metrics_path: '/metrics',
      enabled: true,
      network_domain_id: 'default',
    })
    setDrawerOpen(true)
  }

  const openEdit = (record: ScrapeJob) => {
    setEditingJob(record)
    form.setFieldsValue({
      job_name: record.job_name,
      job_type: record.job_type,
      // {v3.16} D21：blackbox 的 resource_type 为空 → 类别不预填
      resource_category: record.resource_type ? CI_TYPE_CATEGORY_MAP[record.resource_type] : undefined,
      resource_type: record.resource_type,
      exporter_template_id: record.exporter_template_id,
      collector_mode: record.exporter_template_id ? 'use_default' : 'manual',
      network_domain_id: record.network_domain_id,
      instance_selection_mode: record.instance_selection_mode,
      scrape_interval: record.scrape_interval,
      scrape_timeout: record.scrape_timeout,
      metrics_path: record.metrics_path,
      scheme: record.scheme,
      label_template_id: record.label_template_id,
      enabled: record.enabled,
      blackbox_module: record.blackbox_module,
    })
    setTargetKeys([...record.selected_instance_ids])
    setBlackboxTargets(record.blackbox_targets ? [...record.blackbox_targets] : [])
    setFilterEnv(undefined)
    setOverriddenFields(
      (record.mapping_overrides ?? []).filter((f) =>
        (MAPPING_OVERRIDE_FIELDS as readonly string[]).includes(f)
      ) as MappingOverrideField[]
    )
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditingJob(null)
    setTargetKeys([])
    setBlackboxTargets([])
    setOverriddenFields([])
  }

  // 选择 Exporter 模板后自动填充采集参数（standard）：优先取映射默认值（决策 14：创建时快照）
  const handleTemplateChange = (templateId: string) => {
    const tpl = templateMap.get(templateId)
    const rt = form.getFieldValue('resource_type') as CiType | undefined
    const mapping = mockCITypeExporterMappings.find(
      (m) => m.resource_type === rt && m.exporter_template_id === templateId
    )
    // {v3.17} D25-C：预填 = 映射默认模板 → 兜底同资源类别 is_default 模板（映射未配置默认模板时）
    const fallbackLt =
      rt && !mapping?.label_template_id
        ? mockLabelTemplates.find((t) => t.resource_category === CI_TYPE_CATEGORY_MAP[rt] && t.is_default)?.template_id
        : undefined
    form.setFieldsValue({
      metrics_path: tpl?.metrics_path ?? mapping?.metrics_path ?? '/metrics',
      scheme: tpl?.scheme ?? mapping?.scheme ?? 'http',
      scrape_interval: mapping?.scrape_interval ?? '15s',
      scrape_timeout: mapping?.scrape_timeout ?? '10s',
      label_template_id: mapping?.label_template_id ?? fallbackLt,
    })
  }

  // 决策 14：查找 Job 对应的映射（含网域覆盖场景 v0.2 预留）
  const getMapping = (record: ScrapeJob) =>
    mockCITypeExporterMappings.find(
      (m) => m.resource_type === record.resource_type && m.exporter_template_id === record.exporter_template_id
    )

  // 决策 14：映射默认值是否已变更（映射 updated_at 晚于 Job 上次同步时间）
  const isMappingChanged = (record: ScrapeJob): boolean => {
    if (record.job_type !== 'standard') return false
    const mapping = getMapping(record)
    if (!mapping || !record.mapping_synced_at) return false
    return new Date(mapping.updated_at).getTime() > new Date(record.mapping_synced_at).getTime()
  }

  // === 决策 34：字段继承来源视觉标记 ===
  type FieldStatus = 'inherited' | 'overridden' | 'pending_sync'

  const getFieldStatus = (field: MappingOverrideField): FieldStatus => {
    if (overriddenFields.includes(field)) return 'overridden'
    if (editingJob && isMappingChanged(editingJob) && !editingJob.mapping_overrides?.includes(field))
      return 'pending_sync'
    return 'inherited'
  }

  const getFieldStatusForJob = (record: ScrapeJob, field: MappingOverrideField): FieldStatus => {
    if (record.mapping_overrides?.includes(field)) return 'overridden'
    if (isMappingChanged(record) && !record.mapping_overrides?.includes(field)) return 'pending_sync'
    return 'inherited'
  }

  const renderFieldTag = (status: FieldStatus): React.ReactNode => {
    const config: Record<FieldStatus, { color: string; text: string; tooltip: string }> = {
      inherited: { color: 'default', text: '继承自映射', tooltip: '当前值来自默认采集配置默认值，用户未手动修改' },
      overridden: { color: 'processing', text: '已覆盖', tooltip: '该字段已被手动覆盖，同步映射默认值时将跳过' },
      pending_sync: { color: 'warning', text: '待同步', tooltip: '映射默认值已变更，执行「同步映射默认值」可刷新该字段' },
    }
    const c = config[status]
    return (
      <Tooltip title={c.tooltip}>
        <Tag color={c.color} style={{ fontSize: 11, lineHeight: '18px', marginInlineStart: 4 }}>
          {c.text}
        </Tag>
      </Tooltip>
    )
  }

  const renderFieldLabel = (field: MappingOverrideField, labelText: string): React.ReactNode => (
    <Space size={4}>
      {labelText}
      {renderFieldTag(getFieldStatus(field))}
    </Space>
  )
  // === 决策 34 结束 ===

  // 决策 14：手动「同步映射默认值」——仅刷新未手动覆盖的字段（含 v0.2 网域覆盖优先），已覆盖字段保持用户值
  const syncFromMapping = (record: ScrapeJob) => {
    const mapping = getMapping(record)
    // {v3.16} D21：blackbox / 手填 Job 的 exporter_template_id 为空，无采集器可同步
    const tpl = record.exporter_template_id ? templateMap.get(record.exporter_template_id) : undefined
    if (!mapping) {
      message.warning('未找到对应默认采集配置，无法同步')
      return
    }
    const nextOverrides = overriddenFields
    const patch: Partial<ScrapeJob> = {}
    if (!nextOverrides.includes('scrape_interval')) patch.scrape_interval = mapping.scrape_interval
    if (!nextOverrides.includes('scrape_timeout')) patch.scrape_timeout = mapping.scrape_timeout
    if (!nextOverrides.includes('metrics_path')) patch.metrics_path = tpl?.metrics_path ?? mapping.metrics_path
    if (!nextOverrides.includes('scheme')) patch.scheme = tpl?.scheme ?? mapping.scheme
    if (!nextOverrides.includes('label_template_id')) patch.label_template_id = mapping.label_template_id
    patch.mapping_synced_at = now()
    patch.updated_at = now()
    setJobs((prev) =>
      prev.map((j) => (j.job_id === record.job_id ? { ...j, ...patch } : j))
    )
    // 同步当前编辑抽屉中的字段与编辑态
    if (editingJob && editingJob.job_id === record.job_id) {
      setEditingJob((prev) => (prev ? { ...prev, ...patch } : prev))
      form.setFieldsValue({
        scrape_interval: patch.scrape_interval ?? form.getFieldValue('scrape_interval'),
        scrape_timeout: patch.scrape_timeout ?? form.getFieldValue('scrape_timeout'),
        metrics_path: patch.metrics_path ?? form.getFieldValue('metrics_path'),
        scheme: patch.scheme ?? form.getFieldValue('scheme'),
        label_template_id: patch.label_template_id ?? form.getFieldValue('label_template_id'),
      })
    }
    const protectedFields = nextOverrides.filter((f) => MAPPING_OVERRIDE_FIELDS.includes(f))
    message.success(
      protectedFields.length > 0
        ? `已同步映射默认值（已跳过手动覆盖字段：${protectedFields.join('、')}）`
        : '已同步映射默认值（含网域覆盖）'
    )
  }

  // 切换 blackbox module 时自动填充默认协议与 metrics_path
  const handleBlackboxModuleChange = (module: BlackboxModule) => {
    form.setFieldsValue({
      metrics_path: '/probe',
      scheme: 'http',
    })
    setBlackboxTargets((prev) =>
      prev.map((t) => ({ ...t, protocol: BLACKBOX_PROTOCOL_BY_MODULE[module] }))
    )
  }

  const validateDomainConsistency = (
    networkDomainId: string,
    selectedIds: string[]
  ): string | null => {
    const mismatched = selectedIds
      .map((id) => mockResources.find((r) => r.resource_id === id))
      .filter((r): r is (typeof mockResources)[number] => !!r)
      .filter((r) => r.network_domain_id !== networkDomainId)
    if (mismatched.length > 0) {
      return `实例 ${mismatched.map((r) => r.instance_name).join('、')} 不属于网域「${
        domainNameMap.get(networkDomainId) ?? networkDomainId
      }」，请移除或切换网域`
    }
    return null
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      const jobType = values.job_type as ScrapeJobType
      const networkDomainId = values.network_domain_id as string

      if (jobType === 'blackbox') {
        if (blackboxTargets.length === 0) {
          message.error('请至少添加一个拨测目标')
          return
        }
      } else {
        const domainErr = validateDomainConsistency(networkDomainId, targetKeys)
        if (domainErr) {
          message.error(domainErr)
          return
        }
      }

      const exporterTemplateId = values.exporter_template_id as string
      // 同步安装状态冗余字段（仅 standard）
      const exporterStatus: Record<string, ExporterInstallStatus> = {}
      if (jobType === 'standard') {
        targetKeys.forEach((id) => {
          const existing = installations.find(
            (c) => c.resource_id === id && c.exporter_template_id === exporterTemplateId
          )
          exporterStatus[id] = existing?.status ?? 'unregistered'
          if (!existing) {
            const newConf: ExporterInstallationConfirmation = {
              id: `eic-${Date.now()}-${id}`,
              resource_id: id,
              exporter_template_id: exporterTemplateId,
              status: 'pending',
              confirmed_by: '',
              confirmed_at: '',
              notes: '',
            }
            setInstallations((prev) => [...prev, newConf])
          }
        })
      }

      if (editingJob) {
        // {v3.14} 剥离 UI 层显式模式字段（collector_mode 不入 ScrapeJob 模型，仅表单交互）
        const { collector_mode: _collectorMode, ...jobValues } = values
        const updated: ScrapeJob = {
          ...editingJob,
          ...jobValues,
          resource_type: values.resource_type as CiType,
          scheme: values.scheme as Scheme,
          selected_instance_ids: jobType === 'standard' ? targetKeys : [],
          blackbox_targets: jobType === 'blackbox' ? blackboxTargets : undefined,
          blackbox_module: jobType === 'blackbox' ? (values.blackbox_module as BlackboxModule) : undefined,
          exporter_status: exporterStatus,
          // 决策 14：保存当前表单中手动覆盖过的字段标记
          mapping_overrides: jobType === 'standard' ? overriddenFields : undefined,
          updated_at: now(),
        }
        setJobs((prev) => prev.map((j) => (j.job_id === editingJob.job_id ? updated : j)))
        message.success('Job 已更新')
      } else {
        const newJob: ScrapeJob = {
          job_id: `job-${Date.now()}`,
          job_name: values.job_name as string,
          job_type: jobType,
          resource_type: values.resource_type as CiType,
          exporter_template_id: exporterTemplateId,
          network_domain_id: networkDomainId,
          instance_selection_mode: values.instance_selection_mode as 'manual' | 'filter',
          selected_instance_ids: jobType === 'standard' ? targetKeys : [],
          instance_filter: null,
          scrape_interval: values.scrape_interval as string,
          scrape_timeout: values.scrape_timeout as string,
          metrics_path: values.metrics_path as string,
          scheme: values.scheme as Scheme,
          label_template_id: (values.label_template_id as string) || undefined,
          relabel_configs: [],
          blackbox_module: jobType === 'blackbox' ? (values.blackbox_module as BlackboxModule) : undefined,
          blackbox_targets: jobType === 'blackbox' ? blackboxTargets : undefined,
          enabled: values.enabled as boolean,
          exporter_status: exporterStatus,
          // 决策 14：创建时对映射默认值做快照，记录同步时间；保存手动覆盖字段标记
          mapping_overrides: jobType === 'standard' ? overriddenFields : [],
          mapping_synced_at: jobType === 'standard' ? now() : undefined,
          created_at: now(),
          updated_at: now(),
        }
        setJobs((prev) => [...prev, newJob])
        message.success('Job 已新增')
      }
      closeDrawer()
    })
  }

  const handleToggleEnabled = (record: ScrapeJob, checked: boolean) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.job_id === record.job_id ? { ...j, enabled: checked, updated_at: now() } : j
      )
    )
    message.success(checked ? '已启用' : '已禁用')
  }

  const handleDelete = (record: ScrapeJob) => {
    modal.confirm({
      title: '确认删除',
      content: `确定删除采集 Job「${record.job_name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setJobs((prev) => prev.filter((j) => j.job_id !== record.job_id))
        message.success('已删除')
      },
    })
  }

  // 点击 Badge 打开安装确认弹窗
  const openConfirm = (conf: ExporterInstallationConfirmation) => {
    setConfirmTarget(conf)
    confirmForm.setFieldsValue({
      status: conf.status,
      confirmed_by: conf.confirmed_by,
      notes: conf.notes,
      actual_port: conf.actual_port,
    })
  }

  const cycleStatus = (status: ExporterInstallStatus): ExporterInstallStatus => {
    const idx = INSTALL_STATUS_CYCLE.indexOf(status)
    return INSTALL_STATUS_CYCLE[(idx + 1) % INSTALL_STATUS_CYCLE.length]
  }

  const handleConfirmSave = () => {
    confirmForm.validateFields().then((values) => {
      if (!confirmTarget) return
      const next: ExporterInstallationConfirmation = {
        ...confirmTarget,
        status: values.status as ExporterInstallStatus,
        confirmed_by: values.confirmed_by as string,
        confirmed_at: now(),
        notes: values.notes as string,
        actual_port: values.actual_port as number | undefined,
      }
      setInstallations((prev) => prev.map((c) => (c.id === confirmTarget.id ? next : c)))
      // 同步冗余 exporter_status
      setJobs((prev) =>
        prev.map((j) => {
          if (j.exporter_template_id !== confirmTarget.exporter_template_id) return j
          if (!j.selected_instance_ids.includes(confirmTarget.resource_id)) return j
          return {
            ...j,
            exporter_status: { ...j.exporter_status, [confirmTarget.resource_id]: next.status },
            updated_at: now(),
          }
        })
      )
      message.success('安装状态已确认')
      setConfirmTarget(null)
    })
  }

  const addBlackboxTarget = () => {
    const module = (form.getFieldValue('blackbox_module') as BlackboxModule | undefined) ?? 'http_2xx'
    setBlackboxTargets((prev) => [
      ...prev,
      { target: '', protocol: BLACKBOX_PROTOCOL_BY_MODULE[module] },
    ])
  }

  const updateBlackboxTarget = (index: number, patch: Partial<BlackboxTarget>) => {
    setBlackboxTargets((prev) =>
      prev.map((t, i) => (i === index ? { ...t, ...patch } : t))
    )
  }

  const removeBlackboxTarget = (index: number) => {
    setBlackboxTargets((prev) => prev.filter((_, i) => i !== index))
  }

  const columns = [
    {
      title: 'Job 名称',
      dataIndex: 'job_name',
      key: 'job_name',
      width: 180,
      // {v3.13} 收敛：去掉名称内 blackbox Tag（与「Job 类型」列完全重复），名称列保持纯净
      // {v3.17} 名称过长 ellipsis + Tooltip 看全名，避免拉高行高
      ellipsis: { showTitle: false },
      render: (value: string) => (
        <Tooltip title={value}>
          <Text strong>{value}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Job 类型',
      dataIndex: 'job_type',
      key: 'job_type',
      render: (value: ScrapeJobType) => (
        <Tag color={value === 'blackbox' ? 'purple' : 'blue'}>
          {value === 'blackbox' ? '拨测' : '标准采集'}
        </Tag>
      ),
    },
    {
      title: '监控对象类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: CiType, record: ScrapeJob) =>
        record.job_type === 'blackbox' ? (
          <Text type="secondary">-</Text>
        ) : (
          <Tag color="blue">{CI_TYPE_LABEL[value]}</Tag>
        ),
    },
    {
      title: '默认采集器 / Module',
      key: 'exporter',
      width: 150,
      // {v3.17} 长名 ellipsis + Tooltip，避免 Tag 内换行拉高行高
      render: (_: unknown, record: ScrapeJob) =>
        record.job_type === 'blackbox' ? (
          <Tag color="cyan">{record.blackbox_module ?? '-'}</Tag>
        ) : record.exporter_template_id ? (
          <Tooltip title={templateNameMap.get(record.exporter_template_id) ?? record.exporter_template_id}>
            <Tag
              color="cyan"
              style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {templateNameMap.get(record.exporter_template_id) ?? record.exporter_template_id}
            </Tag>
          </Tooltip>
        ) : (
          <Text type="secondary">手填参数</Text>
        ),
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag>{domainNameMap.get(value) ?? value}</Tag>,
    },
    {
      title: '实例选择 / 拨测目标',
      key: 'selection',
      // {v3.13} 收敛：standard 模式 + 实例数合成一个 Tag（「手动 · 12 实例」），比单看模式信息量更高
      render: (_: unknown, record: ScrapeJob) =>
        record.job_type === 'blackbox' ? (
          <Text type="secondary">{record.blackbox_targets?.length ?? 0} 个目标</Text>
        ) : (
          <Tag color={record.instance_selection_mode === 'manual' ? 'purple' : 'geekblue'}>
            {record.instance_selection_mode === 'manual' ? '手动' : '过滤'} · {record.selected_instance_ids.length} 实例
          </Tag>
        ),
    },
    {
      title: '参数同步',
      key: 'mappingSync',
      // {v3.13} 异常驱动：正常态只显示低饱和「已同步」单行（自定义字段数收进 Tooltip）；
      // 仅「映射默认值已变更」时显示橙色 Tag——健康度信号从常驻噪音变为异常才可见
      render: (_: unknown, record: ScrapeJob) => {
        if (record.job_type === 'blackbox') return <Text type="secondary">-</Text>
        const changed = isMappingChanged(record)
        const overrides = record.mapping_overrides ?? []
        const tip =
          overrides.length > 0
            ? `${overrides.length} 个字段已自定义（${overrides.join('、')}），同步映射默认值时将被跳过`
            : '与默认采集配置一致'
        return changed ? (
          <Tooltip title="默认采集配置默认值已变更，请在编辑中手动同步">
            <Tag color="warning" style={{ marginInlineEnd: 0 }}>
              映射默认值已变更
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title={tip}>
            <Text type="secondary" style={{ fontSize: 12, cursor: 'help' }}>
              已同步
            </Text>
          </Tooltip>
        )
      },
    },
    // {v3.2} 标签模板列：展示继承模板名 / 「标签待配置」提示（引导先补配 CI-Exporter 映射）
    // {v3.13} 收敛：正常态模板名 ellipsis + Tooltip 看全名，继承状态 Tag 仅在「待同步」时出现（正常继承不给标记）；
    // 「标签待配置」橙色 Tag + 点击跳转保留（异常态引导）
    {
      title: '标签模板',
      key: 'labelTemplate',
      render: (_: unknown, record: ScrapeJob) => {
        if (record.job_type === 'blackbox') return <Text type="secondary">-</Text>
        if (record.label_template_id) {
          const status = getFieldStatusForJob(record, 'label_template_id')
          return (
            <Space size={4}>
              <Tooltip
                title={`${labelNameMap.get(record.label_template_id) ?? record.label_template_id}（${record.label_template_id}）`}
              >
                <Text
                  style={{
                    maxWidth: 120,
                    display: 'inline-block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {labelNameMap.get(record.label_template_id) ?? record.label_template_id}
                </Text>
              </Tooltip>
              {status === 'pending_sync' && renderFieldTag(status)}
            </Space>
          )
        }
        const mapping = getMapping(record)
        if (mapping && !mapping.has_label_template) {
          return (
            // {v3.18} D26：点击打开该 Job 对应映射的编辑抽屉（修复空跳转）
            <Tooltip title="该监控对象类型的默认采集配置尚未关联标签模板，点击立即补配">
              <Tag
                color="warning"
                style={{ cursor: 'pointer' }}
                onClick={() => mapping && openPresetEdit(mapping)}
              >
                标签待配置
              </Tag>
            </Tooltip>
          )
        }
        return <Text type="secondary">未关联</Text>
      },
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean, record: ScrapeJob) => (
        <Switch
          checked={value}
          size="small"
          onChange={(checked) => handleToggleEnabled(record, checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      // {v3.13} 收敛：高频「编辑」保留文字按钮；「详情」「删除」收成图标按钮（Tooltip 说明），降低行宽
      render: (_: unknown, record: ScrapeJob) => (
        <Space size={2}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Tooltip title="查看详情">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetailJob(record)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ]

  const isBlackbox = watchJobType === 'blackbox'

  return (
    <MainLayout>
      <div className="page-header">
        {/* {v3.8} 标题随左侧导航子项一一对应：采集器管理 / 采集 Job（菜单即导航，无页内重复切换） */}
        <Title level={4}>{view === 'collectors' ? '采集器管理' : '采集 Job'}</Title>
        {view === 'collectors' ? (
          <Text type="secondary">
            类型级采集器指引 + 预设维护：每个 监控对象类型该装什么采集器（默认/可选）、怎么装（安装指南）；创建采集 Job 时自动套用默认值（决策 14）；实例级安装确认在「采集 Job」选实例时进行（5.6）
          </Text>
        ) : (
          <Text type="secondary">
            管理 Prometheus 采集任务（standard）与 blackbox 拨测任务；所有 Job 必须绑定单一网域，配置下发由 Module_09 负责；创建 Job 时自动套用 监控对象类型的默认采集配置（见「采集器管理」）
          </Text>
        )}
      </div>

      {view === 'collectors' && (
        <Card size="small">
          {/* {v3.19} 动线改为 Steps（size small 横向一行）：比大号 Alert 更紧凑美观、语义更贴切（三步流程） */}
          <Steps
            size="small"
            style={{ marginBottom: 16 }}
            items={[
              { title: '登记采集器', description: '仅自研 / 第三方需要，登记后入「采集实现池」' },
              { title: '配置默认采集', description: '绑定采集器与标签模板，创建 Job 自动套用' },
              { title: '创建 Job 确认安装', description: '选实例时进行，本页不重复' },
            ]}
          />
          {/* {v3.12} application_http 引导；{v3.19} 改 banner 紧凑窄条：与 Steps 搭配不并列突兀 */}
          <Alert
            type="info"
            banner
            style={{ marginBottom: 12 }}
            message="HTTP 应用 / 业务指标采集无需安装独立采集器：业务服务（含自定义微服务）仍属 application_http，无需登记「采集器」；创建采集 Job 时端口 / 采集路径按应用实际 endpoint 手填，可选 Spring Boot actuator / Go / Python 等多个采集实现。"
          />
          <Row justify="space-between" style={{ marginBottom: 12 }}>
            <Col>
              <Space wrap size={12}>
                <Space size={8}>
                  {/* {v3.19} 与「采集 Job」页「新增 Job」按钮统一尺寸（默认大按钮，去掉 size=small） */}
                  <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }} onClick={() => openPresetCreate()}>
                    新增默认采集配置
                  </Button>
                  {/* {v3.13} 动线主次分离：登记采集器降级为次级按钮（① 的前置补救动作，非主流程），并加定位说明；无表单上下文（source=none，登记后仅入池）
                      {v3.19} 移除并列的灰色说明文字（与按钮 Tooltip 职责重复、造成可点/不可点混淆）；「池中没有需要的采集器？」引导移至列表空态 */}
                  <Tooltip title="把自研 / 第三方采集实现加入「采集实现池」，之后可在默认采集配置中引用">
                    <Button icon={<PlusCircleOutlined />} onClick={() => openTemplateRegister()}>
                      登记采集器
                    </Button>
                  </Tooltip>
                </Space>
                {/* {v3.12} 采集器管理 Tab 筛选：按 监控对象类型 + 来源 */}
                <Select
                  placeholder="按 监控对象类型筛选"
                  allowClear
                  style={{ width: 160 }}
                  value={collectorCiTypeFilter}
                  onChange={(v) => setCollectorCiTypeFilter(v as CiType | undefined)}
                >
                  {CI_TYPES.map((t) => (
                    <Option key={t} value={t}>{CI_TYPE_LABEL[t]}</Option>
                  ))}
                </Select>
                <Select
                  placeholder="按来源筛选"
                  allowClear
                  style={{ width: 140 }}
                  value={collectorSourceFilter}
                  onChange={(v) => setCollectorSourceFilter(v as ExporterSource | undefined)}
                >
                  {EXPORTER_SOURCES.map((s) => (
                    <Option key={s} value={s}>{EXPORTER_SOURCE_LABEL[s]}</Option>
                  ))}
                </Select>
              </Space>
            </Col>
            <Col>
              {/* {v3.16} D22：计数 = 映射 + 池全貌 */}
              <Text type="secondary">
                共 {collectorRows.length} 行（映射 {filteredPresets.length} · 池中采集器 {exporterTemplates.length}，未引用{' '}
                {exporterTemplates.filter(
                  (t) => !presets.some((p) => p.exporter_template_id === t.exporter_template_id)
                ).length}
                ）
              </Text>
            </Col>
          </Row>
          <Table
            rowKey={(row: CollectorRow) =>
              row.kind === 'mapping' ? `map-${row.mapping.mapping_id}` : `tpl-${row.template.exporter_template_id}`
            }
            size="small"
            dataSource={collectorRows}
            // {v3.17} 列多超出窗口：横向滚动，避免挤压换行拉高行高
            scroll={{ x: 1050 }}
            pagination={false}
            // {v3.19} 空态引导：筛选无匹配 / 池为空时显示「池中没有需要的采集器？」+ 内联登记入口（原工具栏灰色文字移至此）
            locale={{
              emptyText: (
                <Space direction="vertical" size={8} style={{ padding: '24px 0' }}>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    {collectorCiTypeFilter || collectorSourceFilter
                      ? '没有匹配的采集器：请调整筛选条件'
                      : '暂无默认采集配置'}
                  </Text>
                  <Space size={8}>
                    <Text type="secondary" style={{ fontSize: 12 }}>池中没有需要的采集器？</Text>
                    <Button size="small" icon={<PlusCircleOutlined />} onClick={() => openTemplateRegister()}>
                      登记自研 / 第三方采集器
                    </Button>
                  </Space>
                </Space>
              ),
            }}
            columns={[
              {
                title: '资源类型',
                key: 'resource_type',
                // {v3.13} 收敛：粗粒度类别小字收进 Tooltip（筛选器已能按类型过滤，列表大类冗余）
                render: (_: unknown, row: CollectorRow) => {
                  if (row.kind === 'template') return <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
                  const v = row.mapping.resource_type
                  return (
                    <Tooltip title={`类别：${CI_TYPE_CATEGORY_MAP[v]}`}>
                      <Tag color="blue">{CI_TYPE_LABEL[v]}</Tag>
                    </Tooltip>
                  )
                },
              },
              {
                title: '默认采集器',
                key: 'exporter_template_id',
                width: 220,
                // {v3.13} 合并：来源 Tag（official/third_party/internal）保留在采集器名称旁，删独立「类型」列
                // {v3.16} D22：未引用采集器行显示「未被引用」Tag
                // {v3.17} 名称 ellipsis + Tooltip，避免长名换行拉高行高
                render: (_: unknown, row: CollectorRow) => {
                  const tplId =
                    row.kind === 'mapping' ? row.mapping.exporter_template_id : row.template.exporter_template_id
                  const tpl = row.kind === 'template' ? row.template : templateMap.get(tplId)
                  const name = templateNameMap.get(tplId) ?? tplId
                  return (
                    <Space size={4}>
                      <Tooltip title={name}>
                        <Text
                          strong
                          style={{
                            maxWidth: 120,
                            display: 'inline-block',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {name}
                        </Text>
                      </Tooltip>
                      {row.kind === 'mapping' && row.mapping.is_default && (
                        <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                          默认
                        </Tag>
                      )}
                      {tpl && (
                        <Tooltip title={`来源：${EXPORTER_SOURCE_LABEL[tpl.source]}`}>
                          <Tag style={{ marginInlineEnd: 0, fontSize: 11 }}>{EXPORTER_SOURCE_LABEL[tpl.source]}</Tag>
                        </Tooltip>
                      )}
                      {row.kind === 'template' && (
                        <Tag color="warning" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                          未被引用
                        </Tag>
                      )}
                    </Space>
                  )
                },
              },
              {
                // {v3.13} 补齐 PRD v3.1 验收：默认采集配置列表「标签模板」列（决策 15 两行卡片）
                title: (
                  <Tooltip title="PRD v3.1：默认采集配置的标签模板（两行卡片）；支持查看（只读预览）/ 更换（同资源类别其他模板）/ 补配（重新触发创建流程）">
                    <Space size={4}>
                      标签模板
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        (v3.1)
                      </Text>
                    </Space>
                  </Tooltip>
                ),
                key: 'labelTemplate',
                render: (_: unknown, row: CollectorRow) => {
                  if (row.kind === 'template') return <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
                  const record = row.mapping
                  const tpl = record.label_template_id
                    ? mockLabelTemplates.find((t) => t.template_id === record.label_template_id) ?? null
                    : null
                  if (!tpl) {
                    return (
                      <Space size={4}>
                        <Tag color="warning">标签模板待配置</Tag>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, fontSize: 11 }}
                          // {v3.18} D26：同页直接打开本行编辑抽屉（修复空跳转）
                          onClick={() => openPresetEdit(record)}
                        >
                          补配
                        </Button>
                      </Space>
                    )
                  }
                  const siblings = mockLabelTemplates.filter(
                    (t) => t.resource_category === tpl.resource_category && t.template_id !== tpl.template_id
                  )
                  return (
                    <Space direction="vertical" size={2}>
                      <Space size={4}>
                        <Popover
                          trigger="click"
                          placement="topLeft"
                          title={`${tpl.name} · 模板映射预览`}
                          content={
                            <div style={{ maxWidth: 320 }}>
                              <div style={{ marginBottom: 6 }}>
                                {tpl.mappings.map((m) => (
                                  <Tag key={m.target_label} style={{ fontSize: 11, marginBottom: 2 }}>
                                    {m.source_field} → {m.target_label}
                                  </Tag>
                                ))}
                              </div>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                资源类别：{RESOURCE_CATEGORY_MAP[tpl.resource_category]} · 共 {tpl.mappings.length} 条映射 · 由
                                Module_07 维护
                              </Text>
                            </div>
                          }
                        >
                          <Typography.Link
                            style={{ fontSize: 12, maxWidth: 130, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {tpl.name}
                          </Typography.Link>
                        </Popover>
                        {tpl.is_default ? (
                          <Tag color="gold" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                            默认
                          </Tag>
                        ) : (
                          <Tag style={{ fontSize: 11, marginInlineEnd: 0 }}>自定义</Tag>
                        )}
                      </Space>
                      <Space size={4}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {RESOURCE_CATEGORY_MAP[tpl.resource_category]} · {tpl.template_id}
                        </Text>
                        {siblings.length > 0 && (
                          <Dropdown
                            menu={{
                              items: siblings.map((s) => ({
                                key: s.template_id,
                                label: s.name,
                                onClick: () => handlePresetLabelTemplateChange(record, s.template_id),
                              })),
                            }}
                          >
                            <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }} icon={<SwapOutlined />}>
                              更换
                            </Button>
                          </Dropdown>
                        )}
                      </Space>
                    </Space>
                  )
                },
              },
              {
                title: 'Endpoint（端口 / 路径 / 协议）',
                key: 'endpoint',
                // {v3.13} 收敛：3 个独立 Tag 合并为一行等宽文本（http :9100 /metrics），一个视觉单元读完
                render: (_: unknown, row: CollectorRow) => {
                  if (row.kind === 'template') {
                    const t = row.template
                    return (
                      <Text code style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {t.scheme} :{t.default_port} {t.metrics_path}
                      </Text>
                    )
                  }
                  const r = row.mapping
                  return (
                    <Text code style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {r.scheme} :{r.default_port} {r.metrics_path}
                    </Text>
                  )
                },
              },
              {
                title: '采集参数',
                key: 'scrape',
                render: (_: unknown, row: CollectorRow) =>
                  row.kind === 'mapping' ? (
                    <Space>
                      <Text type="secondary">间隔 {row.mapping.scrape_interval}</Text>
                      <Text type="secondary">超时 {row.mapping.scrape_timeout}</Text>
                    </Space>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      未配置
                    </Text>
                  ),
              },
              {
                title: '安装指南 / 下载 / 文档',
                key: 'install_guide',
                // {v3.13} 收敛：可点 Tag 改为图标 + Tooltip 文字链
                // {v3.16} D20：安装指南单一来源 = 采集实现（tpl.install_guide），映射行不再持有该字段
                render: (_: unknown, row: CollectorRow) => {
                  const tpl = row.kind === 'template' ? row.template : templateMap.get(row.mapping.exporter_template_id)
                  const guideTitle =
                    row.kind === 'mapping'
                      ? `${CI_TYPE_LABEL[row.mapping.resource_type]} · ${
                          templateNameMap.get(row.mapping.exporter_template_id) ?? ''
                        } 安装指南`
                      : `${templateNameMap.get(tpl?.exporter_template_id ?? '') ?? ''} 安装指南`
                  return (
                    <Space size={2}>
                      {tpl?.install_guide ? (
                        <Popover
                          placement="topLeft"
                          title={guideTitle}
                          content={
                            <Text style={{ fontSize: 12, maxWidth: 380, display: 'block' }}>{tpl.install_guide}</Text>
                          }
                        >
                          <Tooltip title="安装指南">
                            <Button type="link" size="small" icon={<ReadOutlined />} style={{ paddingInline: 4 }} />
                          </Tooltip>
                        </Popover>
                      ) : null}
                      {tpl?.download_url ? (
                        <Tooltip title="下载">
                          <Button
                            type="link"
                            size="small"
                            icon={<DownloadOutlined />}
                            style={{ paddingInline: 4 }}
                            onClick={() => window.open(tpl.download_url, '_blank')}
                          />
                        </Tooltip>
                      ) : null}
                      {tpl?.homepage ? (
                        <Tooltip title="文档">
                          <Button
                            type="link"
                            size="small"
                            icon={<FileTextOutlined />}
                            style={{ paddingInline: 4 }}
                            onClick={() => window.open(tpl.homepage, '_blank')}
                          />
                        </Tooltip>
                      ) : null}
                      {!tpl?.install_guide && !tpl?.download_url && !tpl?.homepage && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          -
                        </Text>
                      )}
                    </Space>
                  )
                },
              },
              {
                title: '平台 / 架构',
                key: 'platform',
                render: (_: unknown, row: CollectorRow) => {
                  const tpl = row.kind === 'template' ? row.template : templateMap.get(row.mapping.exporter_template_id)
                  return tpl ? (
                    <Space>
                      <Tag>{tpl.os}</Tag>
                      <Tag>{tpl.arch}</Tag>
                    </Space>
                  ) : (
                    <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
                  )
                },
              },
              {
                title: '操作',
                key: 'actions',
                render: (_: unknown, row: CollectorRow) =>
                  row.kind === 'mapping' ? (
                    <Space>
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openPresetEdit(row.mapping)}>
                        编辑
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={row.mapping.is_builtin}
                        onClick={() => handlePresetDelete(row.mapping)}
                      >
                        删除
                      </Button>
                    </Space>
                  ) : (
                    // {v3.16} D22：未被引用采集器的快捷动作——打开新增默认采集配置并预填该采集器
                    <Button type="link" size="small" onClick={() => openPresetCreate(row.template.exporter_template_id)}>
                      去配置
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      )}
      {view === 'jobs' && (
        <Card className="page-card">
          <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ backgroundColor: '#0ECDEB' }}
              onClick={openCreate}
            >
              新增 Job
            </Button>
          </Col>
          <Col>
            <Space size={12}>
              {/* {v3.12} 采集 Job 列表网域查询条件（选项 = 已纳管网域） */}
              <Select
                placeholder="全部网域"
                allowClear
                style={{ width: 180 }}
                value={listDomainFilter}
                onChange={(v) => setListDomainFilter(v)}
                options={MONITORED_NETWORK_DOMAINS.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }))}
              />
              <Text type="secondary">
                共 {jobs.filter((j) => (listDomainFilter ? j.network_domain_id === listDomainFilter : true)).length} 个任务（标准{' '}
                {jobs.filter((j) => (listDomainFilter ? j.network_domain_id === listDomainFilter : true) && j.job_type === 'standard').length} / 拨测{' '}
                {jobs.filter((j) => (listDomainFilter ? j.network_domain_id === listDomainFilter : true) && j.job_type === 'blackbox').length}）
              </Text>
            </Space>
          </Col>
        </Row>

        <Table
          rowKey="job_id"
          dataSource={jobs.filter((j) => (listDomainFilter ? j.network_domain_id === listDomainFilter : true))}
          columns={columns}
          // {v3.17} 列数多超出窗口：固定最小宽度、横向滚动，避免列挤压换行拉高行高
          scroll={{ x: 1080 }}
          pagination={{ pageSize: 5 }}
        />
      </Card>
    )}


      {/* {v3.8} 默认采集配置编辑抽屉（预设层维护：采集器 / 参数 / 安装指南；入口合一后承载于此） */}
      <Drawer
        title={editingPreset ? '编辑默认采集配置' : '新增默认采集配置'}
        width={560}
        open={presetDrawerOpen}
        onClose={closePresetDrawer}
        extra={
          <Space>
            <Button onClick={closePresetDrawer}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handlePresetSave}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={presetForm} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="资源类别" name="resource_category" rules={[{ required: true, message: '请选择资源类别' }]}>
                <Select
                  placeholder="请选择"
                  disabled={!!editingPreset}
                  onChange={() => presetForm.setFieldsValue({ resource_type: undefined, exporter_template_id: undefined })}
                >
                  {RESOURCE_CATEGORIES.map((cat) => (
                    <Option key={cat} value={cat}>{RESOURCE_CATEGORY_MAP[cat]}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="监控对象类型" name="resource_type" rules={[{ required: true, message: '请选择 监控对象类型' }]}>
                <Select placeholder="请选择" disabled={!!editingPreset}>
                  {presetCategoryCiTypes.map((t) => (
                    <Option key={t} value={t}>{CI_TYPE_LABEL[t]}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="默认采集器"
            name="exporter_template_id"
            rules={[{ required: true, message: '请选择默认采集器' }]}
            extra="选择后自动填充端口/路径/协议；安装指南归属采集器"
          >
            <Select
              placeholder="请选择"
              showSearch
              optionFilterProp="children"
              // {v3.13} 空态内联补救：选不到合适采集器时，在真正需要的场景（选择器空态）提供登记入口
              // {v3.14} 携带发起上下文：预填当前 监控对象类型、保存后自动回选，闭合「选不到 → 登记 → 自动选中」动线
              notFoundContent={
                <Space direction="vertical" size={4} style={{ padding: '8px 0' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    未找到合适的采集器？
                  </Text>
                  <Button
                    size="small"
                    icon={<PlusCircleOutlined />}
                    onClick={() =>
                      openTemplateRegister({
                        source: 'preset',
                        ciType: presetForm.getFieldValue('resource_type') as CiType | undefined,
                      })
                    }
                  >
                    登记采集器
                  </Button>
                </Space>
              }
            >
              {exporterTemplates
                .filter((t) => t.supported_resource_types.length > 0)
                .filter((t) =>
                  presetForm.getFieldValue('resource_type')
                    ? t.supported_resource_types.includes(presetForm.getFieldValue('resource_type') as CiType)
                    : true
                )
                .map((t) => (
                  <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                    {t.name} v{t.version} · {EXPORTER_SOURCE_LABEL[t.source]}
                  </Option>
                ))}
            </Select>
          </Form.Item>
          {/* {v3.18} D26/D25-A：Divider 分组——声明"标签模板与采集器正交、可选"（不是采集器的一部分） */}
          <Divider style={{ margin: '4px 0 12px' }} plain>
            <Text type="secondary" style={{ fontSize: 12 }}>
              标签模板（与采集器正交，可选）
            </Text>
          </Divider>
          {/* {v3.17} D25-A：默认标签模板（可选）——按资源类别过滤；创建 Job 时自动预填；与采集器正交，由 Module_07 维护 */}
          <Form.Item
            label="默认标签模板（可选）"
            name="label_template_id"
            extra="该监控对象类型的默认标签模板：创建采集 Job 时自动预填，可更换；不选则创建 Job 时再选择。标签模板与采集器正交，由 Module_07 维护"
          >
            <Select
              placeholder={watchPresetCategory ? '请选择（可选）' : '请先选择资源类别'}
              allowClear
              showSearch
              optionFilterProp="children"
              notFoundContent={
                <Space direction="vertical" size={4} style={{ padding: '8px 0' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {watchPresetCategory ? '该资源类别尚无标签模板，请先创建' : '请先选择资源类别'}
                  </Text>
                  <Typography.Link href={MODULE_LINKS.module07} style={{ fontSize: 12 }}>
                    前往标签模板管理（Module_07）→
                  </Typography.Link>
                </Space>
              }
            >
              {mockLabelTemplates
                .filter((t) => (watchPresetCategory ? t.resource_category === watchPresetCategory : true))
                .map((t) => (
                  <Option key={t.template_id} value={t.template_id}>
                    {t.name}（{RESOURCE_CATEGORY_MAP[t.resource_category]} · {t.mappings.length} 条映射）
                    {t.is_default ? ' · 默认' : ''}
                  </Option>
                ))}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="默认端口" name="default_port" rules={[{ required: true, message: '请输入端口' }]} extra="预置参数 = 官方默认值参考；自研采集器请按实际部署填写">
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="采集路径" name="metrics_path" rules={[{ required: true, message: '请输入路径' }]}>
                <Input placeholder="/metrics" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="协议" name="scheme" rules={[{ required: true }]}>
                <Select>
                  {SCHEMES.map((s) => (
                    <Option key={s} value={s}>{s.toUpperCase()}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="采集间隔" name="scrape_interval" rules={[{ required: true, message: '请输入间隔' }]}>
                <Input placeholder="15s" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="采集超时" name="scrape_timeout" rules={[{ required: true, message: '请输入超时' }]}>
                <Input placeholder="10s" />
              </Form.Item>
            </Col>
          </Row>
          {/* {v3.16} D20：install_guide 单一来源 = 采集实现（ExporterTemplate），此处只读展示、不再编辑（映射行不持有该字段） */}
          <Form.Item
            label="安装指南（只读，归属采集实现）"
            extra="安装指南由采集实现持有并唯一维护；如需该监控对象类型的补充说明，另行维护类型级备注（install_notes）"
          >
            {watchPresetExporter && templateMap.get(watchPresetExporter)?.install_guide ? (
              <Alert
                type="info"
                showIcon
                message="该采集器的安装指南"
                description={
                  <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', display: 'block' }}>
                    {templateMap.get(watchPresetExporter)?.install_guide}
                  </Text>
                }
              />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {watchPresetExporter ? '该采集器未提供安装指南' : '未选择采集器'}
              </Text>
            )}
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title={editingJob ? '编辑采集 Job' : '新增采集 Job'}
        width={760}
        open={drawerOpen}
        onClose={closeDrawer}
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSave}>
              保存
            </Button>
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFieldsChange={(changedFields) => {
            // 决策 14：用户手动修改（touched）映射继承参数时记录覆盖标记，供「同步映射默认值」跳过
            const touched = changedFields
              .filter(
                (f) =>
                  f.touched &&
                  f.name.length === 1 &&
                  (MAPPING_OVERRIDE_FIELDS as readonly string[]).includes(String(f.name[0]))
              )
              .map((f) => String(f.name[0]) as MappingOverrideField)
            if (touched.length > 0) {
              setOverriddenFields((prev) => Array.from(new Set([...prev, ...touched])))
            }
          }}
        >
          {editingJob && editingJob.job_type === 'standard' && isMappingChanged(editingJob) && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="映射默认值已变更"
              description={
                <Space direction="vertical" size={8}>
                  <Text>
                    对应默认采集配置（{getMapping(editingJob)?.resource_type} →{' '}
                    {editingJob.exporter_template_id
                      ? templateNameMap.get(editingJob.exporter_template_id)
                      : '手填参数'}
                    ）默认采集参数已更新（v0.2 起可含网域覆盖）。
                    保护存量策略：本 Job 参数保持不变，需手动同步后刷新。
                  </Text>
                  {overriddenFields.length > 0 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      已手动覆盖字段（{overriddenFields.join('、')}）在同步时保持用户值，不会被映射默认值覆盖。
                    </Text>
                  )}
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    style={{ backgroundColor: '#0ECDEB', borderColor: '#0ECDEB', color: '#fff' }}
                    onClick={() => syncFromMapping(editingJob)}
                  >
                    同步映射默认值
                  </Button>
                </Space>
              }
            />
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Job 名称"
                name="job_name"
                rules={[{ required: true, message: '请输入 Job 名称' }]}
              >
                <Input placeholder="如 prod-hosts 或 blackbox-http" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Job 类型"
                name="job_type"
                rules={[{ required: true, message: '请选择 Job 类型' }]}
                extra="blackbox 拨测任务不再维护独立实体，内嵌为 ScrapeJob 的一种类型"
              >
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  disabled={!!editingJob}
                  onChange={(e) => {
                    const next = e.target.value as ScrapeJobType
                    if (next === 'blackbox') {
                      // {v3.16} 决策 D21：blackbox 不占 监控对象类型 / 采集器语义——清空 resource_category / resource_type / exporter_template_id
                      form.setFieldsValue({
                        resource_category: undefined,
                        resource_type: undefined,
                        exporter_template_id: undefined,
                        collector_mode: 'manual',
                        metrics_path: '/probe',
                        scheme: 'http',
                        blackbox_module: 'http_2xx',
                      })
                      setTargetKeys([])
                    } else {
                      form.setFieldsValue({
                        resource_category: undefined,
                        resource_type: undefined,
                        exporter_template_id: undefined,
                        metrics_path: '/metrics',
                        scheme: 'http',
                        blackbox_module: undefined,
                      })
                      setBlackboxTargets([])
                    }
                  }}
                >
                  <Radio.Button value="standard">标准采集</Radio.Button>
                  <Radio.Button value="blackbox">blackbox 拨测</Radio.Button>
                </Radio.Group>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={isBlackbox ? 24 : 12}>
              <Form.Item
                label="归属网域"
                name="network_domain_id"
                rules={[{ required: true, message: '请选择网域' }]}
                extra="所有 ScrapeJob 必须绑定且仅绑定单一已纳管网域；未纳管网域需先到配置中心完成纳管"
              >
                {/* {v3.14} 决策 D1：网域选择器空态 = 说明文案 + 内联跳转 M09，避免等保存时才报错 */}
                <Select
                  placeholder="请选择"
                  disabled={!!editingJob}
                  // {v3.17} 网域空态两步指引：M06 创建网域（行政）→ M09 完成纳管（监控），两个跳转入口
                  notFoundContent={
                    <Space direction="vertical" size={4} style={{ padding: '8px 0' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        暂无已纳管网域，请先完成网域创建与监控纳管：
                      </Text>
                      <Typography.Link href={MODULE_LINKS.module06} style={{ fontSize: 12 }}>
                        ① 前往网域管理（M06）创建网域 →
                      </Typography.Link>
                      <Typography.Link href={MODULE_LINKS.module09} style={{ fontSize: 12 }}>
                        ② 前往配置中心（M09）完成纳管 →
                      </Typography.Link>
                    </Space>
                  }
                  onChange={() => {
                    setTargetKeys([])
                    message.info('切换网域后已选实例已清空，实例必须与 Job 同域')
                  }}
                >
                  {MONITORED_NETWORK_DOMAINS.map((d) => (
                    <Option key={d.id} value={d.id}>
                      {d.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            {!isBlackbox && (
              <Col span={12}>
                <Form.Item
                  label="资源类别"
                  name="resource_category"
                  rules={[{ required: true, message: '请选择资源类别' }]}
                  extra="先选类别（主机/中间件/应用/通用目标），再选具体 监控对象类型"
                >
                  <Select
                    placeholder="请选择"
                    disabled={!!editingJob}
                    onChange={() => {
                      setTargetKeys([])
                      form.setFieldsValue({ resource_type: undefined, exporter_template_id: undefined })
                    }}
                  >
                    {RESOURCE_CATEGORIES.map((cat) => (
                      <Option key={cat} value={cat}>
                        {RESOURCE_CATEGORY_MAP[cat]}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            )}
          </Row>

          {!isBlackbox && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    label="监控对象类型"
                    name="resource_type"
                    rules={[{ required: true, message: '请选择 监控对象类型' }]}
                  >
                    <Select
                      placeholder={categoryCiTypes.length > 0 ? '请选择 监控对象类型' : '请先选择资源类别'}
                      disabled={!!editingJob || categoryCiTypes.length === 0}
                      onChange={(type) => {
                        setTargetKeys([])
                        // {v3.8} 选中 监控对象类型后自动匹配映射默认采集器（决策 15 继承链；可空手填）
                        const mapping = mockCITypeExporterMappings.find(
                          (m) => m.resource_type === (type as CiType)
                        )
                        form.setFieldsValue({
                          exporter_template_id: mapping?.exporter_template_id,
                        })
                        if (mapping) handleTemplateChange(mapping.exporter_template_id)
                      }}
                    >
                      {categoryCiTypes.map((type) => (
                        <Option key={type} value={type}>
                          {CI_TYPE_LABEL[type]}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  {/* {v3.14} 决策 D2：采集器显式二选一——「使用默认采集器（推荐）」/「手填采集参数」，避免"下拉留空"被理解为不需要采集器 */}
                  <Form.Item
                    label="采集器模式"
                    name="collector_mode"
                    initialValue="use_default"
                    extra="使用默认采集器：选中 监控对象类型后自动带出映射默认值；手填采集参数：不引用采集器默认值，直接填写下方采集参数"
                  >
                    <Radio.Group
                      optionType="button"
                      buttonStyle="solid"
                      size="small"
                      onChange={(e) => {
                        const mode = e.target.value as 'use_default' | 'manual'
                        if (mode === 'manual') {
                          // 手填模式：清空采集器引用（采集参数保留，供用户手填/覆盖）
                          form.setFieldsValue({ exporter_template_id: undefined })
                        } else {
                          // 使用默认采集器：若当前未选，自动带出映射默认采集器
                          const rt = form.getFieldValue('resource_type') as CiType | undefined
                          if (rt && !form.getFieldValue('exporter_template_id')) {
                            const mapping = mockCITypeExporterMappings.find((m) => m.resource_type === rt)
                            if (mapping) {
                              form.setFieldsValue({ exporter_template_id: mapping.exporter_template_id })
                              handleTemplateChange(mapping.exporter_template_id)
                            }
                          }
                        }
                      }}
                    >
                      <Radio.Button value="use_default">使用默认采集器（推荐）</Radio.Button>
                      <Radio.Button value="manual">手填采集参数</Radio.Button>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>
              {watchCollectorMode === 'use_default' ? (
                <Row gutter={16}>
                  <Col span={12}>
                    {/* {v3.8} 默认采集器：选中后预填采集参数；{v3.14} 空态内联登记入口（决策 D13） */}
                    <Form.Item
                      label="默认采集器"
                      name="exporter_template_id"
                      rules={[{ required: true, message: '请选择默认采集器（或切换为手填采集参数）' }]}
                      extra="选中 监控对象类型后自动带出映射默认采集器，可更换"
                    >
                      <Select
                        placeholder="请选择默认采集器"
                        showSearch
                        optionFilterProp="children"
                        notFoundContent={
                          <Space direction="vertical" size={4} style={{ padding: '8px 0' }}>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              未找到合适的采集器？
                            </Text>
                            <Button
                              size="small"
                              icon={<PlusCircleOutlined />}
                              onClick={() =>
                                openTemplateRegister({
                                  source: 'job',
                                  ciType: watchResourceType as CiType | undefined,
                                })
                              }
                            >
                              登记采集器
                            </Button>
                          </Space>
                        }
                        onChange={(v) => handleTemplateChange(v as string)}
                      >
                        {exporterTemplates
                          .filter((t) => t.supported_resource_types.length > 0)
                          .filter((t) =>
                            watchResourceType
                              ? t.supported_resource_types.includes(watchResourceType as CiType)
                              : true
                          )
                          .map((t) => (
                            <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                              {t.name} v{t.version} · {EXPORTER_SOURCE_LABEL[t.source]}
                            </Option>
                          ))}
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="手填采集参数模式"
                  description="不引用采集器默认值（exporter_template_id 为空），请在下方直接填写采集参数（采集间隔 / 采集超时 / 协议 / 指标路径）；application_http 等业务指标端点场景推荐此模式。"
                />
              )}
            </>
          )}

          {isBlackbox ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="blackbox 模块"
                  name="blackbox_module"
                  rules={[{ required: true, message: '请选择 blackbox 模块' }]}
                  extra="Module_09 会按模块生成 blackbox.yml 与 prometheus.yml 中的 scrape_config"
                >
                  <Select placeholder="请选择" onChange={(v) => handleBlackboxModuleChange(v as BlackboxModule)}>
                    {BLACKBOX_MODULES.map((m) => (
                      <Option key={m} value={m}>
                        {BLACKBOX_MODULE_LABEL[m]}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="指标路径"
                  name="metrics_path"
                  rules={[{ required: true, message: '请输入指标路径' }]}
                >
                  <Input disabled placeholder="blackbox 固定为 /probe" />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label={renderFieldLabel('label_template_id', '标签模板')}
                  name="label_template_id"
                  extra={
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {/* {v3.17} D25-C：显性说明自动匹配语义 */}
                        {selectedLabelTemplate
                          ? '已自动匹配该监控对象类型的默认标签模板，可更换（引用级）；标签内容编辑唯一入口在 Module_07'
                          : '创建时自动预填映射默认模板（缺省兜底同类别默认模板）；标签内容编辑唯一入口在 Module_07'}
                      </Text>
                      {/* {v3.17} 模板概要行 + 独立 Modal 表格查看（替代表单内卡片堆砌）；不满意可点「前往标签模板管理」 */}
                      {selectedLabelTemplate ? (
                        <Space size={8} wrap style={{ marginTop: 4 }}>
                          <Space size={4}>
                            <Text strong style={{ fontSize: 12 }}>
                              {selectedLabelTemplate.name}
                            </Text>
                            {selectedLabelTemplate.is_default ? (
                              <Tag color="gold" style={{ fontSize: 11 }}>默认</Tag>
                            ) : (
                              <Tag style={{ fontSize: 11 }}>自定义</Tag>
                            )}
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {RESOURCE_CATEGORY_MAP[selectedLabelTemplate.resource_category]} · {selectedLabelTemplate.template_id}
                            </Text>
                          </Space>
                          <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewTemplate(selectedLabelTemplate)}>
                            查看映射
                          </Button>
                          {editingJob && (
                            <Button
                              size="small"
                              icon={<SwapOutlined />}
                              onClick={() => form.setFieldsValue({ label_template_id: undefined })}
                            >
                              更换
                            </Button>
                          )}
                          <Typography.Link href={MODULE_LINKS.module07} style={{ fontSize: 12 }}>
                            前往标签模板管理 →
                          </Typography.Link>
                        </Space>
                      ) : (
                        /* {v3.1} 无标签模板时展示创建引导；{v3.2} 区分「映射未配置模板（引导先补配 CI-Exporter 映射，Job 自动继承）」与「用户未选择模板」 */
                        <Alert
                          type={mappingMissingTemplate ? 'warning' : 'info'}
                          showIcon
                          style={{ marginTop: 4 }}
                          message={
                            mappingMissingTemplate ? (
                              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                <Text style={{ fontSize: 12 }}>
                                  该监控对象类型的默认采集配置尚未关联标签模板，监控数据将缺少归属标签（instance / app / env 等）。
                                </Text>
                                <Space size={12} wrap>
                                  {/* {v3.18} D26：主按钮带 edit 参数跳转，落位自动打开映射编辑抽屉（不再是空跳转） */}
                                  <Button
                                    size="small"
                                    type="primary"
                                    style={{ backgroundColor: '#0ECDEB', borderColor: '#0ECDEB', color: '#fff' }}
                                    onClick={() =>
                                      navigate(
                                        `/ci-exporter-mapping?edit=${currentTypeMapping?.mapping_id ?? ''}`
                                      )
                                    }
                                  >
                                    立即补配（设置该类型的默认标签模板）
                                  </Button>
                                </Space>
                              </Space>
                            ) : (
                              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                <Text style={{ fontSize: 12 }}>
                                  {/* {v3.18} D26：文案区分缺口——类别下无模板时引导去 M07 创建 */}
                                  {categoryHasTemplate
                                    ? '暂未选择标签模板'
                                    : '该资源类别尚无标签模板，请先创建（创建后采集 Job 将自动继承）'}
                                </Text>
                                {!categoryHasTemplate && (
                                  <Space size={12} wrap>
                                    <Typography.Link href={MODULE_LINKS.module07} style={{ fontSize: 12 }}>
                                      前往创建模板（Module_07）→
                                    </Typography.Link>
                                  </Space>
                                )}
                              </Space>
                            )
                          }
                        />
                      )}
                    </Space>
                  }
                >
                  <Select
                    placeholder="请选择标签模板"
                    allowClear
                    showSearch
                    optionFilterProp="children"
                    // {v3.14} 决策 D1/D13：标签模板选择器空态 = 说明文案 + 内联跳转 Module_07（模板 CRUD 归属方）
                    // {v3.16} 决策 D18：按所属资源类别过滤（模板锚定粗粒度类别），默认模板由映射标记到 监控对象类型
                    notFoundContent={
                      <Space direction="vertical" size={4} style={{ padding: '8px 0' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          该资源类别尚无标签模板，请先创建（创建后采集 Job 将自动继承）
                        </Text>
                        <Typography.Link href={MODULE_LINKS.module07} style={{ fontSize: 12 }}>
                          前往标签模板管理（Module_07）→
                        </Typography.Link>
                      </Space>
                    }
                  >
                    {mockLabelTemplates
                      // {v3.17} D25-D：按资源类别过滤（类别驱动候选）——选定资源类别即收敛，不再等监控对象类型
                      .filter((t) =>
                        watchResourceCategory ? t.resource_category === watchResourceCategory : true
                      )
                      .map((t) => (
                        <Option key={t.template_id} value={t.template_id}>
                          {t.name}（{RESOURCE_CATEGORY_MAP[t.resource_category]} · {t.mappings.length} 条映射）
                        </Option>
                      ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
          )}

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="选择模式"
                name="instance_selection_mode"
                // {v3.14} 决策 D16：「手动选择」= 手动勾选具体实例（非手动选择采集器）
                extra="手动选择 = 手动勾选具体实例（候选按类型 + 网域自动收敛）；与采集器「使用默认 / 手填参数」二选一是两回事"
              >
                <Select disabled={isBlackbox}>
                  <Option value="manual">手动选择（实例）</Option>
                  <Option value="filter" disabled>
                    过滤规则（v0.3+）
                  </Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={renderFieldLabel('scrape_interval', '采集/拨测间隔')}
                name="scrape_interval"
                rules={[{ required: true, message: '请选择间隔' }]}
              >
                <Select>
                  <Option value="15s">15s</Option>
                  <Option value="30s">30s</Option>
                  <Option value="60s">60s</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={renderFieldLabel('scrape_timeout', '超时')}
                name="scrape_timeout"
                rules={[{ required: true, message: '请选择超时' }]}
              >
                <Select>
                  <Option value="5s">5s</Option>
                  <Option value="10s">10s</Option>
                  <Option value="30s">30s</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          {!isBlackbox && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={renderFieldLabel('scheme', '协议')} name="scheme" rules={[{ required: true, message: '请选择协议' }]}>
                  <Select>
                    {SCHEMES.map((s) => (
                      <Option key={s} value={s}>
                        {s}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label={renderFieldLabel('metrics_path', '指标路径')}
                  name="metrics_path"
                  rules={[{ required: true, message: '请输入指标路径' }]}
                >
                  <Input placeholder="/metrics" />
                </Form.Item>
              </Col>
            </Row>
          )}

          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {watchMode === 'filter' && !isBlackbox && (
            <Alert
              type="info"
              showIcon
              message="v0.3+ 开放：按网域/环境/应用/标签筛选"
              description="instance_filter 字段在 v0.3+ 版本开放，支持动态条件筛选与预览匹配结果。"
              style={{ marginBottom: 16 }}
            />
          )}
        </Form>

        {isBlackbox ? (
          <>
            <Alert
              type="info"
              showIcon
              message="拨测目标"
              description="blackbox 拨测目标内嵌在 ScrapeJob 中，Module_09 会生成 blackbox.yml 与对应 scrape_config。"
              style={{ marginBottom: 12 }}
            />
            <List
              bordered
              dataSource={blackboxTargets}
              locale={{ emptyText: '暂无拨测目标，点击下方按钮添加' }}
              renderItem={(item, index) => (
                <List.Item
                  actions={[
                    <Button type="link" danger onClick={() => removeBlackboxTarget(index)}>
                      删除
                    </Button>,
                  ]}
                >
                  <Row gutter={8} style={{ width: '100%' }} align="middle">
                    <Col span={10}>
                      <Input
                        placeholder="如 api.example.com/health 或 10.0.1.11"
                        value={item.target}
                        onChange={(e) => updateBlackboxTarget(index, { target: e.target.value })}
                        prefix={<GlobalOutlined style={{ color: PROTOCOL_COLOR[item.protocol] }} />}
                      />
                    </Col>
                    <Col span={6}>
                      <Select
                        style={{ width: '100%' }}
                        value={item.protocol}
                        onChange={(v) => updateBlackboxTarget(index, { protocol: v as ProbeProtocol })}
                      >
                        {(['http', 'https', 'tcp', 'icmp', 'dns'] as ProbeProtocol[]).map((p) => (
                          <Option key={p} value={p}>
                            {PROTOCOL_LABEL[p]}
                          </Option>
                        ))}
                      </Select>
                    </Col>
                    <Col span={8}>
                      <Input
                        placeholder="完整 URL（HTTP/HTTPS 可选）"
                        value={item.url ?? ''}
                        onChange={(e) => updateBlackboxTarget(index, { url: e.target.value })}
                      />
                    </Col>
                  </Row>
                </List.Item>
              )}
            />
            <Button type="dashed" icon={<PlusOutlined />} onClick={addBlackboxTarget} style={{ marginTop: 12 }}>
              新增拨测目标
            </Button>
          </>
        ) : (
          watchResourceType && (
            <>
              <Alert
                type="info"
                showIcon
                message="实例选择（自动带出候选）"
                description="已按「资源类型 + Job 归属网域」自动收敛可选实例（v3.0）；支持一键全选/反选与关键字搜索；跨网域实例不可被同一 Job 选中。v0.3+ 开放按环境/应用/标签条件筛选。"
                style={{ marginBottom: 12 }}
              />
              <Row gutter={8} style={{ marginBottom: 8 }}>
                <Col span={12}>
                  <Select
                    placeholder="按环境筛选"
                    allowClear
                    style={{ width: '100%' }}
                    value={filterEnv}
                    onChange={(v) => setFilterEnv(v)}
                  >
                    {ENV_VALUES.map((e) => (
                      <Option key={e} value={e}>
                        {ENV_LABEL[e]}
                      </Option>
                    ))}
                  </Select>
                </Col>
                <Col span={12}>
                  {/* {v3.4} 业务类型筛选：筛选字段 = Resource 属性字段（business_domain），label 名 biz 作 UI 别名 */}
                  <Select
                    placeholder="按业务类型（biz）筛选"
                    allowClear
                    style={{ width: '100%' }}
                    value={filterBusinessDomain}
                    onChange={(v) => setFilterBusinessDomain(v)}
                  >
                    {BIZ_DOMAINS.map((d) => (
                      <Option key={d} value={d}>{d}</Option>
                    ))}
                  </Select>
                </Col>
              </Row>
              <Transfer
                dataSource={transferData}
                titles={['同类型同域可选实例', '已选实例']}
                targetKeys={targetKeys}
                onChange={(next) => setTargetKeys(next as string[])}
                render={(item) => String(item.title)}
                listStyle={{ width: 300, height: 320 }}
                style={{ marginBottom: 24 }}
                showSearch
                filterOption={(inputValue, item) =>
                  String(item.title).toLowerCase().includes(inputValue.toLowerCase()) ||
                  (item.description ?? '').toLowerCase().includes(inputValue.toLowerCase())
                }
              />
            </>
          )
        )}

        {editingJob && editingJob.job_type === 'standard' && editingJob.selected_instance_ids.length > 0 && (
          <>
            <Title level={5}>Exporter 安装确认</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              点击状态徽标可修改安装状态并填写确认信息；未确认实例不生成 target
            </Text>
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              {editingJob.selected_instance_ids.map((id) => {
                const resource = mockResources.find((r) => r.resource_id === id)
                const conf = installations.find(
                  (c) =>
                    c.resource_id === id &&
                    c.exporter_template_id === editingJob.exporter_template_id
                )
                const status = conf?.status ?? 'unregistered'
                const meta = INSTALL_STATUS_MAP[status]
                return (
                  <Card
                    key={id}
                    size="small"
                    bodyStyle={{ padding: 12 }}
                    hoverable
                    onClick={() =>
                      conf &&
                      openConfirm({
                        ...conf,
                        status: cycleStatus(status),
                      })
                    }
                  >
                    <Row align="middle" justify="space-between">
                      <Col>
                        <Text strong>{resource?.instance_name ?? id}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {resource?.instance_ip} · {resource ? ENV_LABEL[resource.env] : ''}
                          </Text>
                        </div>
                        {conf?.confirmed_by && (
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              确认人 {conf.confirmed_by} · {conf.notes || '无备注'}
                            </Text>
                          </div>
                        )}
                      </Col>
                      <Col>
                        <Tooltip title="点击切换状态并填写确认信息">
                          <Badge color={meta.color} text={meta.text} />
                        </Tooltip>
                      </Col>
                    </Row>
                  </Card>
                )
              })}
            </Space>
          </>
        )}

        <Alert
          type="warning"
          showIcon
          message="P2：高级 Relabel 管理"
          description="relabel_configs 字段为 P2 预留，将支持标签丢弃/保留/重写、正则替换、hashmod 等高级能力。"
          style={{ marginTop: 24 }}
        />
      </Drawer>

      <Modal
        title="Exporter 安装确认"
        open={!!confirmTarget}
        onCancel={() => setConfirmTarget(null)}
        onOk={handleConfirmSave}
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={480}
      >
        {confirmTarget && (
          <Form form={confirmForm} layout="vertical" style={{ marginTop: 16 }}>
            <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="资源">
                {mockResources.find((r) => r.resource_id === confirmTarget.resource_id)?.instance_name ?? confirmTarget.resource_id}
              </Descriptions.Item>
              <Descriptions.Item label="Exporter">
                {templateNameMap.get(confirmTarget.exporter_template_id)}
              </Descriptions.Item>
            </Descriptions>
            <Form.Item
              label="安装状态"
              name="status"
              rules={[{ required: true, message: '请选择状态' }]}
            >
              <Select>
                {INSTALL_STATUS_CYCLE.map((s) => (
                  <Option key={s} value={s}>
                    {INSTALL_STATUS_MAP[s].text}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              label="确认人"
              name="confirmed_by"
              rules={[{ required: true, message: '请输入确认人' }]}
            >
              <Input placeholder="如 alice" />
            </Form.Item>
            <Form.Item label="备注（工单号/安装记录）" name="notes">
              <Input.TextArea rows={2} placeholder="可选" />
            </Form.Item>
            <Form.Item
              label="实际监听端口 {P1}"
              name="actual_port"
              extra="登记实例上 exporter 实际监听端口；生成配置时与生效端口不一致将提示（不自动改配置）"
            >
              <InputNumber min={1} max={65535} placeholder="如 9100" style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title="Job 详情"
        open={!!detailJob}
        onCancel={() => setDetailJob(null)}
        footer={
          <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={() => setDetailJob(null)}>
            关闭
          </Button>
        }
        width={680}
      >
        {detailJob && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="Job 名称" span={2}>
                <Text strong>{detailJob.job_name}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Job 类型">
                <Tag color={detailJob.job_type === 'blackbox' ? 'purple' : 'blue'}>
                  {detailJob.job_type === 'blackbox' ? 'blackbox 拨测' : '标准采集'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="归属网域">
                <Tag>{domainNameMap.get(detailJob.network_domain_id) ?? detailJob.network_domain_id}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="监控对象类型">
                {detailJob.job_type === 'blackbox' || !detailJob.resource_type ? (
                  <Text type="secondary">-</Text>
                ) : (
                  <Tag color="blue">{CI_TYPE_LABEL[detailJob.resource_type]}</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Exporter / Module">
                {detailJob.job_type === 'blackbox' ? (
                  <Tag color="cyan">{detailJob.blackbox_module ?? '-'}</Tag>
                ) : detailJob.exporter_template_id ? (
                  <Tag color="cyan">
                    {templateNameMap.get(detailJob.exporter_template_id) ?? detailJob.exporter_template_id}
                  </Tag>
                ) : (
                  <Text type="secondary">手填参数</Text>
                )}
              </Descriptions.Item>
              {/* 决策 34：详情视图每个参数字段显示继承/覆盖/待同步标记 */}
              <Descriptions.Item label="采集间隔">
                <Space size={4}>
                  <Text>{detailJob.scrape_interval}</Text>
                  {detailJob.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(detailJob, 'scrape_interval'))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="超时">
                <Space size={4}>
                  <Text>{detailJob.scrape_timeout}</Text>
                  {detailJob.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(detailJob, 'scrape_timeout'))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="指标路径">
                <Space size={4}>
                  <Text code>{detailJob.metrics_path}</Text>
                  {detailJob.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(detailJob, 'metrics_path'))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="协议">
                <Space size={4}>
                  <Tag>{detailJob.scheme}</Tag>
                  {detailJob.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(detailJob, 'scheme'))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="选择模式">
                {detailJob.job_type === 'blackbox' ? (
                  <Text type="secondary">-</Text>
                ) : detailJob.instance_selection_mode === 'manual' ? (
                  '手动勾选'
                ) : (
                  '过滤规则（v0.3+）'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="标签模板">
                {detailJob.label_template_id ? (
                  <Space size={4}>
                    <Badge
                      status="success"
                      text={labelNameMap.get(detailJob.label_template_id) ?? detailJob.label_template_id}
                    />
                    {detailJob.job_type === 'standard' && renderFieldTag(getFieldStatusForJob(detailJob, 'label_template_id'))}
                  </Space>
                ) : detailJob.job_type === 'standard' &&
                  getMapping(detailJob) &&
                  !getMapping(detailJob)!.has_label_template ? (
                  /* {v3.2} 引用无标签模板映射的 Job：详情提示待配置；{v3.18} D26 点击打开映射编辑抽屉 */
                  <Tooltip title="该监控对象类型的默认采集配置尚未关联标签模板，点击立即补配">
                    <Tag
                      color="warning"
                      style={{ cursor: 'pointer' }}
                      onClick={() => getMapping(detailJob) && openPresetEdit(getMapping(detailJob)!)}
                    >
                      标签待配置
                    </Tag>
                  </Tooltip>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="启用状态">
                <Switch checked={detailJob.enabled} size="small" disabled />
              </Descriptions.Item>
              <Descriptions.Item label="创建 / 更新时间">
                {new Date(detailJob.created_at).toLocaleString()} / {new Date(detailJob.updated_at).toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="参数同步快照">
                {detailJob.job_type === 'blackbox' ? (
                  <Text type="secondary">-</Text>
                ) : isMappingChanged(detailJob) ? (
                  <Tag color="warning">映射默认值已变更</Tag>
                ) : detailJob.mapping_synced_at ? (
                  <Tag color="success">已同步 · {new Date(detailJob.mapping_synced_at).toLocaleString()}</Tag>
                ) : (
                  <Tag color="success">已同步</Tag>
                )}
              </Descriptions.Item>
            </Descriptions>

            {detailJob.job_type === 'blackbox' ? (
              <>
                <Title level={5} style={{ marginTop: 16 }}>
                  拨测目标（{detailJob.blackbox_targets?.length ?? 0}）
                </Title>
                <List
                  bordered
                  size="small"
                  dataSource={detailJob.blackbox_targets ?? []}
                  renderItem={(item, index) => (
                    <List.Item key={index}>
                      <Space>
                        <Tag color={PROTOCOL_COLOR[item.protocol]}>{PROTOCOL_LABEL[item.protocol]}</Tag>
                        <Text code>{item.url || item.target}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </>
            ) : (
              detailJob.selected_instance_ids.length > 0 && (
                <>
                  <Title level={5} style={{ marginTop: 16 }}>
                    已选实例（{detailJob.selected_instance_ids.length}）
                  </Title>
                  <List
                    bordered
                    size="small"
                    dataSource={detailJob.selected_instance_ids}
                    renderItem={(id) => {
                      const r = mockResources.find((res) => res.resource_id === id)
                      const meta = INSTALL_STATUS_MAP[detailJob.exporter_status[id] ?? 'unregistered']
                      return (
                        <List.Item key={id}>
                          <Space>
                            <Text strong>{r?.instance_name ?? id}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {r?.instance_ip}
                            </Text>
                            <Badge color={meta.color} text={meta.text} />
                          </Space>
                        </List.Item>
                      )
                    }}
                  />
                </>
              )
            )}
          </>
        )}
      </Modal>

      {/* {v3.17} 标签模板详情 Modal：表格对应形式查看映射（替代表单内卡片堆砌）；不满意可跳转 Module_07 模板管理 */}
      <Modal
        title={previewTemplate ? `标签模板：${previewTemplate.name}` : '标签模板'}
        open={!!previewTemplate}
        onCancel={() => setPreviewTemplate(null)}
        footer={
          <Space>
            <Typography.Link href={MODULE_LINKS.module07} style={{ fontSize: 12 }}>
              前往标签模板管理（Module_07）→
            </Typography.Link>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={() => setPreviewTemplate(null)}>
              关闭
            </Button>
          </Space>
        }
        width={600}
      >
        {previewTemplate && (
          <>
            <Space size={8} style={{ marginBottom: 12 }} wrap>
              <Tag color="blue">{RESOURCE_CATEGORY_MAP[previewTemplate.resource_category]}</Tag>
              <Text code style={{ fontSize: 12 }}>
                {previewTemplate.template_id}
              </Text>
              {previewTemplate.is_default ? <Tag color="gold">默认</Tag> : <Tag>自定义</Tag>}
              <Text type="secondary" style={{ fontSize: 12 }}>
                共 {previewTemplate.mappings.length} 条映射
              </Text>
            </Space>
            <Table
              size="small"
              rowKey="target_label"
              dataSource={previewTemplate.mappings}
              pagination={false}
              columns={[
                { title: '来源字段', dataIndex: 'source_field', key: 'source_field' },
                {
                  title: '来源类型',
                  dataIndex: 'source_type',
                  key: 'source_type',
                  render: (v: string) => <Tag style={{ fontSize: 11 }}>{v}</Tag>,
                },
                {
                  title: '目标标签',
                  dataIndex: 'target_label',
                  key: 'target_label',
                  render: (v: string) => (
                    <Text code style={{ fontSize: 12 }}>
                      {v}
                    </Text>
                  ),
                },
                {
                  title: '启用',
                  dataIndex: 'enabled',
                  key: 'enabled',
                  render: (v: boolean) => (v ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
                },
              ]}
            />
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message="标签内容编辑唯一入口在 Module_07"
              description="本模块只读引用该模板；如需调整字段 → 标签映射、克隆或删除模板，请前往标签模板管理。"
            />
          </>
        )}
      </Modal>

      {/* {v3.12} 登记自研采集器 Modal；{v3.14} 标题随发起上下文提示：已预填 监控对象类型，保存后自动回选 */}
      <Modal
        title={
          registerCtx.source !== 'none' && registerCtx.ciType
            ? `登记采集器（自研 / 第三方）· 支持类型已预填「${CI_TYPE_LABEL[registerCtx.ciType]}」，保存后自动选中`
            : '登记采集器（自研 / 第三方）'
        }
        open={templateModalOpen}
        onCancel={() => {
          setTemplateModalOpen(false)
          templateForm.resetFields()
        }}
        onOk={handleTemplateSave}
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={640}
      >
        <Form form={templateForm} layout="vertical" style={{ marginTop: 16 }}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="自研采集器登记后即入池"
            description="登记完成后，该采集器与平台预置采集器同等待遇——可被默认采集配置引用、创建 Job 时预填参数、可走实例级安装确认。"
          />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="采集器名称" name="name" rules={[{ required: true, message: '请输入采集器名称' }]}>
                <Input placeholder="如 my-app-exporter" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="版本" name="version" extra="建议语义化版本">
                <Input placeholder="1.0.0" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="来源" name="source" rules={[{ required: true }]} initialValue="internal">
            <Select
              placeholder="请选择"
              options={EXPORTER_SOURCES.map((s) => ({ value: s, label: EXPORTER_SOURCE_LABEL[s] }))}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="默认端口"
                name="default_port"
                rules={[{ required: true, message: '请输入端口' }]}
                extra="自研采集器按实际部署填写"
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="采集路径"
                name="metrics_path"
                rules={[{ required: true, message: '请输入路径' }]}
                extra="自研采集器按实际部署填写"
              >
                <Input placeholder="/metrics" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="协议" name="scheme" rules={[{ required: true }]} initialValue="http">
                <Select>
                  {SCHEMES.map((s) => (
                    <Option key={s} value={s}>{s.toUpperCase()}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="支持 监控对象类型"
            name="supported_resource_types"
            rules={[{ required: true, message: '请至少选择一个 监控对象类型' }]}
            extra="从「默认采集配置 / Job」表单空态打开时已预填当前 监控对象类型；登记成功后会自动回选到发起表单"
          >
            <Select mode="multiple" placeholder="请选择该采集器可服务的 监控对象类型">
              {CI_TYPES.map((t) => (
                <Option key={t} value={t}>{CI_TYPE_LABEL[t]}</Option>
              ))}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="适用操作系统" name="os" initialValue="any">
                <Select>
                  <Option value="linux">linux</Option>
                  <Option value="windows">windows</Option>
                  <Option value="any">any</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="适用架构" name="arch" initialValue="any">
                <Select>
                  <Option value="amd64">amd64</Option>
                  <Option value="arm64">arm64</Option>
                  <Option value="any">any</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="下载地址" name="download_url" extra="内部制品库地址或内网下载链接">
                <Input placeholder="https://..." />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="官方文档 / 主页" name="homepage">
                <Input placeholder="https://..." />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="安装指南" name="install_guide">
            <Input.TextArea rows={3} placeholder="离线/隔离网域安装说明" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="采集器用途与能力说明" />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
