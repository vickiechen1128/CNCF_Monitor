import { useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Modal,
  Descriptions,
  message,
} from 'antd'
import { CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockPendingCIs,
  PENDING_REASON_COLORS,
  PENDING_REASON_LABELS,
  type PendingCI,
  type PendingReason,
} from '../mocks/module-04'

const { Title } = Typography

export function PendingCiPage() {
  const [pendingList, setPendingList] = useState<PendingCI[]>(mockPendingCIs)
  const [previewCi, setPreviewCi] = useState<PendingCI | null>(null)

  const handleMap = (record: PendingCI) => {
    setPendingList((prev) => prev.filter((item) => item.id !== record.id))
    message.success(`已映射 CI：${record.id}`)
  }

  const handleIgnore = (record: PendingCI) => {
    setPendingList((prev) => prev.filter((item) => item.id !== record.id))
    message.success(`已忽略 CI：${record.id}`)
  }

  const columns = [
    {
      title: 'CI ID',
      dataIndex: 'id',
      key: 'id',
    },
    {
      title: '来源 Provider',
      dataIndex: 'providerName',
      key: 'providerName',
    },
    {
      title: 'BlueKing 对象',
      dataIndex: 'bkObjId',
      key: 'bkObjId',
      render: (value: string | undefined) => value || '-',
    },
    {
      title: '目标资源类型',
      dataIndex: 'resourceType',
      key: 'resourceType',
      render: (value: string | undefined) => value ? <Tag color="blue">{value}</Tag> : '-',
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (reason: PendingReason) => (
        <Tag color={PENDING_REASON_COLORS[reason]}>{PENDING_REASON_LABELS[reason]}</Tag>
      ),
    },
    {
      title: '进入队列时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: PendingCI) => (
        <Space>
          <Button type="link" icon={<EyeOutlined />} onClick={() => setPreviewCi(record)}>
            预览
          </Button>
          <Button type="link" icon={<CheckOutlined />} onClick={() => handleMap(record)}>
            映射
          </Button>
          <Button type="link" danger icon={<CloseOutlined />} onClick={() => handleIgnore(record)}>
            忽略
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>待分类 CI</Title>
      </div>
      <Card className="page-card">
        <Table
          rowKey="id"
          dataSource={pendingList}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title="原始数据预览"
        open={Boolean(previewCi)}
        onCancel={() => setPreviewCi(null)}
        footer={null}
        width={640}
      >
        {previewCi && (
          <>
            <Descriptions bordered column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="CI ID">{previewCi.id}</Descriptions.Item>
              <Descriptions.Item label="Provider">{previewCi.providerName}</Descriptions.Item>
              <Descriptions.Item label="原因">
                <Tag color={PENDING_REASON_COLORS[previewCi.reason]}>
                  {PENDING_REASON_LABELS[previewCi.reason]}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
            <pre className="yaml-preview">{JSON.stringify(previewCi.rawData, null, 2)}</pre>
          </>
        )}
      </Modal>
    </MainLayout>
  )
}
