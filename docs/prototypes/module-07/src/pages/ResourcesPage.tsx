import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  App,
  Badge,
  AutoComplete,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  InfoCircleOutlined,
  LockOutlined,
  PlusOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { EllipsisText } from '../components/EllipsisText'
import { ReviewNote } from '../components/ReviewNote'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../components/tablePresets'
import {
  ENV_VALUES,
  OS_OPTIONS,
  DATABASE_TYPE_OPTIONS,
  IMPORT_TEMPLATE_COLUMNS,
  LABEL_SOURCE_MAP,
  LABEL_SOURCE_PRIORITY,
  MIDDLEWARE_TYPE_OPTIONS,
  PROTOCOL_OPTIONS,
  PROTECTED_PROMETHEUS_LABELS,
  RESOURCE_TYPE_MAP,
  SCHEME_OPTIONS,
  SOURCE_TYPE_MAP,
  STATUS_MAP,
  STATUS_MAPPING_RULES,
  STATUS_VALUES,
  isApplicationResource,
  isGenericTargetResource,
  isHostResource,
  isDatabaseResource,
  isMiddlewareResource,
  mockBusinessDomains,
  mockLabelTemplates,
  mockNetworkDomains,
  mockResourceLabels,
  mockResources,
  isBizDisabled,
  resolveBizName,
} from '../mocks/module-07'
import type {
  AppProtocol,
  Env,
  ImportError,
  Resource,
  ResourceLabel,
  ResourceStatus,
  ResourceCategory,
  TargetScheme,
} from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

// {v2.13} 五大类（决策 D19）：新增 database——此前本地数组漏加，Tabs 只渲染 4 类
const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

const STATUS_COLOR: Record<ResourceStatus, string> = {
  online: '#00B578',
  offline: '#FF4C3A',
  maintenance: '#FA8C16',
  orphan: '#86909C',
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CUSTOM_LABELS_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^;]+)(;([A-Za-z_][A-Za-z0-9_]*=[^;]+))*$/

/** Excel 导入结果 mock 演示（PRD 7.2 / 7.3，含重复检测与网域校验错误示例） */
const IMPORT_RESULT_DEMO: Record<ResourceCategory, { total: number; success: number; failed: number; errors: ImportError[] }> = {
  host: {
    total: 3,
    success: 1,
    failed: 2,
    errors: [
      { row: 2, resource_category: 'host', field: 'instance_ip', value: '999.999.999.999', reason: 'IP 格式不正确' },
      { row: 3, resource_category: 'host', field: 'instance_ip:port', value: '10.0.1.11:9100', reason: '重复检测：instance_ip:port 已存在' },
    ],
  },
  middleware: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [
      { row: 2, resource_category: 'middleware', field: 'network_domain', value: 'unknown-domain', reason: '网域不存在：network_domain 必须对应已存在的 NetworkDomain.id' },
    ],
  },
  // {v2.13} 数据库产品线导入示例（决策 D19）
  database: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [
      { row: 2, resource_category: 'database', field: 'database_type', value: 'oracle-xe', reason: 'database_type 必须是 mysql/redis/mongodb/dm8/postgresql/oracle/sqlserver 之一' },
    ],
  },
  application: {
    total: 3,
    success: 1,
    failed: 2,
    errors: [
      // {v2.19} 业务未登记校验（决策 13/14/17）：报错给可执行指引（5.16.1）——字典由平台配置文件预置、热加载生效，无自助登记入口
      { row: 2, resource_category: 'application', field: 'biz_code', value: 'settlement', reason: '业务 settlement 未登记，请联系平台管理员在业务分组字典配置（platform/config/business_domains.yaml）中添加后重新导入' },
      { row: 3, resource_category: 'application', field: 'endpoint', value: '10.0.3.11:9100', reason: '重复检测：service_name+endpoint 已存在' },
    ],
  },
  generic_target: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [{ row: 1, resource_category: 'generic_target', field: 'custom_labels', value: 'device_type=snmp', reason: 'custom_labels 必须符合 key=value;key2=value2 格式' }],
  },
}

