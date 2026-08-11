import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Drawer,
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
  Alert,
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
  const watchedLabelTemplateId = Form.useWatch('label_template_id', form)
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

  // 当前表单选中的标签模板（用于只读预览映射内容，模板由 Module_07 维护）
  const selectedLabelTemplate = useMemo(
    () => mockLabelTemplates.find((t) => t.template_id === watchedLabelTemplateId) ?? null,
    [watchedLabelTemplateId]
  )

  // 列表列点击模板名打开的只读预览抽屉
  const [previewTemplate, setPreviewTemplate] = useState<(typeof mockLabelTemplates)[number] | null>(null)

  // 只读预览抽屉的映射明细列（来源字段 → 目标标签 → 启用）
  const previewColumns = [
    { title: '来源字段', dataIndex: 'source_field', key: 'source_field', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '来源类型',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (v: string) => (
        <Tag>{v === 'composite' ? '组合字段' : v === 'resource_field' ? '资源字段' : v}</Tag>
      ),
    },
    { title: '目标标签', dataIndex: 'target_label', key: 'target_label', render: (v: string) => <Text strong style={{ color: '#0ECDEB' }}>{v}</Text> },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (v: boolean) => (v ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />),
    },
  ]

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
    if (form.isFieldsTouched()) {
      modal.confirm({
        title: '有未保存的修改',
        content: '确定关闭吗？未保存的修改将丢失。',
        onOk: () => {
          setModalOpen(false)
          setEditingMapping(null)
          form.resetFields()
        },
      })
    } else {
      setModalOpen(false)
      setEditingMapping(null)
      form.resetFields()
    }
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
      render: (value?: string) => {
        if (!value) return '-'
        const tpl = mockLabelTemplates.find((t) => t.template_id === value)
        return (
          <div
            onClick={(e) => {
              e.stopPropagation()
              if (tpl) setPreviewTemplate(tpl)
            }}
            style={{ cursor: tpl ? 'pointer' : 'default' }}
          >
            <Space direction="vertical" size={0}>
              <Space size={4}>
                <Text strong>{labelNameMap.get(value) ?? value}</Text>
                {tpl?.is_default ? <Tag color="gold">默认</Tag> : <Tag>自定义</Tag>}
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {tpl ? `${RESOURCE_CATEGORY_MAP[tpl.resource_category]} · ` : ''}
                <Text code style={{ fontSize: 11 }}>
                  {value}
                </Text>
              </Text>
            </Space>
          </div>
        )
      },
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

      <Drawer
        title={editingMapping ? '编辑 CI-Exporter 模板映射' : '新增 CI-Exporter 模板映射'}
        open={modalOpen}
        onClose={handleCloseModal}
        width={640}
        maskClosable={false}
        extra={
          <Space>
            <Button onClick={handleCloseModal}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSave}>
              保存
            </Button>
          </Space>
        }
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
          <Form.Item
            label="标签模板"
            name="label_template_id"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                由 Module_07 维护；创建 Job 时自动继承，可换用其他模板（引用级）；标签内容编辑唯一入口在 Module_07
              </Text>
            }
          >
            <Select placeholder="请选择" allowClear showSearch optionFilterProp="children">
              {mockLabelTemplates.map((t) => (
                <Option key={t.template_id} value={t.template_id}>
                  {t.name}（{RESOURCE_CATEGORY_MAP[t.resource_category]} / {t.template_id}）
                </Option>
              ))}
            </Select>
          </Form.Item>
          {/* 只读预览：选中模板后以紧凑卡片展示映射明细，并提供跨模块跳转（模板 CRUD 归属 Module_07） */}
          {selectedLabelTemplate && (
            <Card
              size="small"
              style={{ marginBottom: 0 }}
              title={
                <Space size={6}>
                  <Text strong style={{ fontSize: 13 }}>
                    {selectedLabelTemplate.name}
                  </Text>
                  {selectedLabelTemplate.is_default ? <Tag color="gold">默认</Tag> : <Tag>自定义</Tag>}
                  <Text code style={{ fontSize: 11 }}>
                    {selectedLabelTemplate.template_id}
                  </Text>
                </Space>
              }
            >
              <Table
                rowKey="target_label"
                size="small"
                pagination={false}
                dataSource={selectedLabelTemplate.mappings}
                columns={previewColumns}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                该模板映射由 Module_07 维护，本页只读展示。
                <Typography.Link href="../module-07/dist/index.html" style={{ marginLeft: 8 }}>
                  前往标签模板管理 →
                </Typography.Link>
              </Text>
            </Card>
          )}
        </Form>
      </Drawer>

      {/* 标签模板只读预览抽屉（点击列表列模板名打开） */}
      <Drawer
        title="标签模板预览（只读）"
        width={560}
        open={!!previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        extra={
          <Typography.Link href="../module-07/dist/index.html" onClick={() => setPreviewTemplate(null)}>
            前往标签模板管理 →
          </Typography.Link>
        }
      >
        {previewTemplate && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Space size={6} wrap>
              <Text strong style={{ fontSize: 14 }}>{previewTemplate.name}</Text>
              {previewTemplate.is_default ? <Tag color="gold">默认</Tag> : <Tag>自定义</Tag>}
              <Tag color="blue">{RESOURCE_CATEGORY_MAP[previewTemplate.resource_category]}</Tag>
              <Text code style={{ fontSize: 11 }}>{previewTemplate.template_id}</Text>
            </Space>
            <Alert
              type="info"
              showIcon
              message="该模板由 Module_07 维护，本页只读展示；字段来源支持资源字段 / 组合字段。"
            />
            <Table
              rowKey="target_label"
              size="small"
              pagination={false}
              dataSource={previewTemplate.mappings}
              columns={previewColumns}
            />
          </Space>
        )}
      </Drawer>
    </MainLayout>
  )
}
