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
  InputNumber,
  message,
} from 'antd'
import { PlayCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockSyncPolicies,
  type SyncPolicy,
  type SyncStrategy,
  type SyncStatus,
} from '../mocks/module-04'

const { Title } = Typography
const { Option } = Select

const STATUS_COLORS: Record<SyncStatus, string> = {
  success: '#00B578',
  running: '#0ECDEB',
  failed: '#FF4C3A',
  idle: '#86909C',
}

const STATUS_LABELS: Record<SyncStatus, string> = {
  success: '成功',
  running: '同步中',
  failed: '失败',
  idle: '空闲',
}

export function SyncPoliciesPage() {
  const [policies, setPolicies] = useState<SyncPolicy[]>(mockSyncPolicies)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()

  const handleRun = (record: SyncPolicy) => {
    setPolicies((prev) =>
      prev.map((item) =>
        item.id === record.id ? { ...item, status: 'running' as SyncStatus } : item
      )
    )
    message.success(`已触发同步任务：${record.name}`)
    setTimeout(() => {
      setPolicies((prev) =>
        prev.map((item) =>
          item.id === record.id
            ? { ...item, status: 'success' as SyncStatus, lastSyncAt: '刚刚' }
            : item
        )
      )
    }, 1500)
  }

  const handleSave = (values: Omit<SyncPolicy, 'id' | 'providerName' | 'lastSyncAt'>) => {
    const newPolicy: SyncPolicy = {
      ...values,
      id: `sp-${String(policies.length + 1).padStart(3, '0')}`,
      providerName: '自定义 Provider',
      lastSyncAt: '-',
    }
    setPolicies((prev) => [...prev, newPolicy])
    message.success('同步策略已添加')
    setIsModalOpen(false)
  }

  const columns = [
    {
      title: '策略名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'Provider',
      dataIndex: 'providerName',
      key: 'providerName',
    },
    {
      title: '同步策略',
      dataIndex: 'strategy',
      key: 'strategy',
      render: (strategy: SyncStrategy) =>
        strategy === 'full' ? <Tag>全量</Tag> : <Tag color="blue">增量</Tag>,
    },
    {
      title: '轮询兜底（分钟）',
      dataIndex: 'fallbackPollingMinutes',
      key: 'fallbackPollingMinutes',
    },
    {
      title: '上次同步',
      dataIndex: 'lastSyncAt',
      key: 'lastSyncAt',
    },
    {
      title: '下次执行',
      dataIndex: 'nextRunAt',
      key: 'nextRunAt',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: SyncStatus) => <Tag color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</Tag>,
    },
    {
      title: '失败处理',
      dataIndex: 'failureHandling',
      key: 'failureHandling',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: SyncPolicy) => (
        <Space>
          <Button
            type="link"
            icon={<PlayCircleOutlined />}
            onClick={() => handleRun(record)}
            disabled={record.status === 'running'}
          >
            立即同步
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>同步策略</Title>
      </div>
      <Card
        className="page-card"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields()
              setIsModalOpen(true)
            }}
          >
            新增策略
          </Button>
        }
      >
        <Table
          rowKey="id"
          dataSource={policies}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title="新增同步策略"
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="策略名称"
            name="name"
            rules={[{ required: true, message: '请输入策略名称' }]}
          >
            <Input placeholder="例如 BlueKing 全量同步" />
          </Form.Item>
          <Form.Item
            label="同步方式"
            name="strategy"
            initialValue="incremental"
            rules={[{ required: true, message: '请选择同步方式' }]}
          >
            <Select placeholder="请选择">
              <Option value="full">全量</Option>
              <Option value="incremental">增量</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="轮询兜底周期（分钟）"
            name="fallbackPollingMinutes"
            initialValue={15}
            rules={[{ required: true, message: '请输入轮询周期' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="下次执行时间"
            name="nextRunAt"
            rules={[{ required: true, message: '请输入下次执行时间' }]}
          >
            <Input placeholder="2026-08-02 10:00:00" />
          </Form.Item>
          <Form.Item
            label="失败处理策略"
            name="failureHandling"
            initialValue="告警并保留上次成功快照"
            rules={[{ required: true, message: '请输入失败处理策略' }]}
          >
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
