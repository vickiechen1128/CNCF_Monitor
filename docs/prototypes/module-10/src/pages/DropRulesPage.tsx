import { useCallback, useMemo, useState } from 'react'
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
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  type DropAction,
  type DropRuleType,
  type MetricDropRule,
  type MonitoringSource,
  mockDropRules,
  mockMonitoringSources,
} from '../mocks/module-10'

const { Option } = Select
const { Title } = Typography

const ruleTypeColors: Record<DropRuleType, string> = {
  metric_name: '#1481FD',
  metric_prefix: '#0ECDEB',
  label_match: '#FA8C16',
  cardinality_limit: '#7B61FF',
}

const ruleTypeLabels: Record<DropRuleType, string> = {
  metric_name: '指标名',
  metric_prefix: '指标前缀',
  label_match: '标签匹配',
  cardinality_limit: '基数上限',
}

const actionColors: Record<DropAction, string> = {
  keep: '#00B578',
  drop: '#FF4C3A',
  sample: '#FA8C16',
}

const actionLabels: Record<DropAction, string> = {
  keep: '保留',
  drop: '丢弃',
  sample: '采样',
}

export default function DropRulesPage() {
  const [sources] = useState<MonitoringSource[]>(mockMonitoringSources)
  const [dropRules, setDropRules] = useState<MetricDropRule[]>(mockDropRules)
  const [editing, setEditing] = useState<MetricDropRule | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()

  const sourceMap = useMemo(() => {
    const map = new Map<string, MonitoringSource>()
    sources.forEach((s) => map.set(s.id, s))
    return map
  }, [sources])

  const openEditor = useCallback((record: MetricDropRule) => {
    setEditing(record)
    form.setFieldsValue({
      ...record,
      sample_ratio: record.sample_ratio ?? 1,
    })
    setIsModalOpen(true)
  }, [form])

  const columns = [
      {
        title: '监控源',
        key: 'source',
        render: (_: unknown, record: MetricDropRule) =>
          sourceMap.get(record.source_id)?.name || record.source_id,
      },
      {
        title: '规则类型',
        dataIndex: 'rule_type',
        key: 'rule_type',
        render: (type: DropRuleType) => (
          <Tag color={ruleTypeColors[type]}>{ruleTypeLabels[type]}</Tag>
        ),
      },
      {
        title: '匹配值',
        dataIndex: 'match_value',
        key: 'match_value',
        ellipsis: true,
      },
      {
        title: '动作',
        dataIndex: 'action',
        key: 'action',
        render: (action: DropAction) => (
          <Tag color={actionColors[action]}>{actionLabels[action]}</Tag>
        ),
      },
      {
        title: '优先级',
        dataIndex: 'priority',
        key: 'priority',
      },
      {
        title: '启用',
        dataIndex: 'enabled',
        key: 'enabled',
        render: (_enabled: boolean, record: MetricDropRule) => (
          <Switch
            checked={record.enabled}
            onChange={(checked) => {
              setDropRules((prev) =>
                prev.map((r) => (r.id === record.id ? { ...r, enabled: checked } : r))
              )
            }}
          />
        ),
      },
      {
        title: '操作',
        key: 'action-col',
        render: (_: unknown, record: MetricDropRule) => (
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
    form.setFieldsValue({
      source_id: sources[0]?.id,
      rule_type: 'metric_name',
      match_value: '',
      action: 'drop',
      priority: 10,
      enabled: true,
      sample_ratio: 1,
    })
    setIsModalOpen(true)
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        const payload: MetricDropRule = {
          id: editing?.id || `dr-${Date.now()}`,
          source_id: values.source_id as string,
          rule_type: values.rule_type as DropRuleType,
          match_value: values.match_value as string,
          action: values.action as DropAction,
          priority: values.priority as number,
          enabled: values.enabled as boolean,
          sample_ratio:
            values.action === 'sample' ? (values.sample_ratio as number) : undefined,
        }
        if (editing) {
          setDropRules((prev) =>
            prev.map((r) => (r.id === payload.id ? payload : r))
          )
        } else {
          setDropRules((prev) => [...prev, payload])
        }
        setIsModalOpen(false)
        message.success(editing ? '丢弃规则已更新' : '丢弃规则已创建')
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>指标丢弃规则</Title>
      </div>
      <Card className="page-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
            新建丢弃规则
          </Button>
          <Table
            rowKey="id"
            dataSource={dropRules}
            columns={columns}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      </Card>
      <Modal
        title={editing ? '编辑丢弃规则' : '新建丢弃规则'}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="source_id"
            label="监控源"
            rules={[{ required: true, message: '请选择监控源' }]}
          >
            <Select placeholder="请选择">
              {sources.map((s) => (
                <Option key={s.id} value={s.id}>
                  {s.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="rule_type"
              label="规则类型"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select placeholder="请选择">
                <Option value="metric_name">指标名</Option>
                <Option value="metric_prefix">指标前缀</Option>
                <Option value="label_match">标签匹配</Option>
                <Option value="cardinality_limit">基数上限</Option>
              </Select>
            </Form.Item>
            <Form.Item
              name="action"
              label="动作"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <Select placeholder="请选择">
                <Option value="keep">保留</Option>
                <Option value="drop">丢弃</Option>
                <Option value="sample">采样</Option>
              </Select>
            </Form.Item>
          </Space>
          <Form.Item
            name="match_value"
            label="匹配值"
            rules={[{ required: true, message: '请输入匹配值' }]}
          >
            <Input placeholder="指标名、前缀、标签表达式或基数上限" />
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="priority"
              label="优先级"
              rules={[{ required: true }]}
              style={{ flex: 1 }}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
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
            noStyle
            shouldUpdate={(prev, curr) => prev.action !== curr.action}
          >
            {({ getFieldValue }) =>
              getFieldValue('action') === 'sample' ? (
                <Form.Item
                  name="sample_ratio"
                  label="采样比例"
                  rules={[{ required: true, message: '请输入采样比例' }]}
                >
                  <InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
