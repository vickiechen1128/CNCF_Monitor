import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Input,
  Select,
  Switch,
  Button,
  Modal,
  Form,
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
  SearchOutlined,
  DatabaseOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { useNavigate } from 'react-router-dom'
import {
  mockExporterTemplates,
  metricLibraryStore,
  METRIC_TYPES,
  METRIC_TYPE_COLOR,
  METRIC_TYPE_LABEL,
  CI_TYPES,
  CI_TYPE_LABEL,
  CI_TYPES_BY_CATEGORY,
  CI_TYPE_CATEGORY_MAP,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_MAP,
} from '../mocks/module-01'
import type {
  MetricLibraryItem,
  MetricType,
  CiType,
  ResourceCategory,
} from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

export default function MetricLibraryPage() {
  const { modal, message } = App.useApp()
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState<MetricLibraryItem[]>(() => [...metricLibraryStore])
  const [search, setSearch] = useState('')
  const [metricTypeFilter, setMetricTypeFilter] = useState<MetricType | undefined>(undefined)
  const [categoryFilter, setCategoryFilter] = useState<ResourceCategory | undefined>(undefined)
  const [ciTypeFilter, setCiTypeFilter] = useState<CiType | undefined>(undefined)
  // {v3.8} 语义域筛选（可选，P1 增强）：cpu / memory / disk / network 等
  const [semanticFilter, setSemanticFilter] = useState<string | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMetric, setEditingMetric] = useState<MetricLibraryItem | null>(null)
  const [form] = Form.useForm()

  // 指标库增删改同步到模块级共享 store，RulesPage 的校验/预览实时读取（决策 5：先有指标库才能写 PromQL）
  const syncStore = (next: MetricLibraryItem[]) => {
    metricLibraryStore.splice(0, metricLibraryStore.length, ...next)
    setMetrics(next)
  }

  // {v3.8} 全部语义域取值（用于筛选下拉）
  const semanticDomains = useMemo(
    () => [...new Set(metrics.map((m) => m.category).filter((c): c is string => !!c))],
    [metrics]
  )

  // {v3.8} 按 CI 类型分组（主锚点 = resource_types，不再按 Exporter 模板分组）；受搜索 / metric_type / CI 类型 / 语义域筛选影响
  const groupedData = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const typeGroups = new Map<CiType, MetricLibraryItem[]>()
    metrics.forEach((m) => {
      if (metricTypeFilter && m.metric_type !== metricTypeFilter) return
      if (semanticFilter && m.category !== semanticFilter) return
      if (
        keyword &&
        !m.metric_name.toLowerCase().includes(keyword) &&
        !m.help.toLowerCase().includes(keyword)
      )
        return
      const anchors = m.resource_types ?? []
      anchors.forEach((rt) => {
        if (ciTypeFilter && rt.resource_type !== ciTypeFilter) return
        const arr = typeGroups.get(rt.resource_type) ?? []
        arr.push(m)
        typeGroups.set(rt.resource_type, arr)
      })
    })
    return [...typeGroups.entries()]
      .map(([resourceType, ms]) => ({ resourceType, metrics: ms }))
      .filter((g) => g.metrics.length > 0)
  }, [metrics, search, metricTypeFilter, semanticFilter, ciTypeFilter])

  const handleOpenModal = (record?: MetricLibraryItem) => {
    if (record) {
      setEditingMetric(record)
      form.setFieldsValue({
        metric_name: record.metric_name,
        metric_type: record.metric_type,
        help: record.help,
        unit: record.unit ?? '',
        labels: record.labels.join(','),
        // {v3.8} 所属 CI 类型（多选，主锚点）+ 来源采集器 + 语义域
        resource_types: (record.resource_types ?? []).map((rt) => rt.resource_type),
        source_exporter: record.resource_types?.[0]?.source_exporter,
        category: record.category,
        enabled: record.enabled,
      })
    } else {
      setEditingMetric(null)
      form.resetFields()
      form.setFieldsValue({
        metric_type: 'gauge',
        enabled: true,
        labels: '',
        resource_types: [],
      })
    }
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingMetric(null)
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      const labels = (values.labels as string)
        ? (values.labels as string)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      // {v3.8} 主锚点：所选 CI 类型 → resource_types（关联带来源采集器标注）
      const ciTypes = (values.resource_types as CiType[]) ?? []
      const sourceExporter = (values.source_exporter as string) || undefined
      const payload = {
        metric_name: values.metric_name as string,
        metric_type: values.metric_type as MetricType,
        help: values.help as string,
        unit: (values.unit as string) || undefined,
        labels,
        resource_types: ciTypes.map((rt) => ({
          resource_type: rt,
          source_exporter: sourceExporter,
        })),
        category: (values.category as string) || undefined,
        enabled: values.enabled as boolean,
      }
      if (editingMetric) {
        const updated: MetricLibraryItem = {
          ...editingMetric,
          ...payload,
        }
        syncStore(metrics.map((m) => (m.metric_id === editingMetric.metric_id ? updated : m)))
        message.success('指标已更新')
      } else {
        const newMetric: MetricLibraryItem = {
          metric_id: `m-${Date.now()}`,
          ...payload,
          is_builtin: false,
        }
        syncStore([...metrics, newMetric])
        message.success('指标已新增（用户扩展）')
      }
      handleCloseModal()
    })
  }

  const handleDelete = (record: MetricLibraryItem) => {
    if (record.is_builtin) {
      message.warning('内置指标禁止删除')
      return
    }
    modal.confirm({
      title: '确认删除',
      content: `确定删除用户扩展指标「${record.metric_name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        syncStore(metrics.filter((m) => m.metric_id !== record.metric_id))
        message.success('已删除')
      },
    })
  }

  const handleToggleEnabled = (record: MetricLibraryItem, checked: boolean) => {
    syncStore(
      metrics.map((m) =>
        m.metric_id === record.metric_id ? { ...m, enabled: checked } : m
      )
    )
    message.success(checked ? '已启用' : '已禁用')
  }

  const columns = [
    {
      title: '指标名称',
      dataIndex: 'metric_name',
      key: 'metric_name',
      render: (value: string) => (
        <Text strong code style={{ color: '#0ECDEB' }}>
          {value}
        </Text>
      ),
    },
    {
      title: '类型',
      dataIndex: 'metric_type',
      key: 'metric_type',
      render: (value: MetricType) => (
        <Tag color={METRIC_TYPE_COLOR[value]}>{METRIC_TYPE_LABEL[value]}</Tag>
      ),
    },
    {
      title: '说明',
      dataIndex: 'help',
      key: 'help',
      ellipsis: true,
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      render: (value?: string) => value || '-',
    },
    {
      title: '标签',
      dataIndex: 'labels',
      key: 'labels',
      render: (value: string[]) => (
        <Space wrap>
          {value.map((label) => (
            <Tag key={label} color="blue" style={{ fontSize: 12 }}>
              {label}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      // {v3.8} 来源采集器标注：指标 → CI 类型关联的来源（解决同名不同义）
      title: '来源采集器',
      key: 'source_exporter',
      render: (_: unknown, record: MetricLibraryItem) => {
        const sources = [...new Set((record.resource_types ?? []).map((rt) => rt.source_exporter).filter(Boolean))]
        return sources.length > 0 ? (
          <Space wrap>
            {sources.map((s) => (
              <Tag key={s} style={{ fontSize: 12 }}>
                {s}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>-</Text>
        )
      },
    },
    {
      // {v3.8} 语义域（可选，P1 增强）
      title: '语义域',
      dataIndex: 'category',
      key: 'category',
      render: (value?: string) => (value ? <Tag color="geekblue">{value}</Tag> : <Text type="secondary" style={{ fontSize: 12 }}>-</Text>),
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
          <Tag>用户扩展</Tag>
        ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean, record: MetricLibraryItem) => (
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
      render: (_: unknown, record: MetricLibraryItem) => (
        <Space>
          <Tooltip title={record.is_builtin ? '内置指标禁止编辑' : '编辑指标'}>
            <Button
              type="link"
              icon={<EditOutlined />}
              disabled={record.is_builtin}
              onClick={() => handleOpenModal(record)}
            >
              编辑
            </Button>
          </Tooltip>
          <Tooltip title={record.is_builtin ? '内置指标禁止删除' : '删除指标'}>
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
        <Title level={4}>技术指标库</Title>
        <Text type="secondary">
          平台可识别的指标元数据（指标名 / 类型 / 单位 / 说明），回答「能采到什么」；按 CI 类型分组查看，必须先存在指标库才能编写 PromQL。
        </Text>
      </div>
      {/* {v3.7} 两库关系说明（用户语言）：技术指标库回答「指标是什么」，业务指标库回答「业务要什么」；动线归组放一起 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="这里维护指标的「技术元数据」；业务指标的语义与负责人请前往业务指标库"
        description={
          <span>
            技术指标库描述「能采到什么」（指标名 / 类型 / 单位 / 说明），供规则编辑提示与 PromQL 校验；
            业务指标库描述「业务关心什么」（语义 / 建议阈值 / 业务域 / 负责人），由业务负责人定义、运维落地采集。
            两者并列互补：规则编辑同时消费两库（v0.3+ 阈值参考业务库）。{' '}
            <Typography.Link onClick={() => navigate('/business-metrics')}>前往业务指标库 →</Typography.Link>
          </span>
        }
      />
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Space wrap>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ backgroundColor: '#0ECDEB' }}
                onClick={() => handleOpenModal()}
              >
                新增指标
              </Button>
              <Select
                placeholder="按资源类别筛选"
                allowClear
                style={{ width: 150 }}
                value={categoryFilter}
                onChange={(v) => {
                  setCategoryFilter(v as ResourceCategory | undefined)
                  setCiTypeFilter(undefined)
                }}
              >
                {RESOURCE_CATEGORIES.map((cat) => (
                  <Option key={cat} value={cat}>
                    {RESOURCE_CATEGORY_MAP[cat]}
                  </Option>
                ))}
              </Select>
              <Select
                placeholder="按 CI 类型筛选"
                allowClear
                style={{ width: 160 }}
                value={ciTypeFilter}
                disabled={!categoryFilter}
                onChange={(v) => setCiTypeFilter(v as CiType | undefined)}
              >
                {(categoryFilter ? CI_TYPES_BY_CATEGORY[categoryFilter] : []).map((type) => (
                  <Option key={type} value={type}>
                    {CI_TYPE_LABEL[type]}
                  </Option>
                ))}
              </Select>
              <Select
                placeholder="按类型筛选"
                allowClear
                style={{ width: 160 }}
                value={metricTypeFilter}
                onChange={(v) => setMetricTypeFilter(v as MetricType | undefined)}
              >
                {METRIC_TYPES.map((t) => (
                  <Option key={t} value={t}>
                    {METRIC_TYPE_LABEL[t]}
                  </Option>
                ))}
              </Select>
              {/* {v3.8} 语义域筛选（可选，P1 增强） */}
              <Select
                placeholder="按语义域筛选"
                allowClear
                style={{ width: 140 }}
                value={semanticFilter}
                onChange={(v) => setSemanticFilter(v as string | undefined)}
              >
                {semanticDomains.map((s) => (
                  <Option key={s} value={s}>
                    {s}
                  </Option>
                ))}
              </Select>
            </Space>
          </Col>
          <Col>
            <Space>
              <DatabaseOutlined style={{ color: '#0ECDEB', fontSize: 18 }} />
              <Text type="secondary">
                共 {metrics.length} 个指标（内置 {metrics.filter((m) => m.is_builtin).length} /
                用户扩展 {metrics.filter((m) => !m.is_builtin).length}），按 {groupedData.length} 个 CI 类型组织
              </Text>
            </Space>
          </Col>
          <Col>
            <Input.Search
              placeholder="搜索指标名或说明"
              allowClear
              prefix={<SearchOutlined />}
              onSearch={(value) => setSearch(value)}
              style={{ width: 320 }}
            />
          </Col>
        </Row>

        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {groupedData.length === 0 && (
            <Card>
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Text type="secondary">未找到匹配的指标</Text>
              </div>
            </Card>
          )}
          {groupedData.map((group) => (
            <Card
              key={group.resourceType}
              type="inner"
              title={
                <Space>
                  {/* {v3.8} 分组锚点 = CI 类型（resource_type），不再按 Exporter 模板分组 */}
                  <Text strong>{CI_TYPE_LABEL[group.resourceType]}</Text>
                  <Tag color="blue">{CI_TYPE_CATEGORY_MAP[group.resourceType]}</Tag>
                  <Badge count={group.metrics.length} style={{ backgroundColor: '#0ECDEB' }} />
                </Space>
              }
              extra={
                <Text type="secondary">
                  {[...new Set(group.metrics.map((m) => m.category).filter((c): c is string => !!c))].join(' · ') ||
                    '指标按 CI 类型组织（来源采集器见各列）'}
                </Text>
              }
            >
              <Table
                rowKey="metric_id"
                dataSource={group.metrics}
                columns={columns}
                pagination={false}
                size="small"
              />
            </Card>
          ))}
        </Space>
      </Card>

      <Modal
        title={editingMetric ? '编辑指标' : '新增指标（用户扩展）'}
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
                label="指标名称"
                name="metric_name"
                rules={[
                  { required: true, message: '请输入指标名称' },
                  {
                    pattern: /^[a-zA-Z_:][a-zA-Z0-9_:]*$/,
                    message: '需符合 Prometheus 指标命名规范',
                  },
                ]}
                extra="如 app_business_orders_total"
              >
                <Input placeholder="如 app_business_orders_total" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="指标类型"
                name="metric_type"
                rules={[{ required: true, message: '请选择指标类型' }]}
              >
                <Select placeholder="请选择">
                  {METRIC_TYPES.map((t) => (
                    <Option key={t} value={t}>
                      {METRIC_TYPE_LABEL[t]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              {/* {v3.8} 主锚点：所属 CI 类型（多选，多对多） */}
              <Form.Item
                label="所属 CI 类型"
                name="resource_types"
                rules={[{ required: true, message: '请至少选择一个 CI 类型' }]}
                extra="指标的主锚点（可多选，如 go_goroutines 属所有应用型类型）；规则编辑器按此提示"
              >
                <Select mode="multiple" placeholder="请选择 CI 类型" showSearch optionFilterProp="children">
                  {CI_TYPES.map((t) => (
                    <Option key={t} value={t}>
                      {CI_TYPE_LABEL[t]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              {/* {v3.8} 来源采集器标注（解决同名不同义）+ 语义域（可选） */}
              <Form.Item
                label="来源采集器"
                name="source_exporter"
                extra="可选，标注指标来源（同名指标不同来源时提示区分）"
              >
                <Select placeholder="可选" allowClear showSearch optionFilterProp="children">
                  {mockExporterTemplates.map((t) => (
                    <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                      {t.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="语义域"
            name="category"
            extra="可选（P1 增强）：cpu / memory / disk / network 等，指标分组浏览与提示聚类"
          >
            <Input placeholder="如 cpu / memory / disk / network" />
          </Form.Item>
          <Form.Item
            label="HELP 文本"
            name="help"
            rules={[{ required: true, message: '请输入 HELP 文本' }]}
          >
            <Input placeholder="指标说明" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="单位" name="unit" extra="如 bytes / seconds / percent">
                <Input placeholder="可选" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="标签键（逗号分隔）"
                name="labels"
                extra="如 status, path, app"
              >
                <Input placeholder="如 status, path, app" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked" extra="禁用指标不参与规则编辑提示">
            <Switch />
          </Form.Item>

          {editingMetric?.is_builtin && (
            <Tag color="gold" icon={<LockOutlined />}>
              内置指标不可编辑核心字段（仅支持启用/禁用）
            </Tag>
          )}
          {!editingMetric && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              新增指标默认 is_builtin=false（用户扩展）；P1 支持用户扩展指标覆盖或补充内置库。
            </Text>
          )}
        </Form>
      </Modal>
    </MainLayout>
  )
}
