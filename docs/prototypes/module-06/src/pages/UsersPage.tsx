import { useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Modal,
  Form,
  Select,
  message,
} from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockUsers, mockTenants, ROLE_LABELS, type User, type UserRole } from '../mocks/module-06'

const { Title, Text } = Typography
const { Option } = Select

export function UsersPage() {
  const [users, setUsers] = useState<User[]>(mockUsers)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form] = Form.useForm()

  const showAssignRole = (record: User) => {
    setEditingUser(record)
    form.setFieldsValue({
      role: record.role,
      tenantId: record.tenantId,
      status: record.status,
    })
    setIsModalOpen(true)
  }

  const handleSave = (values: { role: UserRole; tenantId?: string; status: 'active' | 'inactive' }) => {
    if (!editingUser) return
    const tenant = mockTenants.find((t) => t.id === values.tenantId)
    setUsers((prev) =>
      prev.map((item) =>
        item.id === editingUser.id
          ? {
              ...item,
              role: values.role,
              tenantId: values.tenantId,
              tenantName: tenant?.name,
              status: values.status,
            }
          : item
      )
    )
    message.success('用户角色已更新')
    setIsModalOpen(false)
  }

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '显示名',
      dataIndex: 'displayName',
      key: 'displayName',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      render: (role: UserRole) => <Tag color="#0ECDEB">{ROLE_LABELS[role]}</Tag>,
    },
    {
      title: '所属租户',
      dataIndex: 'tenantName',
      key: 'tenantName',
      render: (name: string | undefined) => name || <Text type="secondary">-</Text>,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      render: (email: string | undefined) => email || '-',
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
      render: (_: unknown, record: User) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => showAssignRole(record)}>
          分配角色
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>用户与权限</Title>
      </div>
      <Card className="page-card">
        <Table
          rowKey="id"
          dataSource={users}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title="分配角色"
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="角色"
            name="role"
            rules={[{ required: true, message: '请选择角色' }]}
          >
            <Select placeholder="请选择">
              <Option value="platform_admin">平台管理员</Option>
              <Option value="tenant_admin">租户管理员</Option>
              <Option value="operator">运维工程师</Option>
              <Option value="viewer">只读用户</Option>
            </Select>
          </Form.Item>
          <Form.Item label="所属租户" name="tenantId">
            <Select placeholder="请选择租户" allowClear>
              {mockTenants.map((tenant) => (
                <Option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </Option>
              ))}
            </Select>
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
        </Form>
      </Modal>
    </MainLayout>
  )
}
