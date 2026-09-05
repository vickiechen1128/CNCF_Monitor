import { useEffect, useMemo, useState, type ReactNode, type Key } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import {
  Card,
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
  Collapse,
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
  InfoCircleOutlined,
  ArrowRightOutlined,
  CopyOutlined,
  SendOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { ReviewNote } from '../components/ReviewNote'
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
  COLLECTION_STATUS_META,
  mockTargetsCollection,
  collectionStatsOf,
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
  AuthType,
  CollectionRunStatus,
  InstanceCollectionStatus,
  InstanceSelectionMode,
} from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const now = () => new Date().toISOString()

// 表单内字段说明提示（轻量非 Alert）：代替表单/抽屉中堆叠的说明性 Alert，用户主区保持清爽
function FieldGuide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 8, padding: '8px 12px', background: '#F7F9FB', borderRadius: 6 }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Text strong style={{ fontSize: 12 }}>
          {title}
        </Text>
        {children}
      </Space>
    </div>
  )
}

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

// {v3.22} 状态列四态聚合（决策 D29）：草稿(draft) > 待下发(pending) > 已生效(active) > 已停用(disabled)
// 草稿=draft_status=draft（不入下发管线）；待下发=存在 M09 待确认变更单；已生效=启用且无待下发；已停用=未启用
type JobStatus = 'draft' | 'pending' | 'active' | 'disabled'
const getJobStatus = (j: ScrapeJob): JobStatus => {
  if (j.draft_status === 'draft') return 'draft'
  if (j.change_status === 'pending') return 'pending'
  return j.enabled ? 'active' : 'disabled'
}

// {v3.28} 决策 53：filter 选择模式提前 v0.2——筛选条件表达式；筛选字段 = Resource 属性字段（label 名仅 UI 别名，由标签模板映射只读派生，不落表达式）
type FilterField = 'env' | 'cluster' | 'app_name' | 'business_domain'
type FilterOp = 'eq' | 'neq' | 'contains'
interface FilterCond {
  field: FilterField
  op: FilterOp
  value: string
}
// 筛选字段展示名（label 别名由模板映射派生，见 PRD 5.4）
const FILTER_FIELD_LABEL: Record<FilterField, string> = {
  env: '环境',
  cluster: '集群',
  app_name: '应用',
  business_domain: '业务类型（biz）',
}
const FILTER_FIELD_SELECTIONS: { value: FilterField; label: string }[] = [
  { value: 'env', label: '环境' },
  { value: 'cluster', label: '集群' },
  { value: 'app_name', label: '应用' },
  { value: 'business_domain', label: '业务类型（biz）' },
]

// {v3.28} 决策 53：instance_filter <-> FilterCond[] 互转（实例筛选条件，字段 = Resource 属性字段）
const parseFilterConds = (filter: Record<string, unknown> | null | undefined): FilterCond[] => {
  if (!filter || !Array.isArray(filter.conditions)) return []
  return (filter.conditions as FilterCond[]).filter(
    (c) =>
      c &&
      c.value !== '' &&
      FILTER_FIELD_SELECTIONS.some((f) => f.value === c.field)
  )
}

// {v3.28} 决策 53：单条筛选条件是否命中某资源（字段 = Resource 属性字段）
const condMatches = (r: (typeof mockResources)[number], c: FilterCond): boolean => {
  const v = String(r[c.field] ?? '')
  switch (c.op) {
    case 'eq':
      return v === c.value
    case 'neq':
      return v !== c.value && v !== ''
    case 'contains':
      return v.includes(c.value)
    default:
      return false
  }
}

// {v3.28} 决策 54：两个字符串数组按集合等价比较（顺序无关）——用于克隆时判定网域集合是否一致
const buildIdentical = (a?: string[] | undefined, b?: string[] | undefined): boolean => {
  const na = [...(a ?? [])].sort()
  const nb = [...(b ?? [])].sort()
  return na.length === nb.length && na.every((v, i) => v === nb[i])
}

// {v3.26} 决策 30：判断网域是否已冻结（禁用）——仅「已纳管且 frozen=true」的网络域视为冻结，禁止新建 Job/新增该域实例
const isFrozenDomain = (id?: string) =>
  !!id && MONITORED_NETWORK_DOMAINS.some((d) => d.id === id && d.frozen === true)

// {v3.22} v0.2 能力角标：橙色小 Tag，标识「该能力 v0.2 交付」的入口/按钮（演示态占位标记）
function V02Badge() {
  return (
    <Tag
      color="orange"
      style={{
        marginInlineStart: 4,
        marginInlineEnd: 0,
        paddingInline: 4,
        lineHeight: '14px',
        fontSize: 10,
        borderRadius: 4,
      }}
    >
      v0.2
    </Tag>
  )
}

