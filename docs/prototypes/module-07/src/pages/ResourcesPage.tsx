import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Badge,
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
  UploadOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  ENV_VALUES,
  IMPORT_TEMPLATE_COLUMNS,
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
  isMiddlewareResource,
  mockNetworkDomains,
  mockResourceLabels,
  mockResources,
} from '../mocks/module-07'
import type {
  AppProtocol,
  Env,
  ImportError,
  Resource,
  ResourceLabel,
  ResourceStatus,
  ResourceType,
  TargetScheme,
} from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']

const STATUS_COLOR: Record<ResourceStatus, string> = {
  online: '#00B578',
  offline: '#FF4C3A',
  maintenance: '#FA8C16',
  orphan: '#86909C',
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CUSTOM_LABELS_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^;]+)(;([A-Za-z_][A-Za-z0-9_]*=[^;]+))*$/

/** Excel 导入结果 mock 演示（PRD 6.2 / 6.3，含重复检测与网域校验错误示例） */
const IMPORT_RESULT_DEMO: Record<ResourceType, { total: number; success: number; failed: number; errors: ImportError[] }> = {
  host: {
    total: 3,
    success: 1,
    failed: 2,
    errors: [
      { row: 2, resource_type: 'host', field: 'instance_ip', value: '999.999.999.999', reason: 'IP 格式不正确' },
      { row: 3, resource_type: 'host', field: 'instance_ip:port', value: '10.0.1.11:9100', reason: '重复检测：instance_ip:port 已存在（PRD 6.2 重复检测）' },
    ],
  },
  middleware: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [
      { row: 2, resource_type: 'middleware', field: 'network_domain', value: 'unknown-domain', reason: '网域不存在：network_domain 必须对应已存在的 NetworkDomain.id（PRD 6.2 网域存在性校验）' },
    ],
  },
  application: {
    total: 3,
    success: 2,
    failed: 1,
    errors: [{ row: 3, resource_type: 'application', field: 'env', value: 'production', reason: 'env 必须是 dev/test/staging/prod 之一' }],
  },
  generic_target: {
    total: 2,
    success: 1,
    failed: 1,
    errors: [{ row: 1, resource_type: 'generic_target', field: 'custom_labels', value: 'device_type=snmp', reason: 'custom_labels 必须符合 key=value;key2=value2 格式' }],
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

export default function ResourcesPage() {
  const { message, modal } = App.useApp()
  const [activeType, setActiveType] = useState<ResourceType>('host')
  const [search, setSearch] = useState('')
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
      if (item.resource_type !== activeType) return false
      if (!keyword) return true
      const texts: (string | undefined)[] = [
        item.instance_name,
        item.hostname,
        item.instance_ip,
        item.app_name,
        item.cluster,
        item.env,
        item.owner,
      ]
      if (isMiddlewareResource(item)) texts.push(item.middleware_type)
      if (isApplicationResource(item)) texts.push(item.service_name)
      if (isGenericTargetResource(item)) texts.push(item.target_name, item.exporter_type)
      return texts.some((t) => (t ?? '').toLowerCase().includes(keyword))
    })
  }, [resources, activeType, search])

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
    if (keyError) {
      message.error(keyError)
      return
    }
    if (cmdbConflict) {
      message.warning('该 key 将由 CMDB 覆盖，建议更换 key')
    }
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
    message.success('标签已添加（source=user）')
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

  const buildNewResource = (type: ResourceType, values: Record<string, unknown>): Resource => {
    const base = {
      network_domain_id: (values.network_domain_id as string) || 'default',
      source_type: 'manual' as const,
      app_name: values.app_name as string | undefined,
      env: values.env as Env | undefined,
      cluster: values.cluster as string | undefined,
      owner: values.owner as string | undefined,
      status: (values.status as ResourceStatus) || 'online',
      is_monitored: false,
      created_at: nowStr(),
      updated_at: nowStr(),
    }
    switch (type) {
      case 'host':
        return {
          resource_id: `res-host-${Date.now()}`,
          resource_type: 'host' as const,
          instance_name: values.instance_name as string,
          hostname: values.hostname as string,
          instance_ip: values.instance_ip as string,
          os_type: values.os_type as string | undefined,
          os_version: values.os_version as string | undefined,
          ...base,
        }
      case 'middleware':
        return {
          resource_id: `res-mw-${Date.now()}`,
          resource_type: 'middleware' as const,
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
          resource_type: 'application' as const,
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
          resource_type: 'generic_target' as const,
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
      app_name: values.app_name as string | undefined,
      env: values.env as Env | undefined,
      cluster: values.cluster as string | undefined,
      owner: values.owner as string | undefined,
      status: (values.status as ResourceStatus) || 'online',
      updated_at: nowStr(),
    }
    switch (record.resource_type) {
      case 'host':
        return {
          ...record,
          ...common,
          hostname: values.hostname as string,
          instance_ip: values.instance_ip as string,
          os_type: values.os_type as string | undefined,
          os_version: values.os_version as string | undefined,
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

  // ---------- 表单字段渲染（按资源类型，PRD 5.6~5.9） ----------
  const renderTypeFields = (type: ResourceType) => {
    switch (type) {
      case 'host':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name" rules={[{ required: true, message: '请输入实例名' }]} extra="host 模板必填，生成 hostname label（PRD 5.2/5.12）">
                  <Input placeholder="如 prod-web-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="主机名" name="hostname" rules={[{ required: true, message: '请输入主机名' }]} extra="host 场景下默认与 instance_name 一致（PRD 5.2）">
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
                  extra="作为 Prometheus scrape target 地址（PRD 5.6）"
                >
                  <Input placeholder="如 10.0.1.11" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="操作系统" name="os_type">
                  <Input placeholder="如 Linux / Windows" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="系统版本" name="os_version">
              <Input placeholder="如 7.9" />
            </Form.Item>
          </>
        )
      case 'middleware':
        return (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="实例名" name="instance_name">
                  <Input placeholder="如 redis-cache-01" />
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
                <Form.Item label="连接串" name="connection_string" extra="敏感信息可加密存储（PRD 5.7）">
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
              extra="作为资源字段由 Module_07 维护，Blackbox Job 配置由 Module_01 负责（PRD 5.8）"
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
                <Form.Item label="Exporter 类型" name="exporter_type" extra="如 snmp_exporter / gpu_exporter / oracle_exporter（PRD 5.9）">
                  <Input placeholder="如 snmp_exporter / gpu_exporter" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="目标 IP / 域名" name="instance_ip" rules={[{ required: true, message: '请输入目标 IP 或域名' }]} extra="必填且符合 IPv4/域名格式（PRD 6.2）">
                  <Input placeholder="如 172.16.0.1" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="端口" name="port" rules={[{ type: 'number', min: 1, max: 65535, message: '端口范围 1~65535' }]} extra="空时不拼接 instance（PRD 5.9）">
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
              extra="支持 key1=value1;key2=value2 格式（PRD 6.1）"
            >
              <Input placeholder="如 device_type=snmp_switch;vendor=h3c" />
            </Form.Item>
          </>
        )
    }
  }

  const renderCommonFields = () => (
    <>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="应用名" name="app_name" rules={[{ required: true, message: '请输入应用名' }]} extra="映射为 app label（PRD 5.2/5.12）">
            <Input placeholder="如 订单服务" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="环境" name="env" rules={[{ required: true, message: '请选择环境' }]} extra="映射为 env label（PRD 5.2/5.12）">
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
          <Form.Item label="集群" name="cluster" rules={[{ required: true, message: '请输入集群' }]} extra="映射为 cluster label；host 场景 sub_app_code 为空时取 vpc（PRD 5.2/5.12）">
            <Input placeholder="如 k8s-prod" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="负责人" name="owner" extra="MVP 用户填写；v0.4+ 优先取自 cmdb_maintainer（PRD 5.2）">
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
            extra="单网域模式下网域列仍展示，不可隐藏（PRD 3.1/5.4）；网域生命周期由 Module_09 负责"
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
          <Form.Item label="状态" name="status" rules={[{ required: true, message: '请选择状态' }]} extra="orphan 为 v0.4+ 预留，不在表单选项中（PRD 5.2）">
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

  // ---------- 表格列（按资源类型固定展示，PRD 3.1） ----------
  const getColumns = (type: ResourceType): TableProps<Resource>['columns'] => {
    const domainColumn = {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag color="cyan">{value}</Tag>,
    }
    const sourceColumn = {
      title: '来源',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (value: string) => <Tag>{SOURCE_TYPE_MAP[value as keyof typeof SOURCE_TYPE_MAP] || value}</Tag>,
    }
    const statusColumn = {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: ResourceStatus) => <Badge color={STATUS_COLOR[value]} text={STATUS_MAP[value]} />,
    }
    const monitoredColumn = {
      title: (
        <Tooltip title="已监控 / 未监控由 Module_01 监控策略维护关联关系，Module_07 只读展示（PRD 3.1/5.2）。is_monitored 字段由 Module_01 在创建/更新/删除 ScrapeJob 时同步计算并写入。">
          <Space size={4}>
            监控
            <InfoCircleOutlined style={{ color: '#86909C' }} />
          </Space>
        </Tooltip>
      ),
      dataIndex: 'is_monitored',
      key: 'is_monitored',
      render: (value: boolean) =>
        value ? (
          <Badge status="processing" text={<span style={{ color: '#00B578' }}>已监控</span>} />
        ) : (
          <Badge status="default" text="未监控" />
        ),
    }
    const actionColumn = {
      title: '操作',
      key: 'actions',
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
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {record.hostname}
                </Text>
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
          sourceColumn,
          statusColumn,
          monitoredColumn,
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
          sourceColumn,
          statusColumn,
          monitoredColumn,
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
          sourceColumn,
          statusColumn,
          monitoredColumn,
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
          sourceColumn,
          statusColumn,
          monitoredColumn,
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
        <Text type="secondary">管理主机、中间件、应用及通用监控对象（Module_07，PRD v1.2）</Text>
      </div>

      {/* 模块边界说明（PRD 1/4.1） */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="模块边界：Module_07 是被动数据提供方"
        description={
          <span>
            本模块仅维护 Resource / LabelTemplate / ResourceLabel，<strong>不生成 prometheus.yml、不配置 ScrapeJob、不下发配置</strong>。
            监控策略由 <Tag color="blue">Module_01</Tag> 负责，配置生成/下发由 <Tag color="blue">Module_09</Tag> 负责。
            <code>is_monitored</code> 字段由 Module_01 维护，本模块只读展示。
          </span>
        }
      />

      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
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
            </Space>
          </Col>
          <Col>
            <Input.Search
              placeholder="搜索实例名 / IP / 应用"
              allowClear
              onSearch={(value) => setSearch(value)}
              style={{ width: 280 }}
            />
          </Col>
        </Row>

        <Tabs
          activeKey={activeType}
          onChange={(key) => setActiveType(key as ResourceType)}
          items={RESOURCE_TYPES.map((type) => ({
            key: type,
            label: `${RESOURCE_TYPE_MAP[type]} (${resources.filter((r) => r.resource_type === type).length})`,
          }))}
          style={{ marginBottom: 16 }}
        />

        <Table
          rowKey="resource_id"
          dataSource={filteredData}
          columns={getColumns(activeType)}
          pagination={{ pageSize: 6 }}
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
            <Alert
              message={`来源：${SOURCE_TYPE_MAP[selectedResource.source_type]} | 类型：${RESOURCE_TYPE_MAP[selectedResource.resource_type]} | 网域：${selectedResource.network_domain_id}`}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Descriptions
              column={2}
              size="small"
              title="基础信息"
              items={[
                { key: 'instance_name', label: '实例名', children: selectedResource.instance_name || '-' },
                { key: 'hostname', label: '主机名', children: selectedResource.hostname || '-' },
                { key: 'instance_ip', label: 'IP 地址', children: selectedResource.instance_ip || '-' },
                { key: 'app_name', label: '应用', children: selectedResource.app_name || '-' },
                { key: 'env', label: '环境', children: selectedResource.env || '-' },
                { key: 'cluster', label: '集群', children: selectedResource.cluster || '-' },
                { key: 'owner', label: '负责人', children: selectedResource.owner || '-' },
                {
                  key: 'status',
                  label: '状态',
                  children: <Badge color={STATUS_COLOR[selectedResource.status]} text={STATUS_MAP[selectedResource.status]} />,
                },
                {
                  key: 'is_monitored',
                  label: (
                    <Tooltip title="is_monitored 由 Module_01 维护，Module_07 只读展示（PRD 5.2）">
                      <Space size={4}>监控状态<InfoCircleOutlined style={{ color: '#86909C', fontSize: 12 }} /></Space>
                    </Tooltip>
                  ),
                  children: selectedResource.is_monitored ? (
                    <Badge status="processing" text="已监控" />
                  ) : (
                    <Badge status="default" text="未监控" />
                  ),
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
              title="CMDB 字段（v0.4+ 预留，由 Module_04 同步）"
              style={{ marginTop: 16 }}
              items={[
                { key: 'cmdb_ci_id', label: 'cmdb_ci_id（v0.4+）', children: selectedResource.cmdb_ci_id || '-' },
                { key: 'cmdb_business_path', label: 'cmdb_business_path（v1.0+）', children: selectedResource.cmdb_business_path || '-' },
                { key: 'cmdb_module_path', label: 'cmdb_module_path（v1.0+）', children: selectedResource.cmdb_module_path || '-' },
                { key: 'cmdb_maintainer', label: 'cmdb_maintainer（v1.0+）', children: selectedResource.cmdb_maintainer || '-' },
              ]}
            />
            <Divider />
            <Title level={5}>标签管理</Title>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="标签冲突优先级：CMDB > 用户 > 系统。system / cmdb 来源标签只读，仅 user 来源标签可编辑与删除。"
            />
            {/* P1 批量标签编辑占位（PRD 3.3） */}
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="批量标签编辑 {P1}：按资源类型或筛选条件批量增删改标签，当前版本暂未开放"
            />
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
                    添加
                  </Button>
                </Col>
              </Row>
              <Text type="secondary" style={{ fontSize: 12 }}>
                key 规则：小写字母 / 数字 / 下划线；禁止以 __ 开头；长度 ≤128；禁止覆盖 Prometheus 内置 label（instance / job / scheme / __address__ 等）。
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
            <Space direction="vertical" style={{ width: '100%' }}>
              {labels.map((label) => (
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
                        <Tag color={label.source === 'cmdb' ? 'blue' : label.source === 'user' ? 'cyan' : 'default'}>
                          {label.source}
                        </Tag>
                        {!label.is_editable && <LockOutlined style={{ color: '#86909C', marginLeft: 4 }} />}
                      </div>
                    </Col>
                    <Col span={12}>
                      <Input
                        value={label.label_value}
                        disabled={!label.is_editable}
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
                      {label.is_editable ? (
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
              ))}
            </Space>
          </>
        )}
      </Drawer>

      {/* 新增 / 编辑资源（PRD 5.6~5.9 按类型渲染字段） */}
      <Modal
        title={`${editingResource ? '编辑资源' : '新增资源'} - ${RESOURCE_TYPE_MAP[editingResource?.resource_type ?? activeType]}`}
        open={editOpen}
        onCancel={() => {
          setEditOpen(false)
          setEditingResource(null)
          resourceForm.resetFields()
        }}
        onOk={handleSaveResource}
        okText="保存"
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={640}
        destroyOnClose
      >
        <Form form={resourceForm} layout="vertical" style={{ marginTop: 16 }}>
          {renderTypeFields(editingResource?.resource_type ?? activeType)}
          {renderCommonFields()}
        </Form>
      </Modal>

      {/* 下载模板（PRD 6.1） */}
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
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="固定列模板（PRD 6.1）"
          description="按资源类型提供固定列模板（原型演示，不生成真实文件）；未填写 network_domain 时自动归属 default 网域。"
        />
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
      </Modal>

      {/* Excel 导入结果（PRD 6.2 / 6.3） */}
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
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="状态映射字典（PRD 5.5.1）"
          description={
            <Space wrap size={[8, 8]}>
              {STATUS_MAPPING_RULES.map((rule) => (
                <Tag key={rule.target}>
                  {rule.source.join(' / ')} → {STATUS_MAP[rule.target]}
                </Tag>
              ))}
            </Space>
          }
        />
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="导入校验项（PRD 6.2，mock 演示）"
          description="必填字段 · 网域存在性（空时归属 default，不存在则报错） · IP 格式 · 端口范围 1~65535 · URL 格式 · env 枚举 dev/test/staging/prod · protocol 枚举 http/https/tcp · 状态枚举 · 重复检测（instance_ip:port / service_name 不可重复） · 通用目标 instance_ip 必填 · scheme 枚举 http/https · custom_labels 格式 key=value;key2=value2"
        />
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
