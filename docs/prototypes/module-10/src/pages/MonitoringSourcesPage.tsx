import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { CopyOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { MainLayout } from '../layouts/MainLayout'
import {
  type AuthType,
  type IngestMethod,
  type MonitoringSource,
  type SourceStatus,
  type SourceType,
  mockIngestionStats,
  mockMonitoringSources,
} from '../mocks/module-10'

const { TextArea } = Input
const { Option } = Select
const { Title } = Typography

const sourceTypeColors: Record<SourceType, string> = {
  edge_agent: '#0ECDEB',
  external_prometheus: '#1481FD',
  zabbix: '#FA8C16',
  cloud_monitor: '#7B61FF',
  opentelemetry: '#00B578',
}

const sourceTypeLabels: Record<SourceType, string> = {
  edge_agent: 'Edge Agent',
  external_prometheus: '外部 Prometheus',
  zabbix: 'Zabbix',
  cloud_monitor: '云监控',
  opentelemetry: 'OpenTelemetry',
}

const statusColors: Record<SourceStatus, string> = {
  online: '#00B578',
  offline: '#86909C',
  pending: '#FA8C16',
  error: '#FF4C3A',
}

const statusLabels: Record<SourceStatus, string> = {
  online: '在线',
  offline: '离线',
  pending: '待接入',
  error: '异常',
}

interface SnippetFormValues {
  remote_write_url?: string
  auth_config?: string
}

function generateRemoteWriteSnippet(values: SnippetFormValues): string {
  const url = values.remote_write_url || 'https://gateway.metric-center.local/api/v2/ingest/prometheus/{source_id}'
  let auth = ''
  try {
    const cfg = JSON.parse(values.auth_config || '{}') as Record<string, unknown>
    if (typeof cfg.token === 'string') {
      auth = `\n  authorization:\n    type: Bearer\n    credentials: ${cfg.token}`
    }
  } catch {
    // 忽略解析失败
  }
  return `remote_write:
  - url: "${url}"${auth}
    queue_config:
      max_samples_per_send: 1000
      max_shards: 10`
}

export default function MonitoringSourcesPage() {
  const [sources, setSources] = useState<MonitoringSource[]>(mockMonitoringSources)
  const [editing, setEditing] = useState<MonitoringSource | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [snippetValues, setSnippetValues] = useState<SnippetFormValues>({})

  function openEditor(record: MonitoringSource) {
    setEditing(record)
    const initial = {
      ...record,
      auth_config: JSON.stringify(record.auth_config, null, 2),
      labels: JSON.stringify(record.labels, null, 2),
    }
    form.setFieldsValue(initial)
    setSnippetValues({
      remote_write_url: record.remote_write_url,
      auth_config: JSON.stringify(record.auth_config, null, 2),
    })
    setIsModalOpen(true)
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '类型',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (type: SourceType) => (
        <Tag color={sourceTypeColors[type]}>{sourceTypeLabels[type]}</Tag>
      ),
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: SourceStatus) => (
        <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>
      ),
    },
    {
      title: '接入端点',
      dataIndex: 'ingest_endpoint',
      key: 'ingest_endpoint',
      ellipsis: true,
    },
    {
      title: '最后心跳',
      key: 'lastHeartbeat',
      render: (_: unknown, record: MonitoringSource) => {
        const ts = mockIngestionStats[record.id]?.last_sample_timestamp
        return ts ? dayjs(ts).format('HH:mm:ss') : '-'
      },
    },
    {
      title: 'Samples/sec',
      key: 'samples',
      render: (_: unknown, record: MonitoringSource) =>
        mockIngestionStats[record.id]?.samples_per_second ?? 0,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: MonitoringSource) => (
        <Button
          type="text"
          icon={<EditOutlined />}
          onClick={() => openEditor(record)}
        >
          编辑
        </Button>
      ),
    },
  ]

  function handleOpenModal() {
    setEditing(null)
    form.resetFields()
    const empty = {
      source_type: 'edge_agent',
      status: 'pending',
      ingest_method: 'remote_write',
      auth_type: 'token',
      auth_config: '{}',
      labels: '{}',
      normalization_enabled: true,
      max_series_per_metric: 10000,
      remote_write_url: '',
    }
    form.setFieldsValue(empty)
    setSnippetValues({})
    setIsModalOpen(true)
  }

  function handleValuesChange(_changed: unknown, all: Record<string, unknown>) {
    setSnippetValues({
      remote_write_url: (all.remote_write_url as string) || '',
      auth_config: (all.auth_config as string) || '{}',
    })
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        let authConfig: Record<string, unknown>
        let labels: Record<string, string>
        try {
          authConfig = JSON.parse((values.auth_config as string) || '{}')
          labels = JSON.parse((values.labels as string) || '{}')
        } catch {
          message.error('Auth Config 或 Labels JSON 格式不正确')
          return
        }
        const payload: MonitoringSource = {
          id: editing?.id || `src-${Date.now()}`,
          name: values.name as string,
          source_type: values.source_type as SourceType,
          network_domain_id: values.network_domain_id as string,
          status: values.status as SourceStatus,
          ingest_method: values.ingest_method as IngestMethod,
          ingest_endpoint: values.ingest_endpoint as string,
          auth_type: values.auth_type as AuthType,
          auth_config: authConfig,
          remote_write_url: values.remote_write_url as string,
          labels,
          normalization_enabled: values.normalization_enabled as boolean,
          max_series_per_metric: values.max_series_per_metric as number,
          metric_drop_rules: editing?.metric_drop_rules ?? [],
        }
        if (editing) {
          setSources((prev) => prev.map((s) => (s.id === payload.id ? payload : s)))
        } else {
          setSources((prev) => [...prev, payload])
        }
        setIsModalOpen(false)
        message.success(editing ? '监控源已更新' : '监控源已创建')
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  function copySnippet() {
    const text = generateRemoteWriteSnippet(snippetValues)
    void navigator.clipboard.writeText(text).then(() => {
      message.success('配置片段已复制')
    })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>监控源登记册</Title>
      </div>
      <Card className="page-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
            新建监控源
          </Button>
          <Table
            rowKey="id"
            dataSource={sources}
            columns={columns}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      </Card>
      <Modal
        title={editing ? '编辑监控源' : '新建监控源'}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false} onValuesChange={handleValuesChange}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入监控源名称' }]}
          >
            <Input />
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="source_type"
              label="源类型"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select placeholder="请选择">
                <Option value="edge_agent">Edge Agent</Option>
                <Option value="external_prometheus">外部 Prometheus</Option>
                <Option value="zabbix">Zabbix</Option>
                <Option value="cloud_monitor">云监控</Option>
                <Option value="opentelemetry">OpenTelemetry</Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="network_domain_id"
              label="网域"
              rules={[{ required: true, message: '请输入网域' }]}
              style={{ flex: 1 }}
            >
              <Input />
            </Form.Item>
          </Space>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="status"
              label="状态"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select placeholder="请选择">
                <Option value="online">在线</Option>
                <Option value="offline">离线</Option>
                <Option value="pending">待接入</Option>
                <Option value="error">异常</Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="ingest_method"
              label="接入方式"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select placeholder="请选择">
                <Option value="remote_write">Remote Write</Option>
                <Option value="pull">Pull</Option>
                <Option value="opentelemetry">OpenTelemetry</Option>
                <Option value="zabbix_proxy">Zabbix Proxy</Option>
              </Select>
            </Form.Item>
          </Space>
          <Form.Item
            name="ingest_endpoint"
            label="接入端点"
            rules={[{ required: true, message: '请输入接入端点' }]}
          >
            <Input placeholder="例如 /api/v2/ingest/prometheus/{source_id}" />
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="auth_type"
              label="认证方式"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select placeholder="请选择">
                <Option value="token">Token</Option>
                <Option value="basic">Basic Auth</Option>
                <Option value="mtls">mTLS</Option>
                <Option value="none">无</Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="max_series_per_metric"
              label="单指标最大 Series"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="auth_config"
            label="认证配置 (JSON)"
            rules={[{ required: true, message: '请输入认证配置' }]}
          >
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="remote_write_url"
            label="Remote Write URL"
            rules={[{ required: true, message: '请输入 Remote Write URL' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="labels"
            label="Labels (JSON)"
            rules={[{ required: true, message: '请输入 Labels' }]}
          >
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="normalization_enabled"
            label="启用标签归一化"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item label="生成的 Remote Write 配置">
            <div className="yaml-preview">
              <pre style={{ margin: 0 }}>{generateRemoteWriteSnippet(snippetValues)}</pre>
            </div>
            <Button
              type="link"
              icon={<CopyOutlined />}
              onClick={copySnippet}
              style={{ paddingLeft: 0 }}
            >
              复制配置
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
