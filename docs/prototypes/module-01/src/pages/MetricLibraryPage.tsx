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
import {
  mockMetricLibrary,
  mockExporterTemplates,
  METRIC_TYPES,
  METRIC_TYPE_COLOR,
  METRIC_TYPE_LABEL,
} from '../mocks/module-01'
import type { MetricLibraryItem, MetricType } from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

export default function MetricLibraryPage() {
  const { modal, message } = App.useApp()
  const [metrics, setMetrics] = useState<MetricLibraryItem[]>(() => [...mockMetricLibrary])
  const [search, setSearch] = useState('')
  const [metricTypeFilter, setMetricTypeFilter] = useState<MetricType | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingMetric, setEditingMetric] = useState<MetricLibraryItem | null>(null)
  const [form] = Form.useForm()

  // 仅展示有指标的 Exporter 分组（受搜索与 metric_type 筛选影响）
  const groupedData = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return mockExporterTemplates
      .map((tpl) => ({
        exporter: tpl,
        metrics: metrics
          .filter((m) => m.exporter_template_id === tpl.exporter_template_id)
          .filter((m) =>
            !metricTypeFilter ? true : m.metric_type === metricTypeFilter
          )
          .filter(
            (m) =>
              !keyword ||
              m.metric_name.toLowerCase().includes(keyword) ||
              m.help.toLowerCase().includes(keyword)
          ),
      }))
      .filter((group) => group.metrics.length > 0)
  }, [metrics, search, metricTypeFilter])

  const handleOpenModal = (record?: MetricLibraryItem) => {
    if (record) {
      setEditingMetric(record)
      form.setFieldsValue({
        metric_name: record.metric_name,
        metric_type: record.metric_type,
        help: record.help,
        unit: record.unit ?? '',
        labels: record.labels.join(','),
        exporter_template_id: record.exporter_template_id,
        enabled: record.enabled,
      })
    } else {
      setEditingMetric(null)
      form.resetFields()
      form.setFieldsValue({
        metric_type: 'gauge',
        enabled: true,
        labels: '',
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
      const payload = {
        metric_name: values.metric_name as string,
        metric_type: values.metric_type as MetricType,
        help: values.help as string,
        unit: (values.unit as string) || undefined,
        labels,
        exporter_template_id: values.exporter_template_id as string,
        enabled: values.enabled as boolean,
      }
      if (editingMetric) {
        const updated: MetricLibraryItem = {
          ...editingMetric,
          ...payload,
        }
        setMetrics((prev) =>
          prev.map((m) => (m.metric_id === editingMetric.metric_id ? updated : m))
        )
        message.success('指标已更新')
      } else {
        const newMetric: MetricLibraryItem = {
          metric_id: `m-${Date.now()}`,
          ...payload,
          is_builtin: false,
        }
        setMetrics((prev) => [...prev, newMetric])
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
        setMetrics((prev) => prev.filter((m) => m.metric_id !== record.metric_id))
        message.success('已删除')
      },
    })
  }

  const handleToggleEnabled = (record: MetricLibraryItem, checked: boolean) => {
    setMetrics((prev) =>
      prev.map((m) =>
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
        <Title level={4}>指标元数据</Title>
        <Text type="secondary">
          按 Exporter 模板分组查看指标库；P1 支持用户扩展指标（is_builtin=false），禁用指标不参与规则编辑提示
        </Text>
      </div>
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
            </Space>
          </Col>
          <Col>
            <Space>
              <DatabaseOutlined style={{ color: '#0ECDEB', fontSize: 18 }} />
              <Text type="secondary">
                共 {metrics.length} 个指标（内置 {metrics.filter((m) => m.is_builtin).length} /
                用户扩展 {metrics.filter((m) => !m.is_builtin).length}），{mockExporterTemplates.length} 个 Exporter 模板
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
              key={group.exporter.exporter_template_id}
              type="inner"
              title={
                <Space>
                  <Text strong>{group.exporter.name}</Text>
                  <Tag color="cyan">v{group.exporter.version}</Tag>
                  <Badge count={group.metrics.length} style={{ backgroundColor: '#0ECDEB' }} />
                </Space>
              }
              extra={<Text type="secondary">{group.exporter.description}</Text>}
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
          <Form.Item
            label="所属 Exporter 模板"
            name="exporter_template_id"
            rules={[{ required: true, message: '请选择 Exporter 模板' }]}
            extra="指标归属的 Exporter，规则编辑器按此过滤"
          >
            <Select placeholder="请选择" showSearch optionFilterProp="children">
              {mockExporterTemplates.map((t) => (
                <Option key={t.exporter_template_id} value={t.exporter_template_id}>
                  {t.name} v{t.version}
                </Option>
              ))}
            </Select>
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
