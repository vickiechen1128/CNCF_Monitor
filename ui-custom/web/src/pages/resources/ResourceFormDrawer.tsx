import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  AutoComplete,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography,
  message,
} from 'antd'
import { networkDomainApi } from '../../api/domain'
import {
  applicationDictApi,
  appPlatformRelApi,
  businessDomainApi,
  osOptionApi,
  platformDictApi,
  resourceApi,
} from '../../api/resources'
import type { NetworkDomain } from '../../types/domain'
import type {
  AppPlatformRel,
  ApplicationDict,
  BusinessDomain,
  OSOption,
  PlatformDict,
  ResourceCategory,
  ResourceCreateInput,
  ResourceStatus,
  ResourceUpdateInput,
} from '../../types/resource'
import type { ResourceListItem } from './useResources'

const { Text } = Typography

/**
 * 资源新增/编辑抽屉（Module_07 §11.2）。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md
 * - Drawer 复用新增/编辑两种模式：新增态走 resourceApi.create（resource_id 由后端生成不展示）；
 *   编辑态预填 row 走 resourceApi.update（resource_id/resource_category/source_type 只读展示、§5.2 不可改）。
 * - 表单字段按 resource_category 差异化渲染（§5.6~§5.9 字段表，字段标签用 PRD「UI 展示名」）。
 * - biz_code 必填下拉（businessDomainApi.list 仅启用项，停用不可选）；network_domain 下拉（networkDomainApi.list）。
 * - 校验错误置于字段下方（antd Form rules）；提交按钮 loading+disabled 防重复；
 *   提交失败透传后端错误 Alert（尤其 403/400 场景）；成功后回刷列表（onSuccess）。
 */

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP / ResourcesPage） */
const RESOURCE_CATEGORY_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用服务',
  generic_target: '其他监控目标',
  interface_service: '接口服务',
}

/** 数据来源展示名（§5.2；cmdb 为 v0.4+ 预留） */
const SOURCE_TYPE_MAP: Record<string, string> = {
  manual: '手动录入',
  import: 'Excel 导入',
  cmdb: 'CMDB 同步',
}

/** 环境取值（§5.16.1 / ValidEnvs）：2026-10-21 起收敛为 OPS / PRD / UAT */
const ENV_VALUES = ['OPS', 'PRD', 'UAT']

/** 运行状态取值（§5.2 / §8.1，UI 展示名「运行状态」；孤儿为后续版本预留不入选） */
const STATUS_OPTIONS: { value: ResourceStatus; label: string }[] = [
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'maintenance', label: '维护中' },
]

/** 数据库类型下拉（§5.7.1 database_type 合法值） */
const DATABASE_TYPE_OPTIONS = ['mysql', 'redis', 'postgresql', 'oracle', 'dm8', 'sqlserver', 'mongodb']

/** 中间件类型下拉（§5.7 middleware_type；mysql/redis 已移入 database_type） */
const MIDDLEWARE_TYPE_OPTIONS = ['kafka', 'elasticsearch', 'nginx', 'zookeeper', 'rabbitmq', 'rocketmq']

/** 其他监控目标采集协议（§5.9 scheme，默认 http） */
const SCHEME_OPTIONS = ['http', 'https']

/** 操作系统家族展示名（os_dict.go：linux / windows） */
const OS_FAMILY_LABEL: Record<string, string> = {
  linux: 'Linux',
  windows: 'Windows',
}

/** IPv4 地址校验（§5.16.2 IP 格式） */
const IPV4_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** 主机名 / 域名校验（generic_target 的 instance_ip 支持 IP 或域名，§5.9） */
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** 自定义标签格式 key1=value1;key2=value2（§5.9 / §5.16.1） */
const CUSTOM_LABELS_RE = /^([^=;]+=[^=;]*)(;[^=;]+=[^=;]*)*$/

interface ResourceFormDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  /** 新增态取当前 Tab 类型；编辑态取行 resource_category */
  category: ResourceCategory
  /** 编辑态预填行（新增态为 null） */
  record?: ResourceListItem | null
  onCancel: () => void
  /** 提交成功后回刷列表（ResourcesPage 传入 reload） */
  onSuccess: () => void
}

/** 解析自定义标签输入「key1=value1;key2=value2」为 map（§5.9 custom_labels 为 map 类型） */
function parseCustomLabels(raw?: string): Record<string, string> | undefined {
  if (!raw || !raw.trim()) return undefined
  const result: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const eq = seg.indexOf('=')
    if (eq <= 0) continue
    result[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim()
  }
  return result
}

