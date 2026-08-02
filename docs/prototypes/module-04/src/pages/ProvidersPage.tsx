import { useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined, SettingOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockProviders,
  PROVIDER_TYPE_LABELS,
  type CMDBProvider,
  type ProviderType,
} from '../mocks/module-04'

const { Title } = Typography
const { Option } = Select

const emptyProvider: Omit<CMDBProvider, 'id'> = {
  name: '',
  type: 'blueking',
  networkDomainId: 'nd-default',
  networkDomainName: 'default',
  syncCycleMinutes: 15,
  status: 'enabled',
  config: {},
  lastSyncAt: '-',
}

export function ProvidersPage() {
  const [providers, setProviders] = useState<CMDBProvider[]>(mockProviders)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<CMDBProvider | null>(null)
  const [form] = Form.useForm()

  const showAdd = () => {
    setEditingProvider(null)
    form.setFieldsValue(emptyProvider)
    setIsModalOpen(true)
  }

  const showEdit = (record: CMDBProvider) => {
    setEditingProvider(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleSave = (values: Omit<CMDBProvider, 'id'>) => {
    if (editingProvider) {
      setProviders((prev) =>
        prev.map((item) =>
          item.id === editingProvider.id ? { ...item, ...values } : item
        )
      )
      message.success('Provider 已更新')
    } else {
      const newProvider: CMDBProvider = {
        ...values,
        id: `p-${String(providers.length + 1).padStart(3, '0')}`,
      }
      setProviders((prev) => [...prev, newProvider])
      message.success('Provider 已添加')
    }
    setIsModalOpen(false)
  }

  const renderConfigFields = (type: ProviderType) => {
    switch (type) {
      case 'blueking':
        return (
          <>
            <Form.Item label="BlueKing 地址" name={['config', 'bkBaseUrl']}>
              <Input placeholder="https://cmdb.example.com" />
            </Form.Item>
            <Form.Item label="业务 ID" name={['config', 'bkBizId']}>
              <Input placeholder="例如 2" />
            </Form.Item>
            <Form.Item label="用户名" name={['config', 'username']}>
              <Input />
            </Form.Item>
          </>
        )
      case 'http':
        return (
          <>
            <Form.Item label="Endpoint" name={['config', 'endpoint']}>
              <Input placeholder="https://assets.example.com/api/resources" />
            </Form.Item>
            <Form.Item label="认证类型" name={['config', 'authType']}>
              <Select placeholder="请选择">
                <Option value="none">无</Option>
                <Option value="bearer">Bearer Token</Option>
                <Option value="basic">Basic Auth</Option>
              </Select>
            </Form.Item>
          </>
        )
      case 'nacos':
        return (
          <>
            <Form.Item label="Server 地址" name={['config', 'serverAddr']}>
              <Input placeholder="http://nacos.example.com:8848" />
            </Form.Item>
            <Form.Item label="命名空间" name={['config', 'namespace']}>
              <Input placeholder="例如 prod" />
            </Form.Item>
          </>
        )
      case 'kubernetes':
        return (
          <>
            <Form.Item label="Kubeconfig 路径" name={['config', 'kubeconfig']}>
              <Input placeholder="/etc/metriccenter/kubeconfig" />
            </Form.Item>
            <Form.Item label="命名空间" name={['config', 'namespaces']}>
              <Input placeholder="例如 default,monitoring" />
            </Form.Item>
          </>
        )
      default:
        return null
    }
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: ProviderType) => <Tag color="#0ECDEB">{PROVIDER_TYPE_LABELS[type]}</Tag>,
    },
    {
      title: '网域',
      dataIndex: 'networkDomainName',
      key: 'networkDomainName',
      render: (name: string) => <Tag color="blue">{name}</Tag>,
    },
    {
      title: '同步周期（分钟）',
      dataIndex: 'syncCycleMinutes',
      key: 'syncCycleMinutes',
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
      title: '上次同步',
      dataIndex: 'lastSyncAt',
      key: 'lastSyncAt',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: CMDBProvider) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => showEdit(record)}>
          配置
        </Button>
      ),
    },
  ]

  const providerType = Form.useWatch('type', form)

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>Provider 配置</Title>
      </div>
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增 Provider
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={providers}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title={editingProvider ? '配置 Provider' : '新增 Provider'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如 BlueKing 主 CMDB" />
          </Form.Item>
          <Form.Item
            label="类型"
            name="type"
            initialValue="blueking"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select placeholder="请选择">
              <Option value="blueking">BlueKing</Option>
              <Option value="http">HTTP</Option>
              <Option value="nacos">Nacos</Option>
              <Option value="kubernetes">Kubernetes</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="网域"
            name="networkDomainName"
            initialValue="default"
            rules={[{ required: true, message: '请输入网域' }]}
          >
            <Select placeholder="请选择">
              <Option value="default">default</Option>
              <Option value="edge">edge</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="同步周期（分钟）"
            name="syncCycleMinutes"
            rules={[{ required: true, message: '请输入同步周期' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
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
          <Card
            size="small"
            title={
              <Space>
                <SettingOutlined />
                <span>连接参数</span>
              </Space>
            }
            style={{ marginTop: 16 }}
          >
            {renderConfigFields(providerType as ProviderType)}
          </Card>
        </Form>
      </Modal>
    </MainLayout>
  )
}