export default function ScrapeJobsPage() {
  const { modal, message } = App.useApp()
  const location = useLocation()
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
  // {v3.28} 决策 53：filter 选择模式提前 v0.2——筛选条件（表达式构建，每生成周期实时求值）
  const [filterConds, setFilterConds] = useState<FilterCond[]>([])
  const [blackboxTargets, setBlackboxTargets] = useState<BlackboxTarget[]>([])
  const [confirmTarget, setConfirmTarget] = useState<ExporterInstallationConfirmation | null>(null)
  const [detailJob, setDetailJob] = useState<ScrapeJob | null>(null)
  // {v3.17} 标签模板映射详情 Modal（表格对应形式查看，替代表单内卡片堆砌）
  const [previewTemplate, setPreviewTemplate] = useState<LabelTemplate | null>(null)
  // 决策 14：当前编辑表单中手动覆盖过映射默认值的字段（「同步映射默认值」时跳过）
  const [overriddenFields, setOverriddenFields] = useState<MappingOverrideField[]>([])
  // {v3.22} 克隆上下文（决策 D29）：从哪个 Job 克隆而来，用于抽屉内提示 + 跨网域克隆时清空实例重选
  const [cloneSource, setCloneSource] = useState<ScrapeJob | null>(null)
  // {v3.22} 列表「状态」查询条件（状态器）：四态聚合筛选（草稿选项 MVP 置灰禁用）
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all')
  // {v3.22} 多选 + 批量提交生效（v0.2）：选中行 + 结果抽屉
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [batchDrawerOpen, setBatchDrawerOpen] = useState(false)
  const [batchResult, setBatchResult] = useState<{ ok: string[]; fail: { name: string; reason: string }[] } | null>(null)
  // {v3.22} 提交生效失败时置顶 Alert 的逐条错误清单
  const [submitErrors, setSubmitErrors] = useState<{ field: string; msg: string }[]>([])
  const [confirmForm] = Form.useForm()
  const [form] = Form.useForm()

  // {v3.27} 决策 47-2：Job 实例采集状态回显——数据源 = M02 /api/v1/targets 代理（只读），20s 自动刷新 + 手动刷新，不阻断编辑与保存
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<string>('')
  useEffect(() => {
    const touch = () => setStatusUpdatedAt(new Date().toLocaleTimeString())
    touch()
    const id = setInterval(touch, 20000)
    return () => clearInterval(id)
  }, [])

  // {v3.12} 采集 Job 列表网域查询条件（取代顶部全局网域切换器）
  // {v3.27} F-09：支持 URL 预选网域（来自 M09「去配置采集 Job」跳转：/scrape-jobs?network_domain=<id>，决策 D27-2）；视图由 pathname 派生，不再用 ?view=
  const [listDomainFilter, setListDomainFilter] = useState<string | undefined>(
    searchParams.get('network_domain') ?? undefined
  )

  // {v3.27} F-09：视图由 pathname 驱动（/collectors=采集器管理，/scrape-jobs=采集 Job）；/ci-exporter-mapping 兼容书签落位采集器管理视图
  const view: 'collectors' | 'jobs' = location.pathname === '/scrape-jobs' ? 'jobs' : 'collectors'
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
  // {v3.27} F-11：标签模板变更唯一入口 = 轻量「更换/补配」抽屉（LabelTemplateSelectDrawer）；编辑抽屉（MappingDrawer）不再含 label_template_id 字段
  const [labelSelectOpen, setLabelSelectOpen] = useState(false)
  const [labelSelectMapping, setLabelSelectMapping] = useState<CITypeExporterMapping | null>(null)
  const openLabelSelect = (record: CITypeExporterMapping) => {
    setLabelSelectMapping(record)
    setLabelSelectOpen(true)
  }
  const closeLabelSelect = () => {
    setLabelSelectOpen(false)
    setLabelSelectMapping(null)
  }
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
  // {v3.27} F-11：编辑抽屉不再含 label_template_id 字段，setFieldsValue 时剔除该字段，避免编辑保存时误清空标签模板
  const openPresetEdit = (record: CITypeExporterMapping) => {
    setEditingPreset(record)
    const { label_template_id: _lt, has_label_template: _ht, ...rest } = record
    void _lt
    void _ht
    presetForm.setFieldsValue({
      ...rest,
      resource_category: CI_TYPE_CATEGORY_MAP[record.resource_type],
    })
    setPresetDrawerOpen(true)
  }
  // {v3.27} F-11：兼容 ?edit=<mapping_id> 深链——收敛为打开「更换/补配」轻量抽屉（编辑抽屉不再承载标签模板补配）
  const editMappingId = searchParams.get('edit')
  useEffect(() => {
    if (editMappingId) {
      const mapping = mockCITypeExporterMappings.find((m) => m.mapping_id === editMappingId)
      // 外部 URL 参数（?edit=<mapping_id>）一次性同步打开轻量抽屉，属「外部系统 → 状态」同步场景
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (mapping) openLabelSelect(mapping)
    }
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

  // 模板 ID → ExporterTemplate 快速索引（纯派生，随渲染重建；React Compiler 对 Map 类型 useMemo 无法保留记忆化，改普通常量）
  const templateMap = new Map<string, (typeof exporterTemplates)[number]>()
  exporterTemplates.forEach((t) => templateMap.set(t.exporter_template_id, t))

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
    // templateMap 为随渲染重建的普通常量，不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, collectorCiTypeFilter, collectorSourceFilter])

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

  // {v3.27} 决策 47-2：Job 详情实例采集状态聚合（在线/待采集/已下发未采到/未知），数据源 = M02 targets 代理
  const detailStats = useMemo(
    () => (detailJob ? collectionStatsOf(detailJob.selected_instance_ids, mockTargetsCollection) : null),
    [detailJob],
  )

  // mockLabelTemplates 为模块常量（从不变化），Map 索引无需 useMemo；React Compiler 亦无法保留其记忆化
  const labelNameMap = new Map<string, string>()
  mockLabelTemplates.forEach((t) => labelNameMap.set(t.template_id, t.name))

  const watchJobType = Form.useWatch('job_type', form) as ScrapeJobType | undefined
  const watchResourceType = Form.useWatch('resource_type', form)
  const watchResourceCategory = Form.useWatch('resource_category', form)
  // {v3.28} 决策 54：网域集合（多选）——表单选中网域 id 数组
  const watchNetworkDomainId = Form.useWatch('network_domain_ids', form) as string[] | undefined
  const watchMode = Form.useWatch('instance_selection_mode', form)
  const watchedLabelTemplateId = Form.useWatch('label_template_id', form)
  // {v3.14} 决策 D2：采集器模式显式二选一（使用默认采集器 / 手填采集参数），避免"下拉留空"歧义
  const watchCollectorMode = Form.useWatch('collector_mode', form) as 'use_default' | 'manual' | undefined
  // {v3.26} 决策 31：认证类型（none/basic/bearer），用于条件渲染认证字段与提交校验
  const watchAuthType = Form.useWatch('auth_type', form) as AuthType | undefined

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

  // Transfer 数据源：按当前 resource_type + Job 网域集合 + 环境 + 业务类型筛选（{v3.4} 业务类型 = 筛选字段，label 名 biz 作 UI 别名）
  // {v3.28} 决策 54：候选集收敛为「同类型 + 归属任一已选网域」的资源
  // {v3.25} offline 排除提级 MVP 必实现（决策 29，对齐 Module_07 8.1 / Module_09 3.3）：
  // 候选集中 Resource.status=offline 实例「显示但置灰不可选」——仍展示（保证下线台账可见），但 disabled 禁止勾选；
  // 已选实例事后转 offline 后由 M09 配置生成跳过（离线后下一配置生成周期即从 targets 移除）。
  // maintenance 排除口径与 Module_07 8.1 一并对齐（MVP 不保证，此处不置灰 + ReviewNote 标注）。
  const transferData = useMemo<TransferItem[]>(() => {
    const rt = watchResourceType as CiType | undefined
    if (!rt) return []
    const domains = watchNetworkDomainId ?? []
    if (domains.length === 0) return []
    return mockResources
      .filter((r) => r.resource_type === rt)
      .filter((r) => domains.includes(r.network_domain_id))
      .filter((r) => (filterEnv ? r.env === filterEnv : true))
      .filter((r) => (filterBusinessDomain ? r.business_domain === filterBusinessDomain : true))
      .map((r) => ({
        key: r.resource_id,
        title: `${r.instance_name}${r.status === 'offline' ? '（已下线）' : ''} (${r.instance_ip})`,
        description: `${domainNameMap.get(r.network_domain_id) ?? r.network_domain_id} · ${ENV_LABEL[r.env]} · ${r.app_name}${r.business_domain ? ` · 业务类型(biz):${r.business_domain}` : ''}${r.status === 'offline' ? ' · 状态:offline（已下线）' : ''}`,
        // {v3.25} 决策 29：offline 实例显示但置灰不可选（disabled）；maintenance 除外（MVP 不保证）
        disabled: r.status === 'offline',
      }))
  }, [watchResourceType, watchNetworkDomainId, filterEnv, filterBusinessDomain, domainNameMap])

  // {v3.28} 决策 53：filter 模式实时求值预览——按「监控对象类型 + 归属任一已选网域 + 筛选条件」求值；
  // 演示「M07 新增匹配资源自动纳入 targets」：预览强调仅脚本模拟了「新纳管资源会在保存后的下一配置生成周期自动纳入」语义（实际由 M09 每周期求值）
  const filterMatching = useMemo(() => {
    const rt = watchResourceType as CiType | undefined
    if (!rt) return { matched: [], total: 0, underDomain: 0 }
    const domains = watchNetworkDomainId ?? []
    return mockResources.reduce<{ matched: (typeof mockResources)[number][]; total: number; underDomain: number }>(
      (acc, r) => {
        if (r.resource_type !== rt) return acc
        acc.total += 1
        if (!domains.includes(r.network_domain_id)) return acc
        acc.underDomain += 1
        const allMatch = filterConds.length > 0 && filterConds.every((c) => condMatches(r, c))
        // offline 实例不纳入采集，但计入预览展示（与手动模式一致：显示但置灰）
        if (allMatch && r.status !== 'offline') acc.matched.push(r)
        return acc
      },
      { matched: [], total: 0, underDomain: 0 }
    )
  }, [watchResourceType, watchNetworkDomainId, filterConds])

  // {v3.22} 列表可见 Job：网域 + 状态（四态）双查询条件过滤
  const visibleJobs = useMemo(
    () =>
      jobs.filter((j) => {
        // {v3.28} 决策 54：Job 绑定网域集合——命中任一网域即入围
        if (listDomainFilter && !j.network_domain_ids.includes(listDomainFilter)) return false
        if (statusFilter !== 'all' && getJobStatus(j) !== statusFilter) return false
        return true
      }),
    [jobs, listDomainFilter, statusFilter]
  )

  const openCreate = () => {
    setEditingJob(null)
    setCloneSource(null)
    setSubmitErrors([])
    form.resetFields()
    setTargetKeys([])
    setBlackboxTargets([])
    setFilterEnv(undefined)
    setFilterConds([])
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
      // {v3.28} 决策 54：网域集合多选默认选中首个已纳管网域
      network_domain_ids: ['default'],
      // {v3.26} 决策 31：认证/TLS 默认无认证 + 跳过校验默认关
      auth_type: 'none',
      tls_skip_verify: false,
      ca_file: undefined,
    })
    setDrawerOpen(true)
  }

  const openEdit = (record: ScrapeJob) => {
    setEditingJob(record)
    setCloneSource(null)
    setSubmitErrors([])
    form.setFieldsValue({
      job_name: record.job_name,
      job_type: record.job_type,
      // {v3.16} D21：blackbox 的 resource_type 为空 → 类别不预填
      resource_category: record.resource_type ? CI_TYPE_CATEGORY_MAP[record.resource_type] : undefined,
      resource_type: record.resource_type,
      exporter_template_id: record.exporter_template_id,
      collector_mode: record.exporter_template_id ? 'use_default' : 'manual',
      network_domain_ids: record.network_domain_ids,
      instance_selection_mode: record.instance_selection_mode,
      scrape_interval: record.scrape_interval,
      scrape_timeout: record.scrape_timeout,
      metrics_path: record.metrics_path,
      scheme: record.scheme,
      label_template_id: record.label_template_id,
      enabled: record.enabled,
      blackbox_module: record.blackbox_module,
      // {v3.26} 决策 31：编辑回填认证/TLS
      auth_type: record.auth_type ?? 'none',
      auth_username: record.auth_username,
      auth_password: record.auth_password,
      auth_token: record.auth_token,
      tls_skip_verify: record.tls_skip_verify ?? false,
      ca_file: record.ca_file,
    })
    setTargetKeys([...record.selected_instance_ids])
    setBlackboxTargets(record.blackbox_targets ? [...record.blackbox_targets] : [])
    setFilterEnv(undefined)
    // {v3.28} 决策 53：filter 模式回填筛选条件
    setFilterConds(parseFilterConds(record.instance_filter))
    setOverriddenFields(
      (record.mapping_overrides ?? []).filter((f) =>
        (MAPPING_OVERRIDE_FIELDS as readonly string[]).includes(f)
      ) as MappingOverrideField[]
    )
    setDrawerOpen(true)
  }

  // {v3.22} 决策 D29：克隆 Job（v0.2）——复制源 Job 采集参数新建；
  // 同网域克隆：直接改选实例分组后提交生效；跨网域克隆：网域改为新域、实例清空重选、安装确认需重新进行
  const openClone = (source: ScrapeJob) => {
    setCloneSource(source)
    setEditingJob(null)
    setSubmitErrors([])
    form.resetFields()
    setTargetKeys([...source.selected_instance_ids])
    setBlackboxTargets(source.blackbox_targets ? [...source.blackbox_targets] : [])
    setFilterEnv(undefined)
    // {v3.28} 决策 53：克隆复制筛选条件
    setFilterConds(parseFilterConds(source.instance_filter))
    setOverriddenFields(
      (source.mapping_overrides ?? []).filter((f) =>
        (MAPPING_OVERRIDE_FIELDS as readonly string[]).includes(f)
      ) as MappingOverrideField[]
    )
    form.setFieldsValue({
      job_name: `${source.job_name}-clone`,
      job_type: source.job_type,
      resource_category: source.resource_type ? CI_TYPE_CATEGORY_MAP[source.resource_type] : undefined,
      resource_type: source.resource_type,
      exporter_template_id: source.exporter_template_id,
      collector_mode: source.exporter_template_id ? 'use_default' : 'manual',
      network_domain_ids: source.network_domain_ids,
      instance_selection_mode: source.instance_selection_mode,
      scrape_interval: source.scrape_interval,
      scrape_timeout: source.scrape_timeout,
      metrics_path: source.metrics_path,
      scheme: source.scheme,
      label_template_id: source.label_template_id,
      enabled: source.enabled,
      blackbox_module: source.blackbox_module,
      // {v3.26} 决策 31：克隆复制认证/TLS
      auth_type: source.auth_type ?? 'none',
      auth_username: source.auth_username,
      auth_password: source.auth_password,
      auth_token: source.auth_token,
      tls_skip_verify: source.tls_skip_verify ?? false,
      ca_file: source.ca_file,
    })
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditingJob(null)
    setCloneSource(null)
    setSubmitErrors([])
    setTargetKeys([])
    setBlackboxTargets([])
    setOverriddenFields([])
    setFilterConds([])
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

  // {v3.28} 决策 54：网域校验由「全域同域」变为「逐域同域」——选中的每个实例只要归属 Job 任一网域即可
  const validateDomainConsistency = (
    networkDomainIds: string[],
    selectedIds: string[]
  ): string | null => {
    if (networkDomainIds.length === 0) return '请至少选择一个归属网域'
    const mismatched = selectedIds
      .map((id) => mockResources.find((r) => r.resource_id === id))
      .filter((r): r is (typeof mockResources)[number] => !!r)
      .filter((r) => !networkDomainIds.includes(r.network_domain_id))
    if (mismatched.length > 0) {
      const domains = networkDomainIds.map((d) => domainNameMap.get(d) ?? d).join('、')
      return `实例 ${mismatched.map((r) => r.instance_name).join('、')} 不属于任一归属网域（${domains}），请移除或补充网域`
    }
    return null
  }

  // {v3.22} 表单字段错误文案映射（提交生效失败时置顶 Alert 逐条展示，便于定位）
  const FIELD_LABEL: Record<string, string> = {
    job_name: 'Job 名称',
    job_type: 'Job 类型',
    // {v3.28} 决策 54：多网域集合字段
    network_domain_ids: '归属网域',
    resource_category: '资源类别',
    resource_type: '监控对象类型',
    exporter_template_id: '默认采集器',
    scrape_interval: '采集间隔',
    scrape_timeout: '采集超时',
    metrics_path: '采集路径',
    scheme: '协议',
    label_template_id: '标签模板',
    instance_selection_mode: '实例选择模式',
    blackbox_module: '拨测模块',
    // {v3.26} 决策 31：认证/TLS 字段
    auth_type: '认证类型',
    auth_username: '用户名',
    auth_password: '密码',
    auth_token: 'Token',
    ca_file: 'CA 证书文件',
  }

  // {v3.22} 决策 D29：提交生效（完整校验）——失败时置顶 Alert 逐条错误清单
  const handleSave = () => {
    setSubmitErrors([])
    form.validateFields().then(
      (values) => {
        const jobType = values.job_type as ScrapeJobType
        // {v3.28} 决策 54：网域集合（多选）
        const networkDomainIds = (values.network_domain_ids ?? []) as string[]
        // {v3.28} 决策 53：filter 模式——无静态实例清单，selected_instance_ids 置空；instance_filter 写入条件表达式
        const selMode = (values.instance_selection_mode as InstanceSelectionMode) ?? 'manual'
        const isFilterMode = selMode === 'filter'
        const effInstanceFilter: Record<string, unknown> | null = isFilterMode
          ? filterConds.length > 0
            ? { conditions: filterConds }
            : null
          : null
        const effSelectedIds = jobType === 'standard' ? (isFilterMode ? [] : targetKeys) : []

        // {v3.26} 决策 30：冻结（禁用）网域禁止新建 Job——提交时兜底校验（表单 Select 已置灰，此处防克隆/程序化命中）
        // {v3.28} 决策 54：任一选中网域被冻结即阻止新建
        const frozenHit = networkDomainIds.find((id) => isFrozenDomain(id))
        if (frozenHit) {
          const msg = `归属网域「${domainNameMap.get(frozenHit) ?? frozenHit}」已冻结（禁用），禁止新建采集 Job`
          setSubmitErrors([{ field: '归属网域', msg }])
          message.error(msg)
          return
        }

        if (jobType === 'blackbox') {
          if (blackboxTargets.length === 0) {
            setSubmitErrors([{ field: '拨测目标', msg: '请至少添加一个拨测目标' }])
            message.error('请至少添加一个拨测目标')
            return
          }
        } else {
          // {v3.28} 决策 54：多网域校验；决策 53：filter 模式无静态实例清单，不做实例一致性校验（实时求值）
          if (values.instance_selection_mode === 'manual') {
            const domainErr = validateDomainConsistency(networkDomainIds, targetKeys)
            if (domainErr) {
              setSubmitErrors([{ field: '实例选择', msg: domainErr }])
              message.error(domainErr)
              return
            }
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
        const { collector_mode, ...jobValues } = values
        void collector_mode

        // {v3.20} 决策 38-1：仅变更实例（targets/*.json）→ file_sd 自动热加载，免 reload、免人工确认；
        // 其余采集参数（job_name/resource_type/exporter/interval/timeout/path/scheme/标签模板）→ 触碰 prometheus.yml → 仍需走 M09 人工确认 + reload
        // {v3.26} 决策 31：认证/TLS 变更同样触碰 prometheus.yml（不影响 targets），故也判定为「非仅实例变更」→ 置 pending 走 M09 人工确认
        const authChanged = (() => {
          const norm = (v: unknown) => v ?? ''
          const oldAuth = {
            auth_type: editingJob.auth_type ?? 'none',
            auth_username: norm(editingJob.auth_username),
            auth_password: norm(editingJob.auth_password),
            auth_token: norm(editingJob.auth_token),
            tls_skip_verify: editingJob.tls_skip_verify ?? false,
            ca_file: norm(editingJob.ca_file),
          }
          const newAuth = {
            auth_type: (values.auth_type as AuthType) ?? 'none',
            auth_username: norm(values.auth_username),
            auth_password: norm(values.auth_password),
            auth_token: norm(values.auth_token),
            tls_skip_verify: (values.tls_skip_verify as boolean) ?? false,
            ca_file: norm(values.ca_file),
          }
          return JSON.stringify(oldAuth) !== JSON.stringify(newAuth)
        })()
        const configKeys: (keyof ScrapeJob)[] = [
          'job_name', 'resource_type',
          'scrape_interval', 'scrape_timeout', 'metrics_path', 'scheme', 'label_template_id',
        ]
        const configChanged = configKeys.some(
          (k) => JSON.stringify(editingJob[k]) !== JSON.stringify(values[k])
        )
        const onlyTargetsChanged = (() => {
          // {v3.28} 决策 53：filter 模式——实例变化 = 筛选表达式变化（targets 由 M09 每周期实时求值，走 file_sd 自动热加载）
          if (isFilterMode) {
            const filterChanged =
              JSON.stringify(editingJob.instance_filter ?? null) !== JSON.stringify(effInstanceFilter)
            return !configChanged && !authChanged && (filterChanged || (effInstanceFilter ?? null) !== null)
          }
          const oldInst = [...editingJob.selected_instance_ids].sort()
          const newInst = [...targetKeys].sort()
          if (JSON.stringify(oldInst) !== JSON.stringify(newInst)) {
            return !configChanged && !authChanged
          }
          return false
        })()

        const updated: ScrapeJob = {
          ...editingJob,
          ...jobValues,
          resource_type: values.resource_type as CiType,
          scheme: values.scheme as Scheme,
          // {v3.28} 决策 54：网域集合；决策 53：filter 模式无静态实例清单
          network_domain_ids: networkDomainIds,
          instance_selection_mode: selMode,
          selected_instance_ids: effSelectedIds,
          instance_filter: effInstanceFilter,
          blackbox_targets: jobType === 'blackbox' ? blackboxTargets : undefined,
          blackbox_module: jobType === 'blackbox' ? (values.blackbox_module as BlackboxModule) : undefined,
          exporter_status: exporterStatus,
          // 决策 14：保存当前表单中手动覆盖过的字段标记
          mapping_overrides: jobType === 'standard' ? overriddenFields : undefined,
          // {v3.20} 决策 38-1：仅实例变更 = 自动生效（保持已确认，无需 M09 确认）；其余变更 = 待确认
          change_status: onlyTargetsChanged ? 'confirmed' : 'pending',
          updated_at: now(),
        }
        setJobs((prev) => prev.map((j) => (j.job_id === editingJob.job_id ? updated : j)))
        if (onlyTargetsChanged) showAutoEffectToast('Job 已更新')
        else showChangePendingToast('Job 已更新')
      } else {
        const newJob: ScrapeJob = {
          job_id: `job-${Date.now()}`,
          job_name: values.job_name as string,
          job_type: jobType,
          resource_type: values.resource_type as CiType,
          exporter_template_id: exporterTemplateId,
          // {v3.28} 决策 54：网域集合；决策 53：filter 模式无静态实例清单
          network_domain_ids: networkDomainIds,
          instance_selection_mode: selMode,
          selected_instance_ids: effSelectedIds,
          instance_filter: effInstanceFilter,
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
          // {v3.26} 决策 31：认证/TLS 最小集（仅影响 prometheus.yml，不参与 targets）
          auth_type: (values.auth_type as AuthType) || 'none',
          auth_username: values.auth_username as string | undefined,
          auth_password: values.auth_password as string | undefined,
          auth_token: values.auth_token as string | undefined,
          tls_skip_verify: (values.tls_skip_verify as boolean) ?? false,
          ca_file: values.ca_file as string | undefined,
          // 决策 14：创建时对映射默认值做快照，记录同步时间；保存手动覆盖字段标记
          mapping_overrides: jobType === 'standard' ? overriddenFields : [],
          // {v3.19} 新建即置「待确认」（M09 变更单待确认，决策 D27-2）
          change_status: 'pending',
          mapping_synced_at: jobType === 'standard' ? now() : undefined,
          created_at: now(),
          updated_at: now(),
        }
        setJobs((prev) => [...prev, newJob])
        showChangePendingToast('Job 已新增')
      }
      closeDrawer()
      },
      (errInfo: { errorFields?: { name: (string | number)[]; errors: string[] }[] }) => {
        const errs: { field: string; msg: string }[] = []
        ;(errInfo.errorFields ?? []).forEach((f) => {
          const name = Array.isArray(f?.name) && f.name.length > 0 ? String(f.name[0]) : ''
          const msg = Array.isArray(f?.errors) && f.errors.length > 0 ? f.errors[0] : '该项为必填'
          errs.push({ field: FIELD_LABEL[name] ?? name, msg })
        })
        setSubmitErrors(errs)
        message.error(`提交生效失败：${errs.length} 处校验未通过，请修正后重试`)
      }
    )
  }

  // {v3.22} 决策 D29：保存草稿（v0.2）——仅基础校验（Job 名称必填），不校验完整采集参数；
  // 草稿不入下发管线（draft_status='draft'、change_status='none'），toast 后表单保持打开
  const handleSaveDraft = () => {
    const name = form.getFieldValue('job_name') as string | undefined
    if (!name?.trim()) {
      message.warning('请先填写 Job 名称以保存草稿')
      return
    }
    setSubmitErrors([])
    const jobType = (form.getFieldValue('job_type') as ScrapeJobType) ?? 'standard'
    // {v3.28} 决策 54：网域集合（多选）；filter 模式无静态实例清单、selected_instance_ids 置空
    const draftSelMode = (form.getFieldValue('instance_selection_mode') as InstanceSelectionMode) ?? 'manual'
    const draftDomainIds = (form.getFieldValue('network_domain_ids') as string[] | undefined) ?? ['default']
    const draftJob: ScrapeJob = {
      job_id: editingJob?.job_id ?? `job-draft-${Date.now()}`,
      job_name: name.trim(),
      job_type: jobType,
      resource_type: (form.getFieldValue('resource_type') as CiType) ?? 'host_linux',
      exporter_template_id: form.getFieldValue('exporter_template_id') as string | undefined,
      network_domain_ids: draftDomainIds,
      instance_selection_mode: draftSelMode,
      selected_instance_ids: jobType === 'standard' && draftSelMode !== 'filter' ? targetKeys : [],
      instance_filter: draftSelMode === 'filter' && filterConds.length > 0 ? { conditions: filterConds } : null,
      scrape_interval: (form.getFieldValue('scrape_interval') as string) ?? '15s',
      scrape_timeout: (form.getFieldValue('scrape_timeout') as string) ?? '10s',
      metrics_path: (form.getFieldValue('metrics_path') as string) ?? '/metrics',
      scheme: (form.getFieldValue('scheme') as Scheme) ?? 'http',
      label_template_id: form.getFieldValue('label_template_id') as string | undefined,
      relabel_configs: [],
      blackbox_module: jobType === 'blackbox' ? (form.getFieldValue('blackbox_module') as BlackboxModule) : undefined,
      blackbox_targets: jobType === 'blackbox' ? blackboxTargets : undefined,
      enabled: false,
      exporter_status: {},
      draft_status: 'draft',
      change_status: 'none',
      created_at: editingJob?.created_at ?? now(),
      updated_at: now(),
    }
    if (editingJob) {
      setJobs((prev) => prev.map((j) => (j.job_id === editingJob.job_id ? draftJob : j)))
    } else {
      setJobs((prev) => [...prev, draftJob])
    }
    setCloneSource(null)
    message.success('草稿已保存，当前配置不会进入下发管线（可继续编辑后提交生效）')
    // 表单保持打开，不关闭抽屉
  }

  // {v3.22} 决策 D29：批量提交生效（v0.2）——勾选多条 Job 一键生成变更并提交；
  // {v3.xx} F-16：批量提交面向「草稿」——草稿提交后进入下发管线（置为已提交 pending）；已生效/待下发项无需重复提交、已停用项须先启用
  const handleBatchSubmit = () => {
    const selected = jobs.filter((j) => selectedRowKeys.includes(j.job_id))
    if (selected.length === 0) return
    const ok: string[] = []
    const fail: { name: string; reason: string }[] = []
    selected.forEach((j) => {
      const s = getJobStatus(j)
      if (s === 'draft') ok.push(j.job_name)
      else if (s === 'disabled') fail.push({ name: j.job_name, reason: '已停用，请先启用后再提交生效' })
      else fail.push({ name: j.job_name, reason: '已生效或在待下发中，无需重复提交生效' })
    })
    // 乐观更新：草稿提交后置为已提交 + 待下发，等待 M09 变更单确认
    setJobs((prev) =>
      prev.map((j) =>
        selectedRowKeys.includes(j.job_id) && !fail.some((f) => f.name === j.job_name)
          ? {
              ...j,
              draft_status: 'submitted' as const,
              enabled: true,
              change_status: 'pending' as const,
              updated_at: now(),
            }
          : j
      )
    )
    setBatchResult({ ok, fail })
    setBatchDrawerOpen(true)
    setSelectedRowKeys([])
  }

  /** {v3.19} 保存/启停/删除后的动线引导（决策 D27-2，MVP 单域动线闭环）：
   *  {v3.22} 改为乐观更新 toast：本地先标为「待下发」，点击 toast 前往 M09「配置变更确认」页确认发布
   *  与全站其他 toast 保持一致——单行 message.success（不再内嵌按钮/竖排结构，避免高度与边框和其他提示框不一致） */
  const showChangePendingToast = (baseMsg: string) => {
    message.success({
      content: `${baseMsg}：已标为「待下发」，变更将由 M09 生成变更单，需确认后生效（点击本条前往配置变更确认）`,
      onClick: () => window.open(MODULE_LINKS.module09, '_blank'),
    })
  }

  /** {v3.20} 决策 38-1：仅新增/移除实例（targets/*.json 变更）→ file_sd 自动热加载，无需 reload、无需人工确认 */
  const showAutoEffectToast = (baseMsg: string) => {
    message.success(`${baseMsg}：实例变更已写入 targets/*.json，file_sd 自动热加载，立即可生效（无需 reload / 人工确认）`)
  }

  const handleToggleEnabled = (record: ScrapeJob, checked: boolean) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.job_id === record.job_id
          ? { ...j, enabled: checked, change_status: 'pending' as const, updated_at: now() }
          : j
      )
    )
    showChangePendingToast(checked ? 'Job 已启用' : 'Job 已禁用')
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
        showChangePendingToast('Job 已删除')
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
      // {v3.22} 状态列聚合四态（决策 D29）：草稿 / 待下发 / 已生效 / 已停用；
      // 草稿 MVP 无真实实例（v0.2 支持保存草稿）——灰显 + Tooltip；「待下发」与下发状态列联动
      title: '状态',
      key: 'status',
      width: 96,
      render: (_: unknown, record: ScrapeJob) => {
        const s = getJobStatus(record)
        if (s === 'draft') {
          return (
            <Tooltip title="v0.2 支持保存草稿：草稿不入下发管线，可继续编辑后提交生效">
              <Tag style={{ color: 'rgba(0,0,0,0.45)', background: '#fafafa', borderColor: '#d9d9d9' }}>草稿</Tag>
            </Tooltip>
          )
        }
        if (s === 'pending') return <Tag color="gold">待下发</Tag>
        if (s === 'active') return <Tag color="green">已生效</Tag>
        return <Tag>已停用</Tag>
      },
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
      key: 'network_domain_ids',
      // {v3.28} 决策 54：网域集合——按归属网域展示多个 Tag（跨网域复用）
      render: (_: unknown, record: ScrapeJob) => (
        <Space size={4} wrap>
          {record.network_domain_ids.map((id) => (
            <Tag key={id}>{domainNameMap.get(id) ?? id}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '实例选择 / 拨测目标',
      key: 'selection',
      // {v3.13} 收敛：standard 模式 + 实例数合成一个 Tag（「手动 · 12 实例」），比单看模式信息量更高
      // {v3.28} 决策 53：filter 模式显示「过滤 · N 条件（动态）」，不持有静态实例数
      render: (_: unknown, record: ScrapeJob) =>
        record.job_type === 'blackbox' ? (
          <Text type="secondary">{record.blackbox_targets?.length ?? 0} 个目标</Text>
        ) : record.instance_selection_mode === 'manual' ? (
          <Tag color="purple">
            手动 · {record.selected_instance_ids.length} 实例
          </Tag>
        ) : (
          <Tag color="geekblue">
            过滤 · {(record.instance_filter && Array.isArray(record.instance_filter.conditions))
              ? record.instance_filter.conditions.length
              : 0} 条件（动态）
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
    {
      // {v3.27}/{v3.28} 决策 47-2：Job 列表「实例采集状态」——简化为「在线 x / 总数 y」。
      // 数据源 = M02 targets 聚合 mock（列表级按 Job 过滤，只读消费，20s 自动刷新）；
      // 存在「待采集 / 已下发未采到」实例时整格高饱和；整格可点击进入详情抽屉查看各实例具体原因。
      title: (
        <Tooltip title="在线实例数 / 已选实例总数（数据由「查询中心」M02 按 Job 回显，本模块只读，约 20s 自动刷新）；存在未在线实例时整格高亮，点击查看详情原因">
          <Space size={4}>
            实例采集状态
            <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'collectionStatus',
      width: 190,
      render: (_: unknown, record: ScrapeJob) => {
        if (record.job_type === 'blackbox') return <Text type="secondary">-</Text>
        const st = collectionStatsOf(record.selected_instance_ids, mockTargetsCollection)
        const total = record.selected_instance_ids.length
        // {v3.28} 简化展示为「在线 x / 总数 y」，整格可点击进入详情抽屉查看各实例具体未在线原因（决策 47-2）
        const anomaly = st.down > 0 || st.pending > 0
        const onClick = () => setDetailJob(record)
        const text = `在线 ${st.up} / 总数 ${total}`
        if (total === 0) return <Text type="secondary">-</Text>
        return anomaly ? (
          <Tooltip title="存在「待采集 / 已下发未采到」实例，点击查看详情确认失败原因">
            <Tag
              color="#FF4C3A"
              style={{ marginInlineEnd: 0, cursor: 'pointer', fontWeight: 500 }}
              onClick={onClick}
            >
              {text}
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="点击查看各实例采集状态详情">
            <Tag
              color="green"
              style={{ marginInlineEnd: 0, cursor: 'pointer' }}
              onClick={onClick}
            >
              {text}
            </Tag>
          </Tooltip>
        )
      },
    },
    {
      // {v3.19} 下发状态（决策 D27-2，MVP）：pending=待确认（存在 M09 待确认变更单）→ 点击跳转配置变更确认；
      // confirmed=已确认；none/空=无变更。数据由 M09 变更单状态回写（pull 模式）
      title: (
        <Tooltip title="变更下发状态（来自 M09 变更单）：待确认=有变更单待你在「配置变更确认」页确认发布；已确认=变更单已确认；无变更=未产生变更单">
          <Space size={4}>
            下发状态
            <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'changeStatus',
      width: 130,
      render: (_: unknown, record: ScrapeJob) => {
        if (record.change_status === 'pending') {
          // {v3.20} 样式调整：原 warning Tag 易被误读为静态状态、看不出可点击；
          // 改为 link 型 Button + 箭头图标，明确「这是可前往确认的操作入口」
          return (
            <Tooltip title="存在待确认的配置变更单，点击前往 M09「配置变更确认」页确认发布">
              <Button
                type="link"
                size="small"
                icon={<ArrowRightOutlined />}
                style={{ padding: 0, height: 'auto', fontSize: 13 }}
                onClick={() => window.open(MODULE_LINKS.module09, '_blank')}
              >
                待确认
              </Button>
            </Tooltip>
          )
        }
        if (record.change_status === 'confirmed') return <Tag color="success">已确认</Tag>
        return <Text type="secondary">-</Text>
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
            // {v3.27} F-11：点击打开该 Job 对应映射的「更换/补配」轻量抽屉（收敛为唯一标签模板变更入口）
            <Tooltip title="该监控对象类型的默认采集配置尚未关联标签模板，点击立即补配">
              <Tag
                color="warning"
                style={{ cursor: 'pointer' }}
                onClick={() => mapping && openLabelSelect(mapping)}
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
      // {v3.xx} F-19：存在待确认变更单（change_status=pending）的 Job 启停置为禁用态，需先到配置变更确认页处理
      render: (value: boolean, record: ScrapeJob) =>
        record.change_status === 'pending' ? (
          <Tooltip title="存在待确认变更单，请先前往配置变更确认页处理">
            <Switch checked={value} size="small" disabled />
          </Tooltip>
        ) : (
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
      // {v3.22} 决策 D29：新增「克隆」（v0.2 角标）——复制源 Job 参数新建同/跨网域变体
      // {v3.xx} F-19：待确认（change_status=pending）Job 的「编辑 / 删除」置为禁用态，避免在有未处理变更单时叠加新变更
      render: (_: unknown, record: ScrapeJob) => (
        <Space size={2}>
          <Tooltip title={record.change_status === 'pending' ? '存在待确认变更单，请先前往配置变更确认页处理' : '编辑'}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              disabled={record.change_status === 'pending'}
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
          </Tooltip>
          <Tooltip title="克隆（v0.2 交付）：复制源 Job 采集参数新建；跨网域克隆时实例需重新选择、安装确认需重新进行">
            <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => openClone(record)}>
              克隆<V02Badge />
            </Button>
          </Tooltip>
          <Tooltip title="查看详情">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setDetailJob(record)} />
          </Tooltip>
          <Tooltip title={record.change_status === 'pending' ? '存在待确认变更单，请先前往配置变更确认页处理' : '删除'}>
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={record.change_status === 'pending'}
              onClick={() => handleDelete(record)}
            />
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
            类型级采集器指引与预设维护：每个监控对象类型该装什么采集器（默认/可选）、怎么装（安装指南）；创建采集 Job 时自动套用默认值；实例级安装确认在采集 Job 页选实例时进行
          </Text>
        ) : (
          <Text type="secondary">
            维护 Prometheus 采集任务与 blackbox 拨测任务；所有采集 Job 必须绑定单一网域，配置变更由配置中心下发；创建 Job 时自动套用该监控对象类型的默认采集配置
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
          {/* {v3.12} application_http 引导；{v3.19} 改 banner 紧凑窄条；{v3.20} 转 FieldGuide 轻量提示，与 Steps 搭配不突兀 */}
          <FieldGuide title="HTTP 应用 / 业务指标采集">
            <Text style={{ fontSize: 12 }}>
              无需安装独立采集器：业务服务（含自定义微服务）仍属 application_http；创建采集 Job 时端口 / 采集路径按应用实际 endpoint 手填，可选 Spring Boot actuator / Go / Python 等多个采集实现。
            </Text>
          </FieldGuide>
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
                          // {v3.27} F-11：同页直接打开本行「更换/补配」轻量抽屉（收敛为唯一标签模板变更入口）
                          onClick={() => openLabelSelect(record)}
                        >
                          补配
                        </Button>
                      </Space>
                    )
                  }
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
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, fontSize: 11 }}
                          icon={<SwapOutlined />}
                          onClick={() => openLabelSelect(record)}
                        >
                          更换
                        </Button>
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
            <Space size={8}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ backgroundColor: '#0ECDEB' }}
                onClick={openCreate}
              >
                新增 Job
              </Button>
              {/* {v3.22} 决策 D29：批量提交生效（v0.2）——勾选多条 Job 一键生成变更并提交，弹结果抽屉逐错误清单
                  {v3.xx} F-16：批量提交生效仅当选中项含「草稿」时可用（草稿不入下发管线，需手动提交生效；已生效/待下发项无需重复提交） */}
              <Tooltip
                title={
                  selectedRowKeys.length === 0
                    ? '请先勾选采集 Job（草稿）后再批量提交生效'
                    : '仅当选中项含草稿（draft）时可用：把多条草稿一起提交，进入 M09 下发管线'
                }
              >
                <Button
                  icon={<SendOutlined />}
                  disabled={
                    selectedRowKeys.length === 0 ||
                    !jobs.some((j) => selectedRowKeys.includes(j.job_id) && j.draft_status === 'draft')
                  }
                  onClick={handleBatchSubmit}
                >
                  批量提交生效<V02Badge />
                </Button>
              </Tooltip>
            </Space>
          </Col>
          <Col>
            <Space size={12}>
              {/* {v3.22} 状态器：四态聚合筛选；MVP 无真实草稿实例，「草稿」选项置灰禁用（v0.2 支持保存草稿） */}
              <Select
                placeholder="全部状态"
                style={{ width: 120 }}
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as 'all' | JobStatus)}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'active', label: '已生效' },
                  { value: 'pending', label: '待下发' },
                  { value: 'disabled', label: '已停用' },
                  { value: 'draft', label: '草稿', disabled: true },
                ]}
              />
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
                共 {visibleJobs.length} 个任务（标准{' '}
                {visibleJobs.filter((j) => j.job_type === 'standard').length} / 拨测{' '}
                {visibleJobs.filter((j) => j.job_type === 'blackbox').length}）
              </Text>
            </Space>
          </Col>
        </Row>

        <Table
          rowKey="job_id"
          dataSource={visibleJobs}
          columns={columns}
          // {v3.17} 列数多超出窗口：固定最小宽度、横向滚动，避免列挤压换行拉高行高
          // {v3.22} 决策 D29：新增「状态」列 + 多选列，最小宽度上浮；{v3.28} 新增「实例采集状态」列，最小宽度再上浮
          scroll={{ x: 1450 }}
          pagination={{ pageSize: 5 }}
          rowSelection={{
            // {v3.22} 决策 D29：多选批量提交；{v3.xx} F-16：草稿可勾选（批量提交生效仅当选中项含草稿时可用，
            // 用于把多条草稿一起提交进入下发管线）
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
          }}
        />
      </Card>
    )}

      {/* {v3.22} 批量提交生效结果抽屉（v0.2）：成功 N 条 / 失败 N 条逐错误清单 */}
      <Drawer
        title="批量提交生效结果"
        width={480}
        open={batchDrawerOpen}
        onClose={() => setBatchDrawerOpen(false)}
        extra={<Button onClick={() => setBatchDrawerOpen(false)}>关闭</Button>}
      >
        {batchResult && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <FieldGuide title={`批量处理结果：成功 ${batchResult.ok.length} 条 / 失败 ${batchResult.fail.length} 条`}>
              <Text>提交成功的 Job 已乐观标为「待下发」，将由 M09 生成变更单，需确认后生效</Text>
            </FieldGuide>
            {batchResult.ok.length > 0 && (
              <div>
                <Text strong>成功（{batchResult.ok.length}）：</Text>
                <List
                  size="small"
                  dataSource={batchResult.ok}
                  renderItem={(name) => (
                    <List.Item>
                      <Text>{name}</Text>
                    </List.Item>
                  )}
                />
              </div>
            )}
            {batchResult.fail.length > 0 && (
              <div>
                <Text strong type="danger">
                  失败（{batchResult.fail.length}）——逐错误清单：
                </Text>
                <List
                  size="small"
                  dataSource={batchResult.fail}
                  renderItem={(f) => (
                    <List.Item>
                      <Space>
                        <Text strong>{f.name}</Text>
                        <Text type="danger">{f.reason}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Space>
        )}
      </Drawer>


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
          {/* {v3.27} F-11：编辑态快照语义提示——变更仅影响新建 Job，不影响已存在 Job；存量 Job 采用新参数需到采集 Job 内手动「同步映射默认值」 */}
          {editingPreset && (
            <FieldGuide title="编辑默认采集配置的影响范围">
              <Text>本修改仅影响新建采集 Job（创建时自动套用新默认值）；已存在的 Job 不会自动变更。如需存量 Job 采用新参数，请在对应采集 Job 内手动「同步映射默认值」。</Text>
            </FieldGuide>
          )}
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
          {/* {v3.27} F-11：MappingDrawer 完全移除 label_template_id 字段（PRD §5.1）；标签模板唯一变更入口 = 列表「更换/补配」轻量抽屉（LabelTemplateSelectDrawer），见下方 Drawer */}
          {/* {v3.27} F-28：层叠默认 + 稀疏覆盖——默认采集配置采集参数字段可留空，留空=继承采集器模板/全局默认（15s/10s//metrics/http）；编辑态清空某字段 = 恢复继承 */}
          <FieldGuide title="采集参数可留空">
            <Text>任一项留空 = 继承采集器模板默认参数；保存时解析为该配置生效快照。</Text>
          </FieldGuide>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="默认端口" name="default_port">
                <InputNumber min={1} max={65535} placeholder="留空=继承采集器默认端口" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="采集路径" name="metrics_path">
                <Input placeholder="/metrics（留空=继承）" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="协议" name="scheme">
                <Select allowClear placeholder="http（留空=继承）">
                  {SCHEMES.map((s) => (
                    <Option key={s} value={s}>{s.toUpperCase()}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="采集间隔" name="scrape_interval">
                <Input placeholder="15s（留空=继承全局默认）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="采集超时" name="scrape_timeout">
                <Input placeholder="10s（留空=继承全局默认）" />
              </Form.Item>
            </Col>
          </Row>
          {/* {v3.16} D20：install_guide 单一来源 = 采集实现（ExporterTemplate），此处只读展示、不再编辑（映射行不持有该字段） */}
          <Form.Item
            label="安装指南（只读，归属采集实现）"
            extra="安装指南由采集实现持有并唯一维护；如需该监控对象类型的补充说明，另行维护类型级备注（install_notes）"
          >
            {watchPresetExporter && templateMap.get(watchPresetExporter)?.install_guide ? (
              <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap', display: 'block' }}>
                {templateMap.get(watchPresetExporter)?.install_guide}
              </Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {watchPresetExporter ? '该采集器未提供安装指南' : '未选择采集器'}
              </Text>
            )}
          </Form.Item>
        </Form>
      </Drawer>

      {/* {v3.27} F-11：标签模板「更换 / 补配」轻量抽屉——唯一变更入口；带入只读上下文，候选按资源类别过滤并高亮当前模板 */}
      <Drawer
        title="更换 / 补配标签模板"
        width={480}
        open={labelSelectOpen}
        onClose={closeLabelSelect}
        footer={
          <Space>
            <Button onClick={closeLabelSelect}>关闭</Button>
          </Space>
        }
      >
        {labelSelectMapping &&
          (() => {
            const cat = CI_TYPE_CATEGORY_MAP[labelSelectMapping.resource_type]
            const candidates = mockLabelTemplates.filter((t) => t.resource_category === cat)
            return (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="监控对象类型">
                    {CI_TYPE_LABEL[labelSelectMapping.resource_type]}
                  </Descriptions.Item>
                  <Descriptions.Item label="资源类别">{RESOURCE_CATEGORY_MAP[cat]}</Descriptions.Item>
                  <Descriptions.Item label="默认采集器">
                    {templateNameMap.get(labelSelectMapping.exporter_template_id) ??
                      labelSelectMapping.exporter_template_id}
                  </Descriptions.Item>
                  <Descriptions.Item label="当前标签模板">
                    {labelSelectMapping.label_template_id
                      ? labelNameMap.get(labelSelectMapping.label_template_id) ??
                        labelSelectMapping.label_template_id
                      : '未配置'}
                  </Descriptions.Item>
                </Descriptions>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  为该默认采集配置更换 / 补配标签模板（按资源类别过滤，由 Module_07 维护）：
                </Text>
                {candidates.length === 0 ? (
                  <FieldGuide title="该资源类别尚无标签模板">
                    <Space direction="vertical" size={4}>
                      <Text style={{ fontSize: 12 }}>
                        请先到 Module_07 创建该资源类别的标签模板，创建后采集 Job 将自动继承。
                      </Text>
                      <Typography.Link href={MODULE_LINKS.module07} style={{ fontSize: 12 }}>
                        前往标签模板管理（Module_07）→
                      </Typography.Link>
                    </Space>
                  </FieldGuide>
                ) : (
                  <List
                    size="small"
                    bordered
                    dataSource={candidates}
                    renderItem={(t) => {
                      const isCurrent = t.template_id === labelSelectMapping.label_template_id
                      return (
                        <List.Item
                          actions={[
                            isCurrent ? (
                              <Tag color="blue" key="cur">
                                当前
                              </Tag>
                            ) : (
                              <Button
                                key="pick"
                                type="link"
                                size="small"
                                onClick={() => {
                                  handlePresetLabelTemplateChange(labelSelectMapping, t.template_id)
                                  closeLabelSelect()
                                }}
                              >
                                选为默认
                              </Button>
                            ),
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space size={4}>
                                {t.name}
                                {t.is_default ? (
                                  <Tag color="gold" style={{ fontSize: 11 }}>
                                    默认
                                  </Tag>
                                ) : (
                                  <Tag style={{ fontSize: 11 }}>自定义</Tag>
                                )}
                              </Space>
                            }
                            description={`${RESOURCE_CATEGORY_MAP[t.resource_category]} · ${t.template_id} · ${t.mappings.length} 条映射`}
                          />
                        </List.Item>
                      )
                    }}
                  />
                )}
              </Space>
            )
          })()}
      </Drawer>

      <Drawer
        title={editingJob ? '编辑采集 Job' : '新增采集 Job'}
        width={760}
        open={drawerOpen}
        onClose={closeDrawer}
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            {/* {v3.22} 决策 D29：双按钮——保存草稿（v0.2，基础校验）/ 提交生效（完整校验） */}
            <Button icon={<SaveOutlined />} onClick={handleSaveDraft}>
              保存草稿<V02Badge />
            </Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSave}>
              提交生效
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
          {/* {v3.22} 提交生效失败：置顶 Alert 逐条错误清单（便于定位到具体字段） */}
          {submitErrors.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 16 }}
              message={`提交生效失败：${submitErrors.length} 处校验未通过`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {submitErrors.map((e) => (
                    <li key={e.field}>
                      <Text type="danger">
                        {e.field}：{e.msg}
                      </Text>
                    </li>
                  ))}
                </ul>
              }
            />
          )}
          {/* {v3.22} 决策 D29：克隆提示——同网域直接改选实例分组；跨网域实例清空重选、安装确认需重新进行 */}
          {cloneSource && (
            <FieldGuide title={`克隆自「${cloneSource.job_name}」`}>
              <Space direction="vertical" size={4}>
                <Text>已复制源 Job 的采集参数（采集器 / 间隔 / 超时 / 路径 / 协议 / 标签模板）。</Text>
                {buildIdentical(watchNetworkDomainId, cloneSource?.network_domain_ids) ? (
                  <Text type="secondary">同网域克隆：可直接调整实例分组后提交生效。</Text>
                ) : (
                  <Text type="warning">跨网域克隆：实例已清空重选，所选实例的「安装确认」需重新进行。</Text>
                )}
              </Space>
            </FieldGuide>
          )}
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
                name="network_domain_ids"
                rules={[{ required: true, message: '请至少选择一个网域' }]}
                // {v3.28} 决策 54：网域集合放宽——一个逻辑 Job 可勾选多个已纳管网域，M09 按域拆分扇出，跨网域复用不再依赖手工克隆
                extra="可勾选多个已纳管网域；实例/拨测目标按各自归属网域自动归组，配置中心按域拆分生成配置；未纳管网域需先到配置中心完成纳管"
              >
                {/* {v3.14} 决策 D1：网域选择器空态 = 说明文案 + 内联跳转 M09，避免等保存时才报错 */}
                <Select
                  mode="multiple"
                  placeholder="请选择一个或多个网域"
                  // {v3.28} 决策 54：允许编辑阶段调整网域集合（跨网域复用），不再禁用
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
                  onChange={(v: string[]) => {
                    setTargetKeys([])
                    // {v3.22} 决策 D29：跨网域克隆时实例清空重选 + 安装确认需重新进行
                    // {v3.28} 决策 54：网域集合比较
                    if (cloneSource && v.join(',') !== cloneSource.network_domain_ids.join(',')) {
                      message.warning('跨网域克隆：实例已清空，请重新选择目标网域实例；「安装确认」需对所选实例重新进行')
                    } else {
                      message.info('切换网域后已选实例已清空，实例必须归属任一已选网域')
                    }
                  }}
                >
                  {MONITORED_NETWORK_DOMAINS.map((d) => (
                    // {v3.26} 决策 30：冻结（禁用）网域显示但置灰不可选（Option disabled + Tooltip 说明）
                    <Option key={d.id} value={d.id} disabled={isFrozenDomain(d.id)}>
                      {d.frozen ? (
                        <Tooltip title="网域已冻结（禁用），禁止新建/纳管">
                          {d.name}（已冻结）
                        </Tooltip>
                      ) : (
                        d.name
                      )}
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
                <FieldGuide title="手填采集参数模式">
                  <Text style={{ fontSize: 12 }}>
                    不引用采集器默认值，请在下方直接填写采集参数（采集间隔 / 采集超时 / 协议 / 指标路径）；HTTP 应用等业务指标端点场景推荐此模式。
                  </Text>
                </FieldGuide>
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
                            <Tag color="default" style={{ fontSize: 11, marginInlineEnd: 0 }}>
                              {RESOURCE_CATEGORY_MAP[selectedLabelTemplate.resource_category]}
                            </Tag>
                            <Tooltip title={`模板 ID：${selectedLabelTemplate.template_id}`}>
                              <Text
                                code
                                type="secondary"
                                style={{
                                  fontSize: 11,
                                  maxWidth: 160,
                                  display: 'inline-block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  verticalAlign: 'middle',
                                }}
                              >
                                {selectedLabelTemplate.template_id}
                              </Text>
                            </Tooltip>
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
                        // 无标签模板时展示创建引导；区分「映射未配置模板（引导先补配采集映射，Job 自动继承）」与「用户未选择模板」
                        <FieldGuide title={mappingMissingTemplate ? '默认采集配置尚未关联标签模板' : '请选择标签模板'}>
                          {mappingMissingTemplate ? (
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
                                    onClick={() => currentTypeMapping && openLabelSelect(currentTypeMapping)}
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
                        </FieldGuide>
                      )}
                    </Space>
                  }
                >
                  <Select
                    placeholder="请选择标签模板"
                    allowClear
                    showSearch
                    optionFilterProp="children"
                    optionLabelProp="label"
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
                        // {v3.20} 标签模板选项改为两行（名称 + 类别/映射数），并用 optionLabelProp="label"
                        // 让选中后下拉框只显示短名称，避免字段被长文案撑爆
                        <Option key={t.template_id} value={t.template_id} label={t.name}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.4 }}>
                            <Text strong style={{ fontSize: 13 }}>{t.name}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {RESOURCE_CATEGORY_MAP[t.resource_category]} · {t.mappings.length} 条映射
                            </Text>
                          </div>
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
                // {v3.28} 决策 53：filter 选择模式提前 v0.2 开放
                extra="手动选择 = 手动勾选具体实例（候选按类型 + 网域自动收敛）；过滤规则 = 按资源属性条件筛选，新纳管匹配资源自动纳入采集，无需编辑 Job"
              >
                <Select disabled={isBlackbox}>
                  <Option value="manual">手动选择（实例）</Option>
                  <Option value="filter">过滤规则（动态）</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label={renderFieldLabel('scrape_interval', '采集/拨测间隔')}
                name="scrape_interval"
                // {v3.27} F-28：层叠默认 + 稀疏覆盖——采参数字段可留空，留空=继承下一层（默认采集配置 → 采集器模板 → 全局 15s）
                extra="留空=继承默认采集配置"
              >
                <Select allowClear placeholder="15s（留空=继承）">
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
                // {v3.27} F-28：留空=继承默认采集配置
                extra="留空=继承默认采集配置"
              >
                <Select allowClear placeholder="10s（留空=继承）">
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
                {/* {v3.27} F-28：协议留空=继承 */}
                <Form.Item label={renderFieldLabel('scheme', '协议')} name="scheme" extra="留空=继承">
                  <Select allowClear placeholder="http（留空=继承）">
                    {SCHEMES.map((s) => (
                      <Option key={s} value={s}>
                        {s}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                {/* {v3.27} F-28：指标路径留空=继承（采集器模板默认 /metrics） */}
                <Form.Item
                  label={renderFieldLabel('metrics_path', '指标路径')}
                  name="metrics_path"
                  extra="留空=继承"
                >
                  <Input placeholder="/metrics（留空=继承）" />
                </Form.Item>
              </Col>
            </Row>
          )}

          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {/* {v3.26} 决策 31：采集认证/TLS 最小集——折叠面板（默认折叠，不展开不增加裸 http 视觉负担）；
              仅影响 prometheus.yml（由 M09 映射进 scrape_configs），不参与 targets 判定；变更提交后置 change_status=pending 走 M09 人工确认 */}
          <Collapse
            ghost
            style={{ marginBottom: 8 }}
            items={[
              {
                key: 'auth-tls',
                label: <Text strong>认证与 TLS</Text>,
                children: (
                  <div>
                    <FieldGuide title="认证与 TLS 生效范围">
                      <Text>认证 / TLS 仅对 https 或需鉴权的目标生效，配置后由 M09 映射进 scrape_configs。</Text>
                    </FieldGuide>
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item
                          label="认证类型"
                          name="auth_type"
                          initialValue="none"
                          extra="无认证 / Basic 基本认证 / Bearer Token"
                        >
                          <Select>
                            <Option value="none">无认证（none）</Option>
                            <Option value="basic">Basic 基本认证</Option>
                            <Option value="bearer">Bearer Token</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          label="TLS 跳过证书校验"
                          name="tls_skip_verify"
                          valuePropName="checked"
                          initialValue={false}
                          extra="自签名 / 内网证书场景可开启"
                        >
                          <Switch />
                        </Form.Item>
                      </Col>
                    </Row>
                    {watchAuthType === 'basic' && (
                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Item
                            label="用户名"
                            name="auth_username"
                            rules={[
                              {
                                validator: (_, v) =>
                                  watchAuthType === 'basic' && !v
                                    ? Promise.reject(new Error('Basic 认证需填写用户名'))
                                    : Promise.resolve(),
                              },
                            ]}
                          >
                            <Input placeholder="Basic 认证用户名" />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            label="密码"
                            name="auth_password"
                            rules={[
                              {
                                validator: (_, v) =>
                                  watchAuthType === 'basic' && !v
                                    ? Promise.reject(new Error('Basic 认证需填写密码'))
                                    : Promise.resolve(),
                              },
                            ]}
                          >
                            <Input.Password placeholder="Basic 认证密码" />
                          </Form.Item>
                        </Col>
                      </Row>
                    )}
                    {watchAuthType === 'bearer' && (
                      <Form.Item
                        label="Token"
                        name="auth_token"
                        rules={[
                          {
                            validator: (_, v) =>
                              watchAuthType === 'bearer' && !v
                                ? Promise.reject(new Error('Bearer 认证需填写 Token'))
                                : Promise.resolve(),
                          },
                        ]}
                      >
                        <Input.Password placeholder="Bearer Token" />
                      </Form.Item>
                    )}
                    <Form.Item
                      label="CA 证书文件（可选）"
                      name="ca_file"
                      extra="仅供启用了 TLS 的 https 目标使用"
                    >
                      <Input placeholder="如 /etc/prometheus/certs/ca.crt" />
                    </Form.Item>
                  </div>
                ),
              },
            ]}
          />

          {watchMode === 'filter' && !isBlackbox && (
            <>
              <FieldGuide title="过滤规则（动态）">
                <Text style={{ fontSize: 12 }}>
                  按资源属性条件动态筛选实例；保存后配置中心每次配置生成周期对条件表达式**实时求值**，新纳管且匹配的资源自动进入采集，无需编辑 Job；不再匹配的资源自动移出。
                </Text>
              </FieldGuide>
              {/* {v3.28} 决策 53：条件表达式构建——字段 = Resource 属性字段（label 仅 UI 别名）；筛选不写任何标签、与标签管理正交 */}
              <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 8 }}>
                {filterConds.map((c, idx) => (
                  <Space key={idx} wrap align="center">
                    {/* AND 连接符（多条件之间为且） */}
                    {idx > 0 && <Text type="secondary" style={{ fontSize: 12 }}>且</Text>}
                    <Select
                      size="small"
                      style={{ width: 150 }}
                      value={c.field}
                      onChange={(f: FilterField) =>
                        setFilterConds((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, field: f } : x))
                        )
                      }
                      options={FILTER_FIELD_SELECTIONS}
                    />
                    <Select
                      size="small"
                      style={{ width: 110 }}
                      value={c.op}
                      onChange={(op: FilterOp) =>
                        setFilterConds((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, op } : x))
                        )
                      }
                      options={[
                        { value: 'eq', label: '等于' },
                        { value: 'neq', label: '不等于' },
                        { value: 'contains', label: '包含' },
                      ]}
                    />
                    <Input
                      size="small"
                      style={{ width: 180 }}
                      placeholder={`输入 ${FILTER_FIELD_LABEL[c.field]} 值`}
                      value={c.value}
                      onChange={(e) =>
                        setFilterConds((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x))
                        )
                      }
                    />
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => setFilterConds((prev) => prev.filter((_, i) => i !== idx))}
                    />
                  </Space>
                ))}
                <Space wrap>
                  <Button
                    size="small"
                    type="dashed"
                    icon={<PlusOutlined />}
                    disabled={!watchResourceType}
                    onClick={() =>
                      setFilterConds((prev) => [
                        ...prev,
                        { field: 'env', op: 'eq', value: '' },
                      ])
                    }
                  >
                    添加条件
                  </Button>
                  {filterConds.length > 0 && (
                    <Button size="small" type="link" onClick={() => setFilterConds([])}>
                      清空条件
                    </Button>
                  )}
                </Space>
              </Space>

              {/* {v3.28} 决策 53：实时求值预览——匹配实例清单（在线数）+ 新纳管自动纳入标注 */}
              <FieldGuide title={`匹配 ${filterMatching.matched.length} 个实例（在线，同类型 + 归属任一已选网域）`}>
                {filterMatching.matched.length > 0 ? (
                  <Text style={{ fontSize: 12 }}>
                    命中：{filterMatching.matched.slice(0, 8).map((r) => r.instance_name).join('、')}
                    {filterMatching.matched.length > 8 ? ` 等 ${filterMatching.matched.length} 个` : ''}
                  </Text>
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    当前条件下暂无匹配实例，请调整筛选条件或先确认已选网域下存在该类型的已纳管资源
                  </Text>
                )}
              </FieldGuide>
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                自动纳入：M07 后续新导入 / 同步的资源如匹配上述条件，将在配置中心下一配置生成周期自动进入本次采集，无需编辑 Job。
              </Text>
              <ReviewNote title="过滤规则">
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  <li>
                    `instance_filter` 筛选字段 = **Resource 属性字段**（env / cluster / app_name / business_domain），`label` 仅作 UI 别名（由标签模板映射只读派生），筛选**不写任何标签**、与标签管理正交（选择器 vs 描述器）。
                  </li>
                  <li>保存后 `instance_selection_mode=filter`，`selected_instance_ids` 置空（不持有静态实例清单）；M09 每配置生成周期对条件表达式实时求值，新匹配资源自动纳入 targets、不再匹配自动移出。
                  </li>
                  <li>筛选结果预览后写入 `instance_filter`（`{'{ conditions: [...] }'}`）；MVP 存量 single-domain Job 迁移为单元素 `network_domain_ids` 集合（决策 54）。
                  </li>
                </ul>
              </ReviewNote>
            </>
          )}
        </Form>

        {isBlackbox ? (
          <>
            <FieldGuide title="拨测目标">
              <Text style={{ fontSize: 12 }}>
                拨测目标内嵌在采集 Job 中，配置中心会据此生成拨测配置与对应抓取配置。
              </Text>
            </FieldGuide>
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
          // {v3.28} 决策 53：过滤模式无「手动勾选」清单（实时求值），仅手动选择模式渲染 Transfer
          watchMode === 'manual' &&
            watchResourceType && (
            <>
              <FieldGuide title="实例选择（自动带出候选）">
                <Text style={{ fontSize: 12 }}>
                  已按「资源类型 + Job 归属网域集合」自动收敛可选实例；支持一键全选 / 反选与关键字搜索；实例必须归属任一已选网域。
                </Text>
              </FieldGuide>
              {/* {v3.25} offline 排除提级 MVP 必实现（决策 29，对齐 Module_07 8.1 / Module_09 3.3）：候选集 offline 实例「显示但置灰不可选」；已选实例转 offline 后 M09 配置生成跳过；「未纳入任何 Job」筛选器为目标语义、MVP 不保证（或统一改指 Module_02 目标状态页） */}
              <ReviewNote title="实例候选集排除（offline 排除 MVP 必实现）">
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  <li>
                    **`offline` 排除（MVP 必实现，决策 29）**：候选集中 `Resource.status=offline` 实例**显示但置灰不可选**（保证下线台账可见、不可勾选，可观察左侧候选中的「已下线」标注）；已选实例转 `offline` 后 M09 配置生成跳过（`offline` 后下一配置生成周期即从 `targets/*.json` 移除，见 [Module_09 3.3 实例过滤](../../../../02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md)）。`maintenance` 排除口径与 [Module_07 8.1](../../../../02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md) 一并对齐（MVP 不保证）。
                  </li>
                  <li>
                    「未纳入任何 Job」筛选器为**目标语义**（MVP 不保证，随本模块落地）：用于快速发现未被任何 ScrapeJob 选中的实例；若沿用不落本模块则统一改指 Module_02 目标状态页。
                  </li>
                </ul>
              </ReviewNote>
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
                onChange={(next) => {
                  const nextKeys = next as string[]
                  // {v3.26} 决策 30：冻结（禁用）网域禁止新增该域实例（允许移除/禁用/编辑存量）——仅放行移除，拦截新增
                  // {v3.28} 决策 54：逐域判定——新增实例若归属冻结网域则拦截
                  const prevKeys = new Set(targetKeys)
                  const addedRes = nextKeys
                    .filter((k) => !prevKeys.has(k))
                    .map((k) => mockResources.find((r) => r.resource_id === k))
                    .filter((r): r is (typeof mockResources)[number] => !!r)
                  const frozenAdded = addedRes.filter((r) => isFrozenDomain(r.network_domain_id))
                  if (frozenAdded.length > 0) {
                    message.warning(
                      `网域「${frozenAdded.map((r) => domainNameMap.get(r.network_domain_id) ?? r.network_domain_id).join('、') || ''}」已冻结（禁用），禁止新增该域实例；仅允许移除或调整存量`
                    )
                    setTargetKeys(targetKeys.filter((k) => !nextKeys.includes(k)))
                    return
                  }
                  setTargetKeys(nextKeys)
                }}
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
            <Title level={5}>Exporter 安装登记（可选）</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              登记为可选项，不影响采集生效；采集状态以「采集状态」列为准。点击状态徽标填写安装登记信息。
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

        <FieldGuide title="高级 Relabel 管理（预留）">
          <Text style={{ fontSize: 12 }}>
            标签高能力处理（丢弃 / 保留 / 重写与正则替换等）将在后续开放，当前为预留入口。
          </Text>
        </FieldGuide>
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
                {/* {v3.28} 决策 54：网域集合展示 */}
                <Space size={4} wrap>
                  {detailJob.network_domain_ids.map((id) => (
                    <Tag key={id}>{domainNameMap.get(id) ?? id}</Tag>
                  ))}
                </Space>
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
                  // {v3.28} 决策 53：filter 模式展示条件表达式文案（不暴露「v0.3+」遗留）
                  <Space size={4} wrap>
                    <Tag color="geekblue">过滤 · 动态</Tag>
                    {detailJob.instance_filter && Array.isArray(detailJob.instance_filter.conditions)
                      ? (detailJob.instance_filter.conditions as FilterCond[])
                          .filter((c) => c && c.value !== '')
                          .map((c, i) => (
                            <Text key={i} type="secondary" style={{ fontSize: 12 }}>
                              {FILTER_FIELD_LABEL[c.field] ?? c.field}
                              {c.op === 'eq' ? '=' : c.op === 'neq' ? '≠' : '包含'}
                              {c.value}
                            </Text>
                          ))
                      : null}
                  </Space>
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
                      onClick={() => {
                        const m = getMapping(detailJob)
                        if (m) openLabelSelect(m)
                      }}
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
                  {/* {v3.27} 决策 47-2：实例采集状态回显——顶部汇总「在线 X / 总数 Y · 待采集 Z」+ 只读、20s 自动刷新 + 手动刷新；数据源 = M02 /api/v1/targets 代理 */}
                  <Space style={{ display: 'flex', flexWrap: 'wrap', marginBottom: 8 }} size={8}>
                    <Text strong style={{ fontSize: 12 }}>
                      在线 {detailStats?.up ?? 0} / 总数 {detailJob.selected_instance_ids.length}
                      {' · '}待采集 {detailStats?.pending ?? 0}
                      {(detailStats?.down ?? 0) > 0 && (
                        <Text type="danger" style={{ fontSize: 12 }}>
                          {' · '}已下发未采到 {detailStats?.down}
                        </Text>
                      )}
                    </Text>
                    <Button
                      size="small"
                      icon={<SyncOutlined />}
                      onClick={() => setStatusUpdatedAt(new Date().toLocaleTimeString())}
                    >
                      刷新
                    </Button>
                    {statusUpdatedAt && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        已更新 {statusUpdatedAt} · 20s 自动刷新
                      </Text>
                    )}
                  </Space>
                  {/* {v3.27} F-17：提示每个实例最终生成的 target labels 由标签模板按 资源实例属性 映射而来 */}
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                    各实例生成 Prometheus target 时的 labels 由标签模板（{detailJob.label_template_id ? labelNameMap.get(detailJob.label_template_id) : '（未绑定，则按实例属性直接生成）'}）按资源实例属性映射而来，不在此处展示。采集状态来自查询中心目标状态 API，本页只读。
                  </Text>
                  <List
                    bordered
                    size="small"
                    dataSource={detailJob.selected_instance_ids}
                    renderItem={(id) => {
                      const r = mockResources.find((res) => res.resource_id === id)
                      const runStatus = (mockTargetsCollection[id]?.status ?? 'unknown') as CollectionRunStatus
                      const runMeta = COLLECTION_STATUS_META[runStatus]
                      const run = mockTargetsCollection[id] as InstanceCollectionStatus | undefined
                      const statusTag =
                        runMeta.anomaly || runStatus === 'pending' ? (
                          <Tooltip
                            title={
                              runStatus === 'pending'
                                ? '待采集：已保存变更尚未下发或未首次抓取'
                                : `已下发未采到：${run?.last_error ?? ''}；配置已下发但未采集到数据，请检查采集器安装与网络连通`.trim()
                            }
                          >
                            <Tag color={runMeta.color}>{runMeta.label}</Tag>
                          </Tooltip>
                        ) : (
                          <Tag color={runMeta.color}>{runMeta.label}</Tag>
                        )
                      return (
                        <List.Item key={id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <Space wrap>
                            <Text strong>{r?.instance_name ?? id}</Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {r?.instance_ip}
                            </Text>
                          </Space>
                          {statusTag}
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
            <FieldGuide title="标签内容编辑">
              <Text style={{ fontSize: 12 }}>
                标签内容编辑的唯一入口在标签模板管理，本模块只读引用该模板；如需调整字段到标签的映射、克隆或删除模板，请前往标签模板管理。
              </Text>
            </FieldGuide>
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
          <FieldGuide title="自研采集器登记后即入池">
            <Text style={{ fontSize: 12 }}>
              登记完成后，该采集器与平台预置采集器同等待遇——可被默认采集配置引用、创建 Job 时预填参数、可走实例级安装确认。
            </Text>
          </FieldGuide>
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
          <Form.Item label="来源" name="source" rules={[{ required: true }]} initialValue="internal" extra="官方/第三方/自研采集器均可登记；与平台预置采集器同名时由系统返回冲突提示">
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
                extra="按实际部署填写"
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="采集路径"
                name="metrics_path"
                rules={[{ required: true, message: '请输入路径' }]}
                extra="按实际部署填写"
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
