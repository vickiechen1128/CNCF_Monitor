/**
 * M01 新建监控任务（对象优先 + 按域派生）向导抽屉。
 *
 * 动线（SRS JG v1.2 §8.5 / 契约 §5.1.1 + §4.1）：
 * 选对象类型 → 组合筛选（AND，默认仅状态）→ 勾选实例（跨页保留 / 可全选）→
 * 分域预览 → 公共参数 → 保存为 Job 组（后端按域生成 N 条子 Job）。
 *
 * 关键约束：网域条件只收窄候选，不决定下发域；下发域由所选实例所属网域派生。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ColumnsType } from 'antd/es/table'
import { jobGroupApi, type CandidateIdsPayload, type CandidateQueryPayload } from '../../api/jobGroups'
import { networkDomainMonitorApi } from '../../api/configCenter'
import { scrapeJobApiV3 } from '../../api/strategyV3'
import { applicationDictApi, businessDomainApi, platformDictApi } from '../../api/resources'
import { labelTemplateApi } from '../../api/labelTemplates'
import { blackboxModuleApi } from '../../api/blackboxModules'
import { getStoredUser } from '../../api/client'
import type { InstanceCandidateV3, JobInstanceV3, ResourceCategory } from '../../types/strategyV3'
import type { CandidateFilterField, DomainHit, FilterCondition, JobGroup } from '../../types/jobGroup'
import { BLACKBOX_CATEGORIES, CATEGORY_MAP } from './strategyConstants'
import { EMPTY_SELECTOR, normalizeSelector, type Selector } from '../../types/collectionTemplate'
import { useCandidateFields, useCollectionTemplateCatalog } from './useCollectionTemplateCatalog'
import { SelectorEditor } from './SelectorEditor'
import { JobParamsFields } from './JobParamsFields'
import { triggerConfigDrafts } from '../config-center/preview/triggerConfigDraft'

const { Text, Title } = Typography

interface Option {
  value: string
  label: string
}

export interface JobGroupWizardDrawerProps {
  open: boolean
  /** 编辑态：预填公共参数与跨域已选实例；为空则是新建 */
  record?: JobGroup | null
  /** 存量单域任务编辑为跨域时的晋升目标（原 Job id） */
  adoptJobId?: string | null
  onClose: () => void
  onSaved: () => void
}

const DEFAULT_CONDITIONS: FilterCondition[] = [
  // 默认只看「运行中」：已停止/维护中选了也采不到，按需显式添加
  { id: 'status-default', field: 'status', op: 'in', values: ['online'] },
]

const PORT_SOURCE_LABEL: Record<string, { text: string; color: string }> = {
  instance: { text: '实例覆盖', color: 'green' },
  mapping: { text: '类型默认', color: 'blue' },
  template: { text: '采集器默认', color: 'cyan' },
  business: { text: '业务端口兜底', color: 'orange' },
  default: { text: '系统默认', color: 'default' },
  unresolved: { text: '未解析', color: 'default' },
}

/** 条件的网络负载（去掉本地 id） */
function toPayloadFilters(conditions: FilterCondition[]) {
  return conditions
    .filter((condition) => condition.values.length > 0)
    .map((condition) => ({ field: condition.field, op: condition.op, values: condition.values }))
}

