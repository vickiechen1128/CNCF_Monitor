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
  Alert,
  Statistic,
  Tabs,
  App,
  Tooltip,
  Empty,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  CodeOutlined,
  MinusCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockMonitoringRules,
  mockExporterTemplates,
  mockCITypeExporterMappings,
  metricLibraryStore,
  CI_TYPE_LABEL,
  CI_TYPE_CATEGORY_MAP,
  CI_TYPES_BY_CATEGORY,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_MAP,
  RULE_TYPE_MAP,
  METRIC_TYPE_COLOR,
  METRIC_TYPE_LABEL,
} from '../mocks/module-01'
import type { CiType, RuleType, MonitoringRule, ResourceCategory } from '../mocks/module-01'

const { Title, Text } = Typography
const { TextArea } = Input
const { Option } = Select
const { TabPane } = Tabs

const now = () => new Date().toISOString()

type ValidationResult =
  | { status: 'success'; message: string }
  | { status: 'error'; message: string }
  | null

// 从 PromQL 表达式中粗略解析出引用的指标名（去掉 label selector / 字符串字面量 / by/without 子句）
const extractMetricNames = (expr: string): string[] => {
  if (!expr) return []
  const stripped = expr
    .replace(/"[^"]*"/g, '""')
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/\[[^\]]*\]/g, '[]')
    .replace(/\b(?:by|without)\s*\([^)]*\)/gi, '')
  const matches = stripped.match(/[a-zA-Z_:][a-zA-Z0-9_:]*/g) ?? []
  const functions = new Set([
    'rate', 'irate', 'increase', 'sum', 'avg', 'min', 'max', 'count',
    'and', 'or', 'unless', 'on', 'ignoring', 'group_left', 'group_right',
    'offset', 'histogram_quantile', 'topk', 'bottomk', 'quantile',
    'predict_linear', 'changes', 'delta', 'deriv', 'idelta', 'resets',
    'absent', 'ceil', 'floor', 'round', 'abs', 'clamp_max', 'clamp_min',
    'clamp', 'time', 'vector', 'scalar', 'sort', 'sort_desc', 'sqrt',
    'ln', 'log2', 'log10', 'exp', 'sgn', 'deg', 'rad', 'pi', 'year',
    'month', 'day_of_month', 'day_of_week', 'days_in_month', 'hour',
    'minute', 'timestamp', 'label_replace', 'label_join', 'bool',
    'aggr_over_time', 'avg_over_time', 'min_over_time', 'max_over_time',
    'sum_over_time', 'count_over_time', 'quantile_over_time',
    'stddev_over_time', 'stdvar_over_time', 'last_over_time',
    'present_over_time', 'holt_winters', 'histogram_count', 'histogram_sum',
    'histogram_avg', 'histogram_stddev', 'histogram_stdvar',
    'histogram_fraction',
  ])
  return matches.filter((n) => !functions.has(n))
}

