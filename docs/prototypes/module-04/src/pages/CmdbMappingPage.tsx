import { useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Alert,
  Switch,
  message,
  Tooltip,
} from 'antd'
import { PlusOutlined, EditOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  mockCiTypeMappings,
  RESOURCE_CATEGORY_LABELS,
  SUB_TYPE_LABELS,
  SUB_TYPES_BY_CATEGORY,
  deriveMonitorType,
  type CiTypeMapping,
  type ResourceCategory,
  type SubType,
} from '../mocks/module-04'

const { Title, Text } = Typography
const { Option } = Select

export function CmdbMappingPage() {
  const [mappings, setMappings] = useState<CiTypeMapping[]>(mockCiTypeMappings)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<CiTypeMapping | null>(null)
  const [form] = Form.useForm()

  const watchCategory = Form.useWatch('category', form) as ResourceCategory | undefined
  const watchSubType = Form.useWatch('subType', form) as SubType | undefined
  // {v1.4} 第三列只读推导（决策 D24）：监控对象类型 = 类别 + 子类型 经推导表实时计算，不可编辑
  const derivedMonitorType =
    watchCategory || watchSubType ? deriveMonitorType(watchCategory ?? 'generic_target', watchSubType) : undefined

  const showAdd = () => {
    setEditing(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const showEdit = (record: CiTypeMapping) => {
    setEditing(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleSave = (values: Omit<CiTypeMapping, 'id' | 'enabled'>) => {
    if (editing) {
      setMappings((prev) => prev.map((m) => (m.id === editing.id ? { ...m, ...values } : m)))
      message.success('映射已更新')
    } else {
      const created: CiTypeMapping = {
        ...values,
        id: `ctm-${String(mappings.length + 1).padStart(3, '0')}`,
        enabled: true,
      }
      setMappings((prev) => [...prev, created])
      message.success(`已为 CI 类型「${values.ciType}」指派资源类别与子类型`)
    }
    setIsModalOpen(false)
  }

  const toggleEnabled = (record: CiTypeMapping, checked: boolean) => {
    setMappings((prev) => prev.map((m) => (m.id === record.id ? { ...m, enabled: checked } : m)))
    message.info(checked ? `已启用映射：${record.ciType}` : `已禁用映射：${record.ciType}（同步时进入待分类队列）`)
  }

  const columns = [
    {
      title: (
        <Tooltip title="CMDB 权威来源（bk_obj_id），监控平台只读；「CI 类型」仅在本模块与 CMDB 上下文使用">
          CI 类型（bk_obj_id）
        </Tooltip>
      ),
      dataIndex: 'ciType',
      key: 'ciType',
      render: (v: string) => <Text code>{v}</Text>,
    },
    {
      title: '资源类别 + 子类型',
      key: 'category',
      render: (_: unknown, record: CiTypeMapping) => (
        <Space size={4}>
          <Tag color="blue">{RESOURCE_CATEGORY_LABELS[record.category]}</Tag>
          {record.subType && <Tag>{SUB_TYPE_LABELS[record.subType]}</Tag>}
        </Space>
      ),
    },
    {
      title: (
        <Tooltip title="由资源类别 + 子类型经推导表实时计算，只读不可编辑（决策 D24）">
          <Space size={4}>
            监控对象类型
            <Text type="secondary" style={{ fontSize: 11 }}>(只读推导)</Text>
          </Space>
        </Tooltip>
      ),
      key: 'monitorType',
      render: (_: unknown, record: CiTypeMapping) => (
        <Space size={4}>
          <ArrowRightOutlined style={{ fontSize: 11, color: '#86909C' }} />
          <Tag color="cyan">{deriveMonitorType(record.category, record.subType)}</Tag>
        </Space>
      ),
    },
    {
      title: '默认启用',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled: boolean, record: CiTypeMapping) => (
        <Switch size="small" checked={enabled} onChange={(checked) => toggleEnabled(record, checked)} />
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: CiTypeMapping) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => showEdit(record)}>
          配置
        </Button>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>CMDB CI 类型映射</Title>
      </div>
      {/* {v1.4} 三列完整推导链（决策 D24）："我配的是前两列，监控对象类型是自动推出来的" */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="三列推导链"
        description="① CI 类型（bk_obj_id）是 CMDB 的权威来源、只读；② 资源类别 + 子类型由管理员指派（新增产品线只配一行映射、不改 CMDB 模型）；③ 监控对象类型由推导表实时计算、只读不可编辑——它只存在于监控平台内部、不回写 CMDB。"
      />
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增映射
          </Button>
        }
      >
        <Table rowKey="id" dataSource={mappings} columns={columns} pagination={{ pageSize: 8 }} />
      </Card>
      <Modal
        title={editing ? '配置映射' : '新增映射（为 CI 类型指派资源类别与子类型）'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="CI 类型（bk_obj_id）"
            name="ciType"
            rules={[{ required: true, message: '请输入 CI 类型' }]}
            extra="CMDB 权威来源，如 mysql / redis / dm8（达梦）/ kafka；类型是 CMDB 的，本平台只配映射"
          >
            <Input placeholder="例如 dm8" disabled={!!editing} />
          </Form.Item>
          <Form.Item
            label="资源类别"
            name="category"
            rules={[{ required: true, message: '请选择资源类别' }]}
            extra="数据库产品线（mysql/redis/dm8…）→ 数据库；消息/网关/搜索（kafka/nginx/es…）→ 中间件"
          >
            <Select placeholder="请选择" onChange={() => form.setFieldsValue({ subType: undefined })}>
              {(Object.keys(RESOURCE_CATEGORY_LABELS) as ResourceCategory[]).map((cat) => (
                <Option key={cat} value={cat}>
                  {RESOURCE_CATEGORY_LABELS[cat]}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="子类型" name="subType">
            <Select placeholder="可选（类别内细粒度子类型）" allowClear>
              {(watchCategory ? SUB_TYPES_BY_CATEGORY[watchCategory] : []).map((st) => (
                <Option key={st} value={st}>
                  {SUB_TYPE_LABELS[st]}
                </Option>
              ))}
            </Select>
          </Form.Item>
          {/* {v1.4} 第三列只读推导展示（决策 D24） */}
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