/** 组装新增请求体：resource_category 创建必传；source_type 由后端置 manual（§5.2/§6.1/T07-06） */
function buildCreateInput(category: ResourceCategory, values: Record<string, unknown>): ResourceCreateInput {
  return {
    resource_category: category,
    network_domain_id: String(values.network_domain_id),
    biz_code: String(values.biz_code),
    app_code: values.app_code ? String(values.app_code) : undefined,
    // {v2026-09-28 决策 110} 平台归属（资源行一等字段）：留空则不下发该键（undefined），
    // 由服务端按所属应用主平台兜底；不传空串，避免被当作显式取值。
    platform_code: values.platform_code ? String(values.platform_code) : undefined,
    // 决策 103 scheme-B：cloud_code 不再随资源写请求体——云由所属网域派生（只读），
    // 表单无「云」录入项，服务端亦不接受该字段。
    env: String(values.env),
    cluster: values.cluster ? String(values.cluster) : undefined,
    owner: values.owner ? String(values.owner) : undefined,
    status: values.status as ResourceStatus,
    ...buildTypeFields(category, values),
  } as ResourceCreateInput
}

/** 组装编辑请求体：resource_id/resource_category/source_type 不可改、不随请求体（§6.1/T07-06） */
function buildUpdateInput(category: ResourceCategory, values: Record<string, unknown>): ResourceUpdateInput {
  return {
    network_domain_id: String(values.network_domain_id),
    biz_code: String(values.biz_code),
    app_code: values.app_code ? String(values.app_code) : undefined,
    // {v2026-09-28 决策 110} 平台归属：编辑态**显式给出**——选中传编码、
    // 清空传 null（表达「取消平台归属」），undefined 会导致「清空后不提交 → 平台残留」。
    platform_code: values.platform_code ? String(values.platform_code) : null,
    // 决策 103 scheme-B：同新增，cloud_code 不经编辑请求体（云随所属网域派生）
    env: String(values.env),
    cluster: values.cluster ? String(values.cluster) : undefined,
    owner: values.owner ? String(values.owner) : undefined,
    status: values.status as ResourceStatus,
    ...buildTypeFields(category, values),
  } as ResourceUpdateInput
}

/** 按资源类别取差异化字段（与 §5.6~§5.9 字段表一致） */
function buildTypeFields(category: ResourceCategory, values: Record<string, unknown>): Record<string, unknown> {
  switch (category) {
    case 'host':
      return {
        instance_name: String(values.instance_name),
        hostname: values.hostname ? String(values.hostname) : undefined,
        instance_ip: String(values.instance_ip),
        os_type: values.os_type ? String(values.os_type) : undefined,
        // {T01-P5} 采集端口：留空 → 提交 0（= 未指定，与 NULL 等价；编辑清空时以 0 回退解析链，提案 §5.1）
        scrape_port: values.scrape_port ? Number(values.scrape_port) : 0,
      }
    case 'database':
      return {
        database_type: String(values.database_type),
        instance_ip: String(values.instance_ip),
        port: Number(values.port),
        version: values.version ? String(values.version) : undefined,
        // {T01-P5} 采集端口语义同 host：留空/0 = 未指定
        scrape_port: values.scrape_port ? Number(values.scrape_port) : 0,
      }
    case 'middleware':
      return {
        middleware_type: String(values.middleware_type),
        instance_ip: String(values.instance_ip),
        port: Number(values.port),
        version: values.version ? String(values.version) : undefined,
        // {T01-P5} 采集端口语义同 host：留空/0 = 未指定
        scrape_port: values.scrape_port ? Number(values.scrape_port) : 0,
      }
    case 'application':
      return {
        service_name: String(values.service_name),
        endpoint: values.endpoint ? String(values.endpoint) : undefined,
        health_check_url: String(values.health_check_url),
        protocol: values.protocol ? String(values.protocol) : undefined,
        port: values.port ? Number(values.port) : undefined,
      }
    case 'generic_target':
      return {
        target_name: String(values.target_name),
        instance_ip: String(values.instance_ip),
        port: values.port ? Number(values.port) : undefined,
        metrics_path: values.metrics_path ? String(values.metrics_path) : undefined,
        scheme: values.scheme ? String(values.scheme) : undefined,
        exporter_type: values.exporter_type ? String(values.exporter_type) : undefined,
        custom_labels: parseCustomLabels(values.custom_labels ? String(values.custom_labels) : undefined),
      }
    case 'interface_service':
      // 接口服务差异化字段：接口名（展示名）+ 接口地址（完整 URL，含 ? 查询参数）。
      // 无采集端口语义，**不提交 scrape_port**（后端 validateScrapePort 仅在填值时校验）。
      return {
        api_name: String(values.api_name),
        api_url: String(values.api_url),
      }
  }
}

