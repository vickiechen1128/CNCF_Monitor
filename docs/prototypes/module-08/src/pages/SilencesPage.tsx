import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { MainLayout } from '../layouts/MainLayout'
import {
  type Matcher,
  type Silence,
  type SilenceStatus,
  mockSilences,
} from '../mocks/module-08'

const { TextArea } = Input
const { RangePicker } = DatePicker
const { Title, Text } = Typography

const statusConfig: Record<SilenceStatus, { color: string; label: string }> = {
  active: { color: 'success', label: '生效中' },
  pending: { color: 'warning', label: '待生效' },
  expired: { color: 'default', label: '已过期' },
}

function formatMatchers(matchers: Matcher[]): string {
  return matchers.map((m) => `${m.name}${m.isRegex ? '=~' : '='}"${m.value}"`).join(', ')
}

export default function SilencesPage() {
  const [silences, setSilences] = useState<Silence[]>(mockSilences)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()

  const columns = useMemo(
    () => [
      {
        title: 'Matchers',
        dataIndex: 'matchers',
        key: 'matchers',
        render: (matchers: Matcher[]) => (
          <Typography.Text code>{formatMatchers(matchers)}</Typography.Text>
        ),
      },
      {
        title: '开始时间',
        dataIndex: 'starts_at',
        key: 'starts_at',
        render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '结束时间',
        dataIndex: 'ends_at',
        key: 'ends_at',
        render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        width: 90,
        render: (status: SilenceStatus) => {
          const cfg = statusConfig[status]
          return <Tag color={cfg.color}>{cfg.label}</Tag>
        },
      },
      {
        title: '创建者',
        dataIndex: 'created_by',
        key: 'created_by',
        width: 130,
      },
      {
        title: '备注',
        dataIndex: 'comment',
        key: 'comment',
        ellipsis: true,
      },
      {
        title: '操作',
        key: 'action',
        width: 90,
        render: (_: unknown, record: Silence) => (
          <Popconfirm
            title="删除该静默规则？"
            description="删除后调用 Alertmanager API 使静默立即失效"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        ),
      },
    ],
    []
  )

  function handleDelete(id: string) {
    setSilences((prev) => prev.filter((s) => s.id !== id))
    message.success('静默规则已删除并调用 Alertmanager API 生效')
  }

  function handleOpenModal() {
    form.resetFields()
    setIsModalOpen(true)
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        let matchers: Matcher[]
        try {
          matchers = JSON.parse((values.matchers as string) || '[]')
        } catch {
          message.error('Matchers JSON 格式不正确')
          return
        }
        const [start, end] = values.range as [dayjs.Dayjs, dayjs.Dayjs]
        const created: Silence = {
          id: `si-${Date.now()}`,
          matchers,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          comment: values.comment as string,
          created_by: values.created_by as string,
          // 状态由 Alertmanager 计算：未到开始时间为 pending，范围内为 active
          status: dayjs().isBefore(start) ? 'pending' : 'active',
        }
        setSilences((prev) => [created, ...prev])
        setIsModalOpen(false)
        message.success('静默规则已创建并调用 Alertmanager API 生效')
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4} style={{ margin: 0 }}>
          静默规则
        </Title>
        <Text type="secondary">
          临时屏蔽匹配告警的通知，常用于计划内变更 / 已知故障窗口
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="静默规则通过 Alertmanager API 生效"
        description="创建 / 删除 / 查询均调用 Alertmanager v2 API（POST /api/v2/silences 等）。状态由 Alertmanager 计算：未到开始时间为 pending（待生效）、时间范围内为 active（生效中）、结束后为 expired（已过期）。"
      />

      <Card className="page-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
            新建静默
          </Button>
          <Table
            rowKey="id"
            dataSource={silences}
            columns={columns}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      </Card>
      <Modal
        title="新建静默规则"
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="matchers"
            label="Matchers (JSON)"
            rules={[{ required: true, message: '请输入 Matchers' }]}
            extra="可从当前活跃告警的标签中联想，如 alertname / instance / network_domain"
          >
            <TextArea
              rows={3}
              placeholder='例如 [{"name":"instance","value":"edge-01","isRegex":false}]'
            />
          </Form.Item>
          <Form.Item
            name="range"
            label="生效时间范围"
            rules={[{ required: true, message: '请选择时间范围' }]}
          >
            <RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="created_by"
            label="创建者"
            rules={[{ required: true, message: '请输入创建者' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="comment"
            label="备注"
            rules={[{ required: true, message: '请输入备注' }]}
            extra="建议注明静默原因，便于审计追溯"
          >
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
