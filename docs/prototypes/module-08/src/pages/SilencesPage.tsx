import { useMemo, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { MainLayout } from '../layouts/MainLayout'
import { type Silence, type SilenceMatcher, mockSilences } from '../mocks/module-08'

const { TextArea } = Input
const { RangePicker } = DatePicker
const { Title } = Typography

function isActive(silence: Silence): boolean {
  return dayjs(silence.ends_at).isAfter(dayjs())
}

function formatMatchers(matchers: SilenceMatcher[]): string {
  return matchers
    .map((m) => `${m.name}${m.isRegex ? '=~' : '='}"${m.value}"`)
    .join(', ')
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
        render: (matchers: SilenceMatcher[]) => (
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
        key: 'status',
        render: (_: unknown, record: Silence) => {
          const active = isActive(record)
          return (
            <Tag color={active ? '#00B578' : '#86909C'}>
              {active ? '生效中' : '已过期'}
            </Tag>
          )
        },
      },
      {
        title: '创建者',
        dataIndex: 'created_by',
        key: 'created_by',
      },
      {
        title: '备注',
        dataIndex: 'comment',
        key: 'comment',
        ellipsis: true,
      },
    ],
    []
  )

  function handleOpenModal() {
    form.resetFields()
    setIsModalOpen(true)
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        let matchers: SilenceMatcher[]
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
        }
        setSilences((prev) => [created, ...prev])
        setIsModalOpen(false)
        message.success('静默规则已创建')
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>静默规则</Title>
      </div>
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
          >
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
