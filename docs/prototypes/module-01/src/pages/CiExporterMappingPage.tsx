import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Modal,
  Form,
  Select,
  InputNumber,
  Space,
  Typography,
  Row,
  Col,
  Badge,
  App,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockCITypeExporterMappings,
  mockExporterTemplates,
  mockLabelTemplates,
  CI_TYPE_LABEL,
  CI_TYPE_CATEGORY_MAP,
  CI_TYPES_BY_CATEGORY,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_MAP,
  SCHEMES,
} from '../mocks/module-01'
import type {
  CiType,
  Scheme,
  CITypeExporterMapping,
  ResourceCategory,
} from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const now = () => new Date().toISOString()

export default function CiExporterMappingPage() {
  const { modal, message } = App.useApp()
  const [mappings, setMappings] = useState<CITypeExporterMapping[]>(() => [
    ...mockCITypeExporterMappings,
  ])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<CITypeExporterMapping | null>(null)
  const [form] = Form.useForm()

  const watchResourceCategory = Form.useWatch('resource_category', form)
  const categoryCiTypes = (watchResourceCategory as ResourceCategory | undefined)
    ? CI_TYPES_BY_CATEGORY[watchResourceCategory as ResourceCategory]
    : []

  const templateMap = useMemo(() => {
    const map = new Map<string, (typeof mockExporterTemplates)[number]>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t))
    return map
  }, [])

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t.name))
    return map
  }, [])

  const labelNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockLabelTemplates.forEach((t) => map.set(t.template_id, t.name))
    return map
  }, [])

  const handleOpenModal = (record?: CITypeExporterMapping) => {
    if (record) {
      setEditingMapping(record)
      form.setFieldsValue({
        ...record,
        resource_category: CI_TYPE_CATEGORY_MAP[record.resource_type],
      })
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

  // 选择 Exporter 模板后自动填充 default_port / metrics_path / scheme
  const handleTemplateChange = (templateId: string) => {
    const tpl = templateMap.get(templateId)
    if (tpl) {
      form.setFieldsValue({
        default_port: tpl.default_port,
        metrics_path: tpl.metrics_path,
        scheme: tpl.scheme,
      })
    }
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      if (editingMapping) {
        const updated: CITypeExporterMapping = {
          ...editingMapping,
          ...values,
          resource_type: values.resource_type as CiType,
          scheme: values.scheme as Scheme,
          updated_at: now(),
        }
        setMappings((prev) =>
          prev.map((m) => (m.mapping_id === editingMapping.mapping_id ? updated : m))
        )
        message.success('映射已更新')
      } else {
        const newMapping: CITypeExporterMapping = {
          mapping_id: `map-${Date.now()}`,
          resource_type: values.resource_type as CiType,
          exporter_template_id: values.exporter_template_id as string,
          default_port: values.default_port as number,
          metrics_path: values.metrics_path as string,
          scheme: values.scheme as Scheme,
          scrape_interval: values.scrape_interval as string,
          scrape_timeout: values.scrape_timeout as string,
          label_template_id: (values.label_template_id as string) || undefined,
          is_builtin: false,
          created_at: now(),
          updated_at: now(),
        }
        setMappings((prev) => [...prev, newMapping])
        message.success('映射已新增')
      }
      handleCloseModal()
    })
  }

  const handleDelete = (record: CITypeExporterMapping) => {
    if (record.is_builtin) {
      message.warning('内置绑定禁止删除')
      return
    }
    modal.confirm({
      title: '确认删除',
      content: `确定删除「${CI_TYPE_LABEL[record.resource_type]} → ${templateNameMap.get(record.exporter_template_id)}」绑定？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setMappings((prev) => prev.filter((m) => m.mapping_id !== record.mapping_id))
        message.success('已删除')
      },
    })
  }

  const columns = [
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: CiType) => (
        <Space>
          <Tag color="blue">{CI_TYPE_LABEL[value]}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {CI_TYPE_CATEGORY_MAP[value]}
          </Text>
        </Space>
      ),
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
      render: (value?: string) =>
        value ? <Badge status="success" text={labelNameMap.get(value) ?? value} /> : '-',
    },
    {
      title: '类型',
      dataIndex: 'is_builtin',
      key: 'is_builtin',
      render: (value: boolean) =>
        value ? (
          <Tag color="gold" icon={<LockOutlined />}>
            内置
          </Tag>
        ) : (
          <Tag>自定义</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: CITypeExporterMapping) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
            编辑
          </Button>
          <Tooltip title={record.is_builtin ? '内置绑定禁止删除' : '删除'}>
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              disabled={record.is_builtin}
              onClick={() => handleDelete(record)}
            >
              删除
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>CI-Exporter 模板映射</Title>
        <Text type="secondary">
          模板层绑定：为各资源类别下的 CI 类型预设默认 Exporter 及采集参数（端口/路径/协议/间隔/超时）；创建采集 Job 时自动继承并可覆盖，与具体采集任务（实例层）职责不同
        </Text>
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
            <Text type="secondary">共 {mappings.length} 条绑定</Text>
          </Col>
        </Row>

        <Table
          rowKey="mapping_id"
          dataSource={mappings}
          columns={columns}
          pagination={{ pageSize: 5 }}
        />
      </Card>

      <Modal
        title={editingMapping ? '编辑 CI-Exporter 模板映射' : '新增 CI-Exporter 模板映射'}
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
                label="资源类别"
                name="resource_category"
                rules={[{ required: true, message: '请选择资源类别' }]}
              >
                <Select
                  disabled={!!editingMapping}
                  placeholder="请选择"
                  onChange={() => form.setFieldsValue({ resource_type: undefined, exporter_template_id: undefined })}
                >
                  {RESOURCE_CATEGORIES.map((cat) => (
                    <Option key={cat} value={cat}>
                      {RESOURCE_CATEGORY_MAP[cat]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="CI 类型"
                name="resource_type"
                rules={[{ required: true, message: '请选择 CI 类型' }]}
              >
                <Select
                  disabled={!!editingMapping || categoryCiTypes.length === 0}
                  placeholder={categoryCiTypes.length > 0 ? '请选择 CI 类型' : '请先选择资源类别'}
                  onChange={() => form.setFieldsValue({ exporter_template_id: undefined })}
                >
                  {categoryCiTypes.map((type) => (
                    <Option key={type} value={type}>
                      {CI_TYPE_LABEL[type]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Exporter 模板"
                name="exporter_template_id"
                rules={[{ required: true, message: '请选择 Exporter 模板' }]}
                extra="选择后自动填充端口/路径/协议"
              >
                <Select
                  placeholder="请选择"
                  onChange={(v) => handleTemplateChange(v as string)}
                  showSearch
                  optionFilterProp="children"
                >
                  {mockExporterTemplates
                    .filter((t) => t.supported_resource_types.length > 0)
                    .filter((t) =>
                      watchResourceCategory
                        ? t.supported_resource_types.some((rt) => CI_TYPE_CATEGORY_MAP[rt] === watchResourceCategory)
                        : true
                    )
                    .map((t) => (
                      <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                        {t.name} v{t.version}
                      </Option>
                    ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="默认端口"
                name="default_port"
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
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
            <Col span={12}>
              <Form.Item
                label="指标路径"
                name="metrics_path"
                rules={[{ required: true, message: '请输入指标路径' }]}
              >
                <Select placeholder="/metrics" showSearch allowClear>
                  <Option value="/metrics">/metrics</Option>
                  <Option value="/actuator/prometheus">/actuator/prometheus</Option>
                  <Option value="/snmp">/snmp</Option>
                  <Option value="/probe">/probe</Option>
                </Select>
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
                <Select placeholder="15s">
                  <Option value="15s">15s</Option>
                  <Option value="30s">30s</Option>
                  <Option value="60s">60s</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="采集超时"
                name="scrape_timeout"
                rules={[{ required: true, message: '请输入采集超时' }]}
              >
                <Select placeholder="10s">
                  <Option value="5s">5s</Option>
                  <Option value="10s">10s</Option>
                  <Option value="30s">30s</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="标签模板" name="label_template_id" extra="LabelTemplate 由 Module_07 维护">
            <Select placeholder="请选择" allowClear showSearch optionFilterProp="children">
              {mockLabelTemplates.map((t) => (
                <Option key={t.template_id} value={t.template_id}>
                  {t.name}（{t.resource_category}）
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
