import { useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockRoutes, type GatewayRoute } from '../mocks/module-03'

const { Title } = Typography
const { Option } = Select

export function GatewayRoutesPage() {
  const [routes, setRoutes] = useState<GatewayRoute[]>(mockRoutes)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingRoute, setEditingRoute] = useState<GatewayRoute | null>(null)
  const [form] = Form.useForm()

  const showAdd = () => {
    setEditingRoute(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const showEdit = (record: GatewayRoute) => {
    setEditingRoute(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleSave = (values: Omit<GatewayRoute, 'id'>) => {
    if (editingRoute) {
      setRoutes((prev) =>
        prev.map((item) => (item.id === editingRoute.id ? { ...item, ...values } : item))
      )
      message.success('路由已更新')
    } else {
      const newRoute: GatewayRoute = {
        ...values,
        id: `r-${String(routes.length + 1).padStart(3, '0')}`,
      }
      setRoutes((prev) => [...prev, newRoute])
      message.success('路由已添加')
    }
    setIsModalOpen(false)
  }

  const columns = [
    {
      title: '路由路径',
      dataIndex: 'path',
      key: 'path',
    },
    {
      title: '目标服务',
      dataIndex: 'targetService',
      key: 'targetService',
    },
    {
      title: '请求方法',
      dataIndex: 'method',
      key: 'method',
      render: (method: string) => <Tag>{method}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) =>
        status === 'enabled' ? (
          <Tag color="#00B578">启用</Tag>
        ) : (
          <Tag color="#86909C">禁用</Tag>
        ),
    },
    {
      title: '说明',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: GatewayRoute) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => showEdit(record)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>网关路由</Title>
      </div>
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增路由
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={routes}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title={editingRoute ? '编辑路由' : '新增路由'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="路由路径"
            name="path"
            rules={[{ required: true, message: '请输入路由路径' }]}
          >
            <Input placeholder="例如 /api/v1/query" />
          </Form.Item>
          <Form.Item
            label="目标服务"
            name="targetService"
            rules={[{ required: true, message: '请输入目标服务' }]}
          >
            <Input placeholder="例如 prometheus-query" />
          </Form.Item>
          <Form.Item
            label="请求方法"
            name="method"
            initialValue="GET"
            rules={[{ required: true, message: '请选择请求方法' }]}
          >
            <Select placeholder="请选择">
              <Option value="GET">GET</Option>
              <Option value="POST">POST</Option>
              <Option value="PUT">PUT</Option>
              <Option value="DELETE">DELETE</Option>
              <Option value="ANY">ANY</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            initialValue="enabled"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="请选择">
              <Option value="enabled">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={2} placeholder="请输入路由说明" />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
