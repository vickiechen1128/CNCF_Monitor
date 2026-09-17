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
  Popconfirm,
  message,
} from 'antd'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockUsers, mockTenants, ROLE_LABELS, type User, type UserRole } from '../mocks/module-06'

const { Title, Text } = Typography
const { Option } = Select

/** 当前登录用户（MVP 判定删除可用性用）。admin 为唯一管理入口，原型的 admin 角色不可删除 */
const CURRENT_USER_ID = 'u-001'

export function UsersPage() {
  const [users, setUsers] = useState<User[]>(mockUsers)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form] = Form.useForm()

  const handleDelete = (record: User) => {
    setUsers((prev) => prev.filter((item) => item.id !== record.id))
    message.success(`已删除用户 ${record.username}，其全部会话已失效`)
  }

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
        <>
          <Button type="link" icon={<EditOutlined />} onClick={() => showAssignRole(record)}>
            分配角色
          </Button>
          {record.id !== CURRENT_USER_ID && record.role !== 'platform_admin' && (
            <Popconfirm
              title="删除用户"
              description={`删除用户 ${record.username} 将使其全部会话失效，是否继续？`}
              onConfirm={() => handleDelete(record)}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </>
      ),
    },
  ]

  return (
    <MainLayout
      reviewNotes={
        <>
          MVP 落地为 <b>admin / user 两级访问控制门</b>（管理后台接口受限，无业务权限点 / 租户隔离）。
          本页 4 级角色（平台管理员 / 租户管理员 / 运维工程师 / 只读用户）为 v1.0+ / 外部 IAM 承接的演示占位，MVP 不落地。
          删除为 MVP 补充能力：删除普通用户即软删并令其全部会话失效；admin 账号与当前登录用户不提供删除入口。
        </>
      }
    >
      <div className="page-header">
        <Title level={4}>用户管理</Title>
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
