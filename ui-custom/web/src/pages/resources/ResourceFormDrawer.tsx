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
  serviceDictApi,
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
  ServiceDict,
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
}

/** 数据来源展示名（§5.2；cmdb 为 v0.4+ 预留） */
const SOURCE_TYPE_MAP: Record<string, string> = {
  manual: '手动录入',
  import: 'Excel 导入',
  cmdb: 'CMDB 同步',
}

/** 环境取值（§5.16.1 / ValidEnvs） */
const ENV_VALUES = ['dev', 'test', 'staging', 'prod']

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
      }
    case 'database':
      return {
        database_type: String(values.database_type),
        instance_ip: String(values.instance_ip),
        port: Number(values.port),
        version: values.version ? String(values.version) : undefined,
      }
    case 'middleware':
      return {
        middleware_type: String(values.middleware_type),
        instance_ip: String(values.instance_ip),
        port: Number(values.port),
        version: values.version ? String(values.version) : undefined,
      }
    case 'application':
      // 采集地址拆分（M07 字段治理）：endpoint（主机）+ port（采集端口）必填且共同构成采集目标；
      // health_check_url 为应用实际 URL，可选、不参与采集；protocol 仅资源画像，可选。
      return {
        service_name: String(values.service_name),
        endpoint: String(values.endpoint),
        health_check_url: values.health_check_url ? String(values.health_check_url) : undefined,
        protocol: values.protocol ? String(values.protocol) : undefined,
        port: Number(values.port),
        // 决策 105：可选服务归属，留空合法（不注入 svc 标签）
        service_code: values.service_code ? String(values.service_code) : undefined,
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
        // 决策 105：可选服务归属，留空合法（不注入 svc 标签）
        service_code: values.service_code ? String(values.service_code) : undefined,
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
    env: record.env,
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
    // 决策 105：可选服务归属（仅 application / generic_target）
    service_code: record.service_code,
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

/**
 * 健康检查 URL 校验（可选）：非空时仅校验为合法 URL（http/https/tcp 且含主机）；
 * 该字段是应用实际访问地址，仅作资源画像 / 标签来源，不参与指标采集与地址派生。
 */
const healthCheckUrlRules = [
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
  // 服务字典（决策 105）：service_code 可选下拉取启用条目，仅 application / generic_target 渲染
  const [serviceDicts, setServiceDicts] = useState<ServiceDict[]>([])
  // {v2026-09-28 决策 110} 平台字典：「平台归属」可选下拉取启用条目（资源行一等字段）
  const [platformDicts, setPlatformDicts] = useState<PlatformDict[]>([])
  // 决策 111：应用↔平台 M:N 关联（app_platform_rel）——应用下拉按所选平台过滤的数据源。
  // 应用字典条目上的 platform_code 已废弃（决策 118-3），平台→应用的归属只能经本关联表反查。
  const [appPlatformRels, setAppPlatformRels] = useState<AppPlatformRel[]>([])
  // 操作系统内置字典（仅 host 表单「操作系统」下拉使用，os_dict.go）
  const [osOptions, setOsOptions] = useState<OSOption[]>([])
  const [dictError, setDictError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** 编辑态以行 resource_category 为准，新增态取传入 Tab 类型 */
  const displayCategory = record?.resource_category ?? category
  const enabledBizDomains = businessDomains.filter((d) => d.enabled)
  // {v2026-09-28 决策 110} 平台字典：下拉仅列启用条目（停用平台禁止新引用，§5C 红线④）
  const enabledPlatformDicts = platformDicts.filter((d) => d.enabled)
  // §5.2 必填口径：application / database / middleware 必填，host / generic_target 可空
  const appCodeRequired =
    displayCategory === 'application' || displayCategory === 'database' || displayCategory === 'middleware'

  /**
   * {v2026-09-28 决策 110 ④} 表单级联：**先选平台 → 再选应用（按所选平台过滤）→ 再选服务**。
   *
   * 平台→应用的过滤依据**只能**是 `app_platform_rel`（决策 111 M:N）：应用字典条目上的
   * 单值 `platform_code` 已废弃（决策 118-3 全仓生产消费者归零），不可用于派生。
   * 未选平台时不做过滤（保持全量启用应用可选，避免「先选平台」成为硬前置）。
   */
  const selectedPlatformCode = Form.useWatch('platform_code', form) as string | undefined
  const selectedAppCode = Form.useWatch('app_code', form) as string | undefined

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

  /**
   * 服务下拉选项（决策 110 ④「再选服务」）：`ServiceDict.app_code` 是应用↔服务 1:N 的
   * 关系权威（决策 112），故按**所选应用**过滤；未选应用时不按应用过滤。
   */
  const enabledServiceDicts = useMemo(
    () =>
      serviceDicts.filter((d) => {
        if (!d.enabled) return false
        if (!selectedAppCode) return true
        // 字典未声明所属应用（游离服务）不参与过滤，避免关系缺失即无法选择
        return !d.app_code || d.app_code === selectedAppCode
      }),
    [serviceDicts, selectedAppCode],
  )

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
      serviceDictApi.list(),
      platformDictApi.list(),
    ])
      .then(([nd, bd, os, ad, sd, pd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
        setOsOptions(os.data?.list ?? [])
        setApplicationDicts(ad.data?.list ?? [])
        setServiceDicts(sd.data?.list ?? [])
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
        form.setFieldsValue({ app_code: undefined, service_code: undefined })
      }
    })
  }

  /** 五类资源共享字段（§5.2 公共字段） */
  const renderSharedFields = () => (
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
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="环境" name="env" rules={[{ required: true, message: '请选择环境' }]}>
            <Select placeholder="请选择环境">
              {ENV_VALUES.map((e) => (
                <Select.Option key={e} value={e}>
                  {e}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="运行状态" name="status" rules={[{ required: true, message: '请选择运行状态' }]}>
            <Select placeholder="请选择运行状态">
              {STATUS_OPTIONS.map((s) => (
                <Select.Option key={s.value} value={s.value}>
                  {s.label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
      {/* {v2026-09-28 决策 110 ④} 级联首项：平台归属（资源行一等字段，可选）。
          排在「应用」之前——平台归属是登记期第一个确定的业务信息；选中后应用下拉按平台过滤。 */}
      <Row gutter={16}>
        <Col span={12}>
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
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
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
          <Form.Item label="集群" name="cluster">
            <Input placeholder="集群名（可选）" maxLength={64} />
          </Form.Item>
        </Col>
        {/* 决策 103 scheme-B：表单不再提供「云」录入项——
            云由资源所属网域派生，仅在列表 / 详情以只读形式呈现。 */}
      </Row>
      <Form.Item label="负责人" name="owner">
        <Input placeholder="负责人（可选）" maxLength={32} />
      </Form.Item>
    </>
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
                <Form.Item label="端口" name="port" rules={portRules}>
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：9092" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )
      case 'application':
        // 采集地址拆分（M07 字段治理）：端点（主机）+ 端口（采集端口）必填并共同构成采集地址；
        // health_check_url 恢复为应用实际 URL 语义（可选、不参与采集），协议仅资源画像。
        return (
          <>
            <Form.Item label="服务名" name="service_name" rules={[{ required: true, message: '请输入服务名' }]}>
              <Input placeholder="例如：order-service" maxLength={64} />
            </Form.Item>
            {/* 决策 105：可选服务归属（仅 application / generic_target 渲染） */}
            <Form.Item
              label="服务编码"
              name="service_code"
              extra="可选：取服务字典启用条目，留空表示不注入服务标签"
            >
              <Select showSearch optionFilterProp="label" allowClear placeholder="请选择服务编码（可选）">
                {enabledServiceDicts.map((d) => (
                  <Select.Option key={d.service_code} value={d.service_code} label={`${d.service_name} (${d.service_code})`}>
                    {d.service_name} ({d.service_code})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              label="健康检查 URL"
              name="health_check_url"
              extra="应用的实际访问地址（业务健康检查用），可选；该字段不参与指标采集（采集地址见『端点』+『端口』）"
              rules={healthCheckUrlRules}
            >
              <Input placeholder="例如：http://10.10.1.4:8081/actuator/health" maxLength={256} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="端点（采集地址主机）"
                  name="endpoint"
                  extra="采集地址主机，IPv4 或域名；与端口一起构成采集目标"
                  rules={[{ required: true, message: '请输入采集地址主机' }]}
                >
                  <Input placeholder="例如：10.10.1.4" maxLength={128} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="端口（采集端口）"
                  name="port"
                  extra="exporter 指标端点监听端口，例如 8081；与端点一起构成采集目标 `端点:端口`"
                  rules={portRules}
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
            {/* 决策 105：可选服务归属（仅 application / generic_target 渲染） */}
            <Form.Item
              label="服务编码"
              name="service_code"
              extra="可选：取服务字典启用条目，留空表示不注入服务标签"
            >
              <Select showSearch optionFilterProp="label" allowClear placeholder="请选择服务编码（可选）">
                {enabledServiceDicts.map((d) => (
                  <Select.Option key={d.service_code} value={d.service_code} label={`${d.service_name} (${d.service_code})`}>
                    {d.service_name} ({d.service_code})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
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
