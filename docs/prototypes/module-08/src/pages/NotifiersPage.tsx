import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  type Notifier,
  type NotifierConfig,
  type NotifierType,
  mockNotifiers,
} from '../mocks/module-08'

const { TextArea } = Input
const { Option } = Select
const { Title, Text } = Typography

const notifierColors: Record<NotifierType, string> = {
  feishu: '#3370FF',
  dingtalk: '#0ECDEB',
  email: '#1481FD',
  wecom: '#00B578',
  webhook: '#86909C',
}

const notifierLabels: Record<NotifierType, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  email: '邮件',
  wecom: '企业微信',
  webhook: 'Webhook',
}

function summarizeConfig(type: NotifierType, config: NotifierConfig): string {
  if (type === 'email') {
    const to = (config.to as string[] | undefined)?.join(', ')
    return to ? `收件人: ${to}` : '邮件配置'
  }
  const url = (config.webhook_url as string) || (config.url as string) || '-'
  return url
}

export default function NotifiersPage() {
  const [notifiers, setNotifiers] = useState<Notifier[]>(mockNotifiers)
  const [editing, setEditing] = useState<Notifier | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()

  const columns = [
      {
        title: '渠道名称',
        dataIndex: 'name',
        key: 'name',
      },
      {
        title: '类型',
        dataIndex: 'type',
        key: 'type',
        render: (type: NotifierType) => (
          <Tag color={notifierColors[type]}>{notifierLabels[type]}</Tag>
        ),
      },
      {
        title: '配置摘要',
        key: 'summary',
        render: (_: unknown, record: Notifier) => (
          <Text type="secondary" ellipsis style={{ maxWidth: 360 }}>
            {summarizeConfig(record.type, record.config)}
          </Text>
        ),
      },
      {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: Notifier) => (
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEditor(record)}
          >
            编辑
          </Button>
        ),
      },
    ]

  function openEditor(record: Notifier) {
    setEditing(record)
    form.setFieldsValue({
      name: record.name,
      type: record.type,
      config: JSON.stringify(record.config, null, 2),
    })
    setIsModalOpen(true)
  }

  function handleOpenModal() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ config: '{}' })
    setIsModalOpen(true)
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        let config: NotifierConfig
        try {
          config = JSON.parse(values.config as string)
        } catch {
          message.error('配置 JSON 格式不正确')
          return
        }
        if (editing) {
          const updated: Notifier = {
            ...editing,
            name: values.name as string,
            type: values.type as NotifierType,
            config,
          }
          setNotifiers((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n))
          )
        } else {
          const created: Notifier = {
            id: `nt-${Date.now()}`,
            name: values.name as string,
            type: values.type as NotifierType,
            config,
          }
          setNotifiers((prev) => [...prev, created])
        }
        setIsModalOpen(false)
        message.success(editing ? '通知渠道已更新' : '通知渠道已创建')
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>通知渠道</Title>
      </div>
      <Card className="page-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
            新建渠道
          </Button>
          <Table
            rowKey="id"
            dataSource={notifiers}
            columns={columns}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      </Card>
      <Modal
        title={editing ? '编辑通知渠道' : '新建通知渠道'}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="渠道名称"
            rules={[{ required: true, message: '请输入渠道名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="type"
            label="类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select placeholder="请选择">
              <Option value="feishu">飞书</Option>
              <Option value="dingtalk">钉钉</Option>
              <Option value="email">邮件</Option>
              <Option value="wecom">企业微信</Option>
              <Option value="webhook">Webhook</Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="config"
            label="配置 (JSON)"
            rules={[{ required: true, message: '请输入配置' }]}
          >
            <TextArea rows={6} placeholder='例如 {"webhook_url":"https://..."}' />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
