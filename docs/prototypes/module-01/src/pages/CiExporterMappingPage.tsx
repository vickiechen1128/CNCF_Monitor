import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  Space,
  Typography,
  Row,
  Col,
  Badge,
} from 'antd'
import { PlusOutlined, EditOutlined, LinkOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockCITypeExporterMappings, mockExporterTemplates } from '../mocks/module-01'
import { RESOURCE_TYPE_MAP } from '../mocks/module-01'
import type { ResourceType } from '../mocks/module-01'
import type { CITypeExporterMapping } from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']
const SCHEMES: Array<'http' | 'https'> = ['http', 'https']

export default function CiExporterMappingPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<CITypeExporterMapping | null>(null)
  const [form] = Form.useForm()

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t.name))
    return map
  }, [])

  const handleOpenModal = (record?: CITypeExporterMapping) => {
    if (record) {
      setEditingMapping(record)
      form.setFieldsValue({ ...record })
    } else {
      setEditingMapping(null)
      form.resetFields()
      form.setFieldsValue({ scheme: 'http', scrape_interval: '15s', scrape_timeout: '10s' })
    }
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingMapping(null)
  }

  const handleSave = () => {
    form.validateFields().then(() => {
      handleCloseModal()
    })
  }

  const columns = [
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: ResourceType) => <Tag color="blue">{RESOURCE_TYPE_MAP[value]}</Tag>,
    },
    {
      title: 'Exporter 模板',
      dataIndex: 'exporter_template_id',
      key: 'exporter_template_id',
      render: (value: string) => (
        <Space>
          <LinkOutlined style={{ color: '#0ECDEB' }} />
          <Text strong>{templateNameMap.get(value) ?? value}</Text>
        </Space>
      ),
    },
    {
      title: '端口 / 路径 / 协议',
      key: 'endpoint',
      render: (_: unknown, record: CITypeExporterMapping) => (
        <Space wrap>
          <Tag>{record.scheme}</Tag>
          <Tag color="purple">:{record.default_port}</Tag>
          <Tag color="cyan">{record.metrics_path}</Tag>
        </Space>
      ),
    },
    {
      title: '采集参数',
      key: 'scrape',
      render: (_: unknown, record: CITypeExporterMapping) => (
        <Space>
          <Text type="secondary">间隔 {record.scrape_interval}</Text>
          <Text type="secondary">超时 {record.scrape_timeout}</Text>
        </Space>
      ),
    },
    {
      title: '标签模板',
      dataIndex: 'label_template_id',
      key: 'label_template_id',
      render: (value?: string) => value ? <Badge status="success" text={value} /> : '-',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: CITypeExporterMapping) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>CI-Exporter 映射</Title>
        <Text type="secondary">配置资源类型与 Exporter 模板的默认绑定关系</Text>
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
              新增映射
            </Button>
          </Col>
          <Col>
            <Text type="secondary">共 {mockCITypeExporterMappings.length} 条绑定</Text>
          </Col>
        </Row>

        <Table
          rowKey="mapping_id"
          dataSource={mockCITypeExporterMappings}
          columns={columns}
          pagination={{ pageSize: 5 }}
        />
      </Card>

      <Modal
        title={editingMapping ? '编辑 CI-Exporter 映射' : '新增 CI-Exporter 映射'}
        open={modalOpen}
        onCancel={handleCloseModal}
        onOk={handleSave}
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={640}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="资源类型"
                name="resource_type"
                rules={[{ required: true, message: '请选择资源类型' }]}
              >
                <Select disabled={!!editingMapping} placeholder="请选择">
                  {RESOURCE_TYPES.map((type) => (
                    <Option key={type} value={type}>
                      {RESOURCE_TYPE_MAP[type]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Exporter 模板"
                name="exporter_template_id"
                rules={[{ required: true, message: '请选择 Exporter 模板' }]}
              >
                <Select placeholder="请选择">
                  {mockExporterTemplates.map((t) => (
                    <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                      {t.name} v{t.version}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="默认端口"
                name="default_port"
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="协议"
                name="scheme"
                rules={[{ required: true, message: '请选择协议' }]}
              >
                <Select placeholder="请选择">
                  {SCHEMES.map((s) => (
                    <Option key={s} value={s}>
                      {s}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="指标路径"
                name="metrics_path"
                rules={[{ required: true, message: '请输入指标路径' }]}
              >
                <Input placeholder="/metrics" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="采集间隔"
                name="scrape_interval"
                rules={[{ required: true, message: '请输入采集间隔' }]}
              >
                <Input placeholder="15s" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="采集超时"
                name="scrape_timeout"
                rules={[{ required: true, message: '请输入采集超时' }]}
              >
                <Input placeholder="10s" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="标签模板 ID" name="label_template_id">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
