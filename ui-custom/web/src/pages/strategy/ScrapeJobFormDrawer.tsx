import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Drawer,
  Form,
  Input,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { networkDomainApi } from '../../api/domain'
import { ciExporterMappingApi } from '../../api/ciExporterMappings'
import { scrapeJobApi, type ScrapeJobInput } from '../../api/scrapeJobs'
import type { NetworkDomain } from '../../types/domain'
import type { AuthType, BlackboxTarget, BlackboxTargetProtocol, MonitorType } from '../../types/strategy'
import type { ScrapeJob } from '../../types/strategy'
import { SCRAPE_PARAM_FIELDS, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP, CATEGORY_MAP } from './strategyConstants'
import { InstanceSelector } from './InstanceSelector'
import { ExporterInstallationPanel } from './ExporterInstallationPanel'

const BLACKBOX_MODULES = ['http_2xx', 'icmp_ping', 'tcp_connect', 'dns_query']
const BLACKBOX_PROTOCOLS: { value: BlackboxTargetProtocol; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'tcp', label: 'TCP' },
  { value: 'icmp', label: 'ICMP' },
  { value: 'dns', label: 'DNS' },
]

/** 参数继承来源 Tag（§5.4 参数同步）：inherited 灰 / overridden 蓝 / pending 橙 */
function ParamsSyncTag({ state }: { state: 'inherited' | 'overridden' | 'pending' | 'none' }) {
  if (state === 'inherited') return <Tag>继承映射</Tag>
  if (state === 'overridden') return <Tag color="blue">已覆盖</Tag>
  if (state === 'pending') return <Tag color="orange">待同步</Tag>
  return null
}

