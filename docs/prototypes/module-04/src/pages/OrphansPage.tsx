import { useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Popconfirm,
  message,
} from 'antd'
import {
  UndoOutlined,
  EditOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { mockOrphans, RESOURCE_CATEGORY_LABELS, type OrphanResource } from '../mocks/module-04'

const { Title, Text } = Typography

export function OrphansPage() {
  const [orphans, setOrphans] = useState<OrphanResource[]>(mockOrphans)

  const handleRestore = (record: OrphanResource) => {
    setOrphans((prev) => prev.filter((item) => item.id !== record.id))
    message.success(`已恢复资源：${record.instanceName}`)
  }

  const handleConvert = (record: OrphanResource) => {
    setOrphans((prev) => prev.filter((item) => item.id !== record.id))
    message.success(`已转为手动资源：${record.instanceName}`)
  }

  const handleDelete = (record: OrphanResource) => {
    setOrphans((prev) => prev.filter((item) => item.id !== record.id))
    message.success(`已删除资源：${record.instanceName}`)
  }

  const columns = [
    {
      title: '网域',
      dataIndex: 'networkDomainName',
      key: 'networkDomainName',
      render: (name: string) => <Tag color="blue">{name}</Tag>,
    },
    {
      // {v1.4} resource_type → resource_category（五大类，决策 D19/D24）
      title: '资源类别',
      dataIndex: 'resourceCategory',
      key: 'resourceCategory',
      render: (cat: string) => (
        <Tag color="blue">{RESOURCE_CATEGORY_LABELS[cat as keyof typeof RESOURCE_CATEGORY_LABELS] ?? cat}</Tag>
      ),
    },
    {
      title: '实例名称',
      dataIndex: 'instanceName',
      key: 'instanceName',
    },
    {
      title: 'IP',
      dataIndex: 'instanceIp',
      key: 'instanceIp',
      render: (ip: string | undefined) => ip || '-',
    },
    {
      title: '删除来源',
      dataIndex: 'deletedSource',
      key: 'deletedSource',
    },
    {
      title: '删除时间',
      dataIndex: 'deletedAt',
      key: 'deletedAt',
    },
    {
      title: '保留截止',
      dataIndex: 'retentionDeadline',
      key: 'retentionDeadline',
      render: (deadline: string) => (
        <Space>
          <ExclamationCircleOutlined style={{ color: '#FA8C16' }} />
          <Text>{deadline}</Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: OrphanResource) => (
        <Space>
          <Button type="link" icon={<UndoOutlined />} onClick={() => handleRestore(record)}>
            恢复
          </Button>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleConvert(record)}>
            转手动
          </Button>
          <Popconfirm
            title="确认删除？"
            description="删除后将无法恢复。"
            onConfirm={() => handleDelete(record)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>孤儿资源</Title>
      </div>
      <Card className="page-card">
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          已删除对象保留 7 天，超过保留期后自动转为孤儿资源。可按网域与资源类别分组处理。
        </Text>
        <Table
          rowKey="id"
          dataSource={orphans}
          columns={columns}
          pagination={{ pageSize: 8 }}
          rowClassName={() => 'orphan-row'}
        />
      </Card>
    </MainLayout>
  )
}
