import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Tag,
  Badge,
  Drawer,
  Form,
  Input,
  Select,
  Upload,
  Space,
  Typography,
  Row,
  Col,
  Alert,
  Tabs,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  UploadOutlined,
  DownloadOutlined,
  EditOutlined,
  InfoCircleOutlined,
  LockOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockResources,
  mockResourceLabels,
  STATUS_MAP,
  RESOURCE_TYPE_MAP,
  SOURCE_TYPE_MAP,
} from '../mocks/module-07'
import type { Resource, ResourceType, ResourceLabel, LabelSource } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']

const STATUS_COLOR: Record<Resource['status'], string> = {
  online: '#00B578',
  offline: '#FF4C3A',
  maintenance: '#FA8C16',
}

const SOURCE_PRIORITY: Record<LabelSource, number> = {
  cmdb: 3,
  user: 2,
  system: 1,
}

export default function ResourcesPage() {
  const [activeType, setActiveType] = useState<ResourceType>('host')
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null)
  const [labels, setLabels] = useState<ResourceLabel[]>([])
  const [form] = Form.useForm()

  const filteredData = useMemo(() => {
    return mockResources.filter((item) => {
      const matchType = item.resource_type === activeType
      const keyword = search.trim().toLowerCase()
      const matchSearch =
        !keyword ||
        item.instance_name.toLowerCase().includes(keyword) ||
        item.hostname.toLowerCase().includes(keyword) ||
        item.instance_ip.includes(keyword) ||
        (item.app_name && item.app_name.toLowerCase().includes(keyword))
      return matchType && matchSearch
    })
  }, [activeType, search])

  const handleOpenDetail = (record: Resource) => {
    setSelectedResource(record)
    const list = mockResourceLabels[record.resource_id] || [
      {
        label_id: `system-${record.resource_id}`,
        resource_id: record.resource_id,
        label_key: 'instance',
        label_value: `${record.hostname}:9100`,
        source: 'system',
        is_editable: false,
      },
    ]
    setLabels(list.sort((a, b) => SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]))
    form.setFieldsValue({
      instance_name: record.instance_name,
      hostname: record.hostname,
      instance_ip: record.instance_ip,
      status: record.status,
      is_monitored: record.is_monitored,
    })
    setDrawerOpen(true)
  }

  const handleCloseDetail = () => {
    setDrawerOpen(false)
    setSelectedResource(null)
  }

  const handleLabelChange = (labelId: string, value: string) => {
    setLabels((prev) =>
      prev.map((item) => (item.label_id === labelId ? { ...item, label_value: value } : item))
    )
  }

  const columns = [
    {
      title: '实例名 / 主机名',
      dataIndex: 'instance_name',
      key: 'instance_name',
      render: (_: unknown, record: Resource) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.instance_name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.hostname}
          </Text>
        </Space>
      ),
    },
    {
      title: 'IP 地址',
      dataIndex: 'instance_ip',
      key: 'instance_ip',
    },
    {
      title: '应用 / 环境 / 集群',
      key: 'app_env_cluster',
      render: (_: unknown, record: Resource) => (
        <Space wrap>
          {record.app_name && <Tag>{record.app_name}</Tag>}
          {record.env && <Tag color="blue">{record.env}</Tag>}
          {record.cluster && <Tag color="purple">{record.cluster}</Tag>}
        </Space>
      ),
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag color="cyan">{value}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: Resource['status']) => (
        <Badge color={STATUS_COLOR[value]} text={STATUS_MAP[value]} />
      ),
    },
    {
      title: '监控',
      dataIndex: 'is_monitored',
      key: 'is_monitored',
      render: (value: boolean) =>
        value ? (
          <Badge status="processing" text="已监控" style={{ color: '#00B578' }} />
        ) : (
          <Badge status="default" text="未监控" />
        ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Resource) => (
        <Space>
          <Button type="link" icon={<InfoCircleOutlined />} onClick={() => handleOpenDetail(record)}>
            详情
          </Button>
          <Button type="link" icon={<EditOutlined />}>
            编辑
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>资源管理</Title>
        <Text type="secondary">管理主机、中间件、应用及通用监控对象</Text>
      </div>
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Space>
              <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }}>
                新增资源
              </Button>
              <Upload beforeUpload={() => false} showUploadList={false}>
                <Button icon={<UploadOutlined />}>Excel 导入</Button>
              </Upload>
              <Button icon={<DownloadOutlined />}>下载模板</Button>
            </Space>
          </Col>
          <Col>
            <Input.Search
              placeholder="搜索实例名 / IP / 应用"
              allowClear
              onSearch={(value) => setSearch(value)}
              style={{ width: 280 }}
            />
          </Col>
        </Row>

        <Tabs
          activeKey={activeType}
          onChange={(key) => setActiveType(key as ResourceType)}
          items={RESOURCE_TYPES.map((type) => ({
            key: type,
            label: `${RESOURCE_TYPE_MAP[type]} (${mockResources.filter((r) => r.resource_type === type).length})`,
          }))}
          style={{ marginBottom: 16 }}
        />

        <Table
          rowKey="resource_id"
          dataSource={filteredData}
          columns={columns}
          pagination={{ pageSize: 6 }}
          onRow={(record) => ({
            onClick: () => handleOpenDetail(record),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      <Drawer
        title="资源详情"
        width={640}
        open={drawerOpen}
        onClose={handleCloseDetail}
        extra={
          <Space>
            <Button onClick={handleCloseDetail}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleCloseDetail}>
              保存
            </Button>
          </Space>
        }
      >
        {selectedResource && (
          <>
            <Alert
              message={`来源：${SOURCE_TYPE_MAP[selectedResource.source_type]} | 类型：${RESOURCE_TYPE_MAP[selectedResource.resource_type]}`}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Form form={form} layout="vertical">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="实例名" name="instance_name">
                    <Input disabled />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="主机名" name="hostname">
                    <Input disabled />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="IP 地址" name="instance_ip">
                    <Input disabled />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="状态" name="status">
                    <Select disabled>
                      <Option value="online">在线</Option>
                      <Option value="offline">离线</Option>
                      <Option value="maintenance">维护中</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>
            </Form>

            <Title level={5} style={{ marginTop: 24 }}>
              标签管理
            </Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              冲突优先级：CMDB &gt; 用户 &gt; 系统。系统标签只读。
            </Text>
            <Space direction="vertical" style={{ width: '100%' }}>
              {labels.map((label) => (
                <Card
                  key={label.label_id}
                  size="small"
                  bodyStyle={{ padding: 12 }}
                  style={{
                    borderLeft: `4px solid ${
                      label.source === 'cmdb'
                        ? '#1481FD'
                        : label.source === 'user'
                          ? '#0ECDEB'
                          : '#86909C'
                    }`,
                  }}
                >
                  <Row gutter={16} align="middle">
                    <Col span={6}>
                      <Text strong>{label.label_key}</Text>
                      <div>
                        <Tag color={label.source === 'cmdb' ? 'blue' : label.source === 'user' ? 'cyan' : 'default'}>
                          {label.source}
                        </Tag>
                        {!label.is_editable && <LockOutlined style={{ color: '#86909C', marginLeft: 4 }} />}
                      </div>
                    </Col>
                    <Col span={18}>
                      <Input
                        value={label.label_value}
                        disabled={!label.is_editable}
                        onChange={(e) => handleLabelChange(label.label_id, e.target.value)}
                        suffix={
                          label.conflict_hint ? (
                            <Tooltip title={label.conflict_hint}>
                              <InfoCircleOutlined style={{ color: '#FA8C16' }} />
                            </Tooltip>
                          ) : null
                        }
                      />
                    </Col>
                  </Row>
                </Card>
              ))}
            </Space>
          </>
        )}
      </Drawer>
    </MainLayout>
  )
}
