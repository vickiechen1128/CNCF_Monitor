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
  Alert,
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
      {/* {v1.2} 新类型接入引导闭环：与 Module_01 v3.4 决策 39 联动（CMDB 新类型映射后 → M01 配置 CI-Exporter 映射/标签模板） */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="映射后的下一步"
        description="CI 类型完成映射同步后，请前往「监控策略」模块（Module_01）为该 CI 类型配置 CI-Exporter 采集映射与标签模板（若尚未配置）——新类型出现 → 管理员映射 → 自动可采集的接入引导闭环。"
      />
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
