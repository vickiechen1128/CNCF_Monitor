import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
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
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { networkDomainApi } from '../../api/domain'
import { ciExporterMappingApi } from '../../api/ciExporterMappings'
import { labelTemplateApi } from '../../api/labelTemplates'
import { scrapeJobApi, type ScrapeJobInput } from '../../api/scrapeJobs'
import { triggerConfigDrafts } from '../config-center/preview/triggerConfigDraft'
import type { NetworkDomain } from '../../types/domain'
import type { AuthType, CITypeExporterMapping, ExporterTemplate, JobType, MonitorType } from '../../types/strategy'
import type { ScrapeJob, ScrapeJobInstanceItem } from '../../types/strategy'
import type { ResourceCategory } from '../../types/resource'
import type { LabelTemplateListItem } from '../../types/label'
import {
  SCRAPE_PARAM_FIELDS,
  MONITOR_TYPE_CASCADE,
  MONITOR_TYPE_MAP,
  CATEGORY_MAP,
  BLACKBOX_CATEGORIES,
  BLACKBOX_TARGET_FIELD_LABEL,
} from './strategyConstants'
import { InstanceSelector } from './InstanceSelector'
import { ExporterInstallationPanel } from './ExporterInstallationPanel'
import { ExporterTemplateDrawer } from './ExporterTemplateDrawer'

// 拨测模块（协议/目标不再手填：目标由所选资源类别决定，协议由目标地址的 scheme 决定，
// 故不再需要 BLACKBOX_PROTOCOLS）。
const BLACKBOX_MODULES = ['http_2xx', 'icmp_ping', 'tcp_connect', 'dns_query']

const { Text, Link } = Typography

