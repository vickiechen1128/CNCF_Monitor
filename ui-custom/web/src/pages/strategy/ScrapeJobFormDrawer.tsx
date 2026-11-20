import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Form,
  Input,
  List,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useNavigate } from 'react-router-dom'
import { networkDomainApi } from '../../api/domain'
import { labelTemplateApi } from '../../api/labelTemplates'
import { scrapeJobApi, type ScrapeJobInput } from '../../api/scrapeJobs'
import { blackboxModuleApi, type BlackboxModule } from '../../api/blackboxModules'
import { triggerConfigDrafts } from '../config-center/preview/triggerConfigDraft'
import type { NetworkDomain } from '../../types/domain'
import type { JobType } from '../../types/strategy'
import type { ScrapeJob, ScrapeJobInstanceItem } from '../../types/strategy'
import type { ResourceCategory } from '../../types/resource'
import type { LabelTemplateListItem } from '../../types/label'
import type { CollectionTemplate, Selector } from '../../types/collectionTemplate'
import { EMPTY_SELECTOR, normalizeSelector } from '../../types/collectionTemplate'
import {
  CATEGORY_MAP,
  BLACKBOX_CATEGORIES,
  BLACKBOX_TARGET_FIELD_LABEL,
} from './strategyConstants'
import { useCandidateFields, useCollectionTemplateCatalog } from './useCollectionTemplateCatalog'
import { SelectorEditor } from './SelectorEditor'
import { AuthTlsFields, ScrapeParamFields } from './JobParamsFields'
import { InstanceSelector } from './InstanceSelector'
import { ExporterInstallationPanel } from './ExporterInstallationPanel'

/**
 * 表单值 = 提交后端的字段 + 仅用于联动展示的 `resource_category`。
 *
 * M01 v1.5 起任务不再有「监控对象类型」：标准采集由「采集模板」决定资源类别与默认参数，
 * 「采哪些对象」由任务自己的 selector 表达。
 */
type ScrapeJobFormValues = Omit<ScrapeJobInput, 'resource_category' | 'resource_type'> & {
  resource_category?: ResourceCategory
  resource_type?: ResourceCategory
}

const { Text, Link } = Typography

/** 参数继承来源 Tag（标准采集：模板带出 / 手动覆盖 / 待同步） */
function ParamsSyncTag({ state }: { state: 'inherited' | 'overridden' | 'pending' | 'none' }) {
  if (state === 'inherited') return <Tag>模板带出</Tag>
  if (state === 'overridden') return <Tag color="blue">已覆盖</Tag>
  if (state === 'pending') return <Tag color="orange">待同步</Tag>
  return null
}

/** {T01-P6} 生效端口来源中文标注（提案 resource-scrape-port-chain §5.3 四种来源） */
const PORT_SOURCE_META: Record<string, { label: string; color: string }> = {
  instance: { label: '实例覆盖', color: 'green' },
  mapping: { label: '类型默认', color: 'blue' },
  template: { label: '采集器默认', color: 'cyan' },
  business: { label: '业务端口兜底', color: 'orange' },
}

/** {T01-P6} business 兜底警示文案（D-4：后端恒 200，警示纯前端职责、不阻断任何操作） */
const BUSINESS_PORT_TOOLTIP = '采集端口未配置，当前以业务端口兜底，请确认 exporter 是否监听该端口'

/**
 * {T01-P6} 生效端口只读回显单元（提案 §5.3）：
 * - 端口：`port=0`（unresolved/未解析）展示 `-` 而非 0（§9 失败态口径）；
 * - 来源：四种中文标注，business 附「⚠️」+ 警示 Tooltip（不阻断）；
 * - 引导：来源非「实例覆盖」（= 生效端口与实例登记不一致）时给「前往 M07 修改」入口；
 * - `port_source` 为空（blackbox / 旧数据）不渲染任何内容。
 */
