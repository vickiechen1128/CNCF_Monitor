import { useEffect, useMemo, useState } from 'react'
import {
  Card,
  Table,
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
} from 'antd'
import type { TransferItem } from 'antd/es/transfer'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  GlobalOutlined,
  SyncOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockScrapeJobs,
  mockExporterTemplates,
  mockResources,
  mockLabelTemplates,
  mockNetworkDomains,
  mockExporterInstallations,
  mockCITypeExporterMappings,
  currentTenant,
  CI_TYPE_LABEL,
  CI_TYPE_CATEGORY_MAP,
  CI_TYPES_BY_CATEGORY,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_MAP,
  SCHEMES,
  ENV_VALUES,
  ENV_LABEL,
  INSTALL_STATUS_MAP,
  INSTALL_STATUS_CYCLE,
  BLACKBOX_MODULES,
  BLACKBOX_MODULE_LABEL,
  BLACKBOX_PROTOCOL_BY_MODULE,
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
} from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const now = () => new Date().toISOString()

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
  const [jobs, setJobs] = useState<ScrapeJob[]>(() => [...mockScrapeJobs])
  const [installations, setInstallations] = useState<ExporterInstallationConfirmation[]>(() => [
    ...mockExporterInstallations,
  ])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScrapeJob | null>(null)
  const [targetKeys, setTargetKeys] = useState<string[]>([])
  const [filterEnv, setFilterEnv] = useState<string | undefined>(undefined)
  const [blackboxTargets, setBlackboxTargets] = useState<BlackboxTarget[]>([])
  const [confirmTarget, setConfirmTarget] = useState<ExporterInstallationConfirmation | null>(null)
  const [detailJob, setDetailJob] = useState<ScrapeJob | null>(null)
  // 决策 14：当前编辑表单中手动覆盖过映射默认值的字段（「同步映射默认值」时跳过）
  const [overriddenFields, setOverriddenFields] = useState<MappingOverrideField[]>([])
  const [confirmForm] = Form.useForm()
  const [form] = Form.useForm()

  // 租户级多网域开关（Header 切换）：单网域模式仅允许绑定 default 管理域
  const isMultiSite = currentTenant.multi_site_enabled
  const availableDomains = isMultiSite
    ? mockNetworkDomains
    : mockNetworkDomains.filter((d) => d.id === 'default')

  // 监听 Header 单网域/多网域切换：切回单网域时强制网域为 default 并清空跨域实例（实例必须与 Job 同域）
  useEffect(() => {
    const onTenantModeChange = (e: Event) => {
      const multiSiteEnabled = (e as CustomEvent).detail?.multiSiteEnabled
      if (multiSiteEnabled === false) {
        const current = form.getFieldValue('network_domain_id')
        if (current && current !== 'default') {
          form.setFieldsValue({ network_domain_id: 'default' })
          setTargetKeys([])
        }
      }
    }
    window.addEventListener('tenant-mode-change', onTenantModeChange)
    return () => window.removeEventListener('tenant-mode-change', onTenantModeChange)
  }, [form])

  const templateMap = useMemo(() => {
    const map = new Map<string, (typeof mockExporterTemplates)[number]>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t))
    return map
  }, [])

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t.name))
    return map
  }, [])

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

  // 当前表单选中的标签模板（用于只读预览映射内容，模板由 Module_07 维护）
  const selectedLabelTemplate = useMemo(
    () => mockLabelTemplates.find((t) => t.template_id === watchedLabelTemplateId) ?? null,
    [watchedLabelTemplateId]
  )

  // 资源类别 → 可选的细粒度 CI 类型（两级级联）
  const categoryCiTypes = (watchResourceCategory as ResourceCategory | undefined)
    ? CI_TYPES_BY_CATEGORY[watchResourceCategory as ResourceCategory]
    : []

  // Transfer 数据源：按当前 resource_type + Job 网域 + 环境筛选
  const transferData = useMemo<TransferItem[]>(() => {
    const rt = watchResourceType as CiType | undefined
    if (!rt) return []
    return mockResources
      .filter((r) => r.resource_type === rt)
      .filter((r) => r.network_domain_id === watchNetworkDomainId)
      .filter((r) => (filterEnv ? r.env === filterEnv : true))
      .map((r) => ({
        key: r.resource_id,
        title: `${r.instance_name} (${r.instance_ip})`,
        description: `${domainNameMap.get(r.network_domain_id) ?? r.network_domain_id} · ${ENV_LABEL[r.env]} · ${r.app_name}`,
      }))
  }, [watchResourceType, watchNetworkDomainId, filterEnv, domainNameMap])

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
      resource_category: CI_TYPE_CATEGORY_MAP[record.resource_type],
      resource_type: record.resource_type,
      exporter_template_id: record.exporter_template_id,
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
    form.setFieldsValue({
      metrics_path: tpl?.metrics_path ?? mapping?.metrics_path ?? '/metrics',
      scheme: tpl?.scheme ?? mapping?.scheme ?? 'http',
      scrape_interval: mapping?.scrape_interval ?? '15s',
      scrape_timeout: mapping?.scrape_timeout ?? '10s',
      label_template_id: mapping?.label_template_id,
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
      inherited: { color: 'default', text: '继承自映射', tooltip: '当前值来自 CI-Exporter 映射默认值，用户未手动修改' },
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
    const tpl = templateMap.get(record.exporter_template_id)
    if (!mapping) {
      message.warning('未找到对应 CI-Exporter 映射，无法同步')
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
        const updated: ScrapeJob = {
          ...editingJob,
          ...values,
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
      render: (value: string, record: ScrapeJob) => (
        <Space>
          <Text strong>{value}</Text>
          {record.job_type === 'blackbox' && <Tag color="purple">blackbox</Tag>}
        </Space>
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
      title: 'CI 类型',
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
      title: 'Exporter / Module',
      key: 'exporter',
      render: (_: unknown, record: ScrapeJob) =>
        record.job_type === 'blackbox' ? (
          <Tag color="cyan">{record.blackbox_module ?? '-'}</Tag>
        ) : (
          <Tag color="cyan">{templateNameMap.get(record.exporter_template_id) ?? record.exporter_template_id}</Tag>
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
      render: (_: unknown, record: ScrapeJob) =>
        record.job_type === 'blackbox' ? (
          <Text type="secondary">{record.blackbox_targets?.length ?? 0} 个目标</Text>
        ) : (
          <Tag color={record.instance_selection_mode === 'manual' ? 'purple' : 'geekblue'}>
            {record.instance_selection_mode === 'manual' ? '手动' : '过滤'}
          </Tag>
        ),
    },
    {
      title: '参数同步',
      key: 'mappingSync',
      render: (_: unknown, record: ScrapeJob) =>
        record.job_type === 'blackbox' ? (
          <Text type="secondary">-</Text>
        ) : (
          <Space direction="vertical" size={2}>
            {isMappingChanged(record) ? (
              <Tooltip title="CI-Exporter 映射默认值已变更，请在编辑中手动同步">
                <Tag color="warning">映射默认值已变更</Tag>
              </Tooltip>
            ) : (
              <Tag color="success">已同步</Tag>
            )}
            {/* 决策 34：列表页展示覆盖字段数量概览 */}
            {record.mapping_overrides && record.mapping_overrides.length > 0 && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {record.mapping_overrides.length} 个字段已自定义
              </Text>
            )}
          </Space>
        ),
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
      render: (_: unknown, record: ScrapeJob) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="link" icon={<EyeOutlined />} onClick={() => setDetailJob(record)}>
            详情
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const isBlackbox = watchJobType === 'blackbox'

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>采集 Job</Title>
        <Text type="secondary">
          管理 Prometheus 采集任务（standard）与 blackbox 拨测任务；所有 Job 必须绑定单一网域，配置下发由 Module_09 负责
        </Text>
      </div>
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
            <Text type="secondary">
              共 {jobs.length} 个任务（标准 {jobs.filter((j) => j.job_type === 'standard').length} / 拨测{' '}
              {jobs.filter((j) => j.job_type === 'blackbox').length}）
            </Text>
          </Col>
        </Row>

        <Table rowKey="job_id" dataSource={jobs} columns={columns} pagination={{ pageSize: 5 }} />
      </Card>

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
                    对应 CI-Exporter 映射（{getMapping(editingJob)?.resource_type} →{' '}
                    {templateNameMap.get(editingJob.exporter_template_id)}）默认采集参数已更新（v0.2 起可含网域覆盖）。
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
                      form.setFieldsValue({
                        resource_category: 'application',
                        resource_type: 'application_http',
                        exporter_template_id: 'et-blackbox',
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
                extra={
                  isMultiSite
                    ? '所有 ScrapeJob 必须绑定且仅绑定单一网域；网域由 Module_09 管理'
                    : '单网域模式：仅支持 default 管理域（Header 可切换多网域模式）'
                }
              >
                <Select
                  placeholder="请选择"
                  disabled={!!editingJob || !isMultiSite}
                  onChange={() => {
                    setTargetKeys([])
                    message.info('切换网域后已选实例已清空，实例必须与 Job 同域')
                  }}
                >
                  {availableDomains.map((d) => (
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
                  extra="先选类别（主机/中间件/应用/通用目标），再选具体 CI 类型"
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
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="CI 类型"
                  name="resource_type"
                  rules={[{ required: true, message: '请选择 CI 类型' }]}
                >
                  <Select
                    placeholder={categoryCiTypes.length > 0 ? '请选择 CI 类型' : '请先选择资源类别'}
                    disabled={!!editingJob || categoryCiTypes.length === 0}
                    onChange={(type) => {
                      setTargetKeys([])
                      // 选中 CI 类型后自动匹配映射默认 Exporter 模板（决策 15 继承链）
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
                <Form.Item
                  label="Exporter 模板"
                  name="exporter_template_id"
                  rules={[{ required: true, message: '请选择 Exporter 模板' }]}
                  extra="选中 CI 类型后自动带出映射默认模板，可覆盖"
                >
                  <Select
                    placeholder="请选择"
                    onChange={(v) => handleTemplateChange(v as string)}
                    showSearch
                    optionFilterProp="children"
                  >
                    {mockExporterTemplates
                      .filter((t) => t.supported_resource_types.length > 0)
                      .filter((t) =>
                        watchResourceType
                          ? t.supported_resource_types.includes(watchResourceType as CiType)
                          : true
                      )
                      .map((t) => (
                        <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                          {t.name} v{t.version}
                        </Option>
                      ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
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
                        由 Module_07 维护，创建时自动预填映射默认模板；可换用其他模板（引用级），标签内容编辑唯一入口在 Module_07
                      </Text>
                      {/* {v3.1} 卡片式选择器：展示模板名称 + 资源类别 + 映射条数 */}
                      {selectedLabelTemplate ? (
                        <Card
                          size="small"
                          title={
                            <Space size={4}>
                              <Text strong style={{ fontSize: 12 }}>
                                {selectedLabelTemplate.name}
                              </Text>
                              {selectedLabelTemplate.is_default ? <Tag color="gold">默认</Tag> : <Tag>自定义</Tag>}
                              <Text code style={{ fontSize: 10 }}>
                                {selectedLabelTemplate.template_id}
                              </Text>
                            </Space>
                          }
                          extra={
                            editingJob ? (
                              <Button
                                type="link"
                                size="small"
                                icon={<SwapOutlined />}
                                onClick={() => form.setFieldsValue({ label_template_id: undefined })}
                              >
                                更换
                              </Button>
                            ) : undefined
                          }
                        >
                          <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            <div>
                              {selectedLabelTemplate.mappings.map((m) => (
                                <Tag key={m.target_label} style={{ fontSize: 11, marginBottom: 2 }}>
                                  {m.source_field} → {m.target_label}
                                </Tag>
                              ))}
                            </div>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              资源类别：{RESOURCE_CATEGORY_MAP[selectedLabelTemplate.resource_category]} · 共 {selectedLabelTemplate.mappings.length} 条映射
                            </Text>
                            <Typography.Link
                              href="../module-07/dist/index.html"
                              style={{ fontSize: 12 }}
                            >
                              前往标签模板管理 →
                            </Typography.Link>
                          </Space>
                        </Card>
                      ) : (
                        /* {v3.1} 无标签模板时展示创建引导 */
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginTop: 4 }}
                          message={
                            <Space size={4}>
                              <Text style={{ fontSize: 12 }}>暂未选择标签模板</Text>
                              <Typography.Link
                                href="../module-07/dist/index.html"
                                style={{ fontSize: 12 }}
                              >
                                前往创建 →
                              </Typography.Link>
                            </Space>
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
                  >
                    {mockLabelTemplates.map((t) => (
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
              <Form.Item label="选择模式" name="instance_selection_mode">
                <Select disabled={isBlackbox}>
                  <Option value="manual">手动选择</Option>
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
                <Col span={24}>
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
              <Descriptions.Item label="CI 类型">
                {detailJob.job_type === 'blackbox' ? (
                  <Text type="secondary">-</Text>
                ) : (
                  <Tag color="blue">{CI_TYPE_LABEL[detailJob.resource_type]}</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Exporter / Module">
                {detailJob.job_type === 'blackbox' ? (
                  <Tag color="cyan">{detailJob.blackbox_module ?? '-'}</Tag>
                ) : (
                  <Tag color="cyan">
                    {templateNameMap.get(detailJob.exporter_template_id) ?? detailJob.exporter_template_id}
                  </Tag>
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
    </MainLayout>
  )
}
