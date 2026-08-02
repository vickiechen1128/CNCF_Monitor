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
  Badge,
} from 'antd'
import { PlusOutlined, EditOutlined, PlayCircleOutlined, CodeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockMonitoringRules } from '../mocks/module-01'
import { RESOURCE_TYPE_MAP } from '../mocks/module-01'
import type { ResourceType } from '../mocks/module-01'
import type { MonitoringRule } from '../mocks/module-01'

const { Title, Text } = Typography
const { TextArea } = Input
const { Option } = Select
const { TabPane } = Tabs

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']

export default function RulesPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<MonitoringRule | null>(null)
  const [validating, setValidating] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(false)
  const [form] = Form.useForm()

  const alertingRules = useMemo(
    () => mockMonitoringRules.filter((r) => r.rule_type === 'alerting'),
    []
  )
  const recordingRules = useMemo(
    () => mockMonitoringRules.filter((r) => r.rule_type === 'recording'),
    []
  )

  const handleOpenModal = (record?: MonitoringRule) => {
    setPreviewVisible(false)
    setValidating(false)
    if (record) {
      setEditingRule(record)
      form.setFieldsValue({
        ...record,
        labelsJson: JSON.stringify(record.labels, null, 2),
        annotationsJson: JSON.stringify(record.annotations, null, 2),
      })
    } else {
      setEditingRule(null)
      form.resetFields()
      form.setFieldsValue({
        rule_type: 'alerting',
        resource_type: 'host',
        enabled: true,
        duration: '5m',
        labelsJson: '{}',
        annotationsJson: '{}',
      })
    }
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingRule(null)
    setPreviewVisible(false)
    setValidating(false)
  }

  const handleValidate = () => {
    setValidating(true)
    setTimeout(() => setValidating(false), 800)
  }

  const handlePreview = () => {
    setPreviewVisible(true)
  }

  const handleSave = () => {
    form.validateFields().then(() => {
      handleCloseModal()
    })
  }

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      render: (value: string, record: MonitoringRule) => (
        <Space>
          <Text strong>{value}</Text>
          <Tag color={record.rule_type === 'alerting' ? '#FF4C3A' : '#1481FD'}>
            {record.rule_type === 'alerting' ? '告警' : '记录'}
          </Tag>
        </Space>
      ),
    },
    {
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: ResourceType) => <Tag color="blue">{RESOURCE_TYPE_MAP[value]}</Tag>,
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
      render: (value: string) => value || '-',
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (value: boolean) =>
        value ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: MonitoringRule) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
          编辑
        </Button>
      ),
    },
  ]

  const renderTable = (data: MonitoringRule[]) => (
    <Table
      rowKey="rule_id"
      dataSource={data}
      columns={columns}
      pagination={{ pageSize: 5 }}
    />
  )

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>规则编辑</Title>
        <Text type="secondary">管理告警规则与记录规则</Text>
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
              新增规则
            </Button>
          </Col>
          <Col>
            <Space size="large">
              <Statistic title="告警规则" value={alertingRules.length} valueStyle={{ color: '#FF4C3A' }} />
              <Statistic title="记录规则" value={recordingRules.length} valueStyle={{ color: '#1481FD' }} />
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
        onOk={handleSave}
        okButtonProps={{ style: { backgroundColor: '#0ECDEB' } }}
        width={720}
        footer={
          <Space>
            <Button onClick={handleCloseModal}>取消</Button>
            <Button icon={<CodeOutlined />} onClick={handlePreview}>
              指标预览
            </Button>
            <Button icon={<PlayCircleOutlined />} loading={validating} onClick={handleValidate}>
              校验
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
                label="资源类型"
                name="resource_type"
                rules={[{ required: true, message: '请选择资源类型' }]}
              >
                <Select placeholder="请选择">
                  {RESOURCE_TYPES.map((type) => (
                    <Option key={type} value={type}>
                      {RESOURCE_TYPE_MAP[type]}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="持续时间 (for)" name="duration">
                <Input placeholder="5m" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="PromQL 表达式"
            name="expr"
            rules={[{ required: true, message: '请输入表达式' }]}
          >
            <TextArea rows={4} placeholder="输入 PromQL 表达式" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Labels (JSON)" name="labelsJson">
                <TextArea rows={4} placeholder='{"severity": "warning"}' />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Annotations (JSON)" name="annotationsJson">
                <TextArea rows={4} placeholder='{"summary": "..."}' />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          {validating && (
            <Alert
              message="语法校验通过（演示）"
              description="表达式结构正确，未发现明显语法错误。"
              type="success"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {previewVisible && (
            <Alert
              message="指标预览（演示数据）"
              description={
                <div>
                  <div>node_cpu_seconds_total{'{cpu="0",mode="idle",instance="prod-web-01:9100"}'} = 823456.78</div>
                  <div>node_cpu_seconds_total{'{cpu="1",mode="idle",instance="prod-web-01:9100"}'} = 823123.45</div>
                </div>
              }
              type="info"
              showIcon
            />
          )}
        </Form>
      </Modal>
    </MainLayout>
  )
}