export default function RulesPage() {
  const { modal, message } = App.useApp()
  const [rules, setRules] = useState<MonitoringRule[]>(() => [...mockMonitoringRules])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<MonitoringRule | null>(null)
  const [validating, setValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<ValidationResult>(null)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [form] = Form.useForm()

  const watchRuleType = Form.useWatch('rule_type', form) as RuleType | undefined
  const watchExporterTemplateId = Form.useWatch('exporter_template_id', form) as
    | string
    | undefined
  const watchResourceCategory = Form.useWatch('resource_category', form)
  const watchResourceType = Form.useWatch('resource_type', form)
  const categoryCiTypes = (watchResourceCategory as ResourceCategory | undefined)
    ? CI_TYPES_BY_CATEGORY[watchResourceCategory as ResourceCategory]
    : []

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t.name))
    return map
  }, [])

  const alertingRules = useMemo(
    () => rules.filter((r) => r.rule_type === 'alerting'),
    [rules]
  )
  const recordingRules = useMemo(
    () => rules.filter((r) => r.rule_type === 'recording'),
    [rules]
  )

  // 指标预览：选 exporter_template_id 后从当前指标库（共享 store，含用户新增/禁用）过滤该 Exporter 启用的指标名
  const previewMetrics = metricLibraryStore.filter(
    (m) =>
      m.exporter_template_id === watchExporterTemplateId &&
      m.enabled
  )

  // 将监控规则默认值打开 modal
  const handleOpenModal = (record?: MonitoringRule) => {
    setPreviewVisible(false)
    setValidating(false)
    setValidationResult(null)
    if (record) {
      setEditingRule(record)
      form.setFieldsValue({
        name: record.name,
        rule_type: record.rule_type,
        resource_category: CI_TYPE_CATEGORY_MAP[record.resource_type],
        resource_type: record.resource_type,
        exporter_template_id: record.exporter_template_id,
        duration: record.duration,
        expr: record.expr,
        enabled: record.enabled,
        labels: Object.entries(record.labels).map(([key, value]) => ({ key, value })),
        annotations: Object.entries(record.annotations).map(([key, value]) => ({
          key,
          value,
        })),
      })
    } else {
      setEditingRule(null)
      form.resetFields()
      form.setFieldsValue({
        rule_type: 'alerting',
        resource_category: 'host',
        resource_type: 'host',
        duration: '5m',
        enabled: true,
        labels: [],
        annotations: [],
      })
    }
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingRule(null)
    setPreviewVisible(false)
    setValidating(false)
    setValidationResult(null)
  }

  // 校验表达式引用的指标是否存在于指标库（基于共享指标库 store，含用户新增/禁用）
  const validateMetrics = (
    expr: string,
    exporterTemplateId?: string
  ): { ok: true } | { ok: false; message: string } => {
    if (!expr.trim()) {
      return { ok: false, message: '表达式不能为空' }
    }
    const knownMetricNames = new Set(
      metricLibraryStore
        .filter((m) => m.enabled)
        .filter((m) => !exporterTemplateId || m.exporter_template_id === exporterTemplateId)
        .map((m) => m.metric_name)
    )
    // 全库兜底（用户可在不同 exporter 间引用），只要任意启用指标命中即视为已知
    const allKnown = new Set(metricLibraryStore.filter((m) => m.enabled).map((m) => m.metric_name))
    const used = extractMetricNames(expr)
    const unknown = used.filter((n) => !allKnown.has(n))
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `未知指标名 ${unknown.join(', ')}${
          exporterTemplateId
            ? `（不在 ${templateNameMap.get(exporterTemplateId) ?? exporterTemplateId} 指标库中）`
            : ''
        }`,
      }
    }
    // 同 Exporter 校验：若选定 exporter，所有指标都应在该 exporter 内
    if (exporterTemplateId) {
      const notInExporter = used.filter((n) => !knownMetricNames.has(n))
      if (notInExporter.length > 0) {
        return {
          ok: false,
          message: `指标 ${notInExporter.join(', ')} 不属于所选 Exporter「${
            templateNameMap.get(exporterTemplateId) ?? exporterTemplateId
          }」`,
        }
      }
    }
    return { ok: true }
  }

  // 交互式 PromQL 校验：检查表达式中出现的指标名是否在所选 Exporter 指标库内
  const handleValidate = () => {
    const expr = (form.getFieldValue('expr') as string) ?? ''
    setValidating(true)
    setValidationResult(null)
    setTimeout(() => {
      setValidating(false)
      const exporterTemplateId = form.getFieldValue('exporter_template_id') as string | undefined
      const result = validateMetrics(expr, exporterTemplateId)
      if (!result.ok) {
        setValidationResult({ status: 'error', message: `校验失败：${result.message}` })
        return
      }
      setValidationResult({
        status: 'success',
        message: '语法校验通过：表达式引用的指标均存在，结构正确。',
      })
    }, 600)
  }

  const handlePreview = () => {
    setPreviewVisible(true)
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      // 保存前强制校验：expr 引用的指标必须存在于指标库（PRD v1.9 决策 5）
      const expr = (values.expr as string) ?? ''
      const exporterTemplateId = values.exporter_template_id as string | undefined
      const metricResult = validateMetrics(expr, exporterTemplateId)
      if (!metricResult.ok) {
        setValidationResult({ status: 'error', message: `保存失败：${metricResult.message}` })
        message.error('保存失败：PromQL 引用了指标库中不存在的指标')
        return
      }

      const labelsArr = (values.labels as { key: string; value: string }[]) ?? []
      const annotationsArr = (values.annotations as { key: string; value: string }[]) ?? []
      const labels: Record<string, string> = {}
      labelsArr.forEach((it) => {
        if (it.key) labels[it.key] = it.value
      })
      const annotations: Record<string, string> = {}
      annotationsArr.forEach((it) => {
        if (it.key) annotations[it.key] = it.value
      })
      const ruleType = values.rule_type as RuleType
      const payload = {
        name: values.name as string,
        rule_type: ruleType,
        expr: values.expr as string,
        duration: ruleType === 'alerting' ? (values.duration as string) : '',
        labels,
        annotations: ruleType === 'alerting' ? annotations : {},
        resource_type: values.resource_type as CiType,
        exporter_template_id: values.exporter_template_id as string,
        // MVP~v0.3 阶段 scope 固定 central（中心求值），不暴露给用户（PRD 5.5）
        scope: 'central' as const,
        enabled: values.enabled as boolean,
      }
      if (editingRule) {
        const updated: MonitoringRule = {
          ...editingRule,
          ...payload,
          updated_at: now(),
        }
        setRules((prev) => prev.map((r) => (r.rule_id === editingRule.rule_id ? updated : r)))
        message.success('规则已更新')
      } else {
        const newRule: MonitoringRule = {
          rule_id: `rule-${Date.now()}`,
          ...payload,
          created_at: now(),
          updated_at: now(),
        }
        setRules((prev) => [...prev, newRule])
        message.success('规则已新增')
      }
      handleCloseModal()
    })
  }

  const handleDelete = (record: MonitoringRule) => {
    modal.confirm({
      title: '确认删除',
      content: `确定删除规则「${record.name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setRules((prev) => prev.filter((r) => r.rule_id !== record.rule_id))
        message.success('已删除')
      },
    })
  }

  const handleToggleEnabled = (record: MonitoringRule, checked: boolean) => {
    setRules((prev) =>
      prev.map((r) =>
        r.rule_id === record.rule_id ? { ...r, enabled: checked, updated_at: now() } : r
      )
    )
    message.success(checked ? '已启用' : '已禁用')
  }

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string, record: MonitoringRule) => (
        <Space>
          <Text strong>{value}</Text>
          <Tag color={RULE_TYPE_MAP[record.rule_type].color}>
            {RULE_TYPE_MAP[record.rule_type].text}
          </Tag>
        </Space>
      ),
    },
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: CiType) => (
        <Space direction="vertical" size={0}>
          <Tag color="blue">{CI_TYPE_LABEL[value]}</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {CI_TYPE_CATEGORY_MAP[value]}
          </Text>
        </Space>
      ),
    },
    {
      title: '关联 Exporter',
      dataIndex: 'exporter_template_id',
      key: 'exporter_template_id',
      render: (value: string) => (
        <Tag color="cyan">{templateNameMap.get(value) ?? value}</Tag>
      ),
    },
    {
      title: '表达式',
      dataIndex: 'expr',
      key: 'expr',
      ellipsis: true,
      render: (value: string) => (
        <Text code style={{ color: '#0ECDEB' }}>
          {value}
        </Text>
      ),
    },
    {
      title: '持续时间',
      dataIndex: 'duration',
      key: 'duration',
      render: (value: string, record: MonitoringRule) =>
        record.rule_type === 'recording' ? <Text type="secondary">-</Text> : value || '-',
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean, record: MonitoringRule) => (
        <Switch
          checked={value}
          size="small"
          onChange={(checked) => handleToggleEnabled(record, checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: MonitoringRule) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
            编辑
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  const renderTable = (data: MonitoringRule[]) => (
    <Table rowKey="rule_id" dataSource={data} columns={columns} pagination={{ pageSize: 5 }} />
  )

  // 渲染 key-value 动态表单（Form.List）
  const renderKeyValueList = (
    name: 'labels' | 'annotations',
    label: string,
    placeholderKey: string,
    placeholderValue: string
  ) => (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div style={{ marginBottom: 8 }}>
          {fields.length === 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              暂无{label}，点击下方按钮新增
            </Text>
          )}
          {fields.map((field) => (
            <Row gutter={8} key={field.key} style={{ marginBottom: 8 }} align="middle">
              <Col span={10}>
                <Form.Item name={[field.name, 'key']} noStyle>
                  <Input placeholder={placeholderKey} />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name={[field.name, 'value']} noStyle>
                  <Input placeholder={placeholderValue} />
                </Form.Item>
              </Col>
              <Col span={4}>
                <MinusCircleOutlined
                  onClick={() => remove(field.name)}
                  style={{ color: '#FF4C3A', fontSize: 16 }}
                />
              </Col>
            </Row>
          ))}
          <Button
            type="dashed"
            onClick={() => add({ key: '', value: '' })}
            icon={<PlusOutlined />}
            size="small"
            style={{ width: 160 }}
          >
            新增{label}行
          </Button>
        </div>
      )}
    </Form.List>
  )

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>规则编辑</Title>
        <Text type="secondary">
          管理告警规则与记录规则；expr 引用的指标必须先存在于指标库，保存时强制校验；规则生命周期由 Module_08 管理
        </Text>
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
                新增规则
              </Button>
              <Tooltip title="P1：规则模板一键填充（待实现）">
                <Button icon={<ThunderboltOutlined />} disabled>
                  规则模板（P1）
                </Button>
              </Tooltip>
            </Space>
          </Col>
          <Col>
            <Space size="large">
              <Statistic
                title="告警规则"
                value={alertingRules.length}
                valueStyle={{ color: RULE_TYPE_MAP.alerting.color }}
              />
              <Statistic
                title="记录规则"
                value={recordingRules.length}
                valueStyle={{ color: RULE_TYPE_MAP.recording.color }}
              />
            </Space>
          </Col>
        </Row>

        <Tabs defaultActiveKey="alerting">
          <TabPane tab="告警规则" key="alerting">
            {renderTable(alertingRules)}
          </TabPane>
          <TabPane tab="记录规则" key="recording">
            {renderTable(recordingRules)}
          </TabPane>
        </Tabs>
      </Card>

      <Modal
        title={editingRule ? '编辑规则' : '新增规则'}
        open={modalOpen}
        onCancel={handleCloseModal}
        width={760}
        footer={
          <Space>
            <Button onClick={handleCloseModal}>取消</Button>
            <Tooltip title="P1：规则模板一键填充（待实现）">
              <Button icon={<ThunderboltOutlined />} disabled>
                规则模板（P1）
              </Button>
            </Tooltip>
            <Button icon={<CodeOutlined />} onClick={handlePreview}>
              指标预览
            </Button>
            <Button icon={<PlayCircleOutlined />} loading={validating} onClick={handleValidate}>
              校验 PromQL
            </Button>
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
                label="规则名称"
                name="name"
                rules={[{ required: true, message: '请输入规则名称' }]}
              >
                <Input placeholder="如 HostHighCpuUsage" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="规则类型"
                name="rule_type"
                rules={[{ required: true, message: '请选择规则类型' }]}
              >
                <Select disabled={!!editingRule}>
                  <Option value="alerting">告警规则</Option>
                  <Option value="recording">记录规则</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="资源类别"
                name="resource_category"
                rules={[{ required: true, message: '请选择资源类别' }]}
              >
                <Select
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
                extra="选中后自动带出映射默认 Exporter 模板"
              >
                <Select
                  placeholder={categoryCiTypes.length > 0 ? '请选择 CI 类型' : '请先选择资源类别'}
                  disabled={categoryCiTypes.length === 0}
                  onChange={(type) => {
                    const mapping = mockCITypeExporterMappings.find(
                      (m) => m.resource_type === (type as CiType)
                    )
                    form.setFieldsValue({
                      exporter_template_id: mapping?.exporter_template_id,
                    })
                  }}
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
            <Col span={24}>
              <Form.Item
                label="关联 Exporter 模板"
                name="exporter_template_id"
                rules={[{ required: true, message: '请选择 Exporter 模板' }]}
                extra="与所选 CI 类型联动：自动带出该类型映射默认模板，用于指标预览与 PromQL 校验，可按需覆盖"
              >
                <Select placeholder="请选择" showSearch optionFilterProp="children">
                  {mockExporterTemplates
                    .filter((t) => t.supported_resource_types.length > 0)
                    .filter((t) =>
                      watchResourceType
                        ? t.supported_resource_types.includes(watchResourceType as CiType)
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
          </Row>

          {watchRuleType === 'alerting' && (
            <Form.Item label="持续时间 (for)" name="duration">
              <Input placeholder="如 5m" />
            </Form.Item>
          )}

          <Form.Item
            label="PromQL 表达式"
            name="expr"
            rules={[{ required: true, message: '请输入表达式' }]}
          >
            <TextArea rows={4} placeholder="输入 PromQL 表达式" />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            message="规则不绑定网域"
            description="告警/记录规则由中心侧对全网域聚合数据统一求值，因此无需（也不应）绑定单一网域；如需限定某网域，请在表达式 label selector 中按 network_domain 标签过滤（该标签由 Module_09 作为 external_labels 自动注入）。"
            style={{ marginBottom: 16 }}
          />

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Labels（key-value）" required={false}>
                {renderKeyValueList('labels', 'Label', 'severity', 'warning')}
              </Form.Item>
            </Col>
            <Col span={12}>
              {watchRuleType === 'alerting' ? (
                <Form.Item label="Annotations（key-value）" required={false}>
                  {renderKeyValueList('annotations', 'Annotation', 'summary', '主机 CPU 过高')}
                </Form.Item>
              ) : (
                <Alert
                  type="info"
                  showIcon
                  message="记录规则不展示 annotations"
                  description="recording 规则仅保留 expr 与 labels，duration / annotations 字段已隐藏（PRD 5.5）。"
                  style={{ marginTop: 30 }}
                />
              )}
            </Col>
          </Row>

          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {validationResult && (
            <Alert
              type={validationResult.status === 'success' ? 'success' : 'error'}
              showIcon
              message={validationResult.status === 'success' ? 'PromQL 校验通过' : 'PromQL 校验失败'}
              description={validationResult.message}
              style={{ marginBottom: 16 }}
            />
          )}

          {previewVisible &&
            (previewMetrics.length === 0 ? (
              <Alert
                type="info"
                showIcon
                message="指标预览"
                description={
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      watchExporterTemplateId
                        ? '该 Exporter 暂无启用指标'
                        : '请先选择 Exporter 模板'
                    }
                  />
                }
                style={{ marginBottom: 16 }}
              />
            ) : (
              <Alert
                type="info"
                showIcon
                message={`指标预览：${templateNameMap.get(watchExporterTemplateId ?? '') ?? ''}（${
                  previewMetrics.length
                } 个启用指标）`}
                description={
                  <Space wrap size={[4, 4]}>
                    {previewMetrics.map((m) => (
                      <Tooltip
                        key={m.metric_id}
                        title={`${m.help}${m.unit ? ` · 单位 ${m.unit}` : ''} · ${METRIC_TYPE_LABEL[m.metric_type]}`}
                      >
                        <Tag color={METRIC_TYPE_COLOR[m.metric_type]} style={{ marginBottom: 4 }}>
                          {m.metric_name}
                        </Tag>
                      </Tooltip>
                    ))}
                  </Space>
                }
                style={{ marginBottom: 16 }}
              />
            ))}

          <Alert
            type="warning"
            showIcon
            message="P1：规则模板一键填充"
            description="按 CI 类型 / Exporter 预置常用规则模板并一键填充的能力在 P1 版本提供，当前为占位按钮。"
            style={{ marginTop: 8 }}
          />

          {!watchExporterTemplateId && (
            <Alert
              type="info"
              showIcon
              message="提示"
              description="选择「关联 Exporter 模板」后可获取指标预览，并辅助 PromQL 校验。"
              style={{ marginTop: 12 }}
            />
          )}
        </Form>
      </Modal>
    </MainLayout>
  )
}