function PortEcho({ item, onGoResources }: { item: ScrapeJobInstanceItem; onGoResources: () => void }) {
  const source = item.port_source
  if (!source) return null
  const meta = PORT_SOURCE_META[source]
  const mismatch = source !== 'instance'
  return (
    <Space size={4} wrap>
      <Text type="secondary" style={{ fontSize: 12 }}>
        生效端口
      </Text>
      <Text code>{item.port ? item.port : '-'}</Text>
      {source === 'business' ? (
        <Tooltip title={BUSINESS_PORT_TOOLTIP}>
          <Tag color="orange" style={{ cursor: 'pointer' }}>
            {meta.label} ⚠️
          </Tag>
        </Tooltip>
      ) : meta ? (
        <Tag color={meta.color}>{meta.label}</Tag>
      ) : null}
      {mismatch && <Link onClick={onGoResources}>前往 M07 修改</Link>}
    </Space>
  )
}

/** 采集模板下拉选项文案：`名称（资源类别）` */
function templateOptionLabel(template: CollectionTemplate): string {
  const category = CATEGORY_MAP[template.resource_category as ResourceCategory] ?? template.resource_category
  return `${template.name}（${category}）`
}

interface ScrapeJobFormDrawerProps {
  open: boolean
  /** 编辑态传行 record；新增态为 null */
  record?: ScrapeJob | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 采集 Job 编辑抽屉（Module_01 SRS v1.5 / §5.4 / §9.1 / §11.1/§11.2，F4）。
 * - 采集模板带出资源类别 / 采集器 / 标签模板 / 采集参数（可覆盖，保留 override UX）；
 * - 「采哪些对象」用统一 SelectorEditor，未改动时按模板推荐条件（default_selector）预填；
 * - 网域下拉=已纳管非冻结；job_type standard/blackbox 切换（blackbox 无模板/选择器）；
 * - 认证TLS折叠面板；标签模板卡片式选择（按资源类别过滤）；标准 Job 内嵌实例选择器与安装确认面板。
 */
export function ScrapeJobFormDrawer({ open, record, onCancel, onSuccess }: ScrapeJobFormDrawerProps) {
  const navigate = useNavigate()
  const { templates } = useCollectionTemplateCatalog()
  const { fields } = useCandidateFields()
  const [form] = Form.useForm<ScrapeJobFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [collectorMode, setCollectorMode] = useState<'default' | 'manual'>('default')
  const [paramsState, setParamsState] = useState<'inherited' | 'overridden' | 'pending' | 'none'>('none')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateListItem[]>([])
  // 模板列表加载状态：未加载完成 / 加载失败时禁止提交（避免静默提交空模板）
  const [labelTemplatesLoading, setLabelTemplatesLoading] = useState(false)
  const [labelTemplatesFailed, setLabelTemplatesFailed] = useState(false)
  // {T01-P6} 编辑态生效端口回显数据（GET /instances 的 port/port_source，仅 standard 分支渲染）
  const [portEchoItems, setPortEchoItems] = useState<ScrapeJobInstanceItem[]>([])
  const [blackboxModules, setBlackboxModules] = useState<BlackboxModule[]>([])
  // 「采哪些对象」选择器：独立受控状态（SelectorEditor 不是 Form 字段）
  const [selector, setSelector] = useState<Selector>(EMPTY_SELECTOR)
  // 用户是否动过选择器：动过之后切换模板不再覆盖用户条件
  const [selectorTouched, setSelectorTouched] = useState(false)
  // 当前选择器是否来自模板推荐条件（展示「已按模板推荐条件预填，可修改」）
  const [selectorPrefilled, setSelectorPrefilled] = useState(false)

  const isEdit = !!record
  // 任务类型分支状态：编辑态由 record.job_type 直接决定（确定性，不依赖
  // Form.useWatch 在 setFieldsValue 后的异步翻转——该异步翻转在真实浏览器中
  // 偶发不触发，导致拨测 Job 编辑时仍停留在「采集」分支、已填的拨测信息不回显）。
  // 新增态初值 standard，由下方 Radio onChange 切换。
  const [jobType, setJobType] = useState<JobType>(record?.job_type ?? 'standard')
  const templateCode = Form.useWatch('template_code', form) as string | undefined
  const formResourceCategory = Form.useWatch('resource_category', form) as ResourceCategory | undefined
  const blackboxCategory = Form.useWatch('resource_type', form) as ResourceCategory | undefined
  const networkDomainId = (Form.useWatch('network_domain_id', form) as string | undefined) ?? ''

  // 可选模板：仅启用项；label 为「名称（类别）」
  const templateOptions = useMemo(
    () =>
      templates
        .filter((template) => template.enabled)
        .map((template) => ({ value: template.code, label: templateOptionLabel(template) })),
    [templates],
  )
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.code === templateCode),
    [templates, templateCode],
  )

  // F1-4：按当前资源类别过滤可选的标签模板（卡片式）。
  // 标准采集类别来自采集模板（目录未就绪时回落到表单值）；拨测类别取 resource_type。
  const resourceCategory = useMemo<ResourceCategory | undefined>(() => {
    if (jobType === 'blackbox') return blackboxCategory
    return selectedTemplate?.resource_category ?? formResourceCategory
  }, [jobType, blackboxCategory, selectedTemplate, formResourceCategory])
  const filteredLabelTemplates = useMemo(
    () => labelTemplates.filter((t) => t.resource_category === resourceCategory),
    [labelTemplates, resourceCategory],
  )

  // 打开抽屉时装载网域与初始值
  useEffect(() => {
    if (!open) return
    // 异步请求回调内 setState；沿用本模块既有 set-state-in-effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    // 编辑态分支由 record 决定（确定性），避免依赖 useWatch 异步翻转导致回显失败
    setJobType(record ? (record.job_type as JobType) : 'standard')
    networkDomainApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setDomains((res.data?.list ?? []).filter((d) => d.is_monitored && d.status === 'enabled')))
      .catch(() => setDomains([]))
    // F1-4：装载标签模板（卡片式选择按资源类别过滤）。
    // 记录加载中 / 失败：未拿到模板时提交会被拦截，不能静默提交空模板。
    setLabelTemplatesLoading(true)
    setLabelTemplatesFailed(false)
    labelTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setLabelTemplates(res.data?.list ?? []))
      .catch(() => {
        setLabelTemplates([])
        setLabelTemplatesFailed(true)
      })
      .finally(() => setLabelTemplatesLoading(false))
    form.resetFields()
    setPortEchoItems([])
    setSelector(EMPTY_SELECTOR)
    setSelectorTouched(false)
    setSelectorPrefilled(false)
    setParamsState('none')
    if (record) {
      setSelectedIds(record.selected_instance_ids ?? [])
      form.setFieldsValue({
        job_name: record.job_name,
        job_type: record.job_type,
        // 标准采集：采集模板（编辑态不回填模板默认参数，保留 Job 快照）
        template_code: record.template_code || undefined,
        resource_category: (record.resource_category as ResourceCategory | undefined) ?? undefined,
        exporter_template_id: record.exporter_template_id,
        network_domain_id: record.network_domain_id,
        scrape_interval: record.scrape_interval,
        scrape_timeout: record.scrape_timeout,
        metrics_path: record.metrics_path,
        scheme: record.scheme,
        // 存量任务可能没有 label_template_id；空值时由用户按需选择
        label_template_id: record.label_template_id ?? '',
        auth_type: record.auth_type,
        username: record.username,
        // 认证密文仅存储不回显（决策31）：编辑回填 token/password 一律置空，仅保留 auth 类型选择与密文占位说明
        token: undefined,
        tls_skip_verify: record.tls_skip_verify,
        ca_file: record.ca_file,
        blackbox_module: record.blackbox_module,
        // 拨测目标改走资源选择：回显用户选定的资源类别，目标清单由 selected_instance_ids
        // 还原（见上方 setSelectedIds），不再回填 blackbox_targets（手填入口已彻底禁用）。
        // target_field 无表单字段可回显 —— 它由 resource_type 写死推导（服务端落库）。
        resource_type: (record.resource_type || undefined) as ResourceCategory | undefined,
        password: undefined,
      })
      // 编辑态：选择器以 Job 快照为准，视为「已改动」，切换模板不覆盖
      setSelector(normalizeSelector(record.selector))
      setSelectorTouched(true)
      setParamsState((record.mapping_overrides?.length ?? 0) > 0 ? 'pending' : 'none')
    } else {
      setSelectedIds([])
      form.setFieldsValue({
        job_type: 'standard',
        auth_type: 'none',
        tls_skip_verify: false,
        exporter_template_id: undefined,
        label_template_id: '',
        template_code: undefined,
        resource_category: undefined,
      } as Partial<ScrapeJobFormValues>)
    }
    // catalog 仅提供模板解析；模板目录加载完成后不应重跑「重置表单」逻辑，否则会清掉用户已填内容
  }, [open, record, form])

  useEffect(() => {
    if (!open || jobType !== 'blackbox') return
    let cancelled = false
    blackboxModuleApi
      .list()
      .then((res) => {
        if (!cancelled) setBlackboxModules(res.data?.list ?? [])
      })
      .catch(() => {
        if (!cancelled) setBlackboxModules([])
      })
    return () => {
      cancelled = true
    }
  }, [open, jobType])

  // {T01-P6} 编辑态拉取生效端口回显（GET /instances 携带 port/port_source）。
  // 仅编辑态 + standard 拉取；失败静默（回显为增强信息，不阻断表单主流程）。
  useEffect(() => {
    if (!open || !record || jobType !== 'standard') return
    let cancelled = false
    scrapeJobApi
      .instances(record.id)
      .then((res) => {
        if (!cancelled) setPortEchoItems(res.data?.items ?? [])
      })
      .catch(() => {
        if (!cancelled) setPortEchoItems([])
      })
    return () => {
      cancelled = true
    }
  }, [open, record, jobType])

  /**
   * 采集模板变化 → 带出资源类别 / 采集器 / 标签模板 / 采集参数（均可再改）。
   * 选择器：用户尚未改动过时按模板推荐条件（default_selector）预填。
   */
  const handleTemplateChange = useCallback(
    (code?: string) => {
      const template = templates.find((item) => item.code === code)
      // 换模板 = 候选类别可能变化，已选实例不再适用
      setSelectedIds([])
      if (!template) {
        form.setFieldsValue({
          resource_category: undefined,
          exporter_template_id: undefined,
          label_template_id: '',
        })
        setParamsState('none')
        setSelector(EMPTY_SELECTOR)
        setSelectorPrefilled(false)
        return
      }
      form.setFieldsValue({
        resource_category: template.resource_category,
        exporter_template_id: template.exporter_template_id,
        label_template_id: template.label_template_id || '',
        // 参数按模板预填（可覆盖；清空 = 回到模板/全局继承）
        scrape_interval: template.scrape_interval || '',
        scrape_timeout: template.scrape_timeout || '',
        metrics_path: template.metrics_path || '',
        scheme: template.scheme || '',
      })
      setCollectorMode('default')
      setParamsState('inherited')
      if (!selectorTouched) {
        const recommended = normalizeSelector(template.default_selector)
        setSelector(recommended)
        setSelectorPrefilled(recommended.filters.length > 0)
      }
    },
    [templates, form, selectorTouched],
  )

  /** 选择器编辑：之后切换模板不再覆盖用户条件 */
  const handleSelectorChange = useCallback((next: Selector) => {
    setSelector(next)
    setSelectorTouched(true)
    setSelectorPrefilled(false)
  }, [])

  // F-28：参数字段 placeholder = 继承链下层生效值提示（采集模板 → 采集器/全局兜底）
  const paramPlaceholders: Record<string, string> = {
    scrape_interval: selectedTemplate?.scrape_interval
      ? `留空继承采集模板（${selectedTemplate.scrape_interval}）`
      : '留空使用全局默认（15s）',
    scrape_timeout: selectedTemplate?.scrape_timeout
      ? `留空继承采集模板（${selectedTemplate.scrape_timeout}）`
      : '留空使用全局默认（10s）',
    metrics_path: selectedTemplate?.metrics_path
      ? `留空继承采集模板（${selectedTemplate.metrics_path}）`
      : '留空继承采集器默认（/metrics）',
    scheme: selectedTemplate?.scheme
      ? `留空继承采集模板（${selectedTemplate.scheme}）`
      : '留空继承采集器默认（http）',
  }

  // 将表单值组装为请求体；draftStatus 决定是「保存草稿」还是「提交生效」。
  const buildBody = useCallback(
    (values: ScrapeJobFormValues, draftStatus: 'draft' | 'ready'): ScrapeJobInput => {
      const isBlackbox = values.job_type === 'blackbox'
      const body: ScrapeJobInput = {
        job_name: values.job_name,
        job_type: values.job_type ?? 'standard',
        network_domain_id: values.network_domain_id ?? '',
        // M01 v1.5：标准采集提交采集模板 + 任务自己的选择器；拨测无模板/选择器（显式清空）
        template_code: isBlackbox ? '' : values.template_code ?? '',
        selector: isBlackbox ? { ...EMPTY_SELECTOR } : normalizeSelector(selector),
        // F-28：采集参数可留空（留空=继承）。空值显式归一为 '' 提交——编辑态清空字段
        // 即「恢复继承」，后端保存时按 模板→采集器→全局 链重新解析生效快照。
        scrape_interval: values.scrape_interval || '',
        scrape_timeout: values.scrape_timeout || '',
        metrics_path: values.metrics_path || '',
        scheme: values.scheme || '',
        auth_type: values.auth_type ?? 'none',
        username: values.username,
        password: values.password,
        token: values.token,
        tls_skip_verify: values.tls_skip_verify ?? false,
        ca_file: values.ca_file,
        label_template_id: values.label_template_id || '',
        draft_status: draftStatus,
        enabled: true,
      }
      if (isBlackbox) {
        body.blackbox_module = values.blackbox_module
        // 拨测目标改走资源选择：目标地址 = 所选实例在「该类别写死的探测地址字段」上的值
        // （接口服务→接口地址、应用服务→健康检查 URL）。只提交类别，target_field 由服务端
        // 推导；手填入口已彻底禁用（后端同样拒绝 blackbox_targets 写入）。
        body.resource_type = values.resource_type
        body.selected_instance_ids = selectedIds
      } else {
        // 标准采集：资源类别由采集模板决定（表单已联动写入）
        body.resource_category = values.resource_category ?? selectedTemplate?.resource_category
        body.exporter_template_id = values.exporter_template_id
        body.selected_instance_ids = selectedIds
      }
      return body
    },
    [selectedIds, selector, selectedTemplate],
  )

  // 保存草稿：仅基础校验（job_name / job_type），不进入 M09 变更管线。
  // 用 form.getFieldsValue() 补全已填字段（如 network_domain_id），避免 validateFields(nameList)
  // 只返回指定字段导致选中的网域丢失。
  const handleSaveDraft = async () => {
    try {
      await form.validateFields(['job_name', 'job_type'])
    } catch {
      return
    }
    const values = form.getFieldsValue()
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = buildBody(values, 'draft')
      await scrapeJobApi.create(body)
      message.success('已保存为草稿')
      setSubmitting(false)
      onSuccess()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '保存草稿失败，请稍后重试')
      setSubmitting(false)
    }
  }

  // 提交生效（编辑/新建）：完整校验并进入 M09 变更管线。
  const handleSubmitReady = async () => {
    let values: ScrapeJobFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    // 标准采集必须选采集模板（否则后端拒绝 template_code 为空）
    if ((values.job_type ?? 'standard') === 'standard' && !values.template_code) {
      message.error('请选择采集模板')
      return
    }
    // 标签模板是提交的硬前置：列表未加载/加载失败/数据异常/未选中时一律拦截，
    // 不允许静默提交空模板（否则任务会没有任何模板标签，且不报错）。
    if (labelTemplatesLoading) {
      message.error('标签模板正在加载，请稍后重试')
      return
    }
    if (labelTemplatesFailed) {
      message.error('标签模板加载失败，请关闭抽屉后重试')
      return
    }
    // 选择自定义模板时必须属于当前资源类别；空值表示不使用模板，仅保留系统注入标签。
    if (values.label_template_id && !filteredLabelTemplates.some((t) => String(t.id) === String(values.label_template_id))) {
      message.error('所选标签模板不属于当前资源类别，请重新选择')
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = buildBody(values, 'ready')
      if (isEdit && record) {
        await scrapeJobApi.update(record.id, body)
      } else {
        await scrapeJobApi.create(body)
      }
      // 即时性优化：保存成功后立刻同步触发变更单生成（best-effort，失败静默兜底）。
      // 检测闭环不依赖它——M09 §3.3.3 30s 自动变更检测兜底；GenerateDraft 同域活
      // pending 保活约束保证不会重复生成（决策 42-1）。
      if (values.network_domain_id) {
        void triggerConfigDrafts([values.network_domain_id], { onNavigate: () => navigate('/config-preview') })
      }
      setSubmitting(false)
      onSuccess()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      setSubmitting(false)
    }
  }

  /**
   * 标签模板选择区（采集 / 拨测共用）。
   * 采集 Job 的类别来自采集模板，拨测 Job 的类别来自 resource_type；
   * 不选择具体模板时后端回落到该类别默认模板，故空选项明确文案为「使用默认标签模板」。
   */
  const renderLabelTemplateSection = () => (
    <Form.Item
      label="标签模板"
      extra={
        resourceCategory
          ? '默认取采集模板配置；可选择自定义模板（仅保留系统注入标签时不使用模板）'
          : '选择采集模板后列出可用标签模板'
      }
    >
      {resourceCategory && labelTemplatesLoading ? (
        <Text type="secondary">标签模板加载中…</Text>
      ) : resourceCategory && labelTemplatesFailed ? (
        <Alert
          type="error"
          showIcon
          message="标签模板加载失败"
          description="模板列表未加载成功时无法提交，请关闭抽屉后重试。"
        />
      ) : resourceCategory ? (
        <Form.Item name="label_template_id" noStyle>
          <Radio.Group buttonStyle="solid" style={{ width: '100%' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Radio.Button value="" style={{ width: '100%', textAlign: 'left' }}>
                <Text type="secondary">不使用标签模板</Text>
              </Radio.Button>
              {filteredLabelTemplates.map((t) => (
                <Radio.Button
                  key={t.id}
                  value={String(t.id)}
                  style={{ width: '100%', height: 'auto', padding: '8px 12px', whiteSpace: 'normal', textAlign: 'left' }}
                >
                  <Space size={6} direction="vertical" align="start">
                    <Text strong>{t.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {CATEGORY_MAP[t.resource_category]} · {t.mappings?.length ?? 0} 条映射
                    </Text>
                  </Space>
                </Radio.Button>
              ))}
            </Space>
          </Radio.Group>
        </Form.Item>
      ) : (
        <Text type="secondary">选择采集模板后列出可用标签模板</Text>
      )}
    </Form.Item>
  )

  return (
    <Drawer
      title={isEdit ? `编辑采集任务 ${record?.job_name ?? ''}` : '新增采集任务'}
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={640}
      // forceRender：Drawer 首次打开时内容惰性挂载（rc-drawer 动画期先于父组件
      // useEffect 的 setFieldsValue 完成挂载），导致编辑回显首次为空、二次才出现；
      // forceRender 保证 Form 常驻挂载，首次打开即正确回显（#19 同源问题，采集 Job 抽屉）。
      forceRender
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          {isEdit ? (
            <Button type="primary" loading={submitting} disabled={submitting} onClick={() => void handleSubmitReady()}>
              保存
            </Button>
          ) : (
            <>
              <Button loading={submitting} disabled={submitting} onClick={() => void handleSaveDraft()}>
                保存草稿
              </Button>
              <Button type="primary" loading={submitting} disabled={submitting} onClick={() => void handleSubmitReady()}>
                提交生效
              </Button>
            </>
          )}
        </Space>
      }
    >
      {submitError && (
        <Alert type="error" showIcon message="保存失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      <Form
        form={form}
        layout="vertical"
        requiredMark
        // 不要用 preserve={false}：standard/blackbox 分支切换卸载时会连带删除
        // network_domain_id/blackbox_* 等值，且 StrictMode 开发态 StrictEffects
        // 模拟卸载会二次删除，导致编辑态回显清空。提交语义不受影响：
        // getFieldsValue()/validateFields() 仅收集已挂载字段，buildBody 按 job_type 显式组装。
        initialValues={{ job_type: 'standard', auth_type: 'none', tls_skip_verify: false, label_template_id: '' }}
      >
        <Row gutter={16}>
          <Col span={14}>
            <Form.Item label="Job 名称" name="job_name" rules={[{ required: true, message: '请输入 Job 名称' }]}>
              <Input placeholder="例如：prod-mysql-01" maxLength={64} />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item label="任务类型" name="job_type" rules={[{ required: true }]}>
              <Radio.Group
                buttonStyle="solid"
                onChange={(e) => {
                  const nextType = e.target.value as JobType
                  setJobType(nextType)
                  // 采集 / 拨测的资源类别不同，切换任务类型后回到「使用默认标签模板」，避免跨类别残留
                  form.setFieldsValue({ label_template_id: '', template_code: undefined })
                  // 拨测没有采集模板与选择器：切换时一并清空，避免把标准采集的条件带过去
                  setSelector(EMPTY_SELECTOR)
                  setSelectorTouched(false)
                  setSelectorPrefilled(false)
                  setSelectedIds([])
                }}
              >
                <Radio.Button value="standard">采集</Radio.Button>
                <Radio.Button value="blackbox">拨测</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Col>
        </Row>

        {jobType === 'standard' ? (
          <>
            {/* 资源类别由采集模板决定，仅作为隐藏提交字段 */}
            <Form.Item name="resource_category" hidden>
              <Input />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="采集模板"
                  name="template_code"
                  rules={[{ required: true, message: '请选择采集模板' }]}
                  extra={
                    selectedTemplate
                      ? `采集实现：${selectedTemplate.exporter_template_name || selectedTemplate.exporter_template_id || '未绑定'}（由模板决定） · 资源类别：${CATEGORY_MAP[selectedTemplate.resource_category] ?? selectedTemplate.resource_category} · 默认端口 ${selectedTemplate.default_port}`
                      : '模板决定采集实现、默认参数与推荐的对象范围；实现清单在「采集模板 → 采集实现」维护'
                  }
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="请选择采集模板"
                    options={templateOptions}
                    onChange={(value) => handleTemplateChange(value as string | undefined)}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="网域"
                  name="network_domain_id"
                  rules={[{ required: true, message: '请选择网域' }]}
                  extra={
                    domains.length === 0 ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        请选择已纳管网域；未纳管请前往
                        <Link onClick={() => navigate('/admin/domains')}>「系统与平台管理 → 网域管理」</Link>
                        纳管
                      </Text>
                    ) : undefined
                  }
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="仅已纳管非冻结网域"
                    notFoundContent="暂无可用网域，请先到「系统与平台管理 → 网域管理」登记中心直连域或采集节点域"
                  >
                    {domains.map((d) => (
                      <Select.Option key={d.id} value={d.id} label={d.name}>
                        {d.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Card size="small" title="采集器与参数" style={{ marginBottom: 12 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Space align="center">
                  <Radio.Group value={collectorMode} onChange={(e) => setCollectorMode(e.target.value)} size="small" optionType="button" buttonStyle="solid">
                    <Radio.Button value="default">使用模板默认</Radio.Button>
                    <Radio.Button value="manual">手填</Radio.Button>
                  </Radio.Group>
                  <ParamsSyncTag state={paramsState} />
                </Space>
                {collectorMode === 'manual' ? (
                  <Form.Item name="exporter_template_id" noStyle rules={[{ required: true, message: '请输入采集器模板 ID' }]}>
                    <Input placeholder="采集器模板 ID（手填）" maxLength={64} />
                  </Form.Item>
                ) : (
                  <Form.Item name="exporter_template_id" noStyle>
                    <Input disabled placeholder="采集模板默认采集器（选择模板后自动带出）" />
                  </Form.Item>
                )}
                <ScrapeParamFields templateCode={templateCode} paramPlaceholders={paramPlaceholders} />
              </Space>
            </Card>

            {/* 「采哪些对象」：选择器只决定任务覆盖范围；不配置 = 该模板类别下全部对象 */}
            <Card size="small" title="采哪些对象（可选）" style={{ marginBottom: 12 }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  条件只决定任务覆盖哪些对象；不配置表示该类别下全部对象。新建时若模板配置了推荐条件，会自动带出，可改可删。
                </Text>
                <SelectorEditor
                  value={selector}
                  onChange={handleSelectorChange}
                  category={resourceCategory}
                  fields={fields}
                  emptyText="不限条件：该模板类别下全部对象"
                />
                {selectorPrefilled && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    已按模板推荐条件预填，可修改
                  </Text>
                )}
              </Space>
            </Card>

            {renderLabelTemplateSection()}

            <AuthTlsFields />

            <Card size="small" title="选择实例" style={{ marginBottom: 12 }}>
              <InstanceSelector
                templateCode={templateCode}
                resourceCategory={resourceCategory}
                networkDomainId={networkDomainId}
                selectedIds={selectedIds}
                onChange={setSelectedIds}
              />
            </Card>
            {/* {T01-P6} 生效端口只读回显：四级解析链结果 + 来源标注（业务端口兜底 ⚠️ 不阻断） */}
            {isEdit && portEchoItems.length > 0 && (
              <Card size="small" title="生效端口回显" style={{ marginBottom: 12 }}>
                <List
                  bordered
                  size="small"
                  dataSource={portEchoItems}
                  renderItem={(it) => (
                    <List.Item>
                      <Space direction="vertical" size={0} style={{ minWidth: 0 }}>
                        <Text strong>{it.instance_name}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {it.instance_ip}
                        </Text>
                      </Space>
                      <PortEcho item={it} onGoResources={() => navigate('/resources')} />
                    </List.Item>
                  )}
                />
              </Card>
            )}
            {isEdit && (
              <ExporterInstallationPanel
                jobId={record!.id}
                jobName={record!.job_name}
                deployed={record!.change_status === 'deployed'}
              />
            )}
          </>
        ) : (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="拨测模块" name="blackbox_module" rules={[{ required: true, message: '请选择拨测模块' }]}>
                  <Select
                    placeholder="选择拨测模块"
                    options={blackboxModules.map((module) => ({
                      value: module.name,
                      label: module.enabled ? module.name : `${module.name}（已停用）`,
                      disabled: !module.enabled,
                    }))}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="资源类别" name="resource_type" rules={[{ required: true, message: '请选择资源类别' }]}>
                  <Select
                    placeholder="请选择"
                    // 只列接口服务 / 应用服务两类（与后端 models.BlackboxProbeCategories 一致）
                    options={BLACKBOX_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_MAP[c] }))}
                    onChange={() => {
                      // 换类别 → 探测地址字段与可用标签模板随之改变，已选实例/模板不再适用，回到默认模板
                      setSelectedIds([])
                      form.setFieldsValue({ label_template_id: '' })
                    }}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="网域"
              name="network_domain_id"
              rules={[{ required: true, message: '请选择网域' }]}
              extra={
                domains.length === 0 ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    请选择已纳管网域；未纳管请前往
                    <Link onClick={() => navigate('/admin/domains')}>「系统与平台管理 → 网域管理」</Link>
                    纳管
                  </Text>
                ) : undefined
              }
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="仅已纳管非冻结网域"
                notFoundContent="暂无可用网域，请先到「系统与平台管理 → 网域管理」登记中心直连域或采集节点域"
              >
                {domains.map((d) => (
                  <Select.Option key={d.id} value={d.id} label={d.name}>
                    {d.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              label="拨测目标"
              required
              extra={
                blackboxCategory
                  ? `从「${CATEGORY_MAP[blackboxCategory]}」台账中选择；目标地址固定取所选实例的${BLACKBOX_TARGET_FIELD_LABEL[blackboxCategory]}，不手工填写。`
                  : '从所选资源类别的台账中选择；目标地址按资源类别固定取一个地址字段，不手工填写。'
              }
            >
              {/* 不传 targetField：探测地址字段由服务端按类别推导（接口服务→接口地址、
                  应用服务→健康检查 URL），候选第二列渲染的即该字段的真实值。 */}
              <InstanceSelector
                resourceCategory={blackboxCategory}
                networkDomainId={networkDomainId}
                addressColumnTitle="探测地址"
                selectedIds={selectedIds}
                onChange={setSelectedIds}
              />
            </Form.Item>

            {renderLabelTemplateSection()}
          </>
        )}
      </Form>
    </Drawer>
  )
}

export default ScrapeJobFormDrawer
