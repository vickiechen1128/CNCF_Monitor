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
  Transfer,
  Space,
  Typography,
  Row,
  Col,
  Badge,
  Descriptions,
} from 'antd'
import type { TransferItem } from 'antd/es/transfer'
import { PlusOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockScrapeJobs, mockExporterTemplates } from '../mocks/module-01'
import { mockResources, RESOURCE_TYPE_MAP } from '../mocks/module-01'
import type { ResourceType } from '../mocks/module-01'
import type { ScrapeJob, ExporterInstallStatus } from '../mocks/module-01'

const { Title, Text } = Typography
const { Option } = Select

const INSTALL_STATUS_MAP: Record<ExporterInstallStatus, { text: string; color: string }> = {
  pending: { text: '待安装', color: '#FA8C16' },
  installed: { text: '已安装', color: '#00B578' },
  not_installed: { text: '未安装', color: '#FF4C3A' },
  unregistered: { text: '未注册', color: '#86909C' },
}

export default function ScrapeJobsPage() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedJob, setSelectedJob] = useState<ScrapeJob | null>(null)
  const [targetKeys, setTargetKeys] = useState<string[]>([])
  const [form] = Form.useForm()

  const templateNameMap = useMemo(() => {
    const map = new Map<string, string>()
    mockExporterTemplates.forEach((t) => map.set(t.exporter_template_id, t.name))
    return map
  }, [])

  const resourceOptions = useMemo<TransferItem[]>(() => {
    if (!selectedJob) return []
    return mockResources
      .filter((r) => r.resource_type === selectedJob.resource_type)
      .map((r) => ({
        key: r.resource_id,
        title: `${r.instance_name} (${r.instance_ip})`,
        description: r.hostname,
      }))
  }, [selectedJob])

  const handleOpenDrawer = (record: ScrapeJob) => {
    setSelectedJob(record)
    setTargetKeys(record.selected_instance_ids)
    form.setFieldsValue({
      job_name: record.job_name,
      resource_type: record.resource_type,
      exporter_template_id: record.exporter_template_id,
      network_domain_id: record.network_domain_id,
      scrape_interval: record.scrape_interval,
      scrape_timeout: record.scrape_timeout,
      metrics_path: record.metrics_path,
      scheme: record.scheme,
      instance_selection_mode: record.instance_selection_mode,
      enabled: record.enabled,
    })
    setDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setDrawerOpen(false)
    setSelectedJob(null)
    setTargetKeys([])
  }

  const handleSave = () => {
    form.validateFields().then(() => {
      handleCloseDrawer()
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
      title: '资源类型',
      dataIndex: 'resource_type',
      key: 'resource_type',
      render: (value: ResourceType) => <Tag color="blue">{RESOURCE_TYPE_MAP[value]}</Tag>,
    },
    {
      title: 'Exporter 模板',
      dataIndex: 'exporter_template_id',
      key: 'exporter_template_id',
      render: (value: string) => <Tag color="cyan">{templateNameMap.get(value) ?? value}</Tag>,
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (value: string) => <Tag>{value}</Tag>,
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
      render: (value: boolean) => <Switch checked={value} size="small" />,
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: ScrapeJob) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} onClick={() => handleOpenDrawer(record)}>
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
        <Title level={4}>采集 Job</Title>
        <Text type="secondary">管理 Prometheus 采集任务与实例选择策略</Text>
      </div>
      <Card className="page-card">
        <Row gutter={[16, 16]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }}>
              新增 Job
            </Button>
          </Col>
          <Col>
            <Text type="secondary">共 {mockScrapeJobs.length} 个采集任务</Text>
          </Col>
        </Row>

        <Table
          rowKey="job_id"
          dataSource={mockScrapeJobs}
          columns={columns}
          pagination={{ pageSize: 5 }}
        />
      </Card>

      <Drawer
        title="采集 Job 详情"
        width={720}
        open={drawerOpen}
        onClose={handleCloseDrawer}
        extra={
          <Space>
            <Button onClick={handleCloseDrawer}>取消</Button>
            <Button type="primary" style={{ backgroundColor: '#0ECDEB' }} onClick={handleSave}>
              保存
            </Button>
          </Space>
        }
      >
        {selectedJob && (
          <>
            <Descriptions title="基本信息" bordered size="small" column={2} style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Job 名称">{selectedJob.job_name}</Descriptions.Item>
              <Descriptions.Item label="资源类型">
                {RESOURCE_TYPE_MAP[selectedJob.resource_type]}
              </Descriptions.Item>
              <Descriptions.Item label="Exporter">
                {templateNameMap.get(selectedJob.exporter_template_id)}
              </Descriptions.Item>
              <Descriptions.Item label="网域">{selectedJob.network_domain_id}</Descriptions.Item>
              <Descriptions.Item label="采集间隔">{selectedJob.scrape_interval}</Descriptions.Item>
              <Descriptions.Item label="采集超时">{selectedJob.scrape_timeout}</Descriptions.Item>
            </Descriptions>

            <Title level={5}>实例选择</Title>
            <Form form={form} layout="vertical">
              <Form.Item name="instance_selection_mode" label="选择模式">
                <Select style={{ width: 200 }}>
                  <Option value="manual">手动选择</Option>
                  <Option value="filter">过滤规则</Option>
                </Select>
              </Form.Item>
            </Form>

            <Transfer
              dataSource={resourceOptions}
              titles={['可选实例', '已选实例']}
              targetKeys={targetKeys}
              onChange={(nextTargetKeys) => setTargetKeys(nextTargetKeys as string[])}
              render={(item) => String(item.title)}
              listStyle={{ width: 280, height: 320 }}
              style={{ marginBottom: 24 }}
            />

            <Title level={5} style={{ marginTop: 24 }}>
              Exporter 安装确认
            </Title>
            <Space direction="vertical" style={{ width: '100%' }}>
              {selectedJob.selected_instance_ids.map((id) => {
                const resource = mockResources.find((r) => r.resource_id === id)
                const status = selectedJob.exporter_status[id] ?? 'unregistered'
                return (
                  <Card key={id} size="small" bodyStyle={{ padding: 12 }}>
                    <Row align="middle" justify="space-between">
                      <Col>
                        <Text strong>{resource?.instance_name ?? id}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {resource?.instance_ip}
                          </Text>
                        </div>
                      </Col>
                      <Col>
                        <Badge
                          color={INSTALL_STATUS_MAP[status].color}
                          text={INSTALL_STATUS_MAP[status].text}
                        />
                      </Col>
                    </Row>
                  </Card>
                )
              })}
            </Space>
          </>
        )}
      </Drawer>
    </MainLayout>
  )
}
