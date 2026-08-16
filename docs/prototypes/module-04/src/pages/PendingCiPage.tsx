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
  Form,
  Select,
  message,
  Alert,
} from 'antd'
import { CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockPendingCIs,
  PENDING_REASON_COLORS,
  PENDING_REASON_LABELS,
  RESOURCE_CATEGORY_LABELS,
  SUB_TYPE_LABELS,
  SUB_TYPES_BY_CATEGORY,
  deriveMonitorType,
  type PendingCI,
  type PendingReason,
  type ResourceCategory,
  type SubType,
} from '../mocks/module-04'

const { Title, Text } = Typography
const { Option } = Select

export function PendingCiPage() {
  const [pendingList, setPendingList] = useState<PendingCI[]>(mockPendingCIs)
  const [previewCi, setPreviewCi] = useState<PendingCI | null>(null)
  const [assignTarget, setAssignTarget] = useState<PendingCI | null>(null)
  const [assignForm] = Form.useForm()

  const watchAssignCategory = Form.useWatch('category', assignForm) as ResourceCategory | undefined
  const watchAssignSubType = Form.useWatch('subType', assignForm) as SubType | undefined
  const derivedMonitorType =
    watchAssignCategory || watchAssignSubType
      ? deriveMonitorType(watchAssignCategory ?? 'generic_target', watchAssignSubType)
      : undefined

  // {v1.4} 决策 D24：动作是「为 CI 类型指派资源类别与子类型」，不是「创建 CI 类型」
  const handleAssign = (record: PendingCI) => {
    assignForm.resetFields()
    setAssignTarget(record)
  }

  const submitAssign = () => {
    if (!assignTarget) return
    assignForm.validateFields().then((values: { category: ResourceCategory; subType?: SubType }) => {
      setPendingList((prev) => prev.filter((item) => item.id !== assignTarget.id))
      message.success(
        `已为 CI 类型「${assignTarget.bkObjId ?? assignTarget.id}」指派资源类别与子类型（${RESOURCE_CATEGORY_LABELS[values.category]}${values.subType ? ' + ' + SUB_TYPE_LABELS[values.subType] : ''}）；监控对象类型 ${derivedMonitorType} 由推导表自动算出`
      )
      setAssignTarget(null)
    })
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
      title: 'BlueKing 对象（bk_obj_id）',
      dataIndex: 'bkObjId',
      key: 'bkObjId',
      render: (value: string | undefined) => (value ? <Text code>{value}</Text> : '-'),
    },
    {
      title: '目标资源类别',
      dataIndex: 'resourceCategory',
      key: 'resourceCategory',
      render: (_: unknown, record: PendingCI) =>
        record.resourceCategory ? (
          <Space size={4}>
            <Tag color="blue">{RESOURCE_CATEGORY_LABELS[record.resourceCategory]}</Tag>
            {record.subType && <Tag>{SUB_TYPE_LABELS[record.subType]}</Tag>}
          </Space>
        ) : (
          <Text type="secondary">待指派</Text>
        ),
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
          <Button type="link" icon={<CheckOutlined />} onClick={() => handleAssign(record)}>
            指派
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
        <Title level={4}>待分类 CI 队列</Title>
      </div>
      {/* {v1.2} 新类型接入引导闭环；{v1.4} 措辞：为 CI 类型指派资源类别与子类型（决策 D24） */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="新类型接入闭环"
        description="队列里的动作是「为 CMDB 已有的 CI 类型指派资源类别与子类型」——类型是 CMDB 的，平台只配映射；监控对象类型由推导表自动算出。指派完成后请前往「监控策略」模块（Module_01）为该 CI 类型配置默认采集与标签模板（若尚未配置）。"
      />
      <Card className="page-card">
        <Table rowKey="id" dataSource={pendingList} columns={columns} pagination={{ pageSize: 8 }} />
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
      {/* {v1.4} 指派 Modal：为 CI 类型指派资源类别 + 子类型，监控对象类型只读推导（决策 D24） */}
      <Modal
        title={`指派资源类别与子类型 · CI 类型「${assignTarget?.bkObjId ?? assignTarget?.id ?? ''}」`}
        open={Boolean(assignTarget)}
        onCancel={() => setAssignTarget(null)}
        onOk={submitAssign}
        okText="指派"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="动作说明"
          description="类型是 CMDB 的（bk_obj_id 权威来源），本平台只配映射；新增数据库产品线（如达梦 dm8）目标类别选「数据库」即可，不改 CMDB 模型。"
        />
        <Form form={assignForm} layout="vertical">
          <Form.Item
            label="资源类别"
            name="category"
            rules={[{ required: true, message: '请选择资源类别' }]}
            extra="数据库产品线 → 数据库；消息/网关/搜索 → 中间件"
          >
            <Select placeholder="请选择" onChange={() => assignForm.setFieldsValue({ subType: undefined })}>
              {(Object.keys(RESOURCE_CATEGORY_LABELS) as ResourceCategory[]).map((cat) => (
                <Option key={cat} value={cat}>
                  {RESOURCE_CATEGORY_LABELS[cat]}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="子类型" name="subType">
            <Select placeholder="可选（类别内细粒度子类型）" allowClear>
              {(watchAssignCategory ? SUB_TYPES_BY_CATEGORY[watchAssignCategory] : []).map((st) => (
                <Option key={st} value={st}>
                  {SUB_TYPE_LABELS[st]}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="监控对象类型（只读推导）">
            {derivedMonitorType ? (
              <Tag color="cyan">{derivedMonitorType}</Tag>
            ) : (
              <Text type="secondary">选择资源类别 / 子类型后自动推导</Text>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
