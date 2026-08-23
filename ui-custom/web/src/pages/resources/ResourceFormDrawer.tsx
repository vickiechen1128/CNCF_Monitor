import { useEffect, useState } from 'react'
import {
  Alert,
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
import { businessDomainApi, resourceApi } from '../../api/resources'
import type { NetworkDomain } from '../../types/domain'
import type {
  BusinessDomain,
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
  application: '应用',
  generic_target: '通用目标',
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

/** 应用服务协议（§5.8 protocol） */
const PROTOCOL_OPTIONS = ['http', 'https', 'tcp']

/** 通用目标采集协议（§5.9 scheme，默认 http） */
const SCHEME_OPTIONS = ['http', 'https']

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
    app_name: values.app_name ? String(values.app_name) : undefined,
    env: String(values.env),
    cluster: values.cluster ? String(values.cluster) : undefined,
    owner: values.owner ? String(values.owner) : undefined,
    status: (values.status as ResourceStatus) || 'online',
    ...buildTypeFields(category, values),
  } as ResourceCreateInput
}

/** 组装编辑请求体：resource_id/resource_category/source_type 不可改、不随请求体（§6.1/T07-06） */
function buildUpdateInput(category: ResourceCategory, values: Record<string, unknown>): ResourceUpdateInput {
  return {
    network_domain_id: String(values.network_domain_id),
    biz_code: String(values.biz_code),
    app_name: values.app_name ? String(values.app_name) : undefined,
    env: String(values.env),
    cluster: values.cluster ? String(values.cluster) : undefined,
    owner: values.owner ? String(values.owner) : undefined,
    status: (values.status as ResourceStatus) || 'online',
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
      return {
        service_name: String(values.service_name),
        endpoint: String(values.endpoint),
        health_check_url: values.health_check_url ? String(values.health_check_url) : undefined,
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
    app_name: record.app_name,
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
  }
}

/** IPv4 必填校验规则（§5.16.2） */
const requiredIpRules = [
  { required: true, message: '请输入 IP 地址' },
  { pattern: IPV4_RE, message: '请输入合法的 IPv4 地址' },
]

/** generic_target 的 instance_ip 支持 IP 或域名（§5.9） */
const requiredIpOrHostnameRules = [
  { required: true, message: '请输入 IP 地址或域名' },
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

/** 可选端口校验（应用/通用目标，port 非必填） */
const optionalPortRules = [{ type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' }]

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
  const [dictError, setDictError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** 编辑态以行 resource_category 为准，新增态取传入 Tab 类型 */
  const displayCategory = record?.resource_category ?? category
  const enabledBizDomains = businessDomains.filter((d) => d.enabled)

  useEffect(() => {
    if (!open) return
    // 打开抽屉时同步重置提交错误；沿用本模块既有 set-state-in-effect 模式（异步请求回调内才异步 setState）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    if (mode === 'create') {
      form.resetFields()
      form.setFieldsValue({ status: 'online', scheme: 'http' })
    } else if (record) {
      form.resetFields()
      form.setFieldsValue(recordToFormValues(record))
    }
    // 网域 / 业务字典下拉（M06 网域清单 / §3.1 业务分组字典）
    Promise.all([networkDomainApi.list({ page: 1, page_size: 100 }), businessDomainApi.list()])
      .then(([nd, bd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
        setDictError(null)
      })
      .catch((err: Error) => setDictError(err.message))
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
          <Form.Item label="运行状态" name="status" initialValue="online">
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
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="应用" name="app_name">
            <Input placeholder="应用名（可选）" maxLength={64} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="集群" name="cluster">
            <Input placeholder="集群名（可选）" maxLength={64} />
          </Form.Item>
        </Col>
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
                <Form.Item label="操作系统" name="os_type">
                  <Input placeholder="例如：Linux（可选）" maxLength={64} />
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
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="服务名" name="service_name" rules={[{ required: true, message: '请输入服务名' }]}>
                  <Input placeholder="例如：order-service" maxLength={64} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="协议"
                  name="protocol"
                  extra="健康检查 / 访问协议"
                >
                  <Select allowClear placeholder="请选择协议">
                    {PROTOCOL_OPTIONS.map((p) => (
                      <Select.Option key={p} value={p}>
                        {p}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="健康检查 URL" name="health_check_url">
              <Input placeholder="例如：http://10.0.1.41:8080/health（可选）" maxLength={256} />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="端点" name="endpoint" rules={[{ required: true, message: '请输入端点' }]}>
                  <Input placeholder="例如：/api/v1/order" maxLength={256} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="端口" name="port" rules={optionalPortRules}>
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="端口（可选）" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )
      case 'generic_target':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="目标名称" name="target_name" rules={[{ required: true, message: '请输入目标名称' }]}>
                  <Input placeholder="例如：node-exporter-cn-north" maxLength={64} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Exporter 类型" name="exporter_type">
                  <Input placeholder="例如：node_exporter（可选）" maxLength={64} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="IP 地址 / 域名" name="instance_ip" rules={requiredIpOrHostnameRules}>
                  <Input placeholder="例如：10.0.1.51 或 exporter.example.com" maxLength={128} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="端口" name="port" rules={optionalPortRules}>
                  <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="端口（可选）" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="采集路径" name="metrics_path">
                  <Input placeholder="/metrics（默认）" maxLength={128} />
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
              extra="格式：key1=value1;key2=value2，可选"
              rules={[{ pattern: CUSTOM_LABELS_RE, message: '格式为 key1=value1;key2=value2' }]}
            >
              <Input placeholder="例如：region=cn-north;role=db" maxLength={512} />
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
          description="网域 / 业务字典加载失败，请稍后重试"
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
