import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Switch,
  Drawer,
  Form,
  Select,
  Input,
  Transfer,
  Space,
  Typography,
  Row,
  Col,
  Badge,
  Descriptions,
  Alert,
  App,
  Tooltip,
  Modal,
} from 'antd'
import type { TransferItem } from 'antd/es/transfer'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockScrapeJobs,
  mockExporterTemplates,
  mockResources,
  mockLabelTemplates,
  mockNetworkDomains,
  mockExporterInstallations,
  CI_TYPES,
  CI_TYPE_LABEL,
  CI_TYPE_CATEGORY_MAP,
  SCHEMES,
  ENV_VALUES,
  ENV_LABEL,
  INSTALL_STATUS_MAP,
  INSTALL_STATUS_CYCLE,
  NETWORK_DOMAIN_IDS,
} from '../mocks/module-01'
import type {
  CiType,
  Scheme,
  ScrapeJob,
  ExporterInstallStatus,
  ExporterInstallationConfirmation,
} from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const now = () => new Date().toISOString()

export default function ScrapeJobsPage() {
  const { modal, message } = App.useApp()
  const [jobs, setJobs] = useState<ScrapeJob[]>(() => [...mockScrapeJobs])
  const [installations, setInstallations] = useState<ExporterInstallationConfirmation[]>(() => [
    ...mockExporterInstallations,
  ])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<ScrapeJob | null>(null)
  const [targetKeys, setTargetKeys] = useState<string[]>([])
  const [filterDomain, setFilterDomain] = useState<string | undefined>(undefined)
  const [filterEnv, setFilterEnv] = useState<string | undefined>(undefined)
  const [confirmTarget, setConfirmTarget] = useState<ExporterInstallationConfirmation | null>(null)
  const [confirmForm] = Form.useForm()
  const [form] = Form.useForm()

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

  const domainNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockNetworkDomains.forEach((d) => map.set(d.id, d.name))
    return map
  }, [])

  const watchResourceType = Form.useWatch('resource_type', form)
  const watchMode = Form.useWatch('instance_selection_mode', form)

  // Transfer 数据源：按当前 resource_type + 网域/环境筛选
  const transferData = useMemo<TransferItem[]>(() => {
    const rt = watchResourceType as CiType | undefined
    if (!rt) return []
    return mockResources
      .filter((r) => r.resource_type === rt)
      .filter((r) => (filterDomain ? r.network_domain_id === filterDomain : true))
      .filter((r) => (filterEnv ? r.env === filterEnv : true))
      .map((r) => ({
        key: r.resource_id,
        title: `${r.instance_name} (${r.instance_ip})`,
        description: `${domainNameMap.get(r.network_domain_id) ?? r.network_domain_id} · ${ENV_LABEL[r.env]} · ${r.app_name}`,
      }))
  }, [watchResourceType, filterDomain, filterEnv, domainNameMap])

  const openCreate = () => {
    setEditingJob(null)
    form.resetFields()
    setTargetKeys([])
    setFilterDomain(undefined)
    setFilterEnv(undefined)
    form.setFieldsValue({
      instance_selection_mode: 'manual',
      scheme: 'http',
      scrape_interval: '15s',
      scrape_timeout: '10s',
      enabled: true,
    })
    setDrawerOpen(true)
  }

  const openEdit = (record: ScrapeJob) => {
    setEditingJob(record)
    form.setFieldsValue({
      job_name: record.job_name,
      resource_type: record.resource_type,
      exporter_template_id: record.exporter_template_id,
      network_domain_id: record.network_domain_id,
      instance_selection_mode: record.instance_selection_mode,
      scrape_interval: record.scrape_interval,
      scrape_timeout: record.scrape_timeout,
      metrics_path: record.metrics_path,
      scheme: record.scheme,
      label_template_id: record.label_template_id,
      enabled: record.enabled,
    })
    setTargetKeys([...record.selected_instance_ids])
    setFilterDomain(undefined)
    setFilterEnv(undefined)
    setDrawerOpen(true)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    setEditingJob(null)
    setTargetKeys([])
  }

  // 选择 Exporter 模板后自动填充采集参数
  const handleTemplateChange = (templateId: string) => {
    const tpl = templateMap.get(templateId)
    if (tpl) {
      form.setFieldsValue({
        metrics_path: tpl.metrics_path,
        scheme: tpl.scheme,
      })
    }
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      const exporterTemplateId = values.exporter_template_id as string
      // 同步安装状态冗余字段
      const exporterStatus: Record<string, ExporterInstallStatus> = {}
      targetKeys.forEach((id) => {
        const existing = installations.find(
          (c) => c.resource_id === id && c.exporter_template_id === exporterTemplateId
        )
        exporterStatus[id] = existing?.status ?? 'unregistered'
        // 为新选中的实例补建 pending 确认记录
        if (!existing) {
          const newConf: ExporterInstallationConfirmation = {
            id: `eic-${Date.now()}-${id}`,
            resource_id: id,
            exporter_template_id: exporterTemplateId,
            status: 'pending',
            confirmed_by: '',
            confirmed_at: '',
            notes: '',
          }
          setInstallations((prev) => [...prev, newConf])
        }
      })
      if (editingJob) {
        const updated: ScrapeJob = {
          ...editingJob,
          ...values,
          resource_type: values.resource_type as CiType,
          scheme: values.scheme as Scheme,
          selected_instance_ids: targetKeys,
          exporter_status: exporterStatus,
          updated_at: now(),
        }
        setJobs((prev) => prev.map((j) => (j.job_id === editingJob.job_id ? updated : j)))
        message.success('Job 已更新')
      } else {
        const newJob: ScrapeJob = {
          job_id: `job-${Date.now()}`,
          job_name: values.job_name as string,
          resource_type: values.resource_type as CiType,
          exporter_template_id: exporterTemplateId,
          network_domain_id: values.network_domain_id as string,
          instance_selection_mode: values.instance_selection_mode as 'manual' | 'filter',
          selected_instance_ids: targetKeys,
          instance_filter: null,
          scrape_interval: values.scrape_interval as string,
          scrape_timeout: values.scrape_timeout as string,
          metrics_path: values.metrics_path as string,
          scheme: values.scheme as Scheme,
          label_template_id: (values.label_template_id as string) || undefined,
          relabel_configs: [],
          enabled: values.enabled as boolean,
          exporter_status: exporterStatus,
          created_at: now(),
          updated_at: now(),
        }
        setJobs((prev) => [...prev, newJob])
        message.success('Job 已新增')
      }
      closeDrawer()
    })
  }

  const handleToggleEnabled = (record: ScrapeJob, checked: boolean) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.job_id === record.job_id ? { ...j, enabled: checked, updated_at: now() } : j
      )
    )
    message.success(checked ? '已启用' : '已禁用')
  }

  const handleDelete = (record: ScrapeJob) => {
    modal.confirm({
      title: '确认删除',
      content: `确定删除采集 Job「${record.job_name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setJobs((prev) => prev.filter((j) => j.job_id !== record.job_id))
        message.success('已删除')
      },
    })
  }

  // 点击 Badge 打开安装确认弹窗
  const openConfirm = (conf: ExporterInstallationConfirmation) => {
    setConfirmTarget(conf)
    confirmForm.setFieldsValue({
      status: conf.status,
      confirmed_by: conf.confirmed_by,
      notes: conf.notes,
    })
  }

  const cycleStatus = (status: ExporterInstallStatus): ExporterInstallStatus => {
    const idx = INSTALL_STATUS_CYCLE.indexOf(status)
    return INSTALL_STATUS_CYCLE[(idx + 1) % INSTALL_STATUS_CYCLE.length]
  }

  const handleConfirmSave = () => {
    confirmForm.validateFields().then((values) => {
      if (!confirmTarget) return
      const next: ExporterInstallationConfirmation = {
        ...confirmTarget,
        status: values.status as ExporterInstallStatus,
        confirmed_by: values.confirmed_by as string,
        confirmed_at: now(),
        notes: values.notes as string,
      }
      setInstallations((prev) => prev.map((c) => (c.id === confirmTarget.id ? next : c)))
      // 同步冗余 exporter_status
      setJobs((prev) =>
        prev.map((j) => {
          if (j.exporter_template_id !== confirmTarget.exporter_template_id) return j
          if (!j.selected_instance_ids.includes(confirmTarget.resource_id)) return j
          return {
            ...j,
            exporter_status: { ...j.exporter_status, [confirmTarget.resource_id]: next.status },
            updated_at: now(),
          }
        })
      )
      message.success('安装状态已确认')
      setConfirmTarget(null)
    })
  }

  const columns = [
    {
      title: 'Job 名称',
      dataIndex: 'job_name',
      key: 'job_name',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: 'CI 类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: CiType) => <Tag color="blue">{CI_TYPE_LABEL[value]}</Tag>,
    },
    {
      title: 'Exporter',
      dataIndex: 'exporter_template_id',
      key: 'exporter_template_id',
      render: (value: string) => <Tag color="cyan">{templateNameMap.get(value) ?? value}</Tag>,
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag>{domainNameMap.get(value) ?? value}</Tag>,
    },
    {
      title: '实例选择',
      dataIndex: 'instance_selection_mode',
      key: 'instance_selection_mode',
      render: (value: ScrapeJob['instance_selection_mode']) => (
        <Tag color={value === 'manual' ? 'purple' : 'geekblue'}>
          {value === 'manual' ? '手动' : '过滤'}
        </Tag>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean, record: ScrapeJob) => (
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
      render: (_: unknown, record: ScrapeJob) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button type="link" icon={<EyeOutlined />} onClick={() => openEdit(record)}>
            详情
          </Button>
          <Button type="link" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>采集 Job</Title>
        <Text type="secondary">
          管理 Prometheus 采集任务与实例选择策略；网域由 Module_09 管理，配置下发由 Module_09 负责
        </Text>
      </div>
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ backgroundColor: '#0ECDEB' }}
              onClick={openCreate}
            >
              新增 Job
            </Button>
          </Col>
          <Col>
            <Text type="secondary">共 {jobs.length} 个采集任务</Text>
          </Col>
        </Row>

        <Table rowKey="job_id" dataSource={jobs} columns={columns} pagination={{ pageSize: 5 }} />
      </Card>

      <Drawer
        title={editingJob ? '编辑采集 Job' : '新增采集 Job'}
        width={760}
        open={drawerOpen}
        onClose={closeDrawer}
        extra={
          <Space>
            <Button onClick={closeDrawer}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSave}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Job 名称"
                name="job_name"
                rules={[{ required: true, message: '请输入 Job 名称' }]}
              >
                <Input placeholder="如 prod-hosts" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="CI 类型"
                name="resource_type"
                rules={[{ required: true, message: '请选择 CI 类型' }]}
              >
                <Select
                  placeholder="请选择"
                  disabled={!!editingJob}
                  onChange={() => setTargetKeys([])}
                >
                  {CI_TYPES.map((type) => (
                    <Option key={type} value={type}>
                      {CI_TYPE_LABEL[type]}（{CI_TYPE_CATEGORY_MAP[type]}）
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
                extra="选择后自动填充采集参数"
              >
                <Select
                  placeholder="请选择"
                  onChange={(v) => handleTemplateChange(v as string)}
                  showSearch
                  optionFilterProp="children"
                >
                  {mockExporterTemplates
                    .filter((t) => t.supported_resource_types.length > 0)
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
                label="网域"
                name="network_domain_id"
                rules={[{ required: true, message: '请选择网域' }]}
                extra="网域由 Module_09 管理"
              >
                <Select placeholder="请选择">
                  {mockNetworkDomains.map((d) => (
                    <Option key={d.id} value={d.id}>
                      {d.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item label="选择模式" name="instance_selection_mode">
                <Select>
                  <Option value="manual">手动选择</Option>
                  <Option value="filter" disabled>
                    过滤规则（v0.3+）
                  </Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="采集间隔"
                name="scrape_interval"
                rules={[{ required: true, message: '请选择采集间隔' }]}
              >
                <Select>
                  <Option value="15s">15s</Option>
                  <Option value="30s">30s</Option>
                  <Option value="60s">60s</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="采集超时"
                name="scrape_timeout"
                rules={[{ required: true, message: '请选择采集超时' }]}
              >
                <Select>
                  <Option value="5s">5s</Option>
                  <Option value="10s">10s</Option>
                  <Option value="30s">30s</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="协议"
                name="scheme"
                rules={[{ required: true, message: '请选择协议' }]}
              >
                <Select>
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
            <Col span={8}>
              <Form.Item label="标签模板" name="label_template_id" extra="由 Module_07 维护">
                <Select placeholder="请选择" allowClear showSearch optionFilterProp="children">
                  {mockLabelTemplates.map((t) => (
                    <Option key={t.template_id} value={t.template_id}>
                      {t.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {watchMode === 'filter' && (
            <Alert
              type="info"
              showIcon
              message="v0.3+ 开放：按网域/环境/应用/标签筛选"
              description="instance_filter 字段在 v0.3+ 版本开放，支持动态条件筛选与预览匹配结果。"
              style={{ marginBottom: 16 }}
            />
          )}

          <Alert
            type="info"
            showIcon
            message="实例选择（MVP 仅手动勾选）"
            description="v0.3+ 将开放按网域/环境/应用/标签筛选（instance_filter）。当前可通过下方过滤器缩小手动勾选范围。"
            style={{ marginBottom: 12 }}
          />
        </Form>

        {watchResourceType && (
          <>
            <Row gutter={8} style={{ marginBottom: 8 }}>
              <Col span={12}>
                <Select
                  placeholder="按网域筛选"
                  allowClear
                  style={{ width: '100%' }}
                  value={filterDomain}
                  onChange={(v) => setFilterDomain(v)}
                >
                  {NETWORK_DOMAIN_IDS.map((d) => (
                    <Option key={d} value={d}>
                      {domainNameMap.get(d) ?? d}
                    </Option>
                  ))}
                </Select>
              </Col>
              <Col span={12}>
                <Select
                  placeholder="按环境筛选"
                  allowClear
                  style={{ width: '100%' }}
                  value={filterEnv}
                  onChange={(v) => setFilterEnv(v)}
                >
                  {ENV_VALUES.map((e) => (
                    <Option key={e} value={e}>
                      {ENV_LABEL[e]}
                    </Option>
                  ))}
                </Select>
              </Col>
            </Row>
            <Transfer
              dataSource={transferData}
              titles={['可选实例', '已选实例']}
              targetKeys={targetKeys}
              onChange={(next) => setTargetKeys(next as string[])}
              render={(item) => String(item.title)}
              listStyle={{ width: 300, height: 320 }}
              style={{ marginBottom: 24 }}
            />
          </>
        )}

        {editingJob && editingJob.selected_instance_ids.length > 0 && (
          <>
            <Title level={5}>Exporter 安装确认</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              点击状态徽标可修改安装状态并填写确认信息；未确认实例不生成 target
            </Text>
            <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
              {editingJob.selected_instance_ids.map((id) => {
                const resource = mockResources.find((r) => r.resource_id === id)
                const conf = installations.find(
                  (c) =>
                    c.resource_id === id &&
                    c.exporter_template_id === editingJob.exporter_template_id
                )
                const status = conf?.status ?? 'unregistered'
                const meta = INSTALL_STATUS_MAP[status]
                return (
                  <Card
                    key={id}
                    size="small"
                    bodyStyle={{ padding: 12 }}
                    hoverable
                    onClick={() =>
                      conf &&
                      openConfirm({
                        ...conf,
                        status: cycleStatus(status),
                      })
                    }
                  >
                    <Row align="middle" justify="space-between">
                      <Col>
                        <Text strong>{resource?.instance_name ?? id}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {resource?.instance_ip} · {resource ? ENV_LABEL[resource.env] : ''}
                          </Text>
                        </div>
                        {conf?.confirmed_by && (
                          <div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              确认人 {conf.confirmed_by} · {conf.notes || '无备注'}
                            </Text>
                          </div>
                        )}
                      </Col>
                      <Col>
                        <Tooltip title="点击切换状态并填写确认信息">
                          <Badge color={meta.color} text={meta.text} />
                        </Tooltip>
                      </Col>
                    </Row>
                  </Card>
                )
              })}
            </Space>
          </>
        )}

        <Alert
          type="warning"
          showIcon
          message="P2：高级 Relabel 管理"
          description="relabel_configs 字段为 P2 预留，将支持标签丢弃/保留/重写、正则替换、hashmod 等高级能力。"
          style={{ marginTop: 24 }}
        />
      </Drawer>

      <Modal
        title="Exporter 安装确认"
        open={!!confirmTarget}
        onCancel={() => setConfirmTarget(null)}
        onOk={handleConfirmSave}
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={480}
      >
        {confirmTarget && (
          <Form form={confirmForm} layout="vertical" style={{ marginTop: 16 }}>
            <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="资源">
                {mockResources.find((r) => r.resource_id === confirmTarget.resource_id)?.instance_name ?? confirmTarget.resource_id}
              </Descriptions.Item>
              <Descriptions.Item label="Exporter">
                {templateNameMap.get(confirmTarget.exporter_template_id)}
              </Descriptions.Item>
            </Descriptions>
            <Form.Item
              label="安装状态"
              name="status"
              rules={[{ required: true, message: '请选择状态' }]}
            >
              <Select>
                {INSTALL_STATUS_CYCLE.map((s) => (
                  <Option key={s} value={s}>
                    {INSTALL_STATUS_MAP[s].text}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              label="确认人"
              name="confirmed_by"
              rules={[{ required: true, message: '请输入确认人' }]}
            >
              <Input placeholder="如 alice" />
            </Form.Item>
            <Form.Item label="备注（工单号/安装记录）" name="notes">
              <Input.TextArea rows={2} placeholder="可选" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </MainLayout>
  )
}