export function JobGroupWizardDrawer({ open, record, adoptJobId, onClose, onSaved }: JobGroupWizardDrawerProps) {
  const isEdit = Boolean(record)
  // 采集模板目录 + 选择器字段字典（SRS Module_01 v1.5）
  const { templates } = useCollectionTemplateCatalog()
  const { fields: candidateFields } = useCandidateFields()
  const [schema, setSchema] = useState<CandidateFilterField[]>([])
  const [fieldOptions, setFieldOptions] = useState<Record<string, Option[]>>({})
  // 未选模板前不发候选查询：避免"默认 Linux 主机"静默过滤导致怀疑数据丢失
  const [templateCode, setTemplateCode] = useState('')
  const [selector, setSelector] = useState<Selector>(EMPTY_SELECTOR)
  const [resourceCategory, setResourceCategory] = useState<ResourceCategory>('host')
  // 任务名称 / 下发任务名（job 标签）
  const [taskName, setTaskName] = useState('')
  const [jobNameOverride, setJobNameOverride] = useState('')
  const [blackboxModules, setBlackboxModules] = useState<{ id: string; name: string; enabled: boolean }[]>([])
  // 任务类型：采集 / 拨测（语义与既有 job_type 一致）
  const [jobType, setJobType] = useState<'standard' | 'blackbox'>('standard')
  const [blackboxCategory, setBlackboxCategory] = useState<'interface_service' | 'application'>('interface_service')
  const [blackboxModule, setBlackboxModule] = useState('')
  // 采集器与标签模板（与单域抽屉对齐的公共参数）
  const [collectorMode, setCollectorMode] = useState<'default' | 'manual'>('default')
  const [labelTemplates, setLabelTemplates] = useState<{ id: number | string; name: string; resource_category?: string }[]>([])
  // 编辑态：逐域实例明细（生效端口 + 安装确认）
  const [instancesByJob, setInstancesByJob] = useState<Record<string, JobInstanceV3[]>>({})
  const [instanceLoading, setInstanceLoading] = useState(false)
  const [conditions, setConditions] = useState<FilterCondition[]>(DEFAULT_CONDITIONS)
  const [pendingField, setPendingField] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<InstanceCandidateV3[]>([])
  const [domains, setDomains] = useState<DomainHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Record<string, InstanceCandidateV3>>({})
  const [filtersChanged, setFiltersChanged] = useState(false)
  const navigate = useNavigate()
  const [paramsForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const pageSize = 20

  const filters = useMemo(() => toPayloadFilters(conditions), [conditions])
  const payload: CandidateQueryPayload = useMemo(
    () => ({
      template_code: jobType === 'blackbox' ? undefined : templateCode,
      selector: jobType === 'blackbox' ? undefined : normalizeSelector(selector),
      resource_category: resourceCategory,
      filters,
      page,
      page_size: pageSize,
    }),
    [templateCode, selector, jobType, resourceCategory, filters, page],
  )

  // 编辑态：预填公共参数 + 跨域已选实例（子任务反查 instance_ids）
  useEffect(() => {
    if (!open || !record) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setTemplateCode(record.template_code || '')
    setSelector(normalizeSelector(record.selector))
    setJobType(record.job_type === 'blackbox' ? 'blackbox' : 'standard')
    setBlackboxModule(record.blackbox_module ?? '')
    /* eslint-enable react-hooks/set-state-in-effect */
    setTaskName(record.name)
    setJobNameOverride(record.job_name !== record.name ? record.job_name : '')
    paramsForm.setFieldsValue({
      scrape_interval: record.scrape_interval,
      scrape_timeout: record.scrape_timeout,
      metrics_path: record.metrics_path,
      scheme: record.scheme,
      auth_type: 'none',
      tls_skip_verify: false,
      label_template_id: '',
    })
    let cancelled = false
    void Promise.all(record.domains.map((domain) => scrapeJobApiV3.get(domain.job_id).catch(() => null)))
      .then((responses) => {
        if (cancelled) return
        const next: Record<string, InstanceCandidateV3> = {}
        for (const response of responses) {
          if (!response) continue
          const job = response.data
          for (const id of job.selected_instance_ids) {
            next[id] = {
              resource_id: id,
              resource_category: job.resource_category,
              template_code: job.template_code,
              display_name: id,
              instance_ip: '',
              port: 0,
              target_address: '',
              network_domain_id: job.network_domain_id,
              status: 'online',
              selectable: true,
              disabled_reason: '',
            }
          }
        }
        setSelected(next)
      })
    return () => {
      cancelled = true
    }
  }, [open, record, paramsForm])

  // 编辑态：拉取每个域级子任务的实例明细（生效端口 / 安装确认）
  useEffect(() => {
    if (!open || !record) return
    let cancelled = false
    const jobIDs = record.domains.map((domain) => domain.job?.id ?? domain.job_id).filter(Boolean)
    if (jobIDs.length === 0) return
    // 进入编辑态先置加载态（重新拉取语义）
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setInstanceLoading(true)
    void Promise.all(
      jobIDs.map((jobID) =>
        scrapeJobApiV3
          .instances(jobID)
          .then((res) => [jobID, res.data.list ?? []] as const)
          .catch(() => [jobID, []] as const),
      ),
    )
      .then((pairs) => {
        if (cancelled) return
        setInstancesByJob(Object.fromEntries(pairs))
      })
      .finally(() => {
        if (!cancelled) setInstanceLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, record])

  // 确认安装（编辑态，按域）
  const confirmInstance = async (jobID: string, instance: JobInstanceV3) => {
    try {
      await scrapeJobApiV3.confirmInstance(jobID, instance.resource_id, {
        confirmed_by: getStoredUser()?.username ?? 'unknown',
        actual_port: instance.port || undefined,
      })
      const res = await scrapeJobApiV3.instances(jobID)
      setInstancesByJob((prev) => ({ ...prev, [jobID]: res.data.list ?? [] }))
      message.success('已记录安装确认')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '安装确认失败')
    }
  }

  // 拨测模块候选（预置下拉，停用项禁用）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    blackboxModuleApi
      .list()
      .then((res) => {
        if (!cancelled) setBlackboxModules((res.data.list ?? []) as never)
      })
      .catch(() => {
        if (!cancelled) setBlackboxModules([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // 标签模板候选（按资源类别过滤；空 = 使用类别默认模板）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    labelTemplateApi
      .list()
      .then((res) => {
        if (!cancelled) setLabelTemplates((res.data.list ?? []) as never)
      })
      .catch(() => {
        if (!cancelled) setLabelTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // 字段清单与字典选项（schema 驱动：新增字段无需改前端）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    jobGroupApi
      .filterSchema()
      .then((res) => {
        if (!cancelled) setSchema(res.data.fields ?? [])
      })
      .catch(() => {
        if (!cancelled) setSchema([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const ensureOptions = useCallback(
    async (field: CandidateFilterField) => {
      if (field.options?.length || fieldOptions[field.key]?.length) return
      if (!field.source) return
      try {
        let options: Option[] = []
        if (field.source === 'network_domains') {
          const res = await networkDomainMonitorApi.list({ page: 1, page_size: 100 })
          options = (res.data.list ?? []).map((item) => ({ value: item.network_domain_id, label: item.name }))
        } else if (field.source === 'application_dicts') {
          const res = await applicationDictApi.list()
          options = (res.data.list ?? []).map((item) => ({ value: item.app_code, label: item.app_name }))
        } else if (field.source === 'business_domains') {
          const res = await businessDomainApi.list()
          options = (res.data.list ?? []).map((item) => ({ value: item.code, label: item.name }))
        } else if (field.source === 'platform_dicts') {
          const res = await platformDictApi.list()
          options = (res.data.list ?? []).map((item) => ({ value: item.platform_code, label: item.platform_name }))
        }
        setFieldOptions((prev) => ({ ...prev, [field.key]: options }))
      } catch {
        message.warning(`「${field.label}」候选值加载失败，可手动输入`)
      }
    },
    [fieldOptions],
  )

  // 候选查询（条件变化即重查，短防抖）；标准任务未选对象类型时不查询
  const typeMissing = jobType === 'standard' && !templateCode
  const currentCategory = resourceCategory
  const templateOptions = templates
    .filter((item) => item.enabled && item.resource_category === resourceCategory)
    .map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))
  const categoryOptions =
    jobType === 'blackbox'
      ? BLACKBOX_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_MAP[category] }))
      : (Object.keys(CATEGORY_MAP) as ResourceCategory[]).map((category) => ({
          value: category,
          label: CATEGORY_MAP[category],
        }))
  useEffect(() => {
    if (!open || typeMissing) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      jobGroupApi
        .queryCandidates(payload)
        .then((res) => {
          if (cancelled) return
          setRows(res.data.list ?? [])
          setTotal(res.data.total ?? 0)
          setDomains(res.data.domains ?? [])
        })
        .catch((err) => {
          if (!cancelled) message.error(err instanceof Error ? err.message : '候选查询失败')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, payload, typeMissing])

  const resetAll = () => {
    setConditions(DEFAULT_CONDITIONS)
    setSelected({})
    setRows([])
    setDomains([])
    setTotal(0)
    setPage(1)
    setFiltersChanged(false)
    paramsForm.resetFields()
    // 重开时复位任务/对象类型，避免沿用上次选择造成误判
    setJobType('standard')
    setTemplateCode('')
    setSelector(EMPTY_SELECTOR)
    setBlackboxCategory('interface_service')
    setBlackboxModule('')
    setCollectorMode('default')
    setInstancesByJob({})
    setTaskName('')
    setJobNameOverride('')
    setResourceCategory('host')
  }

  const handleClose = () => {
    resetAll()
    onClose()
  }

  const updateCondition = (id: string, patch: Partial<FilterCondition>) => {
    setConditions((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    setPage(1)
    setFiltersChanged(Object.keys(selected).length > 0)
  }

  const removeCondition = (id: string) => {
    setConditions((prev) => prev.filter((item) => item.id !== id))
    setPage(1)
    setFiltersChanged(Object.keys(selected).length > 0)
  }

  const addCondition = (fieldKey: string) => {
    const field = schema.find((item) => item.key === fieldKey)
    if (!field) return
    void ensureOptions(field)
    setConditions((prev) => [
      ...prev,
      { id: `${fieldKey}-${Date.now()}`, field: fieldKey, op: field.ops[0] ?? 'in', values: [] },
    ])
    setPage(1)
    setFiltersChanged(Object.keys(selected).length > 0)
  }

  const selectedList = Object.values(selected)
  const selectedDomainCount = new Set(selectedList.map((item) => item.network_domain_id)).size

  // 已选的真实分域预览（来自所选实例，而不是筛选条件）
  const selectedByDomain = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of selectedList) {
      counts.set(item.network_domain_id, (counts.get(item.network_domain_id) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [selectedList])

  const domainNameOf = (id: string) => {
    const hit = domains.find((item) => item.network_domain_id === id)
    if (hit?.network_domain_name) return hit.network_domain_name
    const option = fieldOptions['network_domain_id']?.find((item) => item.value === id)
    return option?.label ?? id
  }

  const selectAllFiltered = async () => {
    const body: CandidateIdsPayload = {
      template_code: jobType === 'blackbox' ? undefined : templateCode,
      selector: jobType === 'blackbox' ? undefined : normalizeSelector(selector),
      resource_category: resourceCategory,
      filters,
    }
    try {
      const res = await jobGroupApi.candidateIds(body)
      const result = res.data
      if (result.truncated) {
        message.warning(`结果超过 ${result.max_ids} 台，请收窄条件后再全选（当前仅纳入前 ${result.ids.length} 台）`)
      }
      // 全选只补充已知实例：当前页详情的补充由候选行提供，其余用占位行保持计数
      setSelected((prev) => {
        const next = { ...prev }
        for (const id of result.ids) {
          if (!next[id]) {
            const row = rows.find((item) => item.resource_id === id)
            next[id] = row ?? {
              resource_id: id,
              resource_category: resourceCategory,
              template_code: templateCode,
              display_name: id,
              instance_ip: '',
              port: 0,
              target_address: '',
              network_domain_id: '',
              status: 'online',
              selectable: true,
              disabled_reason: '',
            }
          }
        }
        return next
      })
      message.success(`已纳入 ${result.ids.length} 台实例`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '全选失败')
    }
  }

  const clearOutOfFilter = async () => {
    const body: CandidateIdsPayload = {
      template_code: jobType === 'blackbox' ? undefined : templateCode,
      selector: jobType === 'blackbox' ? undefined : normalizeSelector(selector),
      resource_category: resourceCategory,
      filters,
    }
    try {
      const res = await jobGroupApi.candidateIds(body)
      if (res.data.truncated) {
        message.warning('结果超过上限，暂无法精确清理，请收窄条件后重试')
        return
      }
      const allowed = new Set(res.data.ids)
      setSelected((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([id]) => allowed.has(id))),
      )
      setFiltersChanged(false)
      message.success('已清理不在当前筛选内的已选实例')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '清理失败')
    }
  }

  // 表单值参与按钮可用性（与采集 Job 抽屉共用同一套参数契约）
  const blackboxReady = jobType !== 'blackbox' || blackboxModule.trim() !== ''
  const canSave =
    selectedList.length > 0 &&
    taskName.trim() !== '' &&
    !typeMissing &&
    blackboxReady

  const handleSave = async () => {
    if (!canSave) return
    setSubmitting(true)
    try {
      const values = await paramsForm.validateFields()
      const finalName = taskName.trim()
      const payload = {
        name: finalName,
        job_name: jobNameOverride.trim() || finalName,
        job_type: jobType,
        resource_category: resourceCategory,
        template_code: jobType === 'blackbox' ? '' : templateCode,
        selector: jobType === 'blackbox' ? EMPTY_SELECTOR : normalizeSelector(selector),
        blackbox_module: jobType === 'blackbox' ? blackboxModule : values.blackbox_module,
        scrape_interval: values.scrape_interval,
        scrape_timeout: values.scrape_timeout,
        metrics_path: values.metrics_path,
        scheme: values.scheme,
        auth_type: values.auth_type,
        exporter_template_id: collectorMode === 'manual' ? values.exporter_template_id : undefined,
        label_template_id: values.label_template_id,
        selected_instance_ids: Object.keys(selected),
        enabled: true,
        status: 'enabled',
      }
      if (adoptJobId) {
        await jobGroupApi.adoptFromJob(adoptJobId, payload)
        message.success(`已保存任务，覆盖 ${selectedDomainCount} 个网域；正在同步配置`)
      } else if (isEdit && record) {
        await jobGroupApi.update(record.id, payload)
        message.success(`已更新采集任务，覆盖 ${selectedDomainCount} 个网域；正在同步配置`)
      } else {
        await jobGroupApi.create(payload)
        message.success(`已创建采集任务，覆盖 ${selectedDomainCount} 个网域；正在同步配置`)
      }
      // 保存后 best-effort 即时触发本次涉及的网域；失败由 30s watcher 兜底。
      void triggerConfigDrafts(
        Array.from(new Set(selectedList.map((item) => item.network_domain_id).filter(Boolean))),
      )
      onSaved()
      handleClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  const columns: ColumnsType<InstanceCandidateV3> = [
    { title: '实例', dataIndex: 'display_name', key: 'display_name', width: 180 },
    {
      title: '所属网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      width: 180,
      render: (id: string) => domainNameOf(id),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) =>
        status === 'online' ? <Tag color="success">运行中</Tag> : <Tag>{status === 'offline' ? '已停止' : '维护中'}</Tag>,
    },
    { title: '采集地址', dataIndex: 'target_address', key: 'target_address' },
  ]

  return (
    <Drawer
      title={isEdit ? `编辑采集任务 - ${record?.name ?? ''}` : '新建采集任务'}
      width={980}
      open={open}
      onClose={handleClose}
      destroyOnHidden
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleClose}>取消</Button>
          <Button type="primary" loading={submitting} disabled={!canSave} onClick={() => void handleSave()}>
            {isEdit ? '保存修改' : '保存'}（覆盖 {selectedDomainCount} 个网域）
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <Title level={5}>1. 任务</Title>
          <Space wrap align="center" size={12}>
            <Input
              style={{ width: 300 }}
              placeholder="任务名称（必填，全局唯一）"
              maxLength={64}
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
            />
            <Radio.Group
              value={jobType}
              onChange={(event) => {
                const nextType = event.target.value as 'standard' | 'blackbox'
                setJobType(nextType)
                if (nextType === 'blackbox') {
                  setResourceCategory('interface_service')
                  setTemplateCode('')
                  setSelector(EMPTY_SELECTOR)
                } else {
                  setResourceCategory('host')
                }
                setSelected({})
                setPage(1)
                setFiltersChanged(false)
              }}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="standard">采集</Radio.Button>
              <Radio.Button value="blackbox">拨测</Radio.Button>
            </Radio.Group>
          </Space>
          <Collapse ghost size="small" style={{ marginTop: 4 }}>
            <Collapse.Panel header="高级：下发任务名（job 标签）" key="job-name">
              <Input
                style={{ width: 320 }}
                placeholder="留空则同任务名称"
                maxLength={64}
                value={jobNameOverride}
                onChange={(event) => setJobNameOverride(event.target.value)}
              />
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  它是指标里的 job 标签；创建后改名会让历史序列按新 job 断档，且需同域唯一。
                </Text>
              </div>
            </Collapse.Panel>
          </Collapse>
        </div>

        <div>
          <Title level={5}>2. 采集模板与范围</Title>
          <Space wrap align="center" size={12}>
            <Select
              style={{ width: 200 }}
              value={resourceCategory}
              options={categoryOptions}
              onChange={(value) => {
                const next = value as ResourceCategory
                setResourceCategory(next)
                if (jobType === 'blackbox') {
                  setBlackboxCategory(next as 'interface_service' | 'application')
                } else {
                  setTemplateCode('')
                  setSelector(EMPTY_SELECTOR)
                }
                setSelected({})
                setPage(1)
              }}
            />
            {jobType === 'standard' ? (
              <Select
                style={{ minWidth: 240 }}
                placeholder="采集模板"
                showSearch
                optionFilterProp="label"
                value={templateCode || undefined}
                options={templateOptions}
                onChange={(value) => {
                  const picked = templates.find((item) => item.code === value)
                  setTemplateCode(value)
                  if (picked) {
                    setResourceCategory(picked.resource_category)
                    setSelector(normalizeSelector(picked.default_selector))
                  }
                  setSelected({})
                  setPage(1)
                  setFiltersChanged(false)
                }}
              />
            ) : (
              <Select
                style={{ minWidth: 260 }}
                placeholder="拨测模块（必填）"
                showSearch
                optionFilterProp="label"
                value={blackboxModule || undefined}
                options={blackboxModules.map((module) => ({
                  value: module.name,
                  label: module.enabled ? module.name : `${module.name}（已停用）`,
                  disabled: !module.enabled,
                }))}
                onChange={(value) => setBlackboxModule(value)}
              />
            )}
          </Space>
          {jobType === 'standard' && (
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                采哪些对象：条件来自字段字典；留空表示该类别全部资源
              </Text>
              <SelectorEditor
                value={selector}
                onChange={setSelector}
                category={resourceCategory}
                fields={candidateFields}
              />
            </div>
          )}
          {jobType === 'blackbox' && !blackboxModule && (
            <div>
              <Text type="danger" style={{ fontSize: 12 }}>
                拨测任务必须选择拨测模块
              </Text>
            </div>
          )}
        </div>

        <div>
          <Title level={5}>3. 筛选与实例</Title>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {conditions.map((condition) => {
              const field = schema.find((item) => item.key === condition.field)
              const options = field?.options ?? fieldOptions[condition.field] ?? []
              return (
                <Space key={condition.id} wrap align="center">
                  <Tag>{field?.label ?? condition.field}</Tag>
                  {field?.type === 'text' ? (
                    <Input
                      style={{ width: 260 }}
                      placeholder="输入精确值"
                      value={condition.values[0] ?? ''}
                      onChange={(event) => updateCondition(condition.id, { values: [event.target.value] })}
                    />
                  ) : (
                    <Select
                      mode="multiple"
                      style={{ minWidth: 260 }}
                      placeholder="选择取值"
                      value={condition.values}
                      options={options}
                      loading={!options.length}
                      onDropdownVisibleChange={(visible) => {
                        if (visible && field) void ensureOptions(field)
                      }}
                      onChange={(values: string[]) => updateCondition(condition.id, { values })}
                    />
                  )}
                  <Button type="link" danger size="small" onClick={() => removeCondition(condition.id)}>
                    移除
                  </Button>
                  {condition.field === 'network_domain_id' && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      只收窄本次可选实例；实际下发哪些网域由所选实例所属网域决定
                    </Text>
                  )}
                </Space>
              )
            })}
            <Space>
              <Select<string | undefined>
                style={{ width: 220 }}
                placeholder="+ 添加条件"
                value={pendingField}
                options={schema
                  .filter((field) => !conditions.some((condition) => condition.field === field.key))
                  .map((field) => ({ value: field.key, label: field.label }))}
                onChange={(value) => {
                  if (value) addCondition(value)
                  setPendingField(undefined)
                }}
              />
              <Button icon={<ReloadOutlined />} onClick={() => setPage(1)}>
                刷新
              </Button>
            </Space>
          </Space>
          {filtersChanged && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 8 }}
              message="筛选条件已变化，已选实例仍保留（保存以实际已选为准）"
              action={
                <Button size="small" onClick={() => void clearOutOfFilter()}>
                  清理不在筛选内的已选
                </Button>
              }
            />
          )}
        </div>

        <div>
          <Space style={{ marginBottom: 8, justifyContent: 'space-between', width: '100%' }}>
            <Text>
              已选 <Text strong>{selectedList.length}</Text> 台 · 覆盖 <Text strong>{selectedDomainCount}</Text> 个网域
              {selectedByDomain.length > 0 && (
                <Text type="secondary" style={{ marginInlineStart: 8, fontSize: 12 }}>
                  （{selectedByDomain.map(([id, count]) => `${domainNameOf(id)} ${count} 台`).join(' / ')}）
                </Text>
              )}
            </Text>
            <Space>
              <Button size="small" onClick={() => void selectAllFiltered()} disabled={total === 0}>
                全选筛选结果（共 {total} 台）
              </Button>
              <Button size="small" disabled={selectedList.length === 0} onClick={() => setSelected({})}>
                清空已选
              </Button>
            </Space>
          </Space>
          <Table<InstanceCandidateV3>
            rowKey="resource_id"
            size="small"
            loading={loading}
            dataSource={rows}
            columns={columns}
            scroll={{ x: 720 }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (nextPage) => setPage(nextPage),
            }}
            rowSelection={{
              preserveSelectedRowKeys: true,
              selectedRowKeys: Object.keys(selected),
              // 用行级回调维护选择集：跨页/跨筛选的已选不会被聚合回调覆盖
              onSelect: (record, checked) => {
                setSelected((prev) => {
                  const next = { ...prev }
                  if (checked) next[record.resource_id] = record
                  else delete next[record.resource_id]
                  return next
                })
              },
              onSelectAll: (checked, _selectedRows, changeRows) => {
                setSelected((prev) => {
                  const next = { ...prev }
                  for (const row of changeRows) {
                    if (checked) next[row.resource_id] = row
                    else delete next[row.resource_id]
                  }
                  return next
                })
              },
            }}
            locale={{
              emptyText: (
                <Empty
                  description={
                    typeMissing
                      ? '请先在上方选择采集模板'
                      : '没有匹配的实例，请检查下面的生效条件'
                  }
                >
                  {!typeMissing && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      当前条件：{jobType === 'blackbox'
                        ? `拨测 / ${blackboxCategory === 'application' ? '应用服务' : '接口服务'}`
                        : `采集 / ${templates.find((item) => item.code === templateCode)?.name ?? templateCode}`}
                      {conditions
                        .filter((condition) => condition.values.length > 0)
                        .map((condition) => {
                          const field = schema.find((item) => item.key === condition.field)
                          return ` · ${field?.label ?? condition.field}=${condition.values.join('、')}`
                        })
                        .join('')}
                      ；主机按操作系统区分（Linux/Windows），类型不符或状态为「维护中」都会被排除
                    </Text>
                  )}
                </Empty>
              ),
            }}
          />
        </div>

        {domains.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前筛选命中：
              {domains
                .map((hit) => `${hit.network_domain_name || hit.network_domain_id} ${hit.count} 台`)
                .join(' / ')}
            </Text>
          </div>
        )}

        <div>
          <Title level={5}>4. 采集参数（同一任务的所有网域共用）</Title>
          <Form
            form={paramsForm}
            layout="vertical"
            initialValues={{
              name: '',
              job_name: '',
              scrape_interval: '15s',
              scrape_timeout: '10s',
              auth_type: 'none',
              tls_skip_verify: false,
              label_template_id: '',
            }}
          >
            <Space wrap align="start" size={16}>
              <Form.Item label="采集器">
                <Space align="center">
                  <Radio.Group
                    value={collectorMode}
                    onChange={(event) => setCollectorMode(event.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                    size="small"
                  >
                    <Radio.Button value="default">使用默认</Radio.Button>
                    <Radio.Button value="manual">手填</Radio.Button>
                  </Radio.Group>
                  <Form.Item name="exporter_template_id" noStyle>
                    <Input
                      style={{ width: 220 }}
                      placeholder={collectorMode === 'manual' ? '采集器模板 ID' : '默认采集器（按类型自动带出）'}
                      disabled={collectorMode !== 'manual'}
                    />
                  </Form.Item>
                </Space>
              </Form.Item>
              <Form.Item name="label_template_id" label="标签模板">
                <Select
                  style={{ width: 260 }}
                  allowClear
                  placeholder="留空使用类别默认标签模板"
                  options={labelTemplates
                    .filter((template) => !template.resource_category || template.resource_category === currentCategory)
                    .map((template) => ({ value: String(template.id), label: template.name }))}
                />
              </Form.Item>
            </Space>
            <JobParamsFields templateCode={templateCode || undefined} />
          </Form>
        </div>


        {isEdit && record && record.domains.length > 0 && (
          <div>
            <Title level={5}>5. 各网域实例与生效端口（编辑态）</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              生效端口由「实例覆盖 → 类型默认 → 采集器默认 → 业务端口兜底」解析；安装确认后可在实例详情查看。
            </Text>
            <Collapse ghost size="small" style={{ marginTop: 8 }}>
              {record.domains.map((domain) => {
                const jobID = domain.job?.id ?? domain.job_id
                const items = instancesByJob[jobID] ?? []
                return (
                  <Collapse.Panel
                    key={jobID}
                    header={`${domain.network_domain_name}（${domain.instance_count} 台）`}
                  >
                    <Table<JobInstanceV3>
                      rowKey="resource_id"
                      size="small"
                      loading={instanceLoading}
                      pagination={false}
                      dataSource={items}
                      columns={[
                        { title: '实例', dataIndex: 'display_name', key: 'display_name', width: 180 },
                        { title: '地址', dataIndex: 'target_address', key: 'target_address', width: 200 },
                        {
                          title: '生效端口',
                          key: 'port',
                          width: 260,
                          render: (_: unknown, item: JobInstanceV3) => {
                            const meta = PORT_SOURCE_LABEL[item.port_source ?? 'unresolved']
                            return (
                              <Space size={4} wrap>
                                <Text code>{item.port ? item.port : '-'}</Text>
                                <Tag color={meta.color}>{meta.text}</Tag>
                                {item.port_source && item.port_source !== 'instance' && (
                                  <Button
                                    type="link"
                                    size="small"
                                    style={{ paddingInline: 0 }}
                                    onClick={() => navigate('/resources')}
                                  >
                                    去资源管理修改
                                  </Button>
                                )}
                              </Space>
                            )
                          },
                        },
                        {
                          title: '安装确认',
                          key: 'installation',
                          width: 200,
                          render: (_: unknown, item: JobInstanceV3) =>
                            item.installation?.status === 'confirmed' ? (
                              <Tag color="green">已确认</Tag>
                            ) : (
                              <Button size="small" type="link" onClick={() => void confirmInstance(jobID, item)}>
                                确认安装
                              </Button>
                            ),
                        },
                      ]}
                      locale={{ emptyText: '该网域暂无实例' }}
                    />
                  </Collapse.Panel>
                )
              })}
            </Collapse>
          </div>
        )}

        {selectedList.length > 0 && (
          <Button type="link" icon={<PlusOutlined />} onClick={() => void selectAllFiltered()} disabled={total === 0}>
            还要把这批筛选结果全部纳入？共 {total} 台
          </Button>
        )}
      </Space>
    </Drawer>
  )
}
