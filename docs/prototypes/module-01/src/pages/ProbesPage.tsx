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
  Badge,
  App,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  GlobalOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockProbes, mockNetworkDomains } from '../mocks/module-01'
import type { BlackboxProbe, ProbeProtocol } from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const PROTOCOL_COLOR: Record<ProbeProtocol, string> = {
  http: '#00B578',
  https: '#1481FD',
  tcp: '#FA8C16',
  icmp: '#0ECDEB',
  dns: '#722ED1',
}

const MODULE_OPTIONS = ['http_2xx', 'http_post_2xx', 'tcp_connect', 'icmp_ping', 'dns_query']

const PROTOCOL_OPTIONS: ProbeProtocol[] = ['http', 'https', 'tcp', 'icmp', 'dns']

const PROTOCOL_LABEL: Record<ProbeProtocol, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  tcp: 'TCP',
  icmp: 'ICMP',
  dns: 'DNS',
}

export default function ProbesPage() {
  const { modal, message } = App.useApp()
  const [probes, setProbes] = useState<BlackboxProbe[]>(() => [...mockProbes])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProbe, setEditingProbe] = useState<BlackboxProbe | null>(null)
  const [form] = Form.useForm()

  const domainNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockNetworkDomains.forEach((d) => map.set(d.id, d.name))
    return map
  }, [])

  const handleOpenModal = (record?: BlackboxProbe) => {
    if (record) {
      setEditingProbe(record)
      form.setFieldsValue({ ...record })
    } else {
      setEditingProbe(null)
      form.resetFields()
      form.setFieldsValue({
        protocol: 'http',
        module: 'http_2xx',
        interval: '30s',
        timeout: '10s',
        network_domain_id: 'default',
        enabled: true,
      })
    }
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingProbe(null)
  }

  const handleSave = () => {
    form.validateFields().then((values) => {
      const payload = {
        target: values.target as string,
        protocol: values.protocol as ProbeProtocol,
        module: values.module as string,
        url: (values.url as string) || undefined,
        network_domain_id: values.network_domain_id as string,
        interval: values.interval as string,
        timeout: values.timeout as string,
        enabled: values.enabled as boolean,
      }
      if (editingProbe) {
        const updated: BlackboxProbe = {
          ...editingProbe,
          ...payload,
        }
        setProbes((prev) =>
          prev.map((p) => (p.probe_id === editingProbe.probe_id ? updated : p))
        )
        message.success('拨测目标已更新')
      } else {
        const newProbe: BlackboxProbe = {
          probe_id: `probe-${Date.now()}`,
          ...payload,
        }
        setProbes((prev) => [...prev, newProbe])
        message.success('拨测目标已新增')
      }
      handleCloseModal()
    })
  }

  const handleDelete = (record: BlackboxProbe) => {
    modal.confirm({
      title: '确认删除',
      content: `确定删除拨测目标「${record.target}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setProbes((prev) => prev.filter((p) => p.probe_id !== record.probe_id))
        message.success('已删除')
      },
    })
  }

  const handleToggleEnabled = (record: BlackboxProbe, checked: boolean) => {
    setProbes((prev) =>
      prev.map((p) =>
        p.probe_id === record.probe_id ? { ...p, enabled: checked } : p
      )
    )
    message.success(checked ? '已启用' : '已禁用')
  }

  const columns = [
    {
      title: '探测目标',
      dataIndex: 'target',
      key: 'target',
      render: (value: string, record: BlackboxProbe) => (
        <Space>
          <GlobalOutlined style={{ color: PROTOCOL_COLOR[record.protocol] }} />
          <Text strong>{value}</Text>
        </Space>
      ),
    },
    {
      title: '协议',
      dataIndex: 'protocol',
      key: 'protocol',
      render: (value: ProbeProtocol) => (
        <Tag color={PROTOCOL_COLOR[value]}>{PROTOCOL_LABEL[value]}</Tag>
      ),
    },
    {
      title: '模块',
      dataIndex: 'module',
      key: 'module',
      render: (value: string) => <Tag color="purple">{value}</Tag>,
    },
    {
      title: '归属网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag>{domainNameMap.get(value) ?? value}</Tag>,
    },
    {
      title: 'URL / 地址',
      dataIndex: 'url',
      key: 'url',
      render: (value?: string) => value || '-',
    },
    {
      title: '探测参数',
      key: 'params',
      render: (_: unknown, record: BlackboxProbe) => (
        <Space>
          <Text type="secondary">间隔 {record.interval}</Text>
          <Text type="secondary">超时 {record.timeout}</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean, record: BlackboxProbe) => (
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
      render: (_: unknown, record: BlackboxProbe) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
            编辑
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>拨测配置</Title>
        <Text type="secondary">
          管理 Blackbox Exporter 探测目标与模块；网域由 Module_09 管理，拨测结果展示由 Module_02 负责
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
              新增探测
            </Button>
          </Col>
          <Col>
            <Space>
              <Badge status="success" />
              <Text type="secondary">
                共 {probes.length} 个拨测目标，启用 {probes.filter((p) => p.enabled).length} 个
              </Text>
            </Space>
          </Col>
        </Row>

        <Table
          rowKey="probe_id"
          dataSource={probes}
          columns={columns}
          pagination={{ pageSize: 6 }}
        />
      </Card>

      <Modal
        title={editingProbe ? '编辑拨测目标' : '新增拨测目标'}
        open={modalOpen}
        onCancel={handleCloseModal}
        onOk={handleSave}
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={560}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="探测目标"
                name="target"
                rules={[{ required: true, message: '请输入探测目标' }]}
                extra="如 api.example.com / 10.0.1.11"
              >
                <Input placeholder="如 api.example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="协议"
                name="protocol"
                rules={[{ required: true, message: '请选择协议' }]}
              >
                <Select placeholder="请选择">
                  {PROTOCOL_OPTIONS.map((p) => (
                    <Option key={p} value={p}>
                      {PROTOCOL_LABEL[p]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="模块"
                name="module"
                rules={[{ required: true, message: '请选择模块' }]}
                extra="对应 blackbox_exporter 的 module 配置"
              >
                <Select placeholder="请选择">
                  {MODULE_OPTIONS.map((m) => (
                    <Option key={m} value={m}>
                      {m}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="归属网域"
                name="network_domain_id"
                rules={[{ required: true, message: '请选择网域' }]}
                extra="拨测目标归属网域，网域由 Module_09 管理"
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
          <Form.Item label="URL" name="url" extra="完整 URL（HTTP/HTTPS 模块可选）">
            <Input placeholder="完整 URL（可选）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="探测间隔"
                name="interval"
                rules={[{ required: true, message: '请输入探测间隔' }]}
              >
                <Select>
                  <Option value="15s">15s</Option>
                  <Option value="30s">30s</Option>
                  <Option value="60s">60s</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="超时"
                name="timeout"
                rules={[{ required: true, message: '请输入超时' }]}
              >
                <Select>
                  <Option value="5s">5s</Option>
                  <Option value="10s">10s</Option>
                  <Option value="30s">30s</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
