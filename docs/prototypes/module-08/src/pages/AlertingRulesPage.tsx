import { useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  type AlertingRule,
  type AlertScope,
  type AlertSeverity,
  mockAlertingRules,
} from '../mocks/module-08'

const { TextArea } = Input
const { Option } = Select
const { Title } = Typography

const severityColors: Record<AlertSeverity, string> = {
  critical: '#FF4C3A',
  warning: '#FA8C16',
  info: '#1481FD',
}

const severityLabels: Record<AlertSeverity, string> = {
  critical: '严重',
  warning: '警告',
  info: '提示',
}

const scopeColors: Record<AlertScope, string> = {
  central: '#1481FD',
  edge: '#0ECDEB',
  both: '#7B61FF',
}

const scopeLabels: Record<AlertScope, string> = {
  central: '中心',
  edge: '边缘',
  both: '全域',
}

function formatJson(value: Record<string, string>): string {
  return JSON.stringify(value, null, 2)
}

function parseJson(value: string): Record<string, string> {
  return value.trim() === '' ? {} : JSON.parse(value)
}

export default function AlertingRulesPage() {
  const [rules, setRules] = useState<AlertingRule[]>(mockAlertingRules)
  const [editing, setEditing] = useState<AlertingRule | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()

  const columns = [
      {
        title: '告警名称',
        dataIndex: 'alert_name',
        key: 'alert_name',
      },
      {
        title: '表达式',
        dataIndex: 'expr',
        key: 'expr',
        ellipsis: true,
      },
      {
        title: '持续时间',
        dataIndex: 'duration',
        key: 'duration',
      },
      {
        title: '严重级别',
        dataIndex: 'severity',
        key: 'severity',
        render: (severity: AlertSeverity) => (
          <Tag color={severityColors[severity]}>{severityLabels[severity]}</Tag>
        ),
      },
      {
        title: '作用域',
        dataIndex: 'scope',
        key: 'scope',
        render: (scope: AlertScope) => (
          <Tag color={scopeColors[scope]}>{scopeLabels[scope]}</Tag>
        ),
      },
      {
        title: '可抑制',
        dataIndex: 'inhibitable',
        key: 'inhibitable',
        render: (inhibitable: boolean) => (
          <Tag color={inhibitable ? '#E6F9F2' : '#F2F3F5'} style={{ color: inhibitable ? '#00B578' : '#86909C' }}>
            {inhibitable ? '是' : '否'}
          </Tag>
        ),
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        key: 'enabled',
        render: (_enabled: boolean, record: AlertingRule) => (
          <Switch
            checked={record.enabled}
            onChange={(checked) => {
              setRules((prev) =>
                prev.map((r) => (r.id === record.id ? { ...r, enabled: checked } : r))
              )
            }}
          />
        ),
      },
      {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: AlertingRule) => (
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

  function openEditor(record: AlertingRule) {
    setEditing(record)
    form.setFieldsValue({
      ...record,
      labels: formatJson(record.labels),
      annotations: formatJson(record.annotations),
    })
    setIsModalOpen(true)
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        let labels: Record<string, string>
        let annotations: Record<string, string>
        try {
          labels = parseJson(values.labels as string)
          annotations = parseJson(values.annotations as string)
        } catch {
          message.error('Labels 或 Annotations JSON 格式不正确')
          return
        }
        if (!editing) return
        const updated: AlertingRule = {
          ...editing,
          expr: values.expr as string,
          duration: values.duration as string,
          severity: values.severity as AlertSeverity,
          scope: values.scope as AlertScope,
          inhibitable: values.inhibitable as boolean,
          enabled: values.enabled as boolean,
          labels,
          annotations,
        }
        setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
        setIsModalOpen(false)
        message.success('告警规则已更新')
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>告警规则</Title>
      </div>
      <Card className="page-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />}>
              新建规则
            </Button>
          </Space>
          <Table
            rowKey="id"
            dataSource={rules}
            columns={columns}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      </Card>
      <Modal
        title="编辑告警规则"
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="alert_name" label="告警名称">
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="expr"
            label="PromQL 表达式"
            rules={[{ required: true, message: '请输入表达式' }]}
          >
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="duration"
            label="持续时间"
            rules={[{ required: true, message: '请输入持续时间' }]}
          >
            <Input placeholder="例如 5m" />
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="severity"
              label="严重级别"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select>
                <Option value="critical">严重</Option>
                <Option value="warning">警告</Option>
                <Option value="info">提示</Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="scope"
              label="作用域"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select>
                <Option value="central">中心</Option>
                <Option value="edge">边缘</Option>
                <Option value="both">全域</Option>
              </Select>
            </Form.Item>
          </Space>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="inhibitable"
              label="可抑制"
              valuePropName="checked"
              style={{ flex: 1 }}
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="enabled"
              label="启用"
              valuePropName="checked"
              style={{ flex: 1 }}
            >
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item
            name="labels"
            label="Labels (JSON)"
            rules={[{ required: true, message: '请输入 Labels' }]}
          >
            <TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="annotations"
            label="Annotations (JSON)"
            rules={[{ required: true, message: '请输入 Annotations' }]}
          >
            <TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
