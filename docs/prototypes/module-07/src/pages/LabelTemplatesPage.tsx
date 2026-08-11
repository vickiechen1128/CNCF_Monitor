import { useMemo, useState } from 'react'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  CMDB_FIELD_OPTIONS,
  COMPOSITE_OPTIONS,
  PROTECTED_PROMETHEUS_LABELS,
  PROMETHEUS_BUILTIN_OPTIONS,
  RESOURCE_FIELD_OPTIONS,
  RESOURCE_TYPE_MAP,
  mockLabelTemplates,
  mockStatusMappingConfig,
} from '../mocks/module-07'
import type { LabelTemplate, LabelTemplateSource, Mapping, ResourceType } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']

const SOURCE_TYPE_OPTIONS: { value: LabelTemplateSource; label: string; disabled?: boolean }[] = [
  { value: 'resource_field', label: '资源字段' },
  { value: 'prometheus_builtin', label: 'Prometheus 内置字段' },
  { value: 'composite', label: '组合字段' },
  { value: 'cmdb_field', label: 'CMDB 字段 {v0.4+}', disabled: true },
]

const SOURCE_TYPE_COLOR: Record<LabelTemplateSource, string> = {
  resource_field: 'blue',
  prometheus_builtin: 'purple',
  composite: 'cyan',
  cmdb_field: 'default',
}

