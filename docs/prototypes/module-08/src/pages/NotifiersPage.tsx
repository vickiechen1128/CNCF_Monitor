import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
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
      title: '接收人名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '渠道类型',
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
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 70,
      render: (enabled: boolean, record: Notifier) => (
        <Switch
          checked={enabled}
          onChange={(checked) => {
            setNotifiers((prev) =>
              prev.map((n) => (n.id === record.id ? { ...n, enabled: checked } : n))
            )
            message.success('接收人状态已更新，alertmanager.yml 已重新生成并 reload')
          }}
        />
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, record: Notifier) => (
        <Button type="text" icon={<EditOutlined />} onClick={() => openEditor(record)}>
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
      enabled: record.enabled,
    })
    setIsModalOpen(true)
  }

  function handleOpenModal() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ config: '{}', enabled: true })
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
        const updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ')
        if (editing) {
          const updated: Notifier = {
            ...editing,
            name: values.name as string,
            type: values.type as NotifierType,
            config,
            enabled: values.enabled as boolean,
            updated_at: updatedAt,
          }
          setNotifiers((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
        } else {
          const created: Notifier = {
            id: `nt-${Date.now()}`,
            name: values.name as string,
            type: values.type as NotifierType,
            config,
            enabled: values.enabled as boolean,
            created_at: updatedAt,
            updated_at: updatedAt,
          }
          setNotifiers((prev) => [...prev, created])
        }
        setIsModalOpen(false)
        message.success(
          editing
            ? '接收人已更新，alertmanager.yml 已重新生成并 reload'
            : '接收人已创建，alertmanager.yml 已重新生成并 reload'
        )
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4} style={{ margin: 0 }}>
          通知渠道（接收人管理）
        </Title>
        <Text type="secondary">
          维护 Alertmanager receiver：飞书 / 钉钉 / 邮件 / 企业微信 / Webhook
        </Text>
      </div>
      <Card className="page-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
              新建接收人
            </Button>
            <Text type="secondary" style={{ fontSize: 13 }}>
              共 {notifiers.length} 个接收人，参数校验：URL / 邮箱 / Token 等
            </Text>
          </Space>
          <Table
            rowKey="id"
            dataSource={notifiers}
            columns={columns}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      </Card>
      <Modal
        title={editing ? '编辑接收人' : '新建接收人'}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="接收人名称"
            rules={[{ required: true, message: '请输入接收人名称' }]}
            extra="对应 Alertmanager receiver 的 name，如 sre-critical、default"
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="type"
            label="渠道类型"
            rules={[{ required: true, message: '请选择渠道类型' }]}
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
            label="渠道配置 (JSON)"
            rules={[{ required: true, message: '请输入配置' }]}
            extra="渠道特定参数：webhook_url / token / smtp 邮箱地址等"
          >
            <TextArea rows={6} placeholder='例如 {"webhook_url":"https://..."}' />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
