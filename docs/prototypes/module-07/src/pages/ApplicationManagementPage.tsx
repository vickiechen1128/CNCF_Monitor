import { useState } from 'react'
import {
  App,
  Badge,
  Button,
  Card,
  Descriptions,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { DownOutlined, ExclamationCircleFilled, InfoCircleFilled, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { Callout } from '../components/Callout'
import { ReviewNote } from '../components/ReviewNote'
import { TABLE_PAGINATION } from '../components/tablePresets'
import { APP_CODE_RE, mockApplicationDict } from '../mocks/module-07'
import type { AppDictEntry } from '../mocks/module-07'

const { Title, Text } = Typography

interface RegisterForm {
  app_code: string
  app_name: string
  description?: string
}

interface EditForm {
  app_name: string
  description?: string
  status: AppDictEntry['status']
}

/**
 * 应用字典管理页（PRD 5.19）
 * 列表 + 登记 + 受限编辑 + 停用；与业务管理页（5.18）同构的红线：
 * 应用编码创建后不可改、仅 应用名/描述/状态 可编辑、停用不删除（无删除入口）、
 * 应用名修改不触发监控配置重生成。
 */
export default function ApplicationManagementPage() {
  const { message, modal } = App.useApp()
  // 应用字典由本页维护（mock 演示字典落 DB、应用管理页维护）
  const [records, setRecords] = useState<AppDictEntry[]>(mockApplicationDict)

  // ---------- 登记 ----------
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerForm] = Form.useForm<RegisterForm>()

  // ---------- 编辑 ----------
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<AppDictEntry | null>(null)
  const [editForm] = Form.useForm<EditForm>()

  const openRegister = () => {
    registerForm.resetFields()
    setRegisterOpen(true)
  }

  const submitRegister = async () => {
    const values = await registerForm.validateFields()
    // 编码规范（小写字母/数字/连字符 ≤64）已由表单检验；这里再做服务端侧重复校验演示
    const duplicated = records.some((d) => d.app_code === values.app_code.trim())
    if (duplicated) {
      registerForm.setFields([{ name: 'app_code', errors: ['该应用编码已存在'] }])
      return
    }
    const created: AppDictEntry = {
      app_code: values.app_code.trim(),
      app_name: values.app_name.trim(),
      description: values.description?.trim() || undefined,
      status: 'enabled',
    }
    setRecords((prev) => [...prev, created])
    setRegisterOpen(false)
    message.success(`应用「${created.app_name}」已登记`)
  }

  const openEdit = (record: AppDictEntry) => {
    setEditing(record)
    editForm.setFieldsValue({
      app_name: record.app_name,
      description: record.description,
      status: record.status,
    })
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!editing) return
    const values = await editForm.validateFields()
    setRecords((prev) =>
      prev.map((d) =>
        d.app_code === editing.app_code
          ? {
              ...d,
              app_name: values.app_name.trim(),
              description: values.description?.trim() || undefined,
              status: values.status,
            }
          : d,
      ),
    )
    setEditOpen(false)
    message.success('应用信息已更新')
  }

  const toggleStatus = (record: AppDictEntry) => {
    // 停用不删除：仅流转状态，存量资源保留历史值
    const nextStatus = record.status === 'enabled' ? 'disabled' : 'enabled'
    const actionText = nextStatus === 'disabled' ? '停用' : '启用'
    modal.confirm({
      title: `确认${actionText}应用「${record.app_name}」？`,
      content:
        nextStatus === 'disabled'
          ? '停用后，该应用不再可被新增 / 编辑资源选用；已归属该应用的存量资源保留历史值，仍可正常展示，采集与聚合不受影响。'
          : '启用后，该应用重新可被新增 / 编辑资源选用。',
      okText: `确认${actionText}`,
      onOk: () => {
        setRecords((prev) =>
          prev.map((d) => (d.app_code === record.app_code ? { ...d, status: nextStatus } : d)),
        )
        message.success(`应用「${record.app_name}」已${actionText}`)
      },
    })
  }

  const columns: TableProps<AppDictEntry>['columns'] = [
    {
      title: '应用编码',
      dataIndex: 'app_code',
      key: 'app_code',
      render: (v: string) => (
        <Text code style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '应用名',
      dataIndex: 'app_name',
      key: 'app_name',
      render: (v: string, record) =>
        record.status === 'disabled' ? <Text type="secondary">{v}（已停用）</Text> : v,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      render: (v?: string) => v || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      // 状态语义统一 Badge（《前端标准》§8：状态语义 = Badge 语义色 + 文字标签）
      render: (v: AppDictEntry['status']) =>
        v === 'enabled' ? <Badge status="success" text="启用" /> : <Badge status="default" text="停用" />,
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      // 操作层次（《前端标准》§8/§9）：主操作「编辑」品牌色加粗且全行唯一；
      // 低频状态操作（停用 / 启用）收进「更多」菜单。
      render: (_: unknown, record) => {
        const actionText = record.status === 'enabled' ? '停用' : '启用'
        return (
          <Space size={12}>
            <Button
              type="link"
              size="small"
              style={{ color: '#0ECDEB', fontWeight: 600, padding: 0 }}
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'toggle',
                    label: actionText,
                    danger: actionText === '停用',
                  },
                ],
                onClick: () => toggleStatus(record),
              }}
              trigger={['click']}
            >
              <Button type="link" size="small" style={{ color: '#4E5969', padding: 0 }}>
                更多 <DownOutlined style={{ fontSize: 10 }} />
              </Button>
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>应用管理</Title>
        <Text type="secondary">维护应用字典，资源的应用归属（应用编码）在本页登记</Text>
      </div>

      <Callout
        tone="info"
        icon={<InfoCircleFilled />}
        title="应用编码是资源归属应用的权威标识"
        style={{ marginBottom: 16 }}
      >
        应用编码会随资源标签一起用于按应用维度聚合监控，<Text strong>创建后不可修改</Text>；
        停用应用不删除，仅不再可被新增 / 编辑资源选用，存量资源保留原归属。
        应用服务 / 数据库 / 中间件登记时必须填应用编码；主机与其他监控目标可留空（设备类资源没有应用归属）。
      </Callout>

      <ReviewNote title="设计说明（面向产品 / 技术评审）" style={{ margin: '0 0 16px' }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            {'{v2.39} 决策 92'}：应用字典由资源字段的展示名拆出为独立字典（字典落 DB、本页维护），
            资源侧只存不可变编码 `app_code`，展示名 `app_name` 由字典解析；`app_code` 是监控标签 `app` 的唯一取值来源。
          </li>
          <li>
            与业务分组字典（5.18 / 业务管理页）同构、粒度不同：`biz` 回答「服务谁」（业务域聚合），
            `app` 回答「属于哪个应用」（应用实例级聚合）；两者都是「编码不可变 + 展示名必填 + 停用不删除」。
          </li>
          <li>
            红线硬化：`app_code` 创建后不可改（编码规范：小写字母 / 数字 / 连字符 ≤ 64，表单醒目提示）；
            编辑仅开放 `app_name` / `description` / 状态；不提供删除入口（停用不删除）；
            `app_name` 修改不触发监控配置重新生成 / 下发（标签存编码）；禁止用展示名当编码。
          </li>
          <li>
            消费链路：资源录入 / Excel 导入只读消费本字典（`GET /api/v2/platform/application-dict`）且只允许引用未停用条目；
            资源列表 / 详情的「应用」列展示字典 `app_name`，字典缺条目时回退显示编码。
          </li>
          <li>
            存量迁移：字典首次 seed 以存量资源的应用取值为基准生成条目（编码归一化、展示名取原值），
            目标是存量 `app` 标签不断、时序不裂。
          </li>
          <li>
            边界：本页为应用字典管理演示；「谁引用了该应用」的引用关系清单不在本页展示，见资源管理页 / Excel 导入校验。
          </li>
        </ul>
      </ReviewNote>

      <Card className="page-card">
        <Space style={{ marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ backgroundColor: '#0ECDEB' }}
            onClick={openRegister}
          >
            登记应用
          </Button>
        </Space>

        <Table
          rowKey="app_code"
          dataSource={records}
          columns={columns}
          size="small"
          pagination={TABLE_PAGINATION}
          locale={{ emptyText: '暂无应用，请点击「登记应用」创建' }}
        />
      </Card>

      {/* 登记应用弹窗 */}
      <Modal
        title="登记应用"
        open={registerOpen}
        onCancel={() => setRegisterOpen(false)}
        onOk={submitRegister}
        okText="登记"
        cancelText="取消"
        width={520}
      >
        <Callout
          tone="warning"
          icon={<ExclamationCircleFilled />}
          title="应用编码创建后不可修改"
          style={{ marginBottom: 16 }}
        >
          应用编码由小写字母、数字、连字符组成且长度不超过 64；一旦创建即作为资源归属的唯一标识，
          随标签用于应用维度聚合，请谨慎填写。
        </Callout>
        <Form form={registerForm} layout="vertical" name="register-application">
          <Form.Item
            label="应用编码"
            name="app_code"
            rules={[
              { required: true, message: '请输入应用编码' },
              { pattern: APP_CODE_RE, message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）' },
            ]}
          >
            <Input placeholder="例如 order-service / pay-service" maxLength={64} />
          </Form.Item>
          <Form.Item label="应用名" name="app_name" rules={[{ required: true, message: '请输入应用名' }]}>
            <Input placeholder="例如 订单服务 / 支付服务" maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="选填，说明该应用的用途或包含的资源范围" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 受限编辑弹窗：仅 应用名 / 描述 / 状态，应用编码只读展示 */}
      <Modal
        title={`编辑应用「${editing?.app_name ?? ''}」`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={submitEdit}
        okText="保存"
        cancelText="取消"
        width={520}
        forceRender
      >
        {editing && (
          <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="应用编码">
              <Text code style={{ fontSize: 12 }}>
                {editing.app_code}
              </Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                创建后不可修改
              </Text>
            </Descriptions.Item>
          </Descriptions>
        )}
        <Form form={editForm} layout="vertical" name="edit-application" initialValues={{ status: 'enabled' }}>
          <Form.Item label="应用名" name="app_name" rules={[{ required: true, message: '请输入应用名' }]}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            extra="停用后该应用不可被新增 / 编辑资源选用；已归属的存量资源保留历史值，采集与聚合不受影响"
          >
            <Select
              options={[
                { value: 'enabled', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
              placeholder="选择状态"
            />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