function nowStr(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

export default function LabelTemplatesPage() {
  const { message, modal } = App.useApp()
  const [activeType, setActiveType] = useState<ResourceType>('host')
  const [templates, setTemplates] = useState<LabelTemplate[]>(mockLabelTemplates)
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(mockLabelTemplates[0].template_id)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null)
  const [mappingModalOpen, setMappingModalOpen] = useState(false)
  const [editingMapping, setEditingMapping] = useState<Mapping | null>(null)
  const [templateForm] = Form.useForm()
  const [mappingForm] = Form.useForm()
  const watchedSourceType = Form.useWatch('source_type', mappingForm)

  const typeTemplates = useMemo(() => templates.filter((t) => t.resource_type === activeType), [templates, activeType])

  const selectedTemplate =
    templates.find((t) => t.template_id === selectedTemplateId) ?? typeTemplates[0] ?? null

  const handleTabChange = (key: string) => {
    const type = key as ResourceType
    setActiveType(type)
    const first = templates.find((t) => t.resource_type === type)
    setSelectedTemplateId(first?.template_id ?? '')
  }

  // ---------- 模板级操作 ----------
  const openTemplateModal = (tpl?: LabelTemplate) => {
    setEditingTemplate(tpl ?? null)
    templateForm.resetFields()
    if (tpl) {
      templateForm.setFieldsValue({ name: tpl.name, resource_type: tpl.resource_type })
    } else {
      templateForm.setFieldsValue({ resource_type: activeType })
    }
    setTemplateModalOpen(true)
  }

  // P1：克隆模板（占位，PRD 未明确编号，作为模板管理增强）
  const handleCloneTemplate = (tpl: LabelTemplate) => {
    const now = nowStr()
    const cloned: LabelTemplate = {
      template_id: `tpl-${tpl.resource_type}-${Date.now()}`,
      name: `${tpl.name}（副本）`,
      resource_type: tpl.resource_type,
      is_default: false,
      mappings: tpl.mappings.map((m) => ({
        ...m,
        mapping_id: `mp-${tpl.resource_type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      })),
      created_at: now,
      updated_at: now,
    }
    setTemplates((prev) => [...prev, cloned])
    setActiveType(cloned.resource_type)
    setSelectedTemplateId(cloned.template_id)
    message.success(`已克隆模板「${tpl.name}」为「${cloned.name}」`)
  }

  // 删除模板：默认模板不可删除（PRD 6.1 模板规则）
  const handleDeleteTemplate = (tpl: LabelTemplate) => {
    if (tpl.is_default) {
      message.warning('默认模板不可删除（每类资源保留一个默认模板）')
      return
    }
    modal.confirm({
      title: '删除模板',
      content: `确认删除模板「${tpl.name}」？该操作不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => {
        setTemplates((prev) => prev.filter((t) => t.template_id !== tpl.template_id))
        if (selectedTemplateId === tpl.template_id) {
          const remaining = templates.filter((t) => t.resource_type === tpl.resource_type && t.template_id !== tpl.template_id)
          setSelectedTemplateId(remaining[0]?.template_id ?? '')
        }
        message.success('模板已删除')
      },
    })
  }

  const handleSaveTemplate = () => {
    templateForm.validateFields().then((values) => {
      const now = nowStr()
      if (editingTemplate) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === editingTemplate.template_id
              ? { ...t, name: values.name as string, resource_type: values.resource_type as ResourceType, updated_at: now }
              : t
          )
        )
        message.success('模板已更新')
      } else {
        const tpl: LabelTemplate = {
          template_id: `tpl-${values.resource_type}-${Date.now()}`,
          name: values.name as string,
          resource_type: values.resource_type as ResourceType,
          is_default: false,
          mappings: [],
          created_at: now,
          updated_at: now,
        }
        setTemplates((prev) => [...prev, tpl])
        setActiveType(tpl.resource_type)
        setSelectedTemplateId(tpl.template_id)
        message.success('模板已新增')
      }
      setTemplateModalOpen(false)
      setEditingTemplate(null)
      templateForm.resetFields()
    })
  }

  // ---------- 映射级操作 ----------
  const getSourceFieldOptions = (type: ResourceType, sourceType?: LabelTemplateSource) => {
    if (sourceType === 'prometheus_builtin') return PROMETHEUS_BUILTIN_OPTIONS.map((f) => ({ value: f, label: f }))
    if (sourceType === 'composite') return COMPOSITE_OPTIONS.map((f) => ({ value: f, label: f }))
    if (sourceType === 'cmdb_field') return CMDB_FIELD_OPTIONS.map((f) => ({ value: f, label: `${f} {v0.4+}` }))
    return RESOURCE_FIELD_OPTIONS[type].map((f) => ({ value: f, label: f }))
  }

  const openMappingModal = (mapping?: Mapping) => {
    if (!selectedTemplate) return
    setEditingMapping(mapping ?? null)
    mappingForm.resetFields()
    if (mapping) {
      mappingForm.setFieldsValue({ ...mapping })
    } else {
      mappingForm.setFieldsValue({ source_type: 'resource_field', enabled: true })
    }
    setMappingModalOpen(true)
  }

  const handleSaveMapping = () => {
    if (!selectedTemplate) return
    mappingForm.validateFields().then((values) => {
      const now = nowStr()
      // PRD 5.3 / 3.3：保护 Prometheus 内置 label，不允许覆盖
      const targetLabel = values.target_label as string
      if (PROTECTED_PROMETHEUS_LABELS.includes(targetLabel)) {
        message.warning(`「${targetLabel}」是 Prometheus 内置保护 label，不允许作为目标标签`)
        return
      }
      const field = {
        source_field: values.source_field as string,
        source_type: values.source_type as LabelTemplateSource,
        target_label: targetLabel,
        transform: (values.transform as string | undefined) ?? '',
        enabled: (values.enabled as boolean | undefined) ?? true,
      }
      if (editingMapping) {
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === selectedTemplate.template_id
              ? {
                  ...t,
                  mappings: t.mappings.map((m) => (m.mapping_id === editingMapping.mapping_id ? { ...m, ...field } : m)),
                  updated_at: now,
                }
              : t
          )
        )
        message.success('映射已更新')
      } else {
        const mapping: Mapping = {
          mapping_id: `mp-${selectedTemplate.resource_type}-${Date.now()}`,
          ...field,
        }
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === selectedTemplate.template_id
              ? { ...t, mappings: [...t.mappings, mapping], updated_at: now }
              : t
          )
        )
        message.success('映射已新增')
      }
      setMappingModalOpen(false)
      setEditingMapping(null)
      mappingForm.resetFields()
    })
  }

  const handleDeleteMapping = (mapping: Mapping) => {
    if (!selectedTemplate) return
    modal.confirm({
      title: '删除映射',
      content: `确认删除映射「${mapping.source_field} → ${mapping.target_label}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => {
        setTemplates((prev) =>
          prev.map((t) =>
            t.template_id === selectedTemplate.template_id
              ? { ...t, mappings: t.mappings.filter((m) => m.mapping_id !== mapping.mapping_id), updated_at: nowStr() }
              : t
          )
        )
        message.success('映射已删除')
      },
    })
  }

  const mappingColumns: TableProps<Mapping>['columns'] = [
    { title: '来源字段', dataIndex: 'source_field', key: 'source_field', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '来源类型',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (value: LabelTemplateSource) => (
        <Tag color={SOURCE_TYPE_COLOR[value]}>
          {SOURCE_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value}
        </Tag>
      ),
    },
    {
      title: '目标标签',
      dataIndex: 'target_label',
      key: 'target_label',
      render: (v: string) => <Text strong style={{ color: '#0ECDEB' }}>{v}</Text>,
    },
    { title: '转换规则', dataIndex: 'transform', key: 'transform', render: (v?: string) => v || '-' },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (v: boolean) => (v ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Mapping) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openMappingModal(record)}>
            编辑
          </Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteMapping(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>标签模板</Title>
        <Text type="secondary">按资源类型管理字段到 Prometheus Label 的映射（模板级管理）</Text>
      </div>

      {/* 模块边界说明 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Module_07 模块边界"
        description={
          <Space direction="vertical" size={4}>
            <Text style={{ fontSize: 13 }}>
              • 标签模板（LabelTemplate）只与资源类型绑定，不绑定 Job；Job 级别的 label 覆盖由 Module_01 负责。
            </Text>
            <Text style={{ fontSize: 13 }}>
              • 字段来源支持：资源字段 / Prometheus 内置字段 / 组合字段；CMDB 字段为 v0.4+ 预留，由 Module_04 接入后启用。
            </Text>
            <Text style={{ fontSize: 13 }}>
              • 每类资源预置一个默认模板，默认模板不可删除。
            </Text>
            <Text style={{ fontSize: 13 }}>
              • 状态映射（Excel 中文 → Resource.status）为可配置规则，详见导入记录页或下方说明。
            </Text>
          </Space>
        }
      />

      {/* 状态映射可配置说明（PRD 5.5.2 / 5.5.3） */}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="状态映射可配置规则"
        description={
          <Space direction="vertical" size={4}>
            <Text style={{ fontSize: 13 }}>
              Excel 导入时，status 列的中文值通过映射规则转换为 Resource.status 枚举。当前 mock 配置：
            </Text>
            <Space wrap size={[8, 4]}>
              {mockStatusMappingConfig.rules.map((rule) => (
                <Tag key={rule.id} style={{ fontSize: 12 }}>
                  {rule.source_status} → {rule.target_status}
                  {rule.resource_type !== 'all' && `（${RESOURCE_TYPE_MAP[rule.resource_type as ResourceType]}）`}
                  {rule.is_builtin && ' [内置]'}
                </Tag>
              ))}
            </Space>
            <Text style={{ fontSize: 12, color: '#86909C' }}>
              大小写敏感：{mockStatusMappingConfig.case_sensitive ? '是' : '否'} · 默认目标状态：{mockStatusMappingConfig.default_target} ·
              映射优先级：精确资源类型规则 {'>'} 'all' 通用规则 · UI 配置入口为 P2
            </Text>
          </Space>
        }
      />

      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Tabs
              activeKey={activeType}
              onChange={handleTabChange}
              items={RESOURCE_TYPES.map((type) => ({
                key: type,
                label: `${RESOURCE_TYPE_MAP[type]} (${templates.filter((t) => t.resource_type === type).length})`,
              }))}
            />
          </Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }} onClick={() => openTemplateModal()}>
              新增模板
            </Button>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={9}>
            <Card size="small" title="模板列表" style={{ minHeight: 420 }}>
              {typeTemplates.length === 0 ? (
                <Empty description="该资源类型暂无模板" />
              ) : (
                <List
                  dataSource={typeTemplates}
                  renderItem={(tpl) => {
                    const active = tpl.template_id === selectedTemplate?.template_id
                    return (
                      <List.Item
                        onClick={() => setSelectedTemplateId(tpl.template_id)}
                        style={{
                          cursor: 'pointer',
                          padding: '10px 12px',
                          borderRadius: 6,
                          background: active ? '#E6FAFD' : undefined,
                          border: active ? '1px solid #0ECDEB' : '1px solid transparent',
                        }}
                      >
                        <List.Item.Meta
                          title={
                            <Space size={6}>
                              <Text strong>{tpl.name}</Text>
                              {tpl.is_default && <Tag color="gold">默认</Tag>}
                            </Space>
                          }
                          description={
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {tpl.mappings.length} 条映射 · 创建于 {tpl.created_at}
                            </Text>
                          }
                        />
                      </List.Item>
                    )
                  }}
                />
              )}
            </Card>
          </Col>
          <Col span={15}>
            {selectedTemplate ? (
              <Card
                size="small"
                title={
                  <Space size={6}>
                    <Text strong>{selectedTemplate.name}</Text>
                    {selectedTemplate.is_default && <Tag color="gold">默认</Tag>}
                    <Tag>{RESOURCE_TYPE_MAP[selectedTemplate.resource_type]}</Tag>
                  </Space>
                }
                extra={
                  <Space>
                    <Button icon={<EditOutlined />} onClick={() => openTemplateModal(selectedTemplate)}>
                      编辑模板
                    </Button>
                    {/* P1：克隆模板占位 */}
                    <Tooltip title="克隆当前模板（含全部映射），用于快速创建变体模板">
                      <Button icon={<CopyOutlined />} onClick={() => handleCloneTemplate(selectedTemplate)}>
                        克隆
                      </Button>
                    </Tooltip>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      style={{ backgroundColor: '#0ECDEB' }}
                      onClick={() => openMappingModal()}
                    >
                      新增映射
                    </Button>
                    {!selectedTemplate.is_default && (
                      <Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteTemplate(selectedTemplate)}>
                        删除模板
                      </Button>
                    )}
                  </Space>
                }
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={
                    <Space direction="vertical" size={2}>
                      <Text style={{ fontSize: 13 }}>
                        LabelTemplate 只与资源类型绑定，不绑定 Job；字段来源支持资源字段 / Prometheus 内置字段 / 组合字段。
                      </Text>
                      <Text style={{ fontSize: 12, color: '#86909C' }}>
                        保护 label（不可作为目标标签）：{PROTECTED_PROMETHEUS_LABELS.join(', ')}
                      </Text>
                    </Space>
                  }
                />
                <Table
                  rowKey="mapping_id"
                  dataSource={selectedTemplate.mappings}
                  columns={mappingColumns}
                  pagination={false}
                  size="small"
                  locale={{ emptyText: '该模板暂无映射，点击「新增映射」添加' }}
                />
              </Card>
            ) : (
              <Card size="small" style={{ minHeight: 420 }}>
                <Empty description="请选择左侧模板查看详情" />
              </Card>
            )}
          </Col>
        </Row>
      </Card>

      {/* 模板编辑弹窗 */}
      <Modal
        title={editingTemplate ? '编辑模板' : '新增模板'}
        open={templateModalOpen}
        onCancel={() => {
          setTemplateModalOpen(false)
          setEditingTemplate(null)
          templateForm.resetFields()
        }}
        onOk={handleSaveTemplate}
        okText="保存"
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={480}
        destroyOnClose
      >
        <Form form={templateForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="模板名称"
            name="name"
            rules={[{ required: true, message: '请输入模板名称' }]}
            extra="模板名称用于展示，同一资源类型下名称可重复"
          >
            <Input placeholder="如 主机默认模板" />
          </Form.Item>
          <Form.Item
            label="资源类型"
            name="resource_type"
            rules={[{ required: true, message: '请选择资源类型' }]}
            extra="模板与资源类型绑定，创建后不可修改"
          >
            <Select disabled={!!editingTemplate} placeholder="请选择">
              {RESOURCE_TYPES.map((type) => (
                <Option key={type} value={type}>
                  {RESOURCE_TYPE_MAP[type]}
                </Option>
              ))}
            </Select>
          </Form.Item>
          {!editingTemplate && (
            <Alert
              type="info"
              showIcon
              message="新增模板默认为非默认模板，mappings 为空。创建后可通过「新增映射」添加字段映射。"
              style={{ marginTop: 8 }}
            />
          )}
        </Form>
      </Modal>

      {/* 映射编辑弹窗 */}
      <Modal
        title={editingMapping ? '编辑映射' : '新增映射'}
        open={mappingModalOpen}
        onCancel={() => {
          setMappingModalOpen(false)
          setEditingMapping(null)
          mappingForm.resetFields()
        }}
        onOk={handleSaveMapping}
        okText="保存"
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={560}
        destroyOnClose
      >
        <Form form={mappingForm} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="来源类型"
                name="source_type"
                rules={[{ required: true, message: '请选择来源类型' }]}
                extra="cmdb_field 为 v0.4+ 预留，由 Module_04 接入后启用"
              >
                <Select placeholder="请选择">
                  {SOURCE_TYPE_OPTIONS.map((opt) => (
                    <Option key={opt.value} value={opt.value} disabled={opt.disabled}>
                      {opt.label} {opt.disabled ? '（v0.4+ 预留）' : ''}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="来源字段"
                name="source_field"
                rules={[{ required: true, message: '请选择来源字段' }]}
                extra={
                  watchedSourceType === 'resource_field'
                    ? '从资源固定字段中选取'
                    : watchedSourceType === 'prometheus_builtin'
                    ? 'Prometheus 内置 label'
                    : watchedSourceType === 'composite'
                    ? '组合字段，如 instance_ip:port'
                    : watchedSourceType === 'cmdb_field'
                    ? 'CMDB 字段，v0.4+ 由 Module_04 同步'
                    : undefined
                }
              >
                <Select
                  placeholder={watchedSourceType === 'cmdb_field' ? 'v0.4+ 支持' : '请选择'}
                  showSearch
                  options={getSourceFieldOptions(selectedTemplate?.resource_type ?? activeType, watchedSourceType)}
                  disabled={watchedSourceType === 'cmdb_field'}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="目标标签"
                name="target_label"
                rules={[{ required: true, message: '请输入目标标签' }]}
                extra="映射为 Prometheus label；保护 label（instance/job 等）不允许使用"
              >
                <Input placeholder="如 instance" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="转换规则"
                name="transform"
                extra="可选：lower / upper / prefix / replace"
              >
                <Input placeholder="可选：lower / upper / prefix / replace" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked" extra="禁用后该映射不参与 label 生成">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
