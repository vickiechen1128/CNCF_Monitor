import { useCallback, useMemo, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  Switch,
  Space,
  Typography,
  Row,
  Col,
  Badge,
} from 'antd'
import { PlusOutlined, EditOutlined, GlobalOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockProbes } from '../mocks/module-01'
import type { BlackboxProbe } from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const PROTOCOL_COLOR: Record<BlackboxProbe['protocol'], string> = {
  http: '#00B578',
  https: '#1481FD',
  tcp: '#FA8C16',
  icmp: '#0ECDEB',
  dns: '#722ED1',
}

const MODULE_OPTIONS = ['http_2xx', 'http_post_2xx', 'tcp_connect', 'icmp_ping', 'dns_query']

export default function ProbesPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProbe, setEditingProbe] = useState<BlackboxProbe | null>(null)
  const [form] = Form.useForm()

  const handleOpenModal = useCallback((record?: BlackboxProbe) => {
    if (record) {
      setEditingProbe(record)
      form.setFieldsValue({ ...record })
    } else {
      setEditingProbe(null)
      form.resetFields()
      form.setFieldsValue({ protocol: 'http', interval: '30s', timeout: '10s', enabled: true })
    }
    setModalOpen(true)
  }, [form])

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingProbe(null)
  }

  const handleSave = () => {
    form.validateFields().then(() => {
      handleCloseModal()
    })
  }

  const columns = useMemo(
    () => [
      {
        title: '探测目标',
        dataIndex: 'target',
        key: 'target',
        render: (value: string, record: BlackboxProbe) => (
          <Space>
            <GlobalOutlined style={{ color: PROTOCOL_COLOR[record.protocol] }} />
            <Text strong>{value}</Text>
          </Space>
        ),
      },
      {
        title: '协议',
        dataIndex: 'protocol',
        key: 'protocol',
        render: (value: BlackboxProbe['protocol']) => (
          <Tag color={PROTOCOL_COLOR[value]}>{value.toUpperCase()}</Tag>
        ),
      },
      {
        title: '模块',
        dataIndex: 'module',
        key: 'module',
        render: (value: string) => <Tag color="purple">{value}</Tag>,
      },
      {
        title: 'URL / 地址',
        dataIndex: 'url',
        key: 'url',
        render: (value?: string) => value || '-',
      },
      {
        title: '探测参数',
        key: 'params',
        render: (_: unknown, record: BlackboxProbe) => (
          <Space>
            <Text type="secondary">间隔 {record.interval}</Text>
            <Text type="secondary">超时 {record.timeout}</Text>
          </Space>
        ),
      },
      {
        title: '状态',
        dataIndex: 'enabled',
        key: 'enabled',
        render: (value: boolean) =>
          value ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />,
      },
      {
        title: '操作',
        key: 'actions',
        render: (_: unknown, record: BlackboxProbe) => (
          <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
            编辑
          </Button>
        ),
      },
    ],
    [handleOpenModal]
  )

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>拨测配置</Title>
        <Text type="secondary">管理 Blackbox Exporter 探测目标与模块</Text>
      </div>
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ backgroundColor: '#0ECDEB' }}
              onClick={() => handleOpenModal()}
            >
              新增探测
            </Button>
          </Col>
          <Col>
            <Text type="secondary">共 {mockProbes.length} 个拨测目标</Text>
          </Col>
        </Row>

        <Table
          rowKey="probe_id"
          dataSource={mockProbes}
          columns={columns}
          pagination={{ pageSize: 6 }}
        />
      </Card>

      <Modal
        title={editingProbe ? '编辑拨测目标' : '新增拨测目标'}
        open={modalOpen}
        onCancel={handleCloseModal}
        onOk={handleSave}
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="探测目标"
                name="target"
                rules={[{ required: true, message: '请输入探测目标' }]}
              >
                <Input placeholder="如 api.example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="协议"
                name="protocol"
                rules={[{ required: true, message: '请选择协议' }]}
              >
                <Select placeholder="请选择">
                  <Option value="http">HTTP</Option>
                  <Option value="https">HTTPS</Option>
                  <Option value="tcp">TCP</Option>
                  <Option value="icmp">ICMP</Option>
                  <Option value="dns">DNS</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="模块"
                name="module"
                rules={[{ required: true, message: '请选择模块' }]}
              >
                <Select placeholder="请选择">
                  {MODULE_OPTIONS.map((m) => (
                    <Option key={m} value={m}>
                      {m}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="URL" name="url">
                <Input placeholder="完整 URL（可选）" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="探测间隔"
                name="interval"
                rules={[{ required: true, message: '请输入探测间隔' }]}
              >
                <Input placeholder="30s" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="超时"
                name="timeout"
                rules={[{ required: true, message: '请输入超时' }]}
              >
                <Input placeholder="10s" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
