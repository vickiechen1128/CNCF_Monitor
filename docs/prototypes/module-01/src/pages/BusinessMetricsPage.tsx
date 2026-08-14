import { useState, useMemo } from 'react'
import {
  Card,
  Table,
  Tag,
  Input,
  Select,
  Button,
  Modal,
  Form,
  Space,
  Typography,
  App,
  Alert,
  Tooltip,
  Badge,
} from 'antd'
import { PlusOutlined, EditOutlined, SendOutlined, CheckCircleOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { MainLayout } from '../layouts/MainLayout'
import {
  businessMetricStore,
  BIZ_METRIC_STATUS_MAP,
  BIZ_METRIC_STATUS_COLOR,
  BIZ_REGISTER_SOURCE_MAP,
  BIZ_DOMAINS,
  METRIC_TYPES,
  USER_ROLE_MAP,
  mockResources,
  mockScrapeJobs,
  type BusinessMetric,
  type BusinessMetricStatus,
  type BusinessMetricRegisterSource,
  type UserRole,
} from '../mocks/module-01'
import type { MetricType } from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

export default function BusinessMetricsPage() {
  const { message } = App.useApp()
  const [searchParams] = useSearchParams()
  // {v3.6} 动线分离：业务负责人 = 登记/更新 + 埋点标记；运维 = 只读语义 + 确认采集上线 + 代登记
  const role: UserRole = searchParams.get('role') === 'biz' ? 'biz_owner' : 'ops'
  const isBiz = role === 'biz_owner'
  const [metrics, setMetrics] = useState<BusinessMetric[]>(() => [...businessMetricStore])
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState<string | undefined>(undefined)
  const [statusFilter, setStatusFilter] = useState<BusinessMetricStatus | undefined>(undefined)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BusinessMetric | null>(null)
  const [form] = Form.useForm()

  const syncStore = (next: BusinessMetric[]) => {
    businessMetricStore.splice(0, businessMetricStore.length, ...next)
    setMetrics(next)
  }

  // {v3.7} 采集落地关联（语义层 → 采集层可见性）：业务指标 app_name → 关联采集 Job 名
  // （app_name 匹配 Resource.app_name → ScrapeJob.selected_instance_ids，模拟采集落地链路）
  const collectionJobByApp = useMemo(() => {
    const appToJob = new Map<string, string>()
    mockScrapeJobs.forEach((job) => {
      job.selected_instance_ids.forEach((rid) => {
        const res = mockResources.find((r) => r.resource_id === rid)
        if (res && res.app_name && !appToJob.has(res.app_name)) appToJob.set(res.app_name, job.job_name)
      })
    })
    return appToJob
  }, [])

  const filtered = metrics.filter((m) => {
    const kw = search.trim().toLowerCase()
    if (kw && !m.metric_name.toLowerCase().includes(kw) && !m.description.includes(kw)) return false
    if (domainFilter && m.business_domain !== domainFilter) return false
    if (statusFilter && m.status !== statusFilter) return false
    return true
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    // 登记来源：业务负责人自录 = self；运维代录 = agent（owner 仍指向业务负责人）
    form.setFieldsValue({ register_source: isBiz ? 'self' : 'agent' })
    setModalOpen(true)
  }

  const openEdit = (m: BusinessMetric) => {
    setEditing(m)
    form.setFieldsValue({ ...m })
    setModalOpen(true)
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
      if (editing) {
        const updated: BusinessMetric = {
          ...editing,
          ...values,
          // 语义编辑权：仅业务负责人或其委托可改（运维视角语义字段只读，见表单 disabled）
          updated_at: now,
        }
        syncStore(metrics.map((m) => (m.metric_id === editing.metric_id ? updated : m)))
        message.success('业务指标已更新')
      } else {
        const created: BusinessMetric = {
          metric_id: `biz-${Date.now()}`,
          metric_name: values.metric_name,
          description: values.description,
          metric_type: values.metric_type as MetricType,
          unit: values.unit,
          business_domain: values.business_domain as string,
          app_name: values.app_name,
          threshold_suggestion: values.threshold_suggestion,
          owner: values.owner as string,
          register_source: values.register_source as BusinessMetricRegisterSource,
          status: 'pending',
          created_at: now,
          updated_at: now,
        }
        syncStore([...metrics, created])
        message.success(
          isBiz ? '已登记业务指标（待业务侧埋点完成）' : '已代登记业务指标（owner 为业务负责人，建议请其确认语义）'
        )
      }
      setModalOpen(false)
      setEditing(null)
      form.resetFields()
    })
  }

  // 状态推进分工：pending→instrumented 业务侧（业务负责人标记埋点完成）；instrumented→online 运维（确认采集上线）
  const advanceStatus = (m: BusinessMetric, next: BusinessMetricStatus, label: string) => {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
    syncStore(metrics.map((x) => (x.metric_id === m.metric_id ? { ...x, status: next, updated_at: now } : x)))
    message.success(`${m.metric_name}：${label}`)
  }

  const columns = [
    { title: '指标名', dataIndex: 'metric_name', key: 'metric_name', render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: '指标语义', dataIndex: 'description', key: 'description', render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
    { title: '业务域', dataIndex: 'business_domain', key: 'business_domain', render: (v: string) => <Tag>{v}</Tag> },
    { title: '关联应用', dataIndex: 'app_name', key: 'app_name', render: (v?: string) => v || '-' },
    { title: '建议阈值', dataIndex: 'threshold_suggestion', key: 'threshold_suggestion', render: (v?: string) => v || '-' },
    {
      title: '业务负责人',
      dataIndex: 'owner',
      key: 'owner',
      render: (v: string) => (
        <Tooltip title="语义所有权责任人：语义 / 阈值仅其可改，不随录入者转移">
          <Space size={4}>{v}<InfoCircleOutlined style={{ color: '#86909C', fontSize: 12 }} /></Space>
        </Tooltip>
      ),
    },
    {
      title: '登记来源',
      dataIndex: 'register_source',
      key: 'register_source',
      render: (v: BusinessMetricRegisterSource) => (
        <Tag color={v === 'self' ? 'cyan' : 'default'}>{BIZ_REGISTER_SOURCE_MAP[v]}</Tag>
      ),
    },
    {
      title: '埋点状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: BusinessMetricStatus) => (
        <Badge status={BIZ_METRIC_STATUS_COLOR[v] as 'success' | 'processing' | 'warning'} text={BIZ_METRIC_STATUS_MAP[v]} />
      ),
    },
    {
      // {v3.7} 采集落地列：把「业务语义契约 → 采集落地」链路显性化（online 显示关联 Job，可跳查询中心查看）
      title: '采集落地',
      key: 'collection',
      render: (_: unknown, m: BusinessMetric) => {
        const jobName = m.app_name ? collectionJobByApp.get(m.app_name) : undefined
        if (m.status === 'online') {
          return (
            <Tooltip title={jobName ? `经采集 Job「${jobName}」抓取，指标可在查询中心检索` : '已确认采集上线，指标可查'}>
              <Badge status="success" text={<span>已上线{jobName ? ` · ${jobName}` : ''}</span>} />
            </Tooltip>
          )
        }
        if (m.status === 'instrumented') {
          return <Text type="secondary" style={{ fontSize: 12 }}>待运维确认采集上线</Text>
        }
        return <Text type="secondary" style={{ fontSize: 12 }}>待业务侧埋点</Text>
      },
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, m: BusinessMetric) => (
        <Space size={8}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(m)}>
            编辑
          </Button>
          {/* 状态推进分工：业务负责人推进 pending→instrumented；运维推进 instrumented→online */}
          {isBiz && m.status === 'pending' && (
            <Button
              type="link"
              size="small"
              icon={<SendOutlined />}
              style={{ color: '#FA8C16' }}
              onClick={() => advanceStatus(m, 'instrumented', '已标记埋点完成，等待运维确认采集上线')}
            >
              标记埋点完成
            </Button>
          )}
          {!isBiz && m.status === 'instrumented' && (
            <Button
              type="link"
              size="small"
              icon={<CheckCircleOutlined />}
              style={{ color: '#1481FD' }}
              onClick={() => advanceStatus(m, 'online', '已确认采集上线（指标可查）')}
            >
              确认采集已上线
            </Button>
          )}
          {!isBiz && m.status === 'pending' && (
            <Tooltip title="业务指标待埋点：业务侧完成代码埋点并标记后，运维可确认上线">
              <Tag style={{ cursor: 'help' }}>待业务侧埋点</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>业务指标库</Title>
        <Text type="secondary">
          {isBiz
            ? `业务负责人模式（${USER_ROLE_MAP[role]}）：登记 / 更新业务指标语义，标记埋点完成；不配置采集任务`
            : `运维工程师模式（${USER_ROLE_MAP[role]}）：可查看全部指标库并配置采集任务；业务指标语义只读，负责确认采集上线、可代办登记`}
        </Text>
      </div>

      {/* {v3.6} 动线分离说明（用户语言）；{v3.7} 业务视图已独立为「指标库 → 业务视图」页（BusinessViewPage），本页仅登记表 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={isBiz ? '在这里定义你的业务监控诉求' : '业务指标由业务负责人定义语义，运维只做采集落地'}
        description={
          isBiz
            ? '业务指标（如支付成功率）的语义只有业务侧清楚。登记后状态流转：待埋点（业务侧代码输出指标）→ 已埋点 → 已上线（运维确认采集落地，指标可查）。'
            : '业务指标库的语义字段（描述 / 阈值 / 负责人）由业务负责人维护；运维可查看全部指标、代办登记（owner 仍指向业务负责人），并负责确认采集上线（online）。'
        }
      />

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            placeholder="搜索指标名 / 语义"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Select placeholder="业务域" value={domainFilter} onChange={setDomainFilter} style={{ width: 140 }} allowClear>
            {BIZ_DOMAINS.map((d) => (
              <Option key={d} value={d}>{d}</Option>
            ))}
          </Select>
          <Select placeholder="埋点状态" value={statusFilter} onChange={setStatusFilter} style={{ width: 130 }} allowClear>
            {(Object.keys(BIZ_METRIC_STATUS_MAP) as BusinessMetricStatus[]).map((s) => (
              <Option key={s} value={s}>{BIZ_METRIC_STATUS_MAP[s]}</Option>
            ))}
          </Select>
          <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }} onClick={openCreate}>
            {isBiz ? '登记业务指标' : '代办登记业务指标'}
          </Button>
        </Space>
        <Table
          rowKey="metric_id"
          size="small"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      {/* 登记 / 编辑抽屉 */}
      <Modal
        title={editing ? `编辑业务指标（${editing.metric_name}）` : (isBiz ? '登记业务指标' : '代办登记业务指标')}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => {
          setModalOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        width={560}
        okText="保存"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="指标名" name="metric_name" rules={[{ required: true, message: '请输入指标名' }]} extra="业务埋点输出的 Prometheus 指标名，如 payment_success_rate">
            <Input placeholder="如 payment_success_rate" />
          </Form.Item>
          <Form.Item label="指标语义" name="description" rules={[{ required: true, message: '请输入指标语义' }]} extra="业务人话说明，如「支付成功率 = 支付成功笔数 / 支付总笔数」">
            <Input.TextArea rows={2} placeholder="说明指标含义与计算口径" disabled={!isBiz && !!editing} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item label="指标类型" name="metric_type" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select placeholder="请选择">
                {METRIC_TYPES.map((t) => (
                  <Option key={t} value={t}>{t}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="单位" name="unit" style={{ flex: 1 }}>
              <Input placeholder="如 % / 笔 / 元" />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item label="所属业务域" name="business_domain" rules={[{ required: true, message: '请选择业务域' }]} style={{ flex: 1 }}>
              <Select placeholder="如 payment">
                {BIZ_DOMAINS.map((d) => (
                  <Option key={d} value={d}>{d}</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="关联应用" name="app_name" style={{ flex: 1 }} extra="值 = 平台应用名（app_name）">
              <Input placeholder="如 pay-service" />
            </Form.Item>
          </Space>
          <Form.Item label="建议阈值" name="threshold_suggestion" extra="业务负责人建议的告警阈值，作为规则编辑的参考输入">
            <Input placeholder="如「成功率 ≥ 99.9%」" disabled={!isBiz && !!editing} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item label="业务负责人" name="owner" rules={[{ required: true, message: '请选择业务负责人' }]} style={{ flex: 1 }} extra="语义所有权责任人（必填，不随录入者转移）">
              <Select placeholder="请选择业务负责人">
                <Option value="王经理（支付）">王经理（支付）</Option>
                <Option value="李经理（订单）">李经理（订单）</Option>
              </Select>
            </Form.Item>
            <Form.Item label="登记来源" name="register_source" style={{ flex: 1 }} extra={isBiz ? '业务负责人自录' : '运维代办（owner 仍指向业务负责人）'}>
              <Select disabled>
                <Option value="self">业务负责人自录</Option>
                <Option value="agent">运维代办</Option>
              </Select>
            </Form.Item>
          </Space>
          {!isBiz && editing && (
            <Alert type="warning" showIcon message="运维视角：语义字段（指标语义 / 建议阈值 / 负责人）只读——语义编辑权在业务负责人或其委托" />
          )}
        </Form>
      </Modal>
    </MainLayout>
  )
}