/** 后端列表 custom_labels 可能以 JSON 对象字符串返回，统一转换为「k1=v1;k2=v2」表单格式（§5.9） */
function customLabelsToFormString(raw?: string): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      return Object.entries(obj)
        .map(([k, v]) => `${k}=${v}`)
        .join(';')
    } catch {
      // 非 JSON 字符串，按原样回填
    }
  }
  return trimmed
}

/** 编辑态行（ResourceListItem 平铺字段）→ 表单初始值（Form 字段名） */
function recordToFormValues(record: ResourceListItem): Record<string, unknown> {
  return {
    network_domain_id: record.network_domain_id,
    biz_code: record.biz_code,
    app_code: record.app_code,
    // {v2026-09-28 决策 110} 平台归属回显：资源行一等字段；空串归一为 undefined 交由 Select 走未选态
    platform_code: record.platform_code || undefined,
    // 存量环境值（dev/test/staging/prod）不在新枚举内：清空，保存时强制重新选择
    env: record.env && ENV_VALUES.includes(record.env) ? record.env : undefined,
    cluster: record.cluster,
    owner: record.owner,
    status: record.status,
    instance_name: record.instance_name,
    hostname: record.hostname,
    instance_ip: record.instance_ip,
    os_type: record.os_type,
    database_type: record.database_type,
    middleware_type: record.middleware_type,
    port: record.port,
    // {T01-P5} 采集端口回显：后端 0 = 未指定 → 归一为空态（与「留空提交 0」对称）
    scrape_port: record.scrape_port || undefined,
    version: record.version,
    service_name: record.service_name,
    health_check_url: record.health_check_url,
    protocol: record.protocol,
    endpoint: record.endpoint,
    target_name: record.target_name,
    metrics_path: record.metrics_path,
    scheme: record.scheme,
    exporter_type: record.exporter_type,
    custom_labels: customLabelsToFormString(record.custom_labels),
    api_name: record.api_name,
    api_url: record.api_url,
  }
}

/** IPv4 必填校验规则（§5.16.2） */
const requiredIpRules = [
  { required: true, message: '请输入 IP 地址' },
  { pattern: IPV4_RE, message: '请输入合法的 IPv4 地址' },
]

/** generic_target 的 instance_ip 支持 IP 或域名（§5.9） */
const requiredIpOrHostnameRules = [
  { required: true, message: '请输入目标 IP 或域名' },
  {
    validator: (_: unknown, value?: string) => {
      if (!value) return Promise.resolve()
      return IPV4_RE.test(value) || HOSTNAME_RE.test(value)
        ? Promise.resolve()
        : Promise.reject(new Error('请输入合法的 IPv4 地址或域名'))
    },
  },
]

