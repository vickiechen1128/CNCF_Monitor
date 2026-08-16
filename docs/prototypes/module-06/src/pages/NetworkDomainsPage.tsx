import { useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tooltip,
  Alert,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockNetworkDomains,
  mockTenants,
  ZONE_TYPE_OPTIONS,
  zoneTypeLabelOf,
  type NetworkDomain,
} from '../mocks/module-06'

const { Title, Text } = Typography
const { Option } = Select

/**
 * {v1.3} M06 为 NetworkDomain 的行政 Owner（PRD 职责边界）：
 * 本页负责网域的行政创建 / 编辑 / 禁用与租户分配，表单只维护行政信息，
 * 不维护监控参数；监控纳管（Token / Remote Write / Edge Agent）由 Module_09 执行。
 * {v1.4} 新增 zone_type（网络区域类型，部署级字典下拉）；网域定义为全平台唯一入口（下游只引用 network_domain_id）。
 * {v1.5} 新建校验：所选租户 multi_site_enabled=false 时不可创建额外网域（行政能力开关，不控制 M09 入口）。
 */
export function NetworkDomainsPage() {
  const [domains, setDomains] = useState<NetworkDomain[]>(mockNetworkDomains)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  const [form] = Form.useForm()

  const tenantNameOf = (tenantId: string) =>
    mockTenants.find((t) => t.id === tenantId)?.name ?? tenantId

  const watchedName = Form.useWatch('name', form) as string | undefined
  const watchedTenant = Form.useWatch('tenant_id', form) as string | undefined

  /** PRD：network_domain_id 全局唯一，按租户前缀自动生成（<tenant>-<name slug>） */
  const suggestedId = (() => {
    if (editingDomain) return editingDomain.id
    const tenantPrefix = watchedTenant ? watchedTenant.replace(/^t-/, '') : ''
    const nameSlug = (watchedName ?? '').trim().toLowerCase().replace(/\s+/g, '-')
    if (!tenantPrefix || !nameSlug) return ''
    return `${tenantPrefix}-${nameSlug}`
  })()

  const showAdd = () => {
    setEditingDomain(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const showEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    form.setFieldsValue({ ...record })
    setIsModalOpen(true)
  }

  const handleSave = (values: Partial<NetworkDomain>) => {
    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    if (editingDomain) {
      setDomains((prev) =>
        prev.map((item) =>
          item.id === editingDomain.id
            ? {
                ...item,
                ...values,
                // 行政归属（id / 租户）创建后不可变更
                id: item.id,
                tenant_id: item.tenant_id,
                updated_at: now,
              }
            : item
        )
      )
      message.success('网域行政信息已更新')
    } else {
      // {v1.5} 行政能力开关校验：multi_site_enabled=false 的租户不可在 M06 创建额外网域
      const targetTenant = mockTenants.find((t) => t.id === values.tenant_id)
      if (targetTenant && !targetTenant.multi_site_enabled) {
        message.error(
          `租户「${targetTenant.name}」未开启多网域能力（multi_site_enabled=false），不可创建额外网域；请使用 default 网域，或在租户管理中开启多网域能力`
        )
        return
      }
      const id = suggestedId || `nd-${Date.now()}`
      if (domains.some((d) => d.id === id)) {
        message.error(`网域 ID「${id}」已存在：network_domain_id 必须全局唯一`)
        return
      }
      const newDomain: NetworkDomain = {
        id,
        name: values.name || '',
        description: values.description || '',
        domain_type: 'edge',
        tenant_id: values.tenant_id || '',
        status: values.status || 'active',
        zone_type: values.zone_type || '',
        // 新建网域仅完成行政登记，监控纳管由 Module_09 执行
        registration_status: 'created',
        created_at: now,
        updated_at: now,
      }
      setDomains((prev) => [...prev, newDomain])
      message.success(`网域已创建（行政登记）：请前往 Module_09 完成监控纳管`)
    }
    setIsModalOpen(false)
  }

  const toggleStatus = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('系统预置管理域禁止禁用')
      return
    }
    const nextStatus = record.status === 'active' ? 'disabled' : 'active'
    Modal.confirm({
      title: nextStatus === 'disabled' ? '禁用网域' : '启用网域',
      content:
        nextStatus === 'disabled'
          ? `确定禁用网域 "${record.name}" 吗？禁用后该网域不可被租户使用，已纳管的监控配置将停止生效。`
          : `确定重新启用网域 "${record.name}" 吗？`,
      okText: nextStatus === 'disabled' ? '确认禁用' : '确认启用',
      okType: nextStatus === 'disabled' ? 'danger' : 'primary',
      cancelText: '取消',
      onOk: () => {
        setDomains((prev) =>
          prev.map((item) =>
            item.id === record.id
              ? { ...item, status: nextStatus, updated_at: new Date().toLocaleString('zh-CN', { hour12: false }) }
              : item
          )
        )
        message.success(nextStatus === 'disabled' ? '网域已禁用' : '网域已启用')
      },
    })
  }

  const columns = [
    { title: '网域 ID', dataIndex: 'id', key: 'id' },
    { title: '网域名称', dataIndex: 'name', key: 'name' },
    {
      title: '所属租户',
      dataIndex: 'tenant_id',
      key: 'tenant_id',
      render: (tenantId: string) => (
        <Tooltip title={`1 网域 : 1 租户，归属不可变更`}>{tenantNameOf(tenantId)}</Tooltip>
      ),
    },
    {
      title: '类型',
      dataIndex: 'domain_type',
      key: 'domain_type',
      render: (type: NetworkDomain['domain_type']) =>
        type === 'management' ? <Tag color="blue">管理域</Tag> : <Tag color="cyan">边缘域</Tag>,
    },
    {
      title: (
        <Tooltip title="{v1.4} 行政字段：由 M06 登记，选项来自部署级字典（政务云预置互联网区/政务外网区等，公有云预置 region），不开放自由文本；M09 纳管时只读引用并注入指标标签">
          <Space size={4}>
            网络区域类型
            <Text type="secondary" style={{ fontSize: 12 }}>
              (zone_type)
            </Text>
          </Space>
        </Tooltip>
      ),
      dataIndex: 'zone_type',
      key: 'zone_type',
      render: (value: string) =>
        value ? <Tag>{zoneTypeLabelOf(value)}</Tag> : <Text type="secondary">未登记</Text>,
    },
    {
      title: (
        <Tooltip title="只读字段：由 Module_09 网域纳管动作维护，本页不可编辑">
          <Space size={4}>
            监控纳管
            <Text type="secondary" style={{ fontSize: 12 }}>
              (M09)
            </Text>
          </Space>
        </Tooltip>
      ),
      dataIndex: 'registration_status',
      key: 'registration_status',
      render: (status: NetworkDomain['registration_status']) =>
        status === 'monitored' ? (
          <Tag color="processing">已纳管</Tag>
        ) : (
          <Tag>未纳管</Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: NetworkDomain['status']) =>
        status === 'active' ? <Tag color="#00B578">启用</Tag> : <Tag color="#86909C">禁用</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: NetworkDomain) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(record)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger={record.status === 'active'}
            icon={record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />}
            onClick={() => toggleStatus(record)}
          >
            {record.status === 'active' ? '禁用' : '启用'}
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>网域管理</Title>
      </div>
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增网域（行政登记）
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="M06 行政创建 → M09 监控纳管（两阶段生命周期）"
          description={
            <Text type="secondary">
              本页是网域定义的<b>全平台唯一入口</b>（{'{v1.4}'}）：仅维护行政信息（名称、所属租户、状态、
              网络区域类型 zone_type），网域 ID 按租户前缀自动生成且全局唯一。下游模块（M07 资源导入/录入、
              M09 监控纳管、CMDB 同步）只引用 network_domain_id，不得在其他入口新建网域。
              行政创建后的网域处于「未纳管」状态，需前往 Module_09「网域纳管」填写监控参数并安装 Edge Agent
              后才进入监控上下文。1 个网域必须且只能归属 1 个租户，禁止跨租户共享网域；
              网域是逻辑操作上下文与采集边界，不是控制面层级（{'{v1.5}'}）。
              租户未开启多网域能力（multi_site_enabled=false）时不可创建额外网域。
            </Text>
          }
        />
        <Table rowKey="id" dataSource={domains} columns={columns} pagination={{ pageSize: 8 }} />
      </Card>
      <Modal
        title={editingDomain ? '编辑网域（行政信息）' : '新增网域（行政登记）'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="网域名称"
            name="name"
            rules={[{ required: true, message: '请输入网域名称' }]}
          >
            <Input placeholder="例如：政务网 A 区" disabled={editingDomain?.id === 'nd-default'} />
          </Form.Item>
          <Form.Item
            label="所属租户"
            name="tenant_id"
            rules={[{ required: true, message: '请选择所属租户' }]}
            extra="1 网域 : 1 租户；创建后网域归属租户不可变更，禁止跨租户共享网域"
          >
            <Select
              placeholder="请选择租户"
              disabled={!!editingDomain}
              showSearch
              optionFilterProp="children"
            >
              {mockTenants
                .filter((t) => t.status === 'active')
                .map((t) => (
                  <Option key={t.id} value={t.id}>
                    {t.name}
                  </Option>
                ))}
            </Select>
          </Form.Item>
          {!editingDomain && watchedTenant && !mockTenants.find((t) => t.id === watchedTenant)?.multi_site_enabled && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="该租户未开启多网域能力（multi_site_enabled=false）"
              description="按 {v1.5} 约束，M06 侧不可为该租户创建额外网域；该租户仅可使用 default 网域及其纳管状态（M09 入口由数据驱动，不受此开关控制）。可在「租户管理」中开启多网域能力。"
            />
          )}
          <Form.Item
            label="网络区域类型（zone_type）"
            name="zone_type"
            extra="{v1.4} 行政字段：选项来自部署级字典（政务云预置互联网区/政务外网区/专线区/DMZ，公有云预置 region），不开放自由文本；M09 纳管时只读引用并注入指标标签"
          >
            <Select
              placeholder="请选择网络区域类型（可留空表示未登记）"
              allowClear
              showSearch
              optionFilterProp="children"
            >
              {ZONE_TYPE_OPTIONS.map((z) => (
                <Option key={z.value} value={z.value}>
                  {z.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="网域 ID（自动生成）"
            extra="按租户前缀自动生成（<租户>-<名称>），全局唯一、创建后不可修改"
          >
            <Input
              value={suggestedId || '自动生成（请先选择租户并填写名称）'}
              disabled
              placeholder="nd-xxx"
            />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征（行政描述，非监控参数）" />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            initialValue="active"
            rules={[{ required: true, message: '请选择状态' }]}
            extra="禁用后网域不可被租户使用；系统预置管理域不可禁用"
          >
            <Select placeholder="请选择" disabled={editingDomain?.domain_type === 'management'}>
              <Option value="active">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Alert
              type="info"
              showIcon
              message="本表单仅维护行政信息"
              description="行政字段范围（v1.4）：ID / 名称 / 所属租户 / 状态 / 网络区域类型（zone_type）。监控参数（Agent 类型、Remote Write URL、Edge Agent Token、center_endpoint）由 Module_09「网域纳管」填写，此处不可配置。"
            />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