interface ScrapeJobFormDrawerProps {
  open: boolean
  /** 编辑态传行 record；新增态为 null */
  record?: ScrapeJob | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 采集 Job 编辑抽屉（Module_01 §3.1/§5.4/§9.1/§11.1/§11.2，F4）。
 * - monitor_type 两级级联带出默认采集器与参数（可覆盖）；默认采集器「使用默认/手填」二选一；
 * - 网域下拉=已纳管非冻结；job_type standard/blackbox 切换（blackbox 隐藏 mon/exp，显黑盒目标）；
 * - 认证TLS折叠面板（auth_type 三选一 + basic→user/pass 掩码、bearer→token、TLS 区）；
 * - 标签模板卡（映射自动继承）；标准 Job 内嵌实例选择器与安装确认面板。
 */
export function ScrapeJobFormDrawer({ open, record, onCancel, onSuccess }: ScrapeJobFormDrawerProps) {
  const [form] = Form.useForm<ScrapeJobInput>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [collectorMode, setCollectorMode] = useState<'default' | 'manual'>('default')
  const [paramsState, setParamsState] = useState<'inherited' | 'overridden' | 'pending' | 'none'>('none')
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  const isEdit = !!record
  const jobType = Form.useWatch('job_type', form) ?? 'standard'
  const monitorType = Form.useWatch('monitor_type', form) as MonitorType | undefined
  const networkDomainId = (Form.useWatch('network_domain_id', form) as string | undefined) ?? ''
  const authType = (Form.useWatch('auth_type', form) as AuthType | undefined) ?? 'none'

  // 打开抽屉时装载网域与初始值
  useEffect(() => {
    if (!open) return
    // 异步请求回调内 setState；沿用本模块既有 set-state-in-effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    networkDomainApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setDomains((res.data?.list ?? []).filter((d) => d.is_monitored && d.status === 'enabled')))
      .catch(() => setDomains([]))
    form.resetFields()
    if (record) {
      setSelectedIds(record.selected_instance_ids ?? [])
      form.setFieldsValue({
        job_name: record.job_name,
        job_type: record.job_type,
        monitor_type: (record.monitor_type || undefined) as MonitorType | undefined,
        exporter_template_id: record.exporter_template_id,
        network_domain_id: record.network_domain_id,
        scrape_interval: record.scrape_interval,
        scrape_timeout: record.scrape_timeout,
        metrics_path: record.metrics_path,
        scheme: record.scheme,
        label_template_id: record.label_template_id,
        auth_type: record.auth_type,
        username: record.username,
        // 认证密文仅存储不回显（决策31）：编辑回填 token/password 一律置空，仅保留 auth 类型选择与密文占位说明
        token: undefined,
        tls_skip_verify: record.tls_skip_verify,
        ca_file: record.ca_file,
        blackbox_module: record.blackbox_module,
        blackbox_targets: record.blackbox_targets,
        password: undefined,
      })
      setParamsState((record.mapping_overrides?.length ?? 0) > 0 ? 'pending' : 'none')
    } else {
      setSelectedIds([])
      form.setFieldsValue({ job_type: 'standard', auth_type: 'none', tls_skip_verify: false, exporter_template_id: undefined, label_template_id: undefined } as Partial<ScrapeJobInput>)
    }
  }, [open, record, form])

  // monitor_type 变化 → 带出默认采集器与参数（可覆盖）
  const handleMonitorTypeChange = useCallback(
    async (next: MonitorType | undefined) => {
      setParamsState('none')
      if (!next) return
      try {
        const res = await ciExporterMappingApi.list({ monitor_type: next as string, is_default: true, page: 1, page_size: 20 })
        const def = res.data?.list?.[0]
        if (def) {
          form.setFieldsValue({
            exporter_template_id: def.exporter_template_id as string,
            scrape_interval: def.scrape_interval,
            scrape_timeout: def.scrape_timeout,
            metrics_path: def.metrics_path,
            scheme: def.scheme,
            label_template_id: def.label_template_id,
          })
          setParamsState('inherited')
        }
      } catch {
        // 无默认映射时保持空，用户可手填
      }
    },
    [form],
  )

  const handleSubmit = async () => {
    let values: ScrapeJobInput
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body: ScrapeJobInput = {
        job_name: values.job_name,
        job_type: values.job_type ?? 'standard',
        network_domain_id: values.network_domain_id!,
        scrape_interval: values.scrape_interval,
        scrape_timeout: values.scrape_timeout,
        metrics_path: values.metrics_path,
        scheme: values.scheme,
        auth_type: values.auth_type ?? 'none',
        username: values.username,
        password: values.password,
        token: values.token,
        tls_skip_verify: values.tls_skip_verify ?? false,
        ca_file: values.ca_file,
        label_template_id: values.label_template_id,
        enabled: true,
      }
      if (values.job_type === 'blackbox') {
        body.blackbox_module = values.blackbox_module
        body.blackbox_targets = values.blackbox_targets?.filter((t): t is BlackboxTarget => !!t && !!t.target)
      } else {
        body.monitor_type = values.monitor_type
        body.exporter_template_id = values.exporter_template_id
        body.selected_instance_ids = selectedIds
      }
      if (isEdit && record) {
        await scrapeJobApi.update(record.id, body)
      } else {
        await scrapeJobApi.create(body)
      }
      message.success('变更将由 M09 生成变更单并下发')
      setSubmitting(false)
      onSuccess()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? `编辑采集任务 ${record?.job_name ?? ''}` : '新增采集任务'}
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={640}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="primary" loading={submitting} disabled={submitting} onClick={() => void handleSubmit()}>
            保存
          </Button>
        </Space>
      }
    >
      {submitError && (
        <Alert type="error" showIcon message="保存失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      <Form
        form={form}
        layout="vertical"
        requiredMark
        preserve={false}
        initialValues={{ job_type: 'standard', auth_type: 'none', tls_skip_verify: false }}
      >
        <Row gutter={16}>
          <Col span={14}>
            <Form.Item label="Job 名称" name="job_name" rules={[{ required: true, message: '请输入 Job 名称' }]}>
              <Input placeholder="例如：prod-mysql-01" maxLength={64} />
            </Form.Item>
          </Col>
          <Col span={10}>
            <Form.Item label="任务类型" name="job_type" rules={[{ required: true }]}>
              <Radio.Group buttonStyle="solid">
                <Radio.Button value="standard">采集</Radio.Button>
                <Radio.Button value="blackbox">拨测</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Col>
        </Row>

        {jobType === 'standard' ? (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="监控对象类型" name="monitor_type" rules={[{ required: true, message: '请选择监控对象类型' }]}>
                  <Select placeholder="按资源类别 → 细粒度选择" onChange={(v) => void handleMonitorTypeChange(v as MonitorType | undefined)}>
                    {MONITOR_TYPE_CASCADE.map((g) => (
                      <Select.OptGroup label={CATEGORY_MAP[g.category]} key={g.category}>
                        {g.types.map((t) => (
                          <Select.Option key={t} value={t}>
                            {MONITOR_TYPE_MAP[t] ?? t}
                          </Select.Option>
                        ))}
                      </Select.OptGroup>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="网域" name="network_domain_id" rules={[{ required: true, message: '请选择网域' }]}>
                  <Select showSearch optionFilterProp="label" placeholder="仅已纳管非冻结网域" disabled={isEdit}>
                    {domains.map((d) => (
                      <Select.Option key={d.id} value={d.id} label={d.name}>
                        {d.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Card size="small" title="采集器与参数同步" style={{ marginBottom: 12 }}>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Space align="center">
                  <Radio.Group value={collectorMode} onChange={(e) => setCollectorMode(e.target.value)} size="small" optionType="button" buttonStyle="solid">
                    <Radio.Button value="default">使用默认</Radio.Button>
                    <Radio.Button value="manual">手填</Radio.Button>
                  </Radio.Group>
                  <ParamsSyncTag state={paramsState} />
                </Space>
                {collectorMode === 'manual' ? (
                  <Form.Item name="exporter_template_id" noStyle rules={[{ required: true, message: '请输入采集器模板 ID' }]}>
                    <Input placeholder="采集器模板 ID（手填）" maxLength={64} />
                  </Form.Item>
                ) : (
                  <Form.Item name="exporter_template_id" noStyle>
                    <Input disabled placeholder="默认采集器（切换监控类型自动带出）" />
                  </Form.Item>
                )}
                <Row gutter={12}>
                  {SCRAPE_PARAM_FIELDS.map((f) => (
                    <Col span={12} key={f.field}>
                      <Form.Item name={f.field as never} label={f.label} rules={[{ required: true, message: `请输入${f.label}` }]}>
                        <Input placeholder={f.field === 'metrics_path' ? '/metrics' : f.field === 'scheme' ? 'http' : undefined} maxLength={64} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
              </Space>
            </Card>

            <Form.Item label="标签模板" name="label_template_id" extra="M07 只读引用；更换请在采集器默认配置中维护">
              <Input placeholder="标签模板 ID（可选，映射自动继承）" maxLength={64} />
            </Form.Item>

            <Collapse ghost>
              <Collapse.Panel header="认证与 TLS" key="auth">
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label="认证类型" name="auth_type" rules={[{ required: true }]}>
                      <Select>
                        <Select.Option value="none">无</Select.Option>
                        <Select.Option value="basic">用户名密码</Select.Option>
                        <Select.Option value="bearer">Bearer Token</Select.Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  {authType !== 'none' && (
                    <Col span={16}>
                      {authType === 'basic' ? (
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                              <Input placeholder="用户名" maxLength={64} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                              <Input.Password placeholder="密文仅存储，不回显" maxLength={128} />
                            </Form.Item>
                          </Col>
                        </Row>
                      ) : (
                        <Form.Item name="token" label="Token" rules={[{ required: true, message: '请输入 Token' }]}>
                          <Input.Password placeholder="密文仅存储，不回显" maxLength={256} />
                        </Form.Item>
                      )}
                    </Col>
                  )}
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="跳过 TLS 校验" name="tls_skip_verify">
                      <Radio.Group size="small">
                        <Radio.Button value={false as never}>否</Radio.Button>
                        <Radio.Button value={true as never}>是</Radio.Button>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="ca_file" label="CA 证书路径">
                      <Input placeholder="可选" maxLength={256} />
                    </Form.Item>
                  </Col>
                </Row>
              </Collapse.Panel>
            </Collapse>

            <Card size="small" title="选择实例" style={{ marginBottom: 12 }}>
              <InstanceSelector monitorType={monitorType} networkDomainId={networkDomainId} selectedIds={selectedIds} onChange={setSelectedIds} />
            </Card>
            {isEdit && <ExporterInstallationPanel jobId={record!.id} />}
          </>
        ) : (
          <>
            <Form.Item label="拨测模块" name="blackbox_module" rules={[{ required: true, message: '请选择拨测模块' }]}>
              <Select placeholder="选择拨测模块">
                {BLACKBOX_MODULES.map((m) => (
                  <Select.Option key={m} value={m}>
                    {m}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="拨测目标" required>
              <Form.List name="blackbox_targets">
                {(fields, { add, remove }) => (
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    {fields.map((field) => (
                      <Space key={field.key} align="baseline" wrap>
                        <Form.Item name={[field.name, 'protocol']} noStyle rules={[{ required: true, message: '协议必填' }]}>
                          <Select placeholder="协议" style={{ width: 110 }}>
                            {BLACKBOX_PROTOCOLS.map((p) => (
                              <Select.Option key={p.value} value={p.value}>
                                {p.label}
                              </Select.Option>
                            ))}
                          </Select>
                        </Form.Item>
                        <Form.Item name={[field.name, 'target']} noStyle rules={[{ required: true, message: '目标必填' }]}>
                          <Input placeholder="目标地址" style={{ width: 200 }} maxLength={128} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'url']} noStyle>
                          <Input placeholder="URL（可选）" style={{ width: 180 }} maxLength={512} />
                        </Form.Item>
                        <Button type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      </Space>
                    ))}
                    <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ protocol: 'http' })}>
                      添加拨测目标
                    </Button>
                  </Space>
                )}
              </Form.List>
            </Form.Item>
            <Form.Item label="网域" name="network_domain_id" rules={[{ required: true, message: '请选择网域' }]}>
              <Select showSearch optionFilterProp="label" placeholder="仅已纳管非冻结网域" disabled={isEdit}>
                {domains.map((d) => (
                  <Select.Option key={d.id} value={d.id} label={d.name}>
                    {d.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </>
        )}
      </Form>
    </Drawer>
  )
}

export default ScrapeJobFormDrawer