/** 端口校验（1-65535，§5.16） */
const portRules = [
  { required: true, message: '请输入端口' },
  { type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' },
]

/** 可选端口校验（应用服务/其他监控目标，port 非必填） */
const optionalPortRules = [{ type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' }]

/** blackbox 拨测 URL：必填，且必须是含主机的 http/https/tcp URL。 */
const healthCheckUrlRules = [
  { required: true, message: '请输入健康检查 URL' },
  {
    validator: (_: unknown, value?: string) => {
      if (!value || !value.trim()) return Promise.resolve()
      let parsed: URL
      try {
        parsed = new URL(value.trim())
      } catch {
        return Promise.reject(new Error('请输入合法的 http/https 地址'))
      }
      const scheme = parsed.protocol.replace(/:$/, '')
      if (!['http', 'https', 'tcp'].includes(scheme) || !parsed.hostname) {
        return Promise.reject(new Error('请输入合法的 http/https 地址'))
      }
      return Promise.resolve()
    },
  },
]

/**
 * 资源新增/编辑抽屉（Module_07 §11.2）。
 * - 新增态：create，resource_id 由后端生成不展示；编辑态：update，resource_id/资源类别/数据来源只读展示（§5.2 不可改）。
 * - biz_code 必填下拉仅启用业务可选；network_domain 下拉来自 M06 网域清单；停用业务不可选。
 * - 校验错误置于字段下方（antd Form rules）；提交按钮 loading+disabled 防重复；
 *   提交失败透传后端错误 Alert（尤其 403/400）；成功后回刷列表（onSuccess）。
 */
export function ResourceFormDrawer({ open, mode, category, record, onCancel, onSuccess }: ResourceFormDrawerProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [networkDomains, setNetworkDomains] = useState<NetworkDomain[]>([])
  const [businessDomains, setBusinessDomains] = useState<BusinessDomain[]>([])
  // 应用字典（决策 92）：app_code 必填下拉取启用条目；展示名 app_name 由字典解析
  const [applicationDicts, setApplicationDicts] = useState<ApplicationDict[]>([])
  // {v2026-09-28 决策 110} 平台字典：「平台归属」可选下拉取启用条目（资源行一等字段）
  const [platformDicts, setPlatformDicts] = useState<PlatformDict[]>([])
  // 决策 111：应用↔平台 M:N 关联（app_platform_rel）——应用下拉按所选平台过滤的数据源。
  // 应用字典条目上的 platform_code 已废弃（决策 118-3），平台→应用的归属只能经本关联表反查。
  const [appPlatformRels, setAppPlatformRels] = useState<AppPlatformRel[]>([])
  // 操作系统内置字典（仅 host 表单「操作系统」下拉使用，os_dict.go）
  const [osOptions, setOsOptions] = useState<OSOption[]>([])
  const [dictError, setDictError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** 存量环境值（dev/test/staging/prod）不在新枚举内：不迁移，编辑时清空并提示重新选择 */
  const legacyEnv = record?.env && !ENV_VALUES.includes(record.env) ? record.env : undefined

  /** 编辑态以行 resource_category 为准，新增态取传入 Tab 类型 */
  const displayCategory = record?.resource_category ?? category
  const enabledBizDomains = businessDomains.filter((d) => d.enabled)
  // {v2026-09-28 决策 110} 平台字典：下拉仅列启用条目（停用平台禁止新引用，§5C 红线④）
  const enabledPlatformDicts = platformDicts.filter((d) => d.enabled)
  // §5.2 必填口径：application / database / middleware / interface_service 必填，host / generic_target 可空
  const appCodeRequired =
    displayCategory === 'application' ||
    displayCategory === 'database' ||
    displayCategory === 'middleware' ||
    displayCategory === 'interface_service'
  // 决策 F（§5.2）：cluster 必填规则 —— application / database / middleware 必填，
  // host / generic_target / interface_service 放开为可空（SNMP 交换机等设备类无集群归属，
  // 强制必填会逼填假数据污染 cluster 标签；接口服务后端 validateInterfaceService 亦不要求
  // cluster；空值不注入标签，见 5.15 规则 4）。与后端 validate.go 的三处 cluster 必填校验同口径，
  // 否则用户在必填类提交空 cluster 会撞后端 400 且前端无任何提示（静默失败）。
  // 刻意与 appCodeRequired 解耦——interface_service 要求 app_code 但不要求 cluster。
  const clusterRequired =
    displayCategory === 'application' || displayCategory === 'database' || displayCategory === 'middleware'

  /**
   * {v2026-09-28 决策 110 ④} 表单级联：**先选平台 → 再选应用（按所选平台过滤）**。
   *
   * 平台→应用的过滤依据**只能**是 `app_platform_rel`（决策 111 M:N）：应用字典条目上的
   * 单值 `platform_code` 已废弃（决策 118-3 全仓生产消费者归零），不可用于派生。
   * 未选平台时不做过滤（保持全量启用应用可选，避免「先选平台」成为硬前置）。
   */
  const selectedPlatformCode = Form.useWatch('platform_code', form) as string | undefined

  /** 关联到所选平台的应用编码集合（未选平台时为 null，表示「不按平台过滤」） */
  const appCodesOnSelectedPlatform = useMemo(() => {
    if (!selectedPlatformCode) return null
    return new Set(
      appPlatformRels.filter((r) => r.platform_code === selectedPlatformCode).map((r) => r.app_code),
    )
  }, [appPlatformRels, selectedPlatformCode])

  /** 应用下拉选项：启用条目 ∩ 所选平台关联集合（决策 110 ④ 级联过滤） */
  const appDictOptions = useMemo(
    () =>
      applicationDicts.filter((d) => {
        if (d.status !== 'enabled') return false
        if (!appCodesOnSelectedPlatform) return true
        return appCodesOnSelectedPlatform.has(d.app_code)
      }),
    [applicationDicts, appCodesOnSelectedPlatform],
  )
  // 应用下拉实际渲染时用（已按平台过滤）；未选平台时退化为全部启用应用
  const enabledAppDicts = appDictOptions

  useEffect(() => {
    if (!open) return
    // 打开抽屉时同步重置提交错误；沿用本模块既有 set-state-in-effect 模式（异步请求回调内才异步 setState）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    if (mode === 'create') {
      form.resetFields()
      // 仅预填 scheme:http（其他监控目标采集协议默认）；status 为 PRD 必填项，刻意不预填，强制用户显式选择
      form.setFieldsValue({ scheme: 'http' })
    } else if (record) {
      form.resetFields()
      form.setFieldsValue(recordToFormValues(record))
    }
    // 网域 / 业务字典 + 操作系统字典下拉（M06 网域清单 / §3.1 业务字典 / os_dict.go）
    // 决策 103 scheme-B：不再拉取云字典——表单无「云」录入项，云由所属网域派生。
    // {v2026-09-28 决策 110}：增拉平台字典（「平台归属」下拉）。
    Promise.all([
      networkDomainApi.list({ page: 1, page_size: 100 }),
      businessDomainApi.list(),
      osOptionApi.list(),
      applicationDictApi.list(),
      platformDictApi.list(),
    ])
      .then(([nd, bd, os, ad, pd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
        setOsOptions(os.data?.list ?? [])
        setApplicationDicts(ad.data?.list ?? [])
        setPlatformDicts(pd.data?.list ?? [])
        setDictError(null)
      })
      .catch((err: Error) => setDictError(err.message))
    // 决策 110 ④ 级联：应用↔平台 M:N 关联（app_platform_rel），用于按所选平台过滤应用下拉。
    // 该数据仅影响级联过滤的收敛度，**加载失败静默降级**为「不按平台过滤」，不阻塞表单填写。
    appPlatformRelApi
      .list()
      .then((res) => setAppPlatformRels(res.data?.list ?? []))
      .catch(() => setAppPlatformRels([]))
  }, [open, mode, record, form])

  const handleSubmit = async () => {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      // 字段校验失败，错误已由 Form.Item 置于字段下方；不提交
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (mode === 'create') {
        await resourceApi.create(buildCreateInput(category, values))
        message.success('资源已新增')
      } else if (record) {
        await resourceApi.update(record.resource_id, buildUpdateInput(displayCategory, values))
        message.success('资源已更新')
      }
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '提交失败，请稍后重试')
      setSubmitting(false)
    }
  }

  /**
   * {v2026-10-03 决策 110 ④} 级联收敛：切换 / 清空「平台归属」后，若已选应用不再属于
   * 新平台（或未选平台时为全量可用），则一并清空应用与服务选择——否则会残留
   * 「应用不属于所选平台」的组合，提交时被服务端自洽性校验拒绝。
   */
  const handlePlatformChange = () => {
    // setFieldsValue 不触发 onChange 递归；用 setTimeout 推至本轮渲染后读取最新 watch 值
    setTimeout(() => {
      const platform = form.getFieldValue('platform_code') as string | undefined
      const appCode = form.getFieldValue('app_code') as string | undefined
      if (!platform || !appCode) return
      const stillValid = appPlatformRels.some((r) => r.platform_code === platform && r.app_code === appCode)
      if (!stillValid) {
        form.setFieldsValue({ app_code: undefined })
      }
    })
  }

  /**
   * 六类资源共享字段（§5.2 公共字段）。两列紧凑布局，避免单列留白。
   * 行序：网域 /（平台归属｜环境）→ 业务 / 应用 →（环境｜运行状态）/（运行状态｜集群）→（集群 / 负责人｜负责人满宽）。
   * 「业务」与「应用」固定在**同一行**靠拢；「平台归属」仅对接口服务以外的类别渲染
   * （接口服务由 blackbox 拨测承载、无平台归属概念，后端 Excel 导入模板亦不含 platform_code 列）。
   * 平台归属仍排在「应用」之前，保留「平台 → 应用」级联（选中平台后应用下拉按平台过滤）。
   */
  const renderSharedFields = () => {
    const isInterface = displayCategory === 'interface_service'
    return (
      <>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="网域" name="network_domain_id" rules={[{ required: true, message: '请选择网域' }]}>
              <Select showSearch optionFilterProp="label" placeholder="请选择网域">
                {networkDomains.map((d) => (
                  <Select.Option key={d.id} value={d.id} label={`${d.name} (${d.id})`}>
                    {d.name} ({d.id})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            {/* 接口服务无平台归属：该格换为「环境」，使两列填满（0 留白） */}
            {isInterface ? (
              <Form.Item
                label="环境"
                name="env"
                rules={[{ required: true, message: '请选择环境' }]}
                extra={legacyEnv ? `原环境「${legacyEnv}」已停用，请重新选择` : undefined}
              >
                <Select placeholder="请选择环境">
                  {ENV_VALUES.map((e) => (
                    <Select.Option key={e} value={e}>
                      {e}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            ) : (
              <Form.Item
                label="平台归属"
                name="platform_code"
                extra="可选：取平台字典启用条目；留空则按所属应用的主平台兜底"
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  allowClear
                  placeholder="请选择平台归属（可选）"
                  onChange={handlePlatformChange}
                >
                  {enabledPlatformDicts.map((d) => (
                    <Select.Option key={d.platform_code} value={d.platform_code} label={`${d.platform_name} (${d.platform_code})`}>
                      {d.platform_name} ({d.platform_code})
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="业务"
              name="biz_code"
              extra="仅启用业务可选；停用业务不可选"
              rules={[{ required: true, message: '请选择业务' }]}
            >
              <Select showSearch optionFilterProp="label" placeholder="请选择业务">
                {enabledBizDomains.map((d) => (
                  <Select.Option key={d.code} value={d.code} label={`${d.name} (${d.code})`}>
                    {d.name} ({d.code})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            {/* 应用与「业务」同排靠拢 */}
            <Form.Item
              label="应用"
              name="app_code"
              extra={
                selectedPlatformCode
                  ? '仅列出关联到所选平台的应用；`app` 标签取编码，展示名由字典解析'
                  : '取应用字典启用条目；`app` 标签取编码，展示名由字典解析'
              }
              rules={appCodeRequired ? [{ required: true, message: '请选择应用' }] : []}
            >
              <Select showSearch optionFilterProp="label" placeholder={appCodeRequired ? '请选择应用' : '请选择应用（可选）'} allowClear>
                {enabledAppDicts.map((d) => (
                  <Select.Option key={d.app_code} value={d.app_code} label={`${d.app_name} (${d.app_code})`}>
                    {d.app_name} ({d.app_code})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            {/* 非接口：环境；接口：运行状态（因环境已上移到首行） */}
            {isInterface ? (
              <Form.Item label="运行状态" name="status" rules={[{ required: true, message: '请选择运行状态' }]}>
                <Select placeholder="请选择运行状态">
                  {STATUS_OPTIONS.map((s) => (
                    <Select.Option key={s.value} value={s.value}>
                      {s.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            ) : (
              <Form.Item
                label="环境"
                name="env"
                rules={[{ required: true, message: '请选择环境' }]}
                extra={legacyEnv ? `原环境「${legacyEnv}」已停用，请重新选择` : undefined}
              >
                <Select placeholder="请选择环境">
                  {ENV_VALUES.map((e) => (
                    <Select.Option key={e} value={e}>
                      {e}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}
          </Col>
          <Col span={12}>
            {/* 非接口：运行状态；接口：集群（因运行状态已上移） */}
            {isInterface ? (
              <Form.Item
                label="集群"
                name="cluster"
                rules={clusterRequired ? [{ required: true, message: '请填写集群' }] : []}
              >
                <Input placeholder={clusterRequired ? '请填写集群' : '集群名（可选）'} maxLength={64} />
              </Form.Item>
            ) : (
              <Form.Item label="运行状态" name="status" rules={[{ required: true, message: '请选择运行状态' }]}>
                <Select placeholder="请选择运行状态">
                  {STATUS_OPTIONS.map((s) => (
                    <Select.Option key={s.value} value={s.value}>
                      {s.label}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            )}
          </Col>
        </Row>
        {isInterface ? (
          /* 接口服务共 6 个网格字段，末行「负责人」满宽，整体 0 留白 */
          <Form.Item label="负责人" name="owner">
            <Input placeholder="负责人（可选）" maxLength={32} />
          </Form.Item>
        ) : (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="集群"
                name="cluster"
                rules={clusterRequired ? [{ required: true, message: '请填写集群' }] : []}
              >
                <Input placeholder={clusterRequired ? '请填写集群' : '集群名（可选）'} maxLength={64} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="负责人" name="owner">
                <Input placeholder="负责人（可选）" maxLength={32} />
              </Form.Item>
            </Col>
          </Row>
        )}
      </>
    )
  }

  /**
   * {T01-P5} host / database / middleware 三类表单共用的「采集端口（选填）」
   * （提案 resource-scrape-port-chain §5.3 录入动线；留空合法，由解析链回落默认端口）。
   *
   * D3a/D3b 守护：application / generic_target **不渲染**该项——application 的
   * 「端口（采集端口）」即采集目标本身（必填直用）、generic_target 的「端口」是端点
   * 自身属性，再展示一个「采集端口」会造成误填暗示。
   *
   * 刻意不设 InputNumber min/max：失焦钳制会把 70000 静默改写成 65535 而无从报错，
   * 放开控件层边界、仅由 rules 在提交时以「端口范围为 1-65535」阻断，保证越界必报错。
   */
  const scrapePortField = (
    <Form.Item
      label="采集端口（选填）"
      name="scrape_port"
      extra="留空时由采集端口解析链取默认（类型映射 → 采集器模板 → 业务端口）"
      rules={optionalPortRules}
    >
      <InputNumber style={{ width: '100%' }} placeholder="例如：9100（可选）" data-testid="scrape-port-input" />
    </Form.Item>
  )

  /** 各资源类别差异化字段（与 §5.6~§5.9 字段表一致，标签用 PRD「UI 展示名」） */
  const renderTypeFields = (type: ResourceCategory) => {
    switch (type) {
      case 'host':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name" rules={[{ required: true, message: '请输入实例名' }]}>
                  <Input placeholder="例如：prod-web-01" maxLength={64} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="主机名" name="hostname">
                  <Input placeholder="主机名（可选）" maxLength={128} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="IP 地址" name="instance_ip" rules={requiredIpRules}>
                  <Input placeholder="例如：10.0.1.11" maxLength={15} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="操作系统"
                  name="os_type"
                  extra="按内置字典选择或输入常用操作系统名；采集 Job 将按 Linux/Windows 家族匹配"
                  rules={[{ required: true, message: '请输入操作系统' }]}
                >
                  <AutoComplete
                    placeholder="请选择或输入操作系统，例如：Ubuntu"
                    options={osOptions.map((o) => ({
                      value: o.name,
                      label: `${o.name}（${OS_FAMILY_LABEL[o.family] ?? o.family}）`,
                    }))}
                    // 未选中字典项时允许自定义输入（保留原值，由后端 NormalizeOSType 兜底家族）
                    filterOption={(input, option) =>
                      (option?.value as string).toLowerCase().includes(input.toLowerCase())
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>{scrapePortField}</Col>
            </Row>
          </>
        )
      case 'database':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="数据库类型"
                  name="database_type"
                  rules={[{ required: true, message: '请选择数据库类型' }]}
                >
                  <Select placeholder="请选择数据库类型" showSearch optionFilterProp="label">
                    {DATABASE_TYPE_OPTIONS.map((t) => (
                      <Select.Option key={t} value={t} label={t}>
                        {t}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="版本" name="version">
                  <Input placeholder="版本（可选）" maxLength={32} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="IP 地址" name="instance_ip" rules={requiredIpRules}>
                  <Input placeholder="例如：10.0.1.21" maxLength={15} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="端口" name="port" rules={portRules}>
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：3306" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>{scrapePortField}</Col>
            </Row>
          </>
        )
      case 'middleware':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="中间件类型"
                  name="middleware_type"
                  rules={[{ required: true, message: '请选择中间件类型' }]}
                >
                  <Select placeholder="请选择中间件类型" showSearch optionFilterProp="label">
                    {MIDDLEWARE_TYPE_OPTIONS.map((t) => (
                      <Select.Option key={t} value={t} label={t}>
                        {t}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="版本" name="version">
                  <Input placeholder="版本（可选）" maxLength={32} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="IP 地址" name="instance_ip" rules={requiredIpRules}>
                  <Input placeholder="例如：10.0.1.31" maxLength={15} />
                </Form.Item>
              </Col>
              <Col span={12}>
                {/* 端口是中间件实例身份的一部分（与 instance_ip 共同构成采集目标 `ip:port`），
                    data-testid 供测试精确定位——label 文案「端口」在 host 表单不渲染，
                    但跨类别断言时按testid 定位更稳（antd label 会被 requiredMark 注入额外文本）。 */}
                <Form.Item label="端口" name="port" rules={portRules}>
                  <InputNumber
                    style={{ width: '100%' }}
                    min={1}
                    max={65535}
                    placeholder="例如：9092"
                    data-testid="middleware-port-input"
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>{scrapePortField}</Col>
            </Row>
          </>
        )
      case 'application':
        return (
          <>
            <Form.Item label="服务名" name="service_name" rules={[{ required: true, message: '请输入服务名' }]}>
              <Input placeholder="例如：order-service" maxLength={64} />
            </Form.Item>
            <Form.Item
              label="健康检查 URL"
              name="health_check_url"
              extra="必填，作为 blackbox 拨测目标地址"
              rules={healthCheckUrlRules}
            >
              <Input placeholder="例如：http://10.10.1.4:8081/actuator/health" maxLength={256} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="端点（采集地址主机）"
                  name="endpoint"
                  extra="选填；与端口一起构成 standard 指标采集目标"
                >
                  <Input placeholder="例如：10.10.1.4" maxLength={128} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="端口（采集端口）"
                  name="port"
                  extra="选填；exporter 指标端点监听端口，例如 8081"
                  rules={optionalPortRules}
                >
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：8081" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="协议" name="protocol" extra="资源画像用（采集协议由采集 Job 的 scheme 决定）">
              <Input placeholder="例如：http（可选）" maxLength={16} />
            </Form.Item>
          </>
        )
      case 'generic_target':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="目标名称" name="target_name" rules={[{ required: true, message: '请输入目标名称' }]}>
                  <Input placeholder="如 核心交换-01" maxLength={64} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Exporter 类型" name="exporter_type" extra="如 snmp_exporter / gpu_exporter / oracle_exporter">
                  <Input placeholder="如 snmp_exporter / gpu_exporter" maxLength={64} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="目标 IP / 域名"
                  name="instance_ip"
                  rules={requiredIpOrHostnameRules}
                  extra="必填且符合 IPv4/域名格式"
                >
                  <Input placeholder="如 172.16.0.1" maxLength={128} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="端口" name="port" rules={optionalPortRules} extra="留空时不生成实例标识（instance）">
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="如 9116（可选）" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="采集路径" name="metrics_path" initialValue="/metrics">
                  <Input placeholder="/metrics" maxLength={128} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="协议" name="scheme" initialValue="http">
                  <Select placeholder="请选择协议">
                    {SCHEME_OPTIONS.map((s) => (
                      <Select.Option key={s} value={s}>
                        {s}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="自定义标签"
              name="custom_labels"
              extra="支持 key1=value1;key2=value2 格式，可选"
              rules={[{ pattern: CUSTOM_LABELS_RE, message: '格式为 key1=value1;key2=value2' }]}
            >
              <Input placeholder="如 device_type=snmp_switch;vendor=h3c" maxLength={512} />
            </Form.Item>
          </>
        )
      case 'interface_service':
        // 接口服务差异化字段：接口名 + 接口地址。**不渲染采集端口**（无采集端口语义）——
        // 该类由 blackbox 拨测采集任务承载，拨测目标地址直接取接口地址。
        return (
          <>
            <Form.Item label="接口名" name="api_name" rules={[{ required: true, message: '请输入接口名' }]}>
              <Input placeholder="例如：订单查询接口" maxLength={200} />
            </Form.Item>
            <Form.Item
              label="接口地址"
              name="api_url"
              extra="必填：填完整 URL（含 ? 查询参数），如 https://api.example.com/health?token=xxx"
              rules={[{ required: true, message: '请输入接口地址' }]}
            >
              <Input placeholder="例如：https://api.example.com/health?token=xxx" maxLength={500} />
            </Form.Item>
          </>
        )
    }
  }

  /** 编辑态只读展示：resource_id / 资源类别 / 数据来源（§5.2 创建后不可改） */
  const renderReadonlyInfo = () => {
    if (mode !== 'edit' || !record) return null
    return (
      <div style={{ marginBottom: 16, background: 'rgba(0,0,0,0.02)', padding: '8px 12px', borderRadius: 6 }}>
        <Space size={24} wrap>
          <Text type="secondary">
            资源 ID：<Text code>{record.resource_id}</Text>
          </Text>
          <Text type="secondary">资源类别：{RESOURCE_CATEGORY_MAP[displayCategory]}</Text>
          <Text type="secondary">数据来源：{SOURCE_TYPE_MAP[record.source_type] ?? record.source_type}</Text>
        </Space>
      </div>
    )
  }

  return (
    <Drawer
      title={
        mode === 'create'
          ? `新增资源（${RESOURCE_CATEGORY_MAP[category]}）`
          : `编辑资源（${RESOURCE_CATEGORY_MAP[displayCategory]}）`
      }
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={560}
      // forceRender：Drawer 首次打开时内容惰性挂载（rc-drawer 动画期先于父组件
      // useEffect 的 setFieldsValue 完成挂载），导致编辑回显首次为空、二次才出现；
      // forceRender 保证 Form 常驻挂载，首次打开即正确回显（#19 通病，M07 资源抽屉）。
      forceRender
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
              {mode === 'create' ? '提交' : '保存'}
            </Button>
          </Space>
        </div>
      }
    >
      {dictError && (
        <Alert
          type="warning"
          showIcon
          message="字典加载失败"
          description="网域 / 业务 / 应用 / 操作系统字典加载失败，请稍后重试"
          style={{ marginBottom: 16 }}
        />
      )}
      {submitError && (
        <Alert type="error" showIcon message="提交失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      {renderReadonlyInfo()}
      <Form form={form} layout="vertical" name="resource-form" requiredMark preserve={false}>
        {renderSharedFields()}
        {renderTypeFields(displayCategory)}
      </Form>
    </Drawer>
  )
}

export default ResourceFormDrawer