/** Label key 校验（PRD 5.3）：小写字母数字下划线、禁止 __ 开头、长度 ≤128、禁止 Prometheus 内置 label */
function validateLabelKey(key: string): string | null {
  if (!key) return null
  if (!/^[a-z0-9_]+$/.test(key)) return 'key 只能包含小写字母、数字、下划线'
  if (key.startsWith('__')) return '禁止以 __ 开头'
  if (key.length > 128) return 'key 长度不能超过 128 字符'
  if (PROTECTED_PROMETHEUS_LABELS.includes(key)) return `禁止覆盖 Prometheus 内置 label（${key}）`
  return null
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

// {v2.2} 联动：按资源类别 + 标签 key 查找模板中对应的映射来源（用于 system 标签标注「来自 XX 模板 · app_name→app」）
function findTemplateSource(resourceType: ResourceCategory, labelKey: string): { templateName: string; sourceField: string } | null {
  const tpl =
    mockLabelTemplates.find((t) => t.resource_category === resourceType && t.is_default) ??
    mockLabelTemplates.find((t) => t.resource_category === resourceType)
  if (!tpl) return null
  const mapping = tpl.mappings.find((m) => m.target_label === labelKey)
  if (!mapping) return null
  return { templateName: tpl.name, sourceField: mapping.source_field }
}

// {v2.2} 联动：该标签 key 是否被当前资源类别的模板映射为生成目标（用于新增标签时引导走模板）
function isTemplateMappedLabel(resourceType: ResourceCategory, labelKey: string): boolean {
  return mockLabelTemplates.some(
    (t) => t.resource_category === resourceType && t.mappings.some((m) => m.target_label === labelKey)
  )
}

export default function ResourcesPage() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const [activeType, setActiveType] = useState<ResourceCategory>('host')
  const [search, setSearch] = useState('')
  // {v2.10} 网域作为资源列表筛选器（非全局上下文），默认全部网域，可切换单个网域
  const [filterDomain, setFilterDomain] = useState<string>('all')
  // {v2.17} 业务作为资源列表筛选器（网域与业务是两个正交维度，资源双归属）
  const [filterBusiness, setFilterBusiness] = useState<string>('all')
  // {v2.20} 决策 31-M1：采集状态筛选器（全部 / 未监控）。is_monitored 由 M01 维护、M07 只读；勾选「未监控」仅显示 is_monitored=false 的资源
  const [filterMonitored, setFilterMonitored] = useState<string>('all')
  const [resources, setResources] = useState<Resource[]>(mockResources)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null)
  const [labels, setLabels] = useState<ResourceLabel[]>([])
  const [newLabelKey, setNewLabelKey] = useState('')
  const [newLabelValue, setNewLabelValue] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editingResource, setEditingResource] = useState<Resource | null>(null)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [resourceForm] = Form.useForm()

  const filteredData = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return resources.filter((item) => {
      if (item.resource_category !== activeType) return false
      if (filterDomain !== 'all' && item.network_domain_id !== filterDomain) return false
      if (filterBusiness !== 'all' && item.biz_code !== filterBusiness) return false
      // {v2.20} 决策 31-M1：未监控筛选 = is_monitored=false（只读映射，不据此计算）
      if (filterMonitored === 'unmonitored' && item.is_monitored !== false) return false
      if (!keyword) return true
      const texts: (string | undefined)[] = [
        item.instance_name,
        item.hostname,
        item.instance_ip,
        item.app_name,
        resolveBizName(item.biz_code),
        item.cluster,
        item.env,
        item.owner,
      ]
      if (isDatabaseResource(item)) texts.push(item.database_type)
      if (isMiddlewareResource(item)) texts.push(item.middleware_type)
      if (isApplicationResource(item)) texts.push(item.service_name)
      if (isGenericTargetResource(item)) texts.push(item.target_name, item.exporter_type)
      return texts.some((t) => (t ?? '').toLowerCase().includes(keyword))
    })
  }, [resources, activeType, search, filterDomain, filterBusiness, filterMonitored])

  // ---------- 详情抽屉：标签管理 ----------
  const handleOpenDetail = (record: Resource) => {
    setSelectedResource(record)
    const list = mockResourceLabels[record.resource_id] || [
      {
        label_id: `system-${record.resource_id}-instance`,
        resource_id: record.resource_id,
        label_key: 'instance',
        label_value: `${record.instance_ip || record.hostname || '-'}:9100`,
        source: 'system',
        is_editable: false,
        created_at: record.created_at,
        updated_at: record.updated_at,
      },
    ]
    setLabels([...list].sort((a, b) => LABEL_SOURCE_PRIORITY[b.source] - LABEL_SOURCE_PRIORITY[a.source]))
    setNewLabelKey('')
    setNewLabelValue('')
    setDrawerOpen(true)
  }

  const handleCloseDetail = () => {
    setDrawerOpen(false)
    setSelectedResource(null)
    setLabels([])
    setNewLabelKey('')
    setNewLabelValue('')
  }

  const handleLabelChange = (labelId: string, value: string) => {
    setLabels((prev) => prev.map((item) => (item.label_id === labelId ? { ...item, label_value: value, updated_at: nowStr() } : item)))
  }

  const keyError = validateLabelKey(newLabelKey)
  const cmdbConflict = labels.some((l) => l.source === 'cmdb' && l.label_key === newLabelKey)

  const handleAddLabel = () => {
    if (!selectedResource) return
    // {v2.8} 双场景治理：静态资源标签由 CMDB / Excel 治理，平台只读，不提供实例级打标
    if (selectedResource.resource_category !== 'application') {
      message.warning('静态资源标签由 CMDB / Excel 治理，平台只读，不提供实例级打标入口')
      return
    }
    if (keyError) {
      message.error(keyError)
      return
    }
    // {v2.2} 类型级变更引导：key 已被模板映射为生成目标时，引导走模板而非实例级手工覆盖
    const templateMapped = isTemplateMappedLabel(selectedResource.resource_category, newLabelKey.trim())
    if (templateMapped) {
      modal.confirm({
        title: '该标签由标签模板生成',
        content: `「${newLabelKey.trim()}」由当前资源类别的标签模板映射生成（如需修改请前往标签模板管理），确认仍要手动添加吗？`,
        okText: '仍要添加',
        cancelText: '前往标签模板',
        onCancel: () => {
          navigate('/label-templates')
        },
        onOk: () => {
          doAddUserLabel()
        },
      })
      return
    }
    if (cmdbConflict) {
      message.warning('该 key 将由 CMDB 覆盖，建议更换 key')
    }
    doAddUserLabel()
  }

  const doAddUserLabel = () => {
    if (!selectedResource) return
    const now = nowStr()
    const label: ResourceLabel = {
      label_id: `user-${Date.now()}`,
      resource_id: selectedResource.resource_id,
      label_key: newLabelKey,
      label_value: newLabelValue || '-',
      source: 'user',
      is_editable: true,
      created_at: now,
      updated_at: now,
    }
    setLabels((prev) => [...prev, label])
    setNewLabelKey('')
    setNewLabelValue('')
    message.success('标签已添加')
  }

  const handleDeleteLabel = (label: ResourceLabel) => {
    if (!label.is_editable) return
    setLabels((prev) => prev.filter((l) => l.label_id !== label.label_id))
    message.success('标签已删除')
  }

  // ---------- 新增 / 编辑资源 ----------
  const openAddModal = () => {
    setEditingResource(null)
    resourceForm.resetFields()
    resourceForm.setFieldsValue({
      network_domain_id: 'default',
      env: 'prod',
      status: 'online',
      metrics_path: '/metrics',
      scheme: 'http',
    })
    setEditOpen(true)
  }

  const openEditModal = (record: Resource) => {
    setEditingResource(record)
    resourceForm.resetFields()
    resourceForm.setFieldsValue({ ...record })
    setEditOpen(true)
  }

  const handleDeleteResource = (record: Resource) => {
    modal.confirm({
      title: '删除资源',
      content: `确认删除资源「${record.instance_name || record.resource_id}」？删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => {
        setResources((prev) => prev.filter((r) => r.resource_id !== record.resource_id))
        message.success('资源已删除')
      },
    })
  }

  const buildNewResource = (type: ResourceCategory, values: Record<string, unknown>): Resource => {
    const base = {
      network_domain_id: (values.network_domain_id as string) || 'default',
      // {v2.18} 业务必填：来自业务分组字典下拉（决策 13/14/17/21），存不可变编码 biz_code
      biz_code: values.biz_code as string | undefined,
      source_type: 'manual' as const,
      app_name: values.app_name as string | undefined,
      env: values.env as Env | undefined,
      cluster: values.cluster as string | undefined,
      owner: values.owner as string | undefined,
      status: (values.status as ResourceStatus) || 'online',
      // {v2.20} 决策 31-M1：新建资源 is_monitored 默认 true（Mock 简化：M07 不计算；真实由 M01 注册采集后置 true，M07 只读）
      is_monitored: true,
      created_at: nowStr(),
      updated_at: nowStr(),
    }
    switch (type) {
      case 'host':
        return {
          resource_id: `res-host-${Date.now()}`,
          resource_category: 'host' as const,
          instance_name: values.instance_name as string,
          hostname: values.hostname as string,
          instance_ip: values.instance_ip as string,
          os_type: values.os_type as string | undefined,
          os_version: values.os_version as string | undefined,
          ...base,
        }
      case 'database':
        // {v2.13} 数据库资源（PRD 5.7.1，决策 D19）
        return {
          resource_id: `res-db-${Date.now()}`,
          resource_category: 'database' as const,
          instance_name: values.instance_name as string | undefined,
          database_type: values.database_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
          ...base,
        }
      case 'middleware':
        return {
          resource_id: `res-mw-${Date.now()}`,
          resource_category: 'middleware' as const,
          instance_name: values.instance_name as string | undefined,
          middleware_type: values.middleware_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
          ...base,
        }
      case 'application':
        return {
          resource_id: `res-app-${Date.now()}`,
          resource_category: 'application' as const,
          instance_name: values.instance_name as string | undefined,
          service_name: values.service_name as string,
          health_check_url: values.health_check_url as string | undefined,
          protocol: values.protocol as AppProtocol | undefined,
          endpoint: values.endpoint as string | undefined,
          port: values.port as number | undefined,
          ...base,
        }
      case 'generic_target':
        return {
          resource_id: `res-gen-${Date.now()}`,
          resource_category: 'generic_target' as const,
          instance_name: values.instance_name as string | undefined,
          target_name: values.target_name as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number | undefined,
          metrics_path: (values.metrics_path as string | undefined) || '/metrics',
          scheme: (values.scheme as TargetScheme | undefined) || 'http',
          custom_labels: values.custom_labels as string | undefined,
          exporter_type: values.exporter_type as string | undefined,
          ...base,
        }
    }
  }

  const buildEditedResource = (record: Resource, values: Record<string, unknown>): Resource => {
    const common = {
      network_domain_id: (values.network_domain_id as string) || 'default',
      // {v2.18} 业务必填：来自业务分组字典下拉（决策 13/14/17/21），存不可变编码 biz_code
      biz_code: values.biz_code as string | undefined,
      app_name: values.app_name as string | undefined,
      env: values.env as Env | undefined,
      cluster: values.cluster as string | undefined,
      owner: values.owner as string | undefined,
      status: (values.status as ResourceStatus) || 'online',
      updated_at: nowStr(),
    }
    switch (record.resource_category) {
      case 'host':
        return {
          ...record,
          ...common,
          hostname: values.hostname as string,
          instance_ip: values.instance_ip as string,
          os_type: values.os_type as string | undefined,
          os_version: values.os_version as string | undefined,
        }
      case 'database':
        // {v2.13} 数据库资源编辑（PRD 5.7.1，决策 D19）
        return {
          ...record,
          ...common,
          database_type: values.database_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
        }
      case 'middleware':
        return {
          ...record,
          ...common,
          middleware_type: values.middleware_type as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number,
          version: values.version as string | undefined,
          connection_string: values.connection_string as string | undefined,
        }
      case 'application':
        return {
          ...record,
          ...common,
          service_name: values.service_name as string,
          health_check_url: values.health_check_url as string | undefined,
          protocol: values.protocol as AppProtocol | undefined,
          endpoint: values.endpoint as string | undefined,
          port: values.port as number | undefined,
        }
      case 'generic_target':
        return {
          ...record,
          ...common,
          target_name: values.target_name as string,
          instance_ip: values.instance_ip as string,
          port: values.port as number | undefined,
          metrics_path: (values.metrics_path as string | undefined) || '/metrics',
          scheme: (values.scheme as TargetScheme | undefined) || 'http',
          custom_labels: values.custom_labels as string | undefined,
          exporter_type: values.exporter_type as string | undefined,
        }
    }
  }

  const handleSaveResource = () => {
    resourceForm.validateFields().then((values) => {
      if (editingResource) {
        const updated = buildEditedResource(editingResource, values)
        setResources((prev) => prev.map((r) => (r.resource_id === editingResource.resource_id ? updated : r)))
        message.success('资源已更新')
      } else {
        const created = buildNewResource(activeType, values)
        setResources((prev) => [...prev, created])
        message.success('资源已新增')
      }
      setEditOpen(false)
      setEditingResource(null)
      resourceForm.resetFields()
    })
  }

  // ---------- 表单字段渲染（按资源类别，PRD 5.6~5.9） ----------
  const renderTypeFields = (type: ResourceCategory) => {
    switch (type) {
      case 'host':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name" rules={[{ required: true, message: '请输入实例名' }]} extra="主机模板必填，生成 hostname 标签">
                  <Input placeholder="如 prod-web-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="主机名" name="hostname" rules={[{ required: true, message: '请输入主机名' }]} extra="主机场景下默认与实例名一致">
                  <Input placeholder="如 prod-web-01.volc" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="管理 IP"
                  name="instance_ip"
                  rules={[
                    { required: true, message: '请输入管理 IP' },
                    { pattern: IPV4_RE, message: 'IPv4 格式不正确' },
                  ]}
                  extra="作为采集目标地址"
                >
                  <Input placeholder="如 10.0.1.11" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="操作系统"
                  name="os_type"
                  rules={[{ required: true, message: '请选择操作系统' }]}
                  extra="必填；内置字典选择（可搜索/自定义），采集实例定位依赖它，越界拼写将无法匹配采集候选"
                >
                  <AutoComplete
                    options={OS_OPTIONS}
                    placeholder="选择或输入（如 Ubuntu / CentOS / Windows Server）"
                    allowClear
                    filterOption={(inputValue, option) =>
                      String(option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="系统版本" name="os_version">
              <Input placeholder="如 7.9" />
            </Form.Item>
          </>
        )
      case 'database':
        // {v2.13} 数据库资源表单（PRD 5.7.1，决策 D19）
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name">
                  <Input placeholder="如 mysql-order-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="数据库类型" name="database_type" rules={[{ required: true, message: '请选择数据库类型' }]}>
                  <Select placeholder="请选择">
                    {DATABASE_TYPE_OPTIONS.map((t) => (
                      <Option key={t} value={t}>
                        {t}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="服务 IP"
                  name="instance_ip"
                  rules={[
                    { required: true, message: '请输入服务 IP' },
                    { pattern: IPV4_RE, message: 'IPv4 格式不正确' },
                  ]}
                >
                  <Input placeholder="如 10.0.2.12" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="服务端口"
                  name="port"
                  rules={[
                    { required: true, message: '请输入服务端口' },
                    { type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' },
                  ]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="如 3306" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="版本" name="version">
                  <Input placeholder="如 8.0" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="连接串" name="connection_string">
                  <Input placeholder="如 mysql://user:****@10.0.2.12:3306/order" />
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
                <Form.Item label="实例名" name="instance_name">
                  <Input placeholder="如 kafka-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="中间件类型" name="middleware_type" rules={[{ required: true, message: '请选择中间件类型' }]}>
                  <Select placeholder="请选择">
                    {MIDDLEWARE_TYPE_OPTIONS.map((t) => (
                      <Option key={t} value={t}>
                        {t}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label="服务 IP"
                  name="instance_ip"
                  rules={[
                    { required: true, message: '请输入服务 IP' },
                    { pattern: IPV4_RE, message: 'IPv4 格式不正确' },
                  ]}
                >
                  <Input placeholder="如 10.0.2.11" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="服务端口"
                  name="port"
                  rules={[
                    { required: true, message: '请输入服务端口' },
                    { type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' },
                  ]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="如 6379" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="版本" name="version">
                  <Input placeholder="如 7.2" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="连接串" name="connection_string" extra="敏感信息可加密存储">
                  <Input placeholder="敏感信息可加密存储" />
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
                  <Input placeholder="如 order-service" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="协议" name="protocol">
                  <Select placeholder="请选择" allowClear>
                    {PROTOCOL_OPTIONS.map((p) => (
                      <Option key={p} value={p}>
                        {p}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="健康检查 URL"
              name="health_check_url"
              rules={[{ type: 'url', message: 'URL 格式不正确' }]}
              extra="作为资源字段由本模块维护；拨测任务的配置由「监控策略」模块负责"
            >
              <Input placeholder="如 http://ip:9100/-/healthy" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="业务指标端点" name="endpoint">
                  <Input placeholder="如 10.0.3.11:9100" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="服务端口"
                  name="port"
                  rules={[{ type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="如 9100" />
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
                  <Input placeholder="如 核心交换-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Exporter 类型" name="exporter_type" extra="如 snmp_exporter / gpu_exporter / oracle_exporter">
                  <Input placeholder="如 snmp_exporter / gpu_exporter" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="目标 IP / 域名" name="instance_ip" rules={[{ required: true, message: '请输入目标 IP 或域名' }]} extra="必填且符合 IPv4/域名格式">
                  <Input placeholder="如 172.16.0.1" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="端口"
                  name="port"
                  rules={[{ type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' }]}
                  extra="留空时不生成实例标识（instance）"
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="如 9116" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="采集路径" name="metrics_path" initialValue="/metrics">
                  <Input placeholder="/metrics" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="协议" name="scheme" initialValue="http">
                  <Select>
                    {SCHEME_OPTIONS.map((s) => (
                      <Option key={s} value={s}>
                        {s}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              label="自定义标签"
              name="custom_labels"
              rules={[{ pattern: CUSTOM_LABELS_RE, message: '格式：key1=value1;key2=value2' }]}
              extra="支持 key1=value1;key2=value2 格式"
            >
              <Input placeholder="如 device_type=snmp_switch;vendor=h3c" />
            </Form.Item>
          </>
        )
    }
  }

  const renderCommonFields = () => {
    const appClusterRequired = ['application', 'database', 'middleware'].includes(activeType)
    return (
    <>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="应用名" name="app_name" rules={appClusterRequired ? [{ required: true, message: '请输入应用名' }] : []} extra="应用服务 / 数据库 / 中间件必填；主机与通用目标可空，为空时不注入 app 标签">
            <Input placeholder="如 订单服务" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="环境" name="env" rules={[{ required: true, message: '请选择环境' }]} extra="映射为 env 标签">
            <Select placeholder="请选择">
              {ENV_VALUES.map((v) => (
                <Option key={v} value={v}>
                  {v}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="集群" name="cluster" rules={appClusterRequired ? [{ required: true, message: '请输入集群' }] : []} extra="应用服务 / 数据库 / 中间件必填；主机场景下子应用编码为空时取 VPC；主机与通用目标可空">
            <Input placeholder="如 k8s-prod" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="负责人" name="owner" extra="MVP 用户填写；后续版本优先取自 CMDB 维护人">
            <Input placeholder="负责人姓名" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            label="网域"
            name="network_domain_id"
            rules={[{ required: true, message: '请选择网域' }]}
            extra="网域作为资源属性由 CMDB / Excel / 手动录入带入；M07 不维护网域生命周期，列表内可用网域筛选器收敛视图"
          >
            <Select placeholder="请选择">
              {mockNetworkDomains.map((d) => (
                <Option key={d.id} value={d.id}>
                  {d.name}（{d.id}）
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* {v2.18} 业务必填下拉：业务分组字典由配置预置（决策 13/14/17）；biz 标签只承载不可变编码 biz_code；停用条目不可选用 */}
          <Form.Item
            label="业务"
            name="biz_code"
            rules={[{ required: true, message: '请选择业务' }]}
            extra="必填；业务归属由业务分组字典维护，用于按业务聚合监控（编码不可变）"
          >
            <Select placeholder="请选择业务" showSearch optionFilterProp="label">
              {mockBusinessDomains
                .filter((d) => d.status === 'enabled')
                .map((d) => (
                  <Option key={d.biz_code} value={d.biz_code}>
                    {d.biz_name}（{d.biz_code}）
                  </Option>
                ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="运行状态" name="status" rules={[{ required: true, message: '请选择运行状态' }]} extra="孤儿状态为后续版本预留，不在表单选项中">
            <Select placeholder="请选择">
              {STATUS_VALUES.map((s) => (
                <Option key={s} value={s}>
                  {STATUS_MAP[s]}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
    </>
    )
  }

  // ---------- 表格列（按资源类别固定展示，PRD 3.1） ----------
  const getColumns = (type: ResourceCategory): TableProps<Resource>['columns'] => {
    const domainColumn = {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag color="cyan">{value}</Tag>,
    }
    // {v2.18} 业务列：展示业务字典 biz_name，停用业务加「已停用」标识（网域与业务双归属正交维度，决策 13/14/17/21）
    const businessColumn = {
      title: '业务',
      dataIndex: 'biz_code',
      key: 'biz_code',
      render: (value?: string) =>
        value ? (
          <Tag color={isBizDisabled(value) ? 'default' : 'geekblue'}>
            {resolveBizName(value)}
            {isBizDisabled(value) ? '（已停用）' : ''}
          </Tag>
        ) : '-',
    }
    const sourceColumn = {
      title: '来源',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (value: string) => <Tag>{SOURCE_TYPE_MAP[value as keyof typeof SOURCE_TYPE_MAP] || value}</Tag>,
    }
    const statusColumn = {
      // {v2.21} 决策 32：「状态」更名「运行状态」；数据来源（CMDB / Excel / 手动）非 M07 自身功能，以列头 hover 隐藏提示标注、不占列宽
      title: (
        <span>
          <Tooltip title="运行状态数据来源：CMDB 同步 / Excel 导入 / 用户手动维护，非本模块计算">
            运行状态
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'status',
      key: 'status',
      render: (value: ResourceStatus) => <Badge color={STATUS_COLOR[value]} text={STATUS_MAP[value]} />,
    }
    // {v2.20} 决策 31-M1：采集状态列——is_monitored 由 M01 维护、M07 只读映射，不做计算/回写
    const monitoredColumn = {
      title: (
        <span>
          <Tooltip title="采集状态数据来源：由「监控策略」模块（M01）计算，本模块只读展示">
            采集状态
            <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'is_monitored',
      key: 'is_monitored',
      render: (value: boolean) =>
        value === false ? <Tag color="red">未监控</Tag> : <Tag color="#0ECDEB">已监控</Tag>,
    }
    const actionColumn = {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      width: 150,
      render: (_: unknown, record: Resource) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<InfoCircleOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleOpenDetail(record)
            }}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              openEditModal(record)
            }}
          >
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              handleDeleteResource(record)
            }}
          >
            删除
          </Button>
        </Space>
      ),
    }

    switch (type) {
      case 'host': {
        const cols: TableProps<Resource>['columns'] = [
          {
            title: '实例名 / 主机名',
            key: 'name',
            render: (_: unknown, record: Resource) => (
              <Space direction="vertical" size={0}>
                <Text strong>{record.instance_name}</Text>
                <EllipsisText type="secondary" maxWidth={180}>
                  {record.hostname}
                </EllipsisText>
              </Space>
            ),
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip' },
          {
            title: '操作系统',
            dataIndex: 'os_type',
            key: 'os_type',
            render: (value?: string) => value || '-',
          },
          {
            title: '应用 / 环境 / 集群',
            key: 'app_env_cluster',
            render: (_: unknown, record: Resource) => (
              <Space wrap>
                {record.app_name && <Tag>{record.app_name}</Tag>}
                {record.env && <Tag color="blue">{record.env}</Tag>}
                {record.cluster && <Tag color="purple">{record.cluster}</Tag>}
              </Space>
            ),
          },
          domainColumn,
          businessColumn,
          sourceColumn,
          monitoredColumn,
          statusColumn,
          actionColumn,
        ]
        return cols
      }
      case 'database': {
        // {v2.13} 数据库资源列表列（PRD 5.7.1，决策 D19）
        const cols: TableProps<Resource>['columns'] = [
          { title: '实例名', dataIndex: 'instance_name', key: 'instance_name' },
          {
            title: '数据库类型',
            key: 'database_type',
            render: (_: unknown, record: Resource) =>
              isDatabaseResource(record) ? <Tag color="green">{record.database_type}</Tag> : '-',
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip' },
          {
            title: '端口',
            key: 'port',
            render: (_: unknown, record: Resource) => (isDatabaseResource(record) ? record.port : '-'),
          },
          {
            title: '版本',
            key: 'version',
            render: (_: unknown, record: Resource) => (isDatabaseResource(record) ? record.version || '-' : '-'),
          },
          domainColumn,
          businessColumn,
          sourceColumn,
          monitoredColumn,
          statusColumn,
          actionColumn,
        ]
        return cols
      }
      case 'middleware': {
        const cols: TableProps<Resource>['columns'] = [
          { title: '实例名', dataIndex: 'instance_name', key: 'instance_name' },
          {
            title: '中间件类型',
            key: 'middleware_type',
            render: (_: unknown, record: Resource) =>
              isMiddlewareResource(record) ? <Tag color="geekblue">{record.middleware_type}</Tag> : '-',
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip' },
          {
            title: '端口',
            key: 'port',
            render: (_: unknown, record: Resource) => (isMiddlewareResource(record) ? record.port : '-'),
          },
          {
            title: '版本',
            key: 'version',
            render: (_: unknown, record: Resource) => (isMiddlewareResource(record) ? record.version || '-' : '-'),
          },
          domainColumn,
          businessColumn,
          sourceColumn,
          monitoredColumn,
          statusColumn,
          actionColumn,
        ]
        return cols
      }
      case 'application': {
        const cols: TableProps<Resource>['columns'] = [
          {
            title: '服务名',
            key: 'service_name',
            render: (_: unknown, record: Resource) =>
              isApplicationResource(record) ? <Text strong>{record.service_name}</Text> : '-',
          },
          {
            title: '健康检查 URL',
            key: 'health_check_url',
            ellipsis: true,
            render: (_: unknown, record: Resource) =>
              isApplicationResource(record) ? record.health_check_url || '-' : '-',
          },
          {
            title: '协议',
            key: 'protocol',
            render: (_: unknown, record: Resource) =>
              isApplicationResource(record) ? record.protocol || '-' : '-',
          },
          {
            title: '端点',
            key: 'endpoint',
            render: (_: unknown, record: Resource) =>
              isApplicationResource(record) ? record.endpoint || '-' : '-',
          },
          {
            title: '端口',
            key: 'port',
            render: (_: unknown, record: Resource) => (isApplicationResource(record) ? record.port ?? '-' : '-'),
          },
          domainColumn,
          businessColumn,
          sourceColumn,
          monitoredColumn,
          statusColumn,
          actionColumn,
        ]
        return cols
      }
      case 'generic_target': {
        const cols: TableProps<Resource>['columns'] = [
          {
            title: '目标名称',
            key: 'target_name',
            render: (_: unknown, record: Resource) =>
              isGenericTargetResource(record) ? <Text strong>{record.target_name}</Text> : '-',
          },
          {
            title: 'Exporter 类型',
            key: 'exporter_type',
            render: (_: unknown, record: Resource) =>
              isGenericTargetResource(record) ? record.exporter_type || '-' : '-',
          },
          { title: 'IP 地址', dataIndex: 'instance_ip', key: 'instance_ip' },
          {
            title: '端口',
            key: 'port',
            render: (_: unknown, record: Resource) => (isGenericTargetResource(record) ? record.port ?? '-' : '-'),
          },
          {
            title: '采集路径',
            key: 'metrics_path',
            render: (_: unknown, record: Resource) =>
              isGenericTargetResource(record) ? record.metrics_path || '/metrics' : '-',
          },
          {
            title: '协议',
            key: 'scheme',
            render: (_: unknown, record: Resource) => (isGenericTargetResource(record) ? record.scheme || 'http' : '-'),
          },
          {
            title: '自定义标签',
            key: 'custom_labels',
            ellipsis: true,
            render: (_: unknown, record: Resource) =>
              isGenericTargetResource(record) && record.custom_labels ? (
                <Text code style={{ fontSize: 12 }}>
                  {record.custom_labels}
                </Text>
              ) : (
                '-'
              ),
          },
          domainColumn,
          businessColumn,
          sourceColumn,
          monitoredColumn,
          statusColumn,
          actionColumn,
        ]
        return cols
      }
    }
  }

  // ---------- 详情抽屉：类型字段 / CMDB 字段 ----------
  const typeFieldItems = (r: Resource) => {
    if (isHostResource(r)) {
      return [
        { key: 'os_type', label: '操作系统', children: r.os_type || '-' },
        { key: 'os_version', label: '系统版本', children: r.os_version || '-' },
      ]
    }
    if (isDatabaseResource(r)) {
      // {v2.13} 数据库资源详情（PRD 5.7.1，决策 D19）
      return [
        { key: 'database_type', label: '数据库类型', children: r.database_type },
        { key: 'port', label: '端口', children: r.port },
        { key: 'version', label: '版本', children: r.version || '-' },
        {
          key: 'connection_string',
          label: '连接串',
          children: r.connection_string ? <Text code style={{ fontSize: 12 }}>{r.connection_string}</Text> : '-',
        },
      ]
    }
    if (isMiddlewareResource(r)) {
      return [
        { key: 'middleware_type', label: '中间件类型', children: r.middleware_type },
        { key: 'port', label: '端口', children: r.port },
        { key: 'version', label: '版本', children: r.version || '-' },
        {
          key: 'connection_string',
          label: '连接串',
          children: r.connection_string ? <Text code style={{ fontSize: 12 }}>{r.connection_string}</Text> : '-',
        },
      ]
    }
    if (isApplicationResource(r)) {
      return [
        { key: 'service_name', label: '服务名', children: r.service_name },
        { key: 'health_check_url', label: '健康检查 URL', children: r.health_check_url || '-' },
        { key: 'protocol', label: '协议', children: r.protocol || '-' },
        { key: 'endpoint', label: '端点', children: r.endpoint || '-' },
        { key: 'port', label: '端口', children: r.port ?? '-' },
      ]
    }
    return [
      { key: 'target_name', label: '目标名称', children: r.target_name },
      { key: 'exporter_type', label: 'Exporter 类型', children: r.exporter_type || '-' },
      { key: 'port', label: '端口', children: r.port ?? '-' },
      { key: 'metrics_path', label: '采集路径', children: r.metrics_path || '/metrics' },
      { key: 'scheme', label: '协议', children: r.scheme || 'http' },
      {
        key: 'custom_labels',
        label: '自定义标签',
        children: r.custom_labels ? <Text code style={{ fontSize: 12 }}>{r.custom_labels}</Text> : '-',
      },
    ]
  }

  const importResult = IMPORT_RESULT_DEMO[activeType]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>资源管理</Title>
        <Text type="secondary">管理主机、中间件、应用及通用监控对象（监控对象管理）</Text>
      </div>

      {/* 模块边界说明（用户语言，技术细节见 MainLayout 全局折叠区） */}
      <Alert
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
        message="本页只维护监控对象数据"
        description={
          <span>
            本页维护监控对象（资源）、资源标签与标签模板的数据，<strong>不生成采集配置、不配置采集任务、不下发配置</strong>。
            采集策略由「监控策略」模块负责，配置生成与下发由「配置中心」模块负责。
          </span>
        }
      />

      <ReviewNote title="设计说明（面向产品 / 技术评审）" style={{ margin: '0 0 16px' }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>{'{v2.20} 决策 31-M1'}：采集状态（已监控 / 未监控）由 M01 维护、M07 只读映射，本页「采集状态」列只读展示并提供「未监控」筛选；is_monitored=false 不代表 status=offline，两者维度独立，M07 不据此计算 / 不写回。</li>
          <li>采集成功 / 目标数据归 M01 / M02：「未纳入任何 Job」在 M01 实例选择器筛选、「选中但无数据」在 M02 目标状态页查看。</li>
          <li>标签来源口径：模板映射生成 = 「系统」标签；手工添加 = 「用户」标签；CMDB 字段（v0.4+）= 「CMDB」标签。</li>
          <li>列显隐配置为 P1 占位，MVP 版本列表列固定展示，可在「列设置」查看后续规划。</li>
          <li>Excel 导入：状态中文值按内置状态映射转换（本页只读展示，配置入口 P2）；枚举列（env / protocol / scheme）要求与字典一致，否则报错。</li>
          <li>{'{v2.20} 决策 29'}：目标状态 offline 后，配置中心（Module_09）下一配置生成周期即将其从 targets/*.json 移除、不触发采集器 reload，批量下线动线为真。</li>
        </ul>
      </ReviewNote>

      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Space wrap>
              <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }} onClick={openAddModal}>
                新增资源
              </Button>
              <Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)}>
                Excel 导入
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => setTemplateModalOpen(true)}>
                下载模板
              </Button>
              {/* 列显隐配置占位（后续版本开放）：列表列显示/隐藏由用户勾选 */}
              <Tooltip title="列显隐配置：可勾选显示/隐藏列表列（含中间件类型、网域、来源等），后续版本开放">
                <Button
                  icon={<SettingOutlined />}
                  onClick={() => message.info('列显隐配置后续版本开放')}
                >
                  列设置
                </Button>
              </Tooltip>
            </Space>
          </Col>
        </Row>

        <FilterBar>
          <FilterItem label="网域" width={240}>
            <Select
              placeholder="全部网域"
              allowClear
              value={filterDomain === 'all' ? undefined : filterDomain}
              onChange={(v) => setFilterDomain(v ?? 'all')}
              style={{ width: 180 }}
              options={mockNetworkDomains.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` }))}
            />
          </FilterItem>
          <FilterItem label="业务" width={240}>
            <Select
              placeholder="全部业务"
              allowClear
              value={filterBusiness === 'all' ? undefined : filterBusiness}
              onChange={(v) => setFilterBusiness(v ?? 'all')}
              style={{ width: 180 }}
              options={mockBusinessDomains
                .filter((d) => d.status === 'enabled')
                .map((d) => ({ value: d.biz_code, label: `${d.biz_name} (${d.biz_code})` }))}
            />
          </FilterItem>
          {/* {v2.20} 决策 31-M1：采集状态筛选——is_monitored 由 M01 维护、M07 只读映射；勾选「未监控」仅显示 is_monitored=false 的资源 */}
          <FilterItem label="采集状态" width={240}>
            <Select
              placeholder="全部"
              allowClear
              value={filterMonitored === 'all' ? undefined : filterMonitored}
              onChange={(v) => setFilterMonitored(v ?? 'all')}
              style={{ width: 180 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'unmonitored', label: '未监控' },
              ]}
            />
          </FilterItem>
          <FilterItem label="搜索" width={340}>
            <Input.Search
              placeholder="搜索实例名 / IP / 应用"
              allowClear
              onSearch={(value) => setSearch(value)}
              style={{ width: 280 }}
            />
          </FilterItem>
        </FilterBar>

        <Tabs
          activeKey={activeType}
          onChange={(key) => setActiveType(key as ResourceCategory)}
          items={RESOURCE_TYPES.map((type) => {
            const total = resources.filter((r) => r.resource_category === type).length
            // {v2.20} 决策 31-M1：Tab 标题展示该类型未监控资源数，配合「采集状态=未监控」筛选动线
            const unmonitored = resources.filter(
              (r) => r.resource_category === type && r.is_monitored === false,
            ).length
            return {
              key: type,
              label: `${RESOURCE_TYPE_MAP[type]} (${total}${unmonitored ? ` · 未监控 ${unmonitored}` : ''})`,
            }
          })}
          style={{ marginBottom: 16 }}
        />

        <Table
          rowKey="resource_id"
          dataSource={filteredData}
          columns={getColumns(activeType)}
          size="small"
          scroll={TABLE_SCROLL_X}
          pagination={TABLE_PAGINATION}
          locale={{
            emptyText: filterMonitored === 'unmonitored' ? '当前类型下暂无未监控资源' : undefined,
          }}
          onRow={(record) => ({
            onClick: () => handleOpenDetail(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      {/* 详情抽屉 + 标签管理（PRD 3.3 / 5.3） */}
      <Drawer
        title="资源详情"
        width={680}
        open={drawerOpen}
        onClose={handleCloseDetail}
        extra={
          <Button onClick={handleCloseDetail}>关闭</Button>
        }
      >
        {selectedResource && (
          <>
            <Space size={[8, 8]} wrap style={{ marginBottom: 16 }}>
              <Tag color="blue">{SOURCE_TYPE_MAP[selectedResource.source_type]}</Tag>
              <Tag>{RESOURCE_TYPE_MAP[selectedResource.resource_category]}</Tag>
              <Tag>网域：{selectedResource.network_domain_id}</Tag>
            </Space>
            <Descriptions
              column={2}
              size="small"
              title="基础信息"
              items={[
                { key: 'instance_name', label: '实例名', children: selectedResource.instance_name || '-' },
                { key: 'hostname', label: '主机名', children: selectedResource.hostname || '-' },
                { key: 'instance_ip', label: 'IP 地址', children: selectedResource.instance_ip || '-' },
                { key: 'biz_code', label: '业务', children: resolveBizName(selectedResource.biz_code) },
                { key: 'app_name', label: '应用', children: selectedResource.app_name || '-' },
                // {v2.3} 适用模板：该资源类别默认模板（模板按 resource_category 隐式关联）
                {
                  key: 'apply_template',
                  label: '适用模板',
                  children: (() => {
                    const tpl = mockLabelTemplates.find(
                      (t) => t.resource_category === selectedResource.resource_category && t.is_default
                    )
                    return tpl ? (
                      <Typography.Link
                        style={{ fontSize: 12 }}
                        onClick={(e) => {
                          e.preventDefault()
                          navigate('/label-templates')
                        }}
                      >
                        {tpl.name}（{tpl.template_id}）
                      </Typography.Link>
                    ) : (
                      '-'
                    )
                  })(),
                },
                { key: 'env', label: '环境', children: selectedResource.env || '-' },
                { key: 'cluster', label: '集群', children: selectedResource.cluster || '-' },
                { key: 'owner', label: '负责人', children: selectedResource.owner || '-' },
                {
                  key: 'status',
                  label: '运行状态',
                  children: <Badge color={STATUS_COLOR[selectedResource.status]} text={STATUS_MAP[selectedResource.status]} />,
                },
                { key: 'created_at', label: '创建时间', children: selectedResource.created_at },
                { key: 'updated_at', label: '更新时间', children: selectedResource.updated_at },
              ]}
            />
            <Descriptions
              column={2}
              size="small"
              title="类型字段"
              style={{ marginTop: 16 }}
              items={typeFieldItems(selectedResource)}
            />
            <Descriptions
              column={2}
              size="small"
              title="CMDB 字段（后续版本接入 CMDB 后同步）"
              style={{ marginTop: 16 }}
              items={[
                { key: 'cmdb_ci_id', label: 'cmdb_ci_id（后续版本）', children: selectedResource.cmdb_ci_id || '-' },
                { key: 'cmdb_business_path', label: 'cmdb_business_path（后续版本）', children: selectedResource.cmdb_business_path || '-' },
                { key: 'cmdb_module_path', label: 'cmdb_module_path（后续版本）', children: selectedResource.cmdb_module_path || '-' },
                { key: 'cmdb_maintainer', label: 'cmdb_maintainer（后续版本）', children: selectedResource.cmdb_maintainer || '-' },
              ]}
            />
            <Divider />
            {/* {v2.8} 双场景治理：标题按资源类别区分（静态资源只读 / 应用服务可编辑） */}
            <Title level={5}>
              {selectedResource?.resource_category === 'application' ? '自定义标签（非必须）' : '自定义标签（静态资源只读）'}
            </Title>
            {/* {v2.6} 统一口径：标签来源 vs 模板映射字段来源的对应关系，消除「系统/用户/CMDB」与「资源字段/组合字段/CMDB 字段」的歧义 */}
            <div style={{ marginBottom: 12, padding: 12, background: '#F7F8FA', borderRadius: 6 }}>
              <Text strong style={{ fontSize: 13 }}>标签口径说明</Text>
              <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
                  <Space wrap size={[4, 4]}>
                    <Tag color="default">系统</Tag>
                    <Text style={{ fontSize: 12 }}>= 由标签模板生成（MVP 字段来源：平台资源字段 / 组合字段），只读；改值请前往标签模板管理</Text>
                  </Space>
                  <Space wrap size={[4, 4]}>
                    <Tag color="cyan">用户</Tag>
                    <Text style={{ fontSize: 12 }}>= 实例级自定义标签（含通用目标 custom_labels 透传）；仅应用服务资源可编辑 / 删除</Text>
                  </Space>
                  <Space wrap size={[4, 4]}>
                    <Tag>CMDB（v0.4+）</Tag>
                    <Text style={{ fontSize: 12 }}>= 后续版本由 CMDB 同步，MVP 仅占位展示，对应模板映射的「CMDB 字段」来源</Text>
                  </Space>
                  <Space wrap size={[4, 4]}>
                    <Tag color="blue">双场景</Tag>
                    <Text style={{ fontSize: 12 }}>=
                      {selectedResource?.resource_category === 'application'
                        ? '业务类型资源：标签由平台治理，开放自定义标签（如核心链路、负责人）'
                        : '静态资源（主机 / 中间件 / 通用目标）：标签由 CMDB / Excel 治理，平台只读，不提供实例级打标入口'}
                    </Text>
                  </Space>
                  <Text style={{ fontSize: 12, color: '#86909C' }}>
                    {'冲突优先级：CMDB > 用户 > 系统（系统标签为生成基线，不可被覆盖）。大多数场景下标签模板已自动生成所需标签，仅当个别应用服务实例需要额外标签时使用。'}
                  </Text>
              </Space>
            </div>
            {/* 批量标签编辑占位（后续版本开放） */}
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              批量标签编辑（后续版本开放）：按资源类别或筛选条件批量增删改标签。
            </Text>
            {selectedResource?.resource_category !== 'application' ? (
              // {v2.8} 双场景治理：静态资源只读，不渲染添加输入（数据治理在 CMDB / Excel 侧）
              <Text style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
                静态资源标签由 CMDB / Excel 治理，平台只读。主机、中间件、通用目标资源的标签由 CMDB 同步（MVP 阶段由 Excel 导入带入），数据治理在 CMDB 侧完成，本平台不引导二次打标。如需修改标签，请前往 CMDB 或更新导入数据。
              </Text>
            ) : (
            <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
              <Row gutter={12} align="middle">
                <Col span={9}>
                  <Input
                    placeholder="label key，如 team"
                    value={newLabelKey}
                    status={keyError ? 'error' : undefined}
                    onChange={(e) => setNewLabelKey(e.target.value)}
                  />
                </Col>
                <Col span={9}>
                  <Input
                    placeholder="label value"
                    value={newLabelValue}
                    onChange={(e) => setNewLabelValue(e.target.value)}
                  />
                </Col>
                <Col span={6}>
                  <Button type="primary" icon={<PlusOutlined />} block style={{ backgroundColor: '#0ECDEB' }} onClick={handleAddLabel}>
                    添加自定义标签
                  </Button>
                </Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                key 规则：小写字母/数字/下划线；禁止 __ 开头；长度 ≤128；禁止覆盖 Prometheus 内置标签（如 instance/job/scheme 等）。
              </Text>
              {(keyError || cmdbConflict) && (
                <div>
                  {keyError && <Text type="danger" style={{ fontSize: 12 }}>{keyError}</Text>}
                  {!keyError && cmdbConflict && (
                    <Text style={{ color: '#FA8C16', fontSize: 12 }}>该 key 将由 CMDB 覆盖，建议更换 key</Text>
                  )}
                </div>
              )}
            </Space>
            )}
            <Space direction="vertical" style={{ width: '100%' }}>
              {labels.map((label) => {
                const tplSource = label.source === 'system' ? findTemplateSource(selectedResource?.resource_category ?? 'host', label.label_key) : null
                return (
                  <Card
                    key={label.label_id}
                    size="small"
                    bodyStyle={{ padding: 12 }}
                    style={{
                      borderLeft: `4px solid ${
                        label.source === 'cmdb' ? '#1481FD' : label.source === 'user' ? '#0ECDEB' : '#86909C'
                      }`,
                    }}
                  >
                    <Row gutter={16} align="middle">
                      <Col span={6}>
                        <Text strong>{label.label_key}</Text>
                        <div>
                          {/* {v2.6} cmdb 来源降级为 v0.4+ 占位展示（MVP 未接入 CMDB） */}
                          <Tag color={label.source === 'cmdb' ? 'default' : label.source === 'user' ? 'cyan' : 'default'}>
                            {label.source === 'cmdb' ? 'CMDB · v0.4+ 预留' : LABEL_SOURCE_MAP[label.source]}
                          </Tag>
                          {/* {v2.8} 静态资源整体只读：即使 user 来源（Excel 带入）也显示锁定 */}
                          {(!label.is_editable || selectedResource?.resource_category !== 'application') && (
                            <LockOutlined style={{ color: '#86909C', marginLeft: 4 }} />
                          )}
                        </div>
                        {/* {v2.2} 联动标注：来源模板/映射 或 来源说明 */}
                        {label.source === 'system' && tplSource && (
                          <Text
                            type="secondary"
                            style={{ fontSize: 11, cursor: 'pointer' }}
                            onClick={() => navigate('/label-templates')}
                          >
                            <Tooltip title="前往标签模板管理">
                              来自 {tplSource.templateName} · {tplSource.sourceField}→{label.label_key}
                            </Tooltip>
                          </Text>
                        )}
                        {label.source === 'system' && !tplSource && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            来自标签模板
                          </Text>
                        )}
                        {label.source === 'user' && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {/* {v2.8} 双场景：application = 资源自定义（实例级）；静态资源 = Excel / CMDB 带入（只读） */}
                            {selectedResource?.resource_category === 'application'
                              ? '资源自定义（实例级）'
                              : 'Excel / CMDB 带入（只读）'}
                          </Text>
                        )}
                        {label.source === 'cmdb' && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            CMDB 同步（v0.4+ 接入后生效，MVP 仅占位展示）
                          </Text>
                        )}
                      </Col>
                      <Col span={12}>
                        <Input
                          value={label.label_value}
                          disabled={!label.is_editable || selectedResource?.resource_category !== 'application'}
                          onChange={(e) => handleLabelChange(label.label_id, e.target.value)}
                          suffix={
                            label.conflict_hint ? (
                              <Tooltip title={label.conflict_hint}>
                                <InfoCircleOutlined style={{ color: '#FA8C16' }} />
                              </Tooltip>
                            ) : null
                          }
                        />
                      </Col>
                      <Col span={6} style={{ textAlign: 'right' }}>
                        {label.is_editable && selectedResource?.resource_category === 'application' ? (
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteLabel(label)}>
                            删除
                          </Button>
                        ) : (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            只读
                          </Text>
                        )}
                      </Col>
                    </Row>
                  </Card>
                )
              })}
            </Space>
          </>
        )}
      </Drawer>

      {/* 新增 / 编辑资源（PRD 5.6~5.9 按类型渲染字段，v1.8 起改为右侧抽屉编辑） */}
      <Drawer
        title={`${editingResource ? '编辑资源' : '新增资源'} - ${RESOURCE_TYPE_MAP[editingResource?.resource_category ?? activeType]}`}
        width={560}
        open={editOpen}
        onClose={() => {
          setEditOpen(false)
          setEditingResource(null)
          resourceForm.resetFields()
        }}
        extra={
          <Space>
            <Button
              onClick={() => {
                setEditOpen(false)
                setEditingResource(null)
                resourceForm.resetFields()
              }}
            >
              取消
            </Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSaveResource}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={resourceForm} layout="vertical" style={{ marginTop: 8 }}>
          {renderTypeFields(editingResource?.resource_category ?? activeType)}
          {renderCommonFields()}
        </Form>
      </Drawer>

      {/* 下载模板（PRD 7.1） */}
      <Modal
        title={`下载模板 - ${RESOURCE_TYPE_MAP[activeType]}`}
        open={templateModalOpen}
        onCancel={() => setTemplateModalOpen(false)}
        footer={
          <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={() => setTemplateModalOpen(false)}>
            关闭
          </Button>
        }
        width={560}
      >
        <Text style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
          <Text strong>固定列模板：</Text>按资源类别提供固定列模板；未填写网域时自动归属默认网域。{/* {v2.19} 模板由后端生成静态 xlsx，内置「取值说明 sheet」列出合法值清单（5.16.1） */}
        </Text>
        <Table
          size="small"
          rowKey="column"
          pagination={false}
          dataSource={IMPORT_TEMPLATE_COLUMNS[activeType].map((c, i) => ({ order: i + 1, column: c }))}
          columns={[
            { title: '列顺序', dataIndex: 'order', key: 'order', width: 80 },
            { title: '列名', dataIndex: 'column', key: 'column', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
          ]}
        />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          custom_labels 列支持 key1=value1;key2=value2 格式；status 支持中文状态值（见导入弹窗状态映射）。
        </Text>
        <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          模板为后端静态生成 xlsx，内置取值说明 sheet 列出各列合法值；biz_code 必填，仅可填已登记字典条目（含兜底 infra）。
        </Text>
        {/* {v2.19} 下载模板由后端生成静态 xlsx + 「取值说明 sheet」（5.16.1）；dataValidation 下拉挪 v0.2+。原灰色长说明已精简。 */}
      </Modal>

      {/* Excel 导入结果（PRD 7.2 / 7.3） */}
      <Modal
        title={`Excel 导入结果 - ${RESOURCE_TYPE_MAP[activeType]}`}
        open={importModalOpen}
        onCancel={() => setImportModalOpen(false)}
        footer={
          <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={() => setImportModalOpen(false)}>
            关闭
          </Button>
        }
        width={720}
      >
        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
          状态映射字典：
        </Text>
        <Space wrap size={[8, 8]} style={{ marginBottom: 12 }}>
          {STATUS_MAPPING_RULES.map((rule) => (
            <Tag key={rule.target}>
              {rule.source.join(' / ')} → {STATUS_MAP[rule.target]}
            </Tag>
          ))}
        </Space>
        <Text style={{ fontSize: 12, color: '#86909C', display: 'block', marginBottom: 12 }}>
          导入校验项：必填字段（含 biz_code 必填） · 网域存在性 · 业务存在性（仅限启用条目，不可自由文本） · IP 格式 · 端口 1~65535 · URL 格式 · env / protocol / scheme / 状态枚举 · 重复检测（instance_ip:port / service_name） · custom_labels 格式 key=value;key2=value2
        </Text>
        <Text style={{ fontSize: 12, color: '#00B0F0', display: 'block', marginBottom: 12 }}>
          导入按行增量更新，不会删除资源，Excel 中已消失的行不会被自动清理。如需停止采集某批资源，请将目标行的「运行状态」改为「已停止」后重新导入，已停止资源将不再被采集。
        </Text>
        <Row gutter={16} style={{ marginBottom: 12 }}>
          <Col span={8}>
            <Card size="small">
              <Text type="secondary">总数</Text>
              <div><Text strong style={{ fontSize: 20 }}>{importResult.total}</Text></div>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Text type="secondary">成功</Text>
              <div><Text strong style={{ fontSize: 20, color: '#00B578' }}>{importResult.success}</Text></div>
            </Card>
          </Col>
          <Col span={8}>
            <Card size="small">
              <Text type="secondary">失败</Text>
              <div><Text strong style={{ fontSize: 20, color: importResult.failed > 0 ? '#FF4C3A' : '#86909C' }}>{importResult.failed}</Text></div>
            </Card>
          </Col>
        </Row>
        <Table
          size="small"
          rowKey={(r) => `${r.row}-${r.field}`}
          pagination={false}
          dataSource={importResult.errors}
          locale={{ emptyText: '导入无错误' }}
          columns={[
            { title: '行号', dataIndex: 'row', key: 'row', width: 70 },
            { title: '字段', dataIndex: 'field', key: 'field', width: 140 },
            {
              title: '值',
              dataIndex: 'value',
              key: 'value',
              render: (v: string) => (v ? <Text code style={{ fontSize: 12 }}>{v}</Text> : '(空)'),
            },
            { title: '原因', dataIndex: 'reason', key: 'reason' },
          ]}
        />
      </Modal>
    </MainLayout>
  )
}
