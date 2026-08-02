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
  Switch,
  Space,
  Typography,
  Row,
  Col,
  Badge,
} from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockLabelTemplates, RESOURCE_TYPE_MAP } from '../mocks/module-07'
import type { LabelTemplate, LabelTemplateSource, ResourceType } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']
const SOURCE_TYPE_OPTIONS: { value: LabelTemplateSource; label: string; disabled?: boolean }[] = [
  { value: 'resource_field', label: '资源字段' },
  { value: 'prometheus_builtin', label: 'Prometheus 内置标签' },
  { value: 'composite', label: '组合表达式' },
  { value: 'cmdb_field', label: 'CMDB 字段', disabled: true },
]

export default function LabelTemplatesPage() {
  const [activeType, setActiveType] = useState<ResourceType>('host')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null)
  const [form] = Form.useForm()

  const filteredData = useMemo(
    () => mockLabelTemplates.filter((item) => item.resource_type === activeType),
    [activeType]
  )

  const handleOpenModal = (record?: LabelTemplate) => {
    if (record) {
      setEditingTemplate(record)
      form.setFieldsValue({ ...record })
    } else {
      setEditingTemplate(null)
      form.resetFields()
      form.setFieldsValue({ resource_type: activeType, enabled: true })
    }
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingTemplate(null)
  }

  const handleSave = () => {
    form.validateFields().then(() => {
      handleCloseModal()
    })
  }

  const columns = [
    {
      title: '来源字段',
      dataIndex: 'source_field',
      key: 'source_field',
    },
    {
      title: '来源类型',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (value: LabelTemplateSource) => {
        const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === value)
        return <Tag color={value === 'cmdb_field' ? 'default' : 'blue'}>{option?.label ?? value}</Tag>
      },
    },
    {
      title: '目标标签',
      dataIndex: 'target_label',
      key: 'target_label',
      render: (value: string) => <Text strong style={{ color: '#0ECDEB' }}>{value}</Text>,
    },
    {
      title: '转换规则',
      dataIndex: 'transform',
      key: 'transform',
      render: (value?: string) => value || '-',
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
      render: (_: unknown, record: LabelTemplate) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>标签模板</Title>
        <Text type="secondary">按资源类型配置字段到监控标签的映射规则</Text>
      </div>
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ backgroundColor: '#0ECDEB' }}
                onClick={() => handleOpenModal()}
              >
                新增映射
              </Button>
            </Space>
          </Col>
          <Col>
            <Text type="secondary">
              当前类型：{RESOURCE_TYPE_MAP[activeType]}，共 {filteredData.length} 条规则
            </Text>
          </Col>
        </Row>

        <Space style={{ marginBottom: 16 }}>
          {RESOURCE_TYPES.map((type) => (
            <Button
              key={type}
              type={activeType === type ? 'primary' : 'default'}
              style={activeType === type ? { backgroundColor: '#0ECDEB' } : undefined}
              onClick={() => setActiveType(type)}
            >
              {RESOURCE_TYPE_MAP[type]}
            </Button>
          ))}
        </Space>

        <Table
          rowKey="template_id"
          dataSource={filteredData}
          columns={columns}
          pagination={{ pageSize: 6 }}
        />
      </Card>

      <Modal
        title={editingTemplate ? '编辑标签映射' : '新增标签映射'}
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
                label="资源类型"
                name="resource_type"
                rules={[{ required: true, message: '请选择资源类型' }]}
              >
                <Select disabled={!!editingTemplate}>
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
                label="目标标签"
                name="target_label"
                rules={[{ required: true, message: '请输入目标标签' }]}
              >
                <Input placeholder="如 instance" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="来源字段"
                name="source_field"
                rules={[{ required: true, message: '请输入来源字段' }]}
              >
                <Input placeholder="如 hostname" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="来源类型"
                name="source_type"
                rules={[{ required: true, message: '请选择来源类型' }]}
              >
                <Select placeholder="请选择">
                  {SOURCE_TYPE_OPTIONS.map((opt) => (
                    <Option key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label} {opt.disabled ? '（暂不支持）' : ''}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="转换规则" name="transform">
            <Input placeholder="可选，如 lower() / concat(:9100)" />
          </Form.Item>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
