import { useState } from 'react'
import { Card, Table, Tag, Button, Space, Modal, Form, Input, Select, message, Tooltip, Typography } from 'antd'
import { EditOutlined, ReloadOutlined, PlusOutlined, CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { networkDomains, type NetworkDomain, type NetworkDomainStatus, type AgentType, type DomainType } from '../mocks/module-09'

const { Text } = Typography

const statusColor: Record<NetworkDomainStatus, string> = {
  online: 'success',
  offline: 'error',
  unknown: 'default',
}

const domainTypeColor: Record<DomainType, string> = {
  management: 'blue',
  edge: 'cyan',
}

const domainTypeLabel: Record<DomainType, string> = {
  management: '管理域',
  edge: '边缘域',
}

const agentTypeLabel: Record<AgentType, string> = {
  vmagent: 'VMAgent',
  'prometheus-agent': 'Prometheus Agent',
}

function maskToken(token: string) {
  if (token.length <= 12) return '***'
  return `${token.slice(0, 6)}...${token.slice(-6)}`
}

export function NetworkDomainsPage() {
  const [data, setData] = useState<NetworkDomain[]>(networkDomains)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  const [form] = Form.useForm<Partial<NetworkDomain>>()

  const handleEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleCreate = () => {
    setEditingDomain(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleSave = (values: Partial<NetworkDomain>) => {
    if (editingDomain) {
      const isDefaultManagement = editingDomain.id === 'default'
      setData((prev) =>
        prev.map((item) =>
          item.id === editingDomain.id
            ? {
                ...item,
                ...values,
                // default 管理域的 domain_type 不可变更
                domain_type: isDefaultManagement ? 'management' : (values.domain_type ?? item.domain_type),
                updated_at: new Date().toLocaleString('zh-CN', { hour12: false }),
              }
            : item
        )
      )
      message.success('网域已更新')
    } else {
      const now = new Date().toLocaleString('zh-CN', { hour12: false })
      const id = values.name?.toLowerCase().replace(/\s+/g, '-') || `domain-${Date.now()}`
      const newDomain: NetworkDomain = {
        id,
        name: values.name || '',
        description: values.description || '',
        domain_type: 'edge',
        tenant_id: values.tenant_id || 'platform_admin',
        token: `tk_${Math.random().toString(36).slice(2, 14)}`,
        agent_type: values.agent_type || 'vmagent',
        remote_write_url: values.remote_write_url || '',
        status: 'unknown',
        last_heartbeat: '-',
        agent_version: '-',
        created_at: now,
        updated_at: now,
      }
      setData((prev) => [...prev, newDomain])
      message.success('网域已创建')
    }
    setIsModalOpen(false)
  }

  const handleResetToken = (record: NetworkDomain) => {
    Modal.confirm({
      title: '重置 Token',
      content: `确定要重置网域 "${record.name}" 的接入 Token 吗？旧 Token 将立即失效。`,
      okText: '确认重置',
      okType: 'primary',
      cancelText: '取消',
      onOk: () => {
        setData((prev) =>
          prev.map((item) =>
            item.id === record.id
              ? { ...item, token: `tk_${Math.random().toString(36).slice(2, 14)}`, updated_at: new Date().toLocaleString('zh-CN', { hour12: false }) }
              : item
          )
        )
        message.success('Token 已重置')
      },
    })
  }

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token).then(() => message.success('Token 已复制'))
  }

  const handleDelete = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('管理域禁止删除')
      return
    }
    Modal.confirm({
      title: '删除网域',
      content: `确定要删除网域 "${record.name}" 吗？删除前请确认该网域下已无资源绑定。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setData((prev) => prev.filter((item) => item.id !== record.id))
        message.success('网域已删除')
      },
    })
  }

  return (
    <MainLayout>
      <Card
        title="网域管理"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            注册网域
          </Button>
        }
      >
        <Table
          dataSource={data}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '网域 ID', dataIndex: 'id', key: 'id' },
            { title: '网域名称', dataIndex: 'name', key: 'name' },
            {
              title: '类型',
              dataIndex: 'domain_type',
              key: 'domain_type',
              render: (type: DomainType) => <Tag color={domainTypeColor[type]}>{domainTypeLabel[type]}</Tag>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              render: (status: NetworkDomainStatus) => <Tag color={statusColor[status]}>{status}</Tag>,
            },
            {
              title: 'Agent 类型',
              dataIndex: 'agent_type',
              key: 'agent_type',
              render: (type: AgentType) => <Tag color="blue">{agentTypeLabel[type]}</Tag>,
            },
            { title: '最后心跳', dataIndex: 'last_heartbeat', key: 'last_heartbeat' },
            {
              title: 'Token',
              dataIndex: 'token',
              key: 'token',
              render: (token: string) => (
                <Space>
                  <span>{maskToken(token)}</span>
                  <Tooltip title="复制 Token">
                    <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => handleCopyToken(token)} />
                  </Tooltip>
                </Space>
              ),
            },
            {
              title: 'Remote Write URL',
              dataIndex: 'remote_write_url',
              key: 'remote_write_url',
              ellipsis: true,
            },
            {
              title: '操作',
              key: 'action',
              render: (_: unknown, record: NetworkDomain) => (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
                    编辑
                  </Button>
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => handleResetToken(record)}>
                    重置 Token
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={record.domain_type === 'management'}
                    onClick={() => handleDelete(record)}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editingDomain ? '编辑网域' : '注册网域'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="name"
            label="网域名称"
            rules={[{ required: true, message: '请输入网域名称' }]}
          >
            <Input placeholder="例如：政务网 A 区" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="描述该网域的用途与网络特征" />
          </Form.Item>
          {editingDomain?.id === 'default' && (
            <Form.Item>
              <Text type="secondary">管理域 "default" 仅允许修改名称与描述，禁止删除。</Text>
            </Form.Item>
          )}
          {!editingDomain && (
            <>
              <Form.Item name="tenant_id" label="租户 ID">
                <Input placeholder="例如：platform_admin" />
              </Form.Item>
              <Form.Item
                name="agent_type"
                label="Agent 类型"
                rules={[{ required: true, message: '请选择 Agent 类型' }]}
              >
                <Select
                  options={[
                    { value: 'vmagent', label: 'VMAgent' },
                    { value: 'prometheus-agent', label: 'Prometheus Agent' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="remote_write_url" label="Remote Write URL">
                <Input placeholder="例如：https://metriccenter.example.com/api/v2/ingest/prometheus" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </MainLayout>
  )
}

export default NetworkDomainsPage