/** 参数继承来源 Tag（§5.4 参数同步）：inherited 灰 / overridden 蓝 / pending 橙 */
function ParamsSyncTag({ state }: { state: 'inherited' | 'overridden' | 'pending' | 'none' }) {
  if (state === 'inherited') return <Tag>继承映射</Tag>
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

interface ScrapeJobFormDrawerProps {
  open: boolean
  /** 编辑态传行 record；新增态为 null */
  record?: ScrapeJob | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 采集 Job 编辑抽屉（Module_01 §3.1/§5.4/§9.1/§11.1/§11.2，F4）。
 * - monitor_type 两级级联带出默认采集器与参数（可覆盖）；默认采集器「使用默认/手填」二选一；
 * - 网域下拉=已纳管非冻结；job_type standard/blackbox 切换（blackbox 隐藏 mon/exp，显黑盒目标）；
 * - 认证TLS折叠面板（auth_type 三选一 + basic→user/pass 掩码、bearer→token、TLS 区）；
 * - 标签模板卡片式选择（按资源类别过滤 + 补配引导，F1-4）；采集器 inline 登记成功回选（C1）；
 * - 编辑态网域可改（FIX-2 已按契约开放），网域空态跨模块引导（A7）；标准 Job 内嵌实例选择器与安装确认面板。
 */
export function ScrapeJobFormDrawer({ open, record, onCancel, onSuccess }: ScrapeJobFormDrawerProps) {
  const navigate = useNavigate()
  const [form] = Form.useForm<ScrapeJobInput & { resource_category?: ResourceCategory }>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [collectorMode, setCollectorMode] = useState<'default' | 'manual'>('default')
  const [paramsState, setParamsState] = useState<'inherited' | 'overridden' | 'pending' | 'none'>('none')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateListItem[]>([])
  const [registerOpen, setRegisterOpen] = useState(false)
  // F-28 稀疏覆盖：当前监控对象类型的默认采集配置（用于参数 placeholder 展示继承默认值；
  // 不再值预填进表单，留空=继承，保存时由后端按 映射→模板→全局 链解析生效快照）
  const [mappingDefaults, setMappingDefaults] = useState<CITypeExporterMapping | null>(null)
  // {T01-P6} 编辑态生效端口回显数据（GET /instances 的 port/port_source，仅 standard 分支渲染）
  const [portEchoItems, setPortEchoItems] = useState<ScrapeJobInstanceItem[]>([])

  const isEdit = !!record
  // 任务类型分支状态：编辑态由 record.job_type 直接决定（确定性，不依赖
  // Form.useWatch 在 setFieldsValue 后的异步翻转——该异步翻转在真实浏览器中
  // 偶发不触发，导致拨测 Job 编辑时仍停留在「采集」分支、已填的拨测信息不回显）。
  // 新增态初值 standard，由下方 Radio onChange 切换。
  const [jobType, setJobType] = useState<JobType>(record?.job_type ?? 'standard')
  const monitorType = Form.useWatch('monitor_type', form) as MonitorType | undefined
  // O2/T01-F15：登记采集器发起上下文 = 当前已选监控对象类型（预填 supported_monitor_types）；useMemo 稳定引用
  const registerInitialTypes = useMemo<MonitorType[] | undefined>(
    () => (monitorType ? [monitorType] : undefined),
    [monitorType],
  )
  const resourceCategorySelected = Form.useWatch('resource_category', form) as ResourceCategory | undefined
  // 拨测（blackbox）分支：由用户选定目标资源类别（限接口服务 / 应用服务两类）。
  // 探测地址字段不再由用户选：由类别写死推导（接口服务→接口地址、应用服务→健康检查 URL），
  // 服务端保存时按同一映射落库，前端不提交 target_field。
  const blackboxCategory = Form.useWatch('resource_type', form) as ResourceCategory | undefined
  // Q1a：登记采集器仅在「已选监控对象类型但无默认采集器」的空态展示（PRD §3.1 采集器选择器空态引导，L83）
  const exporterTemplateId = Form.useWatch('exporter_template_id', form) as string | undefined
  const networkDomainId = (Form.useWatch('network_domain_id', form) as string | undefined) ?? ''
  const authType = (Form.useWatch('auth_type', form) as AuthType | undefined) ?? 'none'

  // F1-8：监控对象类型候选 = 按已选资源类别过滤（两级级联）
  const categoryTypes = useMemo<MonitorType[]>(() => {
    if (!resourceCategorySelected) return []
    return MONITOR_TYPE_CASCADE.find((g) => g.category === resourceCategorySelected)?.types ?? []
  }, [resourceCategorySelected])

  // F1-4：按当前资源类别过滤可选的标签模板（卡片式）。
  // 采集 Job 由 monitor_type 推导类别；拨测 Job 没有 monitor_type，类别取 resource_type
  // （接口服务 / 应用服务），否则拨测场景下选择器会因 monitorType 为空而不渲染。
  const resourceCategory = useMemo<ResourceCategory | undefined>(() => {
    if (jobType === 'blackbox') return blackboxCategory
    if (!monitorType) return undefined
    return MONITOR_TYPE_CASCADE.find((g) => g.types.includes(monitorType))?.category
  }, [jobType, blackboxCategory, monitorType])
  const filteredLabelTemplates = useMemo(
    () => labelTemplates.filter((t) => t.resource_category === resourceCategory),
    [labelTemplates, resourceCategory],
  )
  // 类别默认模板：label_template_id 留空时后端按该类别默认模板生成标签，
  // 选项文案据此明确「使用默认标签模板（xxx）」而非误导性的「不关联」。
  const defaultLabelTemplate = useMemo(
    () => filteredLabelTemplates.find((t) => t.is_default),
    [filteredLabelTemplates],
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
    // F1-4：装载标签模板（卡片式选择按资源类别过滤）
    labelTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setLabelTemplates(res.data?.list ?? []))
      .catch(() => setLabelTemplates([]))
    form.resetFields()
    setMappingDefaults(null)
    setPortEchoItems([])
    if (record) {
      setSelectedIds(record.selected_instance_ids ?? [])
      // F1-8 编辑态回显：由 record.monitor_type 反推所属资源类别预填（提交载荷仍为 single monitor_type）
      const echoedCategory = MONITOR_TYPE_CASCADE.find((g) => g.types.includes(record.monitor_type as MonitorType))?.category
      form.setFieldsValue({
        job_name: record.job_name,
        job_type: record.job_type,
        resource_category: echoedCategory,
        monitor_type: (record.monitor_type || undefined) as MonitorType | undefined,
        exporter_template_id: record.exporter_template_id,
        network_domain_id: record.network_domain_id,
        scrape_interval: record.scrape_interval,
        scrape_timeout: record.scrape_timeout,
        metrics_path: record.metrics_path,
        scheme: record.scheme,
        // 留空 = 使用该类别默认模板；显式置 '' 让「使用默认标签模板」单选项默认选中
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
      setParamsState((record.mapping_overrides?.length ?? 0) > 0 ? 'pending' : 'none')
    } else {
      setSelectedIds([])
      form.setFieldsValue({ job_type: 'standard', auth_type: 'none', tls_skip_verify: false, exporter_template_id: undefined, label_template_id: '' } as Partial<ScrapeJobInput>)
    }
  }, [open, record, form])

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

  // monitor_type 变化 → 带出默认采集器与标签模板；采集参数仅以 placeholder 展示
  // 映射默认值（F-28 稀疏覆盖：留空=继承，不再把参数值写进表单快照）
  const handleMonitorTypeChange = useCallback(
    async (next: MonitorType | undefined) => {
      setParamsState('none')
      setMappingDefaults(null)
      if (!next) return
      try {
        const res = await ciExporterMappingApi.list({ monitor_type: next as string, is_default: true, page: 1, page_size: 20 })
        const def = res.data?.list?.[0]
        if (def) {
          setMappingDefaults(def)
          form.setFieldsValue({
            exporter_template_id: def.exporter_template_id as string,
            label_template_id: def.label_template_id || '',
          })
          setParamsState('inherited')
        }
      } catch {
        // 无默认映射时保持空，用户可手填
      }
    },
    [form],
  )

  // F-28：参数字段 placeholder = 继承链下层生效值提示（映射 → 采集器/全局兜底）
  const paramPlaceholders: Record<string, string> = {
    scrape_interval: mappingDefaults?.scrape_interval
      ? `留空继承默认采集配置（${mappingDefaults.scrape_interval}）`
      : '留空使用全局默认（15s）',
    scrape_timeout: mappingDefaults?.scrape_timeout
      ? `留空继承默认采集配置（${mappingDefaults.scrape_timeout}）`
      : '留空使用全局默认（10s）',
    metrics_path: mappingDefaults?.metrics_path
      ? `留空继承默认采集配置（${mappingDefaults.metrics_path}）`
      : '留空继承采集器默认（/metrics）',
    scheme: mappingDefaults?.scheme
      ? `留空继承默认采集配置（${mappingDefaults.scheme}）`
      : '留空继承采集器默认（http）',
  }

  // C1：登记采集器成功后回选到来源表单（D17）：回填 exporter_template_id 并切「手填」展示
  const handleRegisterSuccess = useCallback(
    (template?: ExporterTemplate) => {
      if (template?.id) {
        form.setFieldsValue({ exporter_template_id: String(template.id) })
        setCollectorMode('manual')
      }
    },
    [form],
  )

  // F1-4：标签模板补配引导（M07 标签模板管理维护）
  const openLabelTemplateGuide = useCallback(() => {
    message.info('标签模板补配请前往「标签模板」管理维护（M07）')
  }, [])

  // 将表单值组装为请求体；draftStatus 决定是「保存草稿」还是「提交生效」。
  const buildBody = useCallback(
    (values: ScrapeJobInput, draftStatus: 'draft' | 'ready'): ScrapeJobInput => {
      const body: ScrapeJobInput = {
        job_name: values.job_name,
        job_type: values.job_type ?? 'standard',
        network_domain_id: values.network_domain_id ?? '',
        // F-28：采集参数可留空（留空=继承）。空值显式归一为 '' 提交——编辑态清空字段
        // 即「恢复继承」，后端保存时按 映射→模板→全局 链重新解析生效快照。
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
        label_template_id: values.label_template_id || undefined,
        draft_status: draftStatus,
        enabled: true,
      }
      if (values.job_type === 'blackbox') {
        body.blackbox_module = values.blackbox_module
        // 拨测目标改走资源选择：目标地址 = 所选实例在「该类别写死的探测地址字段」上的值
        // （接口服务→接口地址、应用服务→健康检查 URL）。只提交类别，target_field 由服务端
        // 推导；手填入口已彻底禁用（后端同样拒绝 blackbox_targets 写入）。
        body.resource_type = values.resource_type
        body.selected_instance_ids = selectedIds
      } else {
        body.monitor_type = values.monitor_type
        body.exporter_template_id = values.exporter_template_id
        body.selected_instance_ids = selectedIds
      }
      return body
    },
    [selectedIds],
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
    let values: ScrapeJobInput
    try {
      values = await form.validateFields()
    } catch {
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
   * 采集 Job 的类别来自 monitor_type，拨测 Job 的类别来自 resource_type；
   * 不选择具体模板时后端回落到该类别默认模板，故空选项明确文案为「使用默认标签模板」。
   */
  const renderLabelTemplateSection = () => (
    <Form.Item
      label="标签模板"
      extra={
        resourceCategory
          ? jobType === 'blackbox'
            ? '按拨测目标资源类别过滤；不选择时使用该类别默认标签模板，也可切换为其他自定义方案'
            : '按资源类别过滤；映射自动继承，补配请前往标签模板管理（M07）'
          : jobType === 'blackbox'
            ? '选择拨测目标资源类别后列出可用标签模板'
            : '选择监控对象类型后按资源类别列出可用标签模板'
      }
    >
      {resourceCategory && filteredLabelTemplates.length > 0 ? (
        <Form.Item name="label_template_id" noStyle>
          <Radio.Group buttonStyle="solid" style={{ width: '100%' }}>
            <Space direction="vertical" style={{ width: '100%' }} size={4}>
              <Radio.Button value="" style={{ width: '100%', textAlign: 'left' }}>
                <Text type="secondary">
                  {defaultLabelTemplate
                    ? `使用默认标签模板（${defaultLabelTemplate.name}）`
                    : '不关联标签模板'}
                </Text>
              </Radio.Button>
              {filteredLabelTemplates.map((t) => (
                <Radio.Button
                  key={t.id}
                  value={String(t.id)}
                  style={{ width: '100%', height: 'auto', padding: '8px 12px', whiteSpace: 'normal', textAlign: 'left' }}
                >
                  <Space size={6} direction="vertical" align="start">
                    <Space size={6}>
                      <Text strong>{t.name}</Text>
                      {t.is_default && <Tag color="blue">默认</Tag>}
                    </Space>
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
        <Space direction="vertical" size={4}>
          {resourceCategory && filteredLabelTemplates.length === 0 ? (
            <>
              <Text type="secondary">该资源类别下暂无标签模板</Text>
              <Button type="link" size="small" onClick={openLabelTemplateGuide}>
                前往补配标签模板
              </Button>
            </>
          ) : (
            <Text type="secondary">
              {jobType === 'blackbox'
                ? '选择拨测目标资源类别后按资源类别列出'
                : '选择监控对象类型后按资源类别列出'}
            </Text>
          )}
        </Space>
      )}
    </Form.Item>
  )

  return (
    <>
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
                  setJobType(e.target.value as JobType)
                  // 采集 / 拨测的资源类别不同，切换任务类型后回到「使用默认标签模板」，避免跨类别残留
                  form.setFieldsValue({ label_template_id: '' })
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
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="资源类别" name="resource_category" rules={[{ required: true, message: '请选择资源类别' }]}>
                  <Select
                    placeholder="请选择"
                    options={MONITOR_TYPE_CASCADE.map((g) => ({ value: g.category, label: CATEGORY_MAP[g.category] }))}
                    onChange={() => form.setFieldsValue({ monitor_type: undefined })}
                  />
                </Form.Item>
                <Form.Item label="监控对象类型" name="monitor_type" rules={[{ required: true, message: '请选择监控对象类型' }]}>
                  <Select
                    placeholder={categoryTypes.length > 0 ? '请选择监控对象类型' : '请先选择资源类别'}
                    disabled={categoryTypes.length === 0}
                    options={categoryTypes.map((t) => ({ value: t, label: MONITOR_TYPE_MAP[t] ?? t }))}
                    onChange={(v) => void handleMonitorTypeChange(v as MonitorType | undefined)}
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
                        默认域自动同步已纳管，未纳管请前往
                        <Link onClick={() => navigate('/admin/domains')}>「系统与平台管理 → 网域管理」</Link>
                        纳管
                      </Text>
                    ) : undefined
                  }
                >
                  <Select showSearch optionFilterProp="label" placeholder="仅已纳管非冻结网域">
                    {domains.map((d) => (
                      <Select.Option key={d.id} value={d.id} label={d.name}>
                        {d.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Card size="small" title="采集器与参数同步" style={{ marginBottom: 12 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Space align="center">
                  <Radio.Group value={collectorMode} onChange={(e) => setCollectorMode(e.target.value)} size="small" optionType="button" buttonStyle="solid">
                    <Radio.Button value="default">使用默认</Radio.Button>
                    <Radio.Button value="manual">手填</Radio.Button>
                  </Radio.Group>
                  <ParamsSyncTag state={paramsState} />
                  {/* C1/PRD §3.1 采集器选择器空态引导：仅「有类型无采集器」显示登记入口，登记成功回选（D17） */}
                  {monitorType && !exporterTemplateId ? (
                    <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => setRegisterOpen(true)}>
                      登记采集器
                    </Button>
                  ) : null}
                </Space>
                {collectorMode === 'manual' ? (
                  <Form.Item name="exporter_template_id" noStyle rules={[{ required: true, message: '请输入采集器模板 ID' }]}>
                    <Input placeholder="采集器模板 ID（手填）" maxLength={64} />
                  </Form.Item>
                ) : (
                  <Form.Item name="exporter_template_id" noStyle>
                    <Input disabled placeholder="默认采集器（切换监控类型自动带出）" />
                  </Form.Item>
                )}
                <Row gutter={12}>
                  {SCRAPE_PARAM_FIELDS.map((f) => {
                    // application_http：采集地址来自资源台账「端点 + 端口」，指标路径无通用默认值，
                    // 必须显式填写（后端留空返回 bad_request）；其它 monitor_type 保持「留空=继承」。
                    const isAppMetricsPath = monitorType === 'application_http' && f.field === 'metrics_path'
                    return (
                      <Col span={12} key={f.field}>
                        {/* F-28：参数默认不必填；placeholder 展示继承链下层生效值（留空=继承） */}
                        <Form.Item
                          name={f.field as never}
                          label={f.label}
                          rules={
                            isAppMetricsPath
                              ? [{ required: true, message: '应用采集必须填写采集路径，例如 /actuator/prometheus' }]
                              : undefined
                          }
                        >
                          <Input
                            placeholder={
                              isAppMetricsPath
                                ? '请填写应用指标路径，例如 /actuator/prometheus（留空无法采集）'
                                : paramPlaceholders[f.field]
                            }
                            maxLength={64}
                            allowClear
                          />
                        </Form.Item>
                      </Col>
                    )
                  })}
                </Row>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  采集参数留空 = 继承默认采集配置 / 采集器默认值；填写 = 覆盖并保存为本 Job 快照。
                </Text>
                {monitorType === 'application_http' && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    应用采集地址来自资源台账的『端点 + 端口』；指标路径需按应用实际暴露情况填写（Spring Boot Actuator
                    默认 /actuator/prometheus），没有通用默认值，不能留空。
                  </Text>
                )}
              </Space>
            </Card>

            {renderLabelTemplateSection()}

            <Collapse ghost>
              <Collapse.Panel header="认证与 TLS" key="auth">
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="认证类型" name="auth_type" rules={[{ required: true }]}>
                      <Select>
                        <Select.Option value="none">无</Select.Option>
                        <Select.Option value="basic">用户名密码</Select.Option>
                        <Select.Option value="bearer">Bearer Token</Select.Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  {authType !== 'none' && (
                    <Col span={16}>
                      {authType === 'basic' ? (
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                              <Input placeholder="用户名" maxLength={64} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                              <Input.Password placeholder="密文仅存储，不回显" maxLength={128} />
                            </Form.Item>
                          </Col>
                        </Row>
                      ) : (
                        <Form.Item name="token" label="Token" rules={[{ required: true, message: '请输入 Token' }]}>
                          <Input.Password placeholder="密文仅存储，不回显" maxLength={256} />
                        </Form.Item>
                      )}
                    </Col>
                  )}
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="跳过 TLS 校验" name="tls_skip_verify">
                      <Radio.Group size="small">
                        <Radio.Button value={false as never}>否</Radio.Button>
                        <Radio.Button value={true as never}>是</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="ca_file" label="CA 证书路径">
                      <Input placeholder="可选" maxLength={256} />
                    </Form.Item>
                  </Col>
                </Row>
              </Collapse.Panel>
            </Collapse>

            <Card size="small" title="选择实例" style={{ marginBottom: 12 }}>
              <InstanceSelector monitorType={monitorType} networkDomainId={networkDomainId} selectedIds={selectedIds} onChange={setSelectedIds} />
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
                  <Select placeholder="选择拨测模块">
                    {BLACKBOX_MODULES.map((m) => (
                      <Select.Option key={m} value={m}>
                        {m}
                      </Select.Option>
                    ))}
                  </Select>
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
                    默认域自动同步已纳管，未纳管请前往
                    <Link onClick={() => navigate('/admin/domains')}>「系统与平台管理 → 网域管理」</Link>
                    纳管
                  </Text>
                ) : undefined
              }
            >
              <Select showSearch optionFilterProp="label" placeholder="仅已纳管非冻结网域">
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
      <ExporterTemplateDrawer
        open={registerOpen}
        onCancel={() => setRegisterOpen(false)}
        onSuccess={handleRegisterSuccess}
        initialMonitorTypes={registerInitialTypes}
      />
    </>
  )
}

export default ScrapeJobFormDrawer