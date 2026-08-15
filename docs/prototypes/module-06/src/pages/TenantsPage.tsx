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
  Switch,
  Tooltip,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockTenants, mockNetworkDomains, type Tenant } from '../mocks/module-06'

const { Title } = Typography
const { Option } = Select

/**
 * {v1.3} 数据源改为「网域管理」页面的行政记录（mockNetworkDomains），
 * 不再使用硬编码列表；选项标注纳管状态，体现「授权 ≠ 已纳管」
 */
const networkDomainOptions = mockNetworkDomains.map((d) => ({
  value: d.id,
  label: d.registration_status === 'monitored' ? `${d.name}（${d.id}，已纳管）` : `${d.name}（${d.id}，未纳管）`,
}))

export function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>(mockTenants)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [form] = Form.useForm()

  const showAdd = () => {
    setEditingTenant(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const showEdit = (record: Tenant) => {
    setEditingTenant(record)
    form.setFieldsValue({
      ...record,
      networkDomainIds: record.networkDomainIds,
    })
    setIsModalOpen(true)
  }

  const handleSave = (values: Omit<Tenant, 'id' | 'networkDomainNames'>) => {
    const selectedDomains = networkDomainOptions.filter((opt) =>
      values.networkDomainIds.includes(opt.value)
    )
    const payload: Omit<Tenant, 'id'> = {
      ...values,
      networkDomainNames: selectedDomains.map((d) => d.label),
    }
    if (editingTenant) {
      setTenants((prev) =>
        prev.map((item) => (item.id === editingTenant.id ? { ...item, ...payload } : item))
      )
      message.success('租户已更新')
    } else {
      const newTenant: Tenant = {
        ...payload,
        id: `t-${String(tenants.length + 1).padStart(3, '0')}`,
      }
      setTenants((prev) => [...prev, newTenant])
      message.success('租户已添加')
    }
    setIsModalOpen(false)
  }

  const columns = [
    {
      title: '租户名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '被授权网域',
      dataIndex: 'networkDomainIds',
      key: 'networkDomainCount',
      render: (ids: string[], record: Tenant) => (
        <Space size={[0, 4]} wrap>
          {ids.map((id) => {
            const monitored = record.monitoredNetworkDomainIds?.includes(id)
            return (
              <Tooltip key={id} title={monitored ? '已接入监控（由配置中心纳管）' : '已授权但未接入监控'}>
                <Tag color={monitored ? 'blue' : 'default'}>{id}</Tag>
              </Tooltip>
            )
          })}
        </Space>
      ),
    },
    {
      title: 'CMDB 业务',
      dataIndex: 'cmdbBusinessPath',
      key: 'cmdbBusinessPath',
    },
    {
      title: '平台管理员',
      dataIndex: 'isPlatformAdmin',
      key: 'isPlatformAdmin',
      render: (value: boolean) => (value ? <Tag color="#0ECDEB">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) =>
        status === 'active' ? <Tag color="#00B578">启用</Tag> : <Tag color="#86909C">禁用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Tenant) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => showEdit(record)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>租户管理</Title>
      </div>
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增租户
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={tenants}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title={editingTenant ? '编辑租户' : '新增租户'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="租户名称"
            name="name"
            rules={[{ required: true, message: '请输入租户名称' }]}
          >
            <Input placeholder="例如 电商业务" />
          </Form.Item>
          <Form.Item
            label="被授权网域"
            name="networkDomainIds"
            initialValue={['nd-default']}
            rules={[{ required: true, message: '请选择被授权网域' }]}
            extra="仅分配网域使用权；网域需先在「网域管理」页完成行政创建，监控纳管（安装 Edge Agent）由 Module_09 在租户授权范围内按需执行"
          >
            <Select mode="multiple" placeholder="请选择网域">
              {networkDomainOptions.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="CMDB 业务 ID"
            name="cmdbBusinessId"
            rules={[{ required: true, message: '请输入 CMDB 业务 ID' }]}
          >
            <Input placeholder="例如 bk-biz-2" />
          </Form.Item>
          <Form.Item
            label="CMDB 业务路径"
            name="cmdbBusinessPath"
            rules={[{ required: true, message: '请输入 CMDB 业务路径' }]}
          >
            <Input placeholder="例如 业务 / 电商" />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            initialValue="active"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="请选择">
              <Option value="active">启用</Option>
              <Option value="inactive">禁用</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="平台管理员租户"
            name="isPlatformAdmin"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
