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
import { SERVICE_CODE_RE, mockServiceDict } from '../mocks/module-07'
import type { ServiceDictEntry } from '../mocks/module-07'

const { Title, Text } = Typography

interface RegisterForm {
  service_code: string
  service_name: string
  description?: string
}

interface EditForm {
  service_name: string
  description?: string
  status: ServiceDictEntry['status']
}

/**
 * 服务字典管理页（PRD 5.22 / 决策 105 / 107）
 * 列表 + 登记 + 受限编辑 + 停用；与应用字典页（5.19）同构的红线：
 * 服务编码创建后不可改、仅 服务名/描述/状态 可编辑、停用不删除（无删除入口）、
 * 服务名修改不触发监控配置重生成（label 存 service_code）。
 */
export default function ServiceManagementPage() {
  const { message, modal } = App.useApp()
  // 服务字典由本页维护（mock 演示字典落 DB、服务管理页维护）
  const [records, setRecords] = useState<ServiceDictEntry[]>(mockServiceDict)

  // ---------- 登记 ----------
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerForm] = Form.useForm<RegisterForm>()

  // ---------- 编辑 ----------
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<ServiceDictEntry | null>(null)
  const [editForm] = Form.useForm<EditForm>()

  const openRegister = () => {
    registerForm.resetFields()
    setRegisterOpen(true)
  }

  const submitRegister = async () => {
    const values = await registerForm.validateFields()
    // 编码规范（小写字母/数字/连字符 ≤64）已由表单检验；这里再做服务端侧重复校验演示
    const duplicated = records.some((d) => d.service_code === values.service_code.trim())
    if (duplicated) {
      registerForm.setFields([{ name: 'service_code', errors: ['该服务编码已存在'] }])
      return
    }
    const created: ServiceDictEntry = {
      service_code: values.service_code.trim(),
      service_name: values.service_name.trim(),
      description: values.description?.trim() || undefined,
      status: 'enabled',
    }
    setRecords((prev) => [...prev, created])
    setRegisterOpen(false)
    message.success(`服务「${created.service_name}」已登记`)
  }

  const openEdit = (record: ServiceDictEntry) => {
    setEditing(record)
    editForm.setFieldsValue({
      service_name: record.service_name,
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
        d.service_code === editing.service_code
          ? {
              ...d,
              service_name: values.service_name.trim(),
              description: values.description?.trim() || undefined,
              status: values.status,
            }
          : d,
      ),
    )
    setEditOpen(false)
    message.success('服务信息已更新')
  }

  const toggleStatus = (record: ServiceDictEntry) => {
    // 停用不删除：仅流转状态，存量资源保留历史值
    const nextStatus = record.status === 'enabled' ? 'disabled' : 'enabled'
    const actionText = nextStatus === 'disabled' ? '停用' : '启用'
    modal.confirm({
      title: `确认${actionText}服务「${record.service_name}」？`,
      content:
        nextStatus === 'disabled'
          ? '停用后，该服务不再可被新增 / 编辑资源选用；已归属该服务的存量资源保留历史值，仍可正常展示。'
          : '启用后，该服务重新可被新增 / 编辑资源选用。',
      okText: `确认${actionText}`,
      onOk: () => {
        setRecords((prev) =>
          prev.map((d) => (d.service_code === record.service_code ? { ...d, status: nextStatus } : d)),
        )
        message.success(`服务「${record.service_name}」已${actionText}`)
      },
    })
  }

  const columns: TableProps<ServiceDictEntry>['columns'] = [
    {
      title: '服务编码',
      dataIndex: 'service_code',
      key: 'service_code',
      render: (v: string) => (
        <Text code style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '服务名',
      dataIndex: 'service_name',
      key: 'service_name',
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
      render: (v: ServiceDictEntry['status']) =>
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
        <Title level={4}>服务管理</Title>
        <Text type="secondary">维护服务字典，资源的服务归属（服务编码）在本页登记</Text>
      </div>

      <Callout
        tone="info"
        icon={<InfoCircleFilled />}
        title="服务编码是资源归属服务的权威标识"
        style={{ marginBottom: 16 }}
      >
        服务编码会随资源标签一起用于按服务维度聚合监控，<Text strong>创建后不可修改</Text>；
        停用服务不删除，仅不再可被新增 / 编辑资源选用，存量资源保留原归属。
        服务归属为可选字段，仅「应用服务」与「其他监控目标」可挂（主机 / 数据库 / 中间件不挂，基础设施非服务）。
      </Callout>

      <ReviewNote title="设计说明（面向产品 / 技术评审）" style={{ margin: '0 0 16px' }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            {'{v2.45} 决策 105 / 107'}：新增服务层 `service` 与「服务字典 `ServiceDict`」——四层实体层级
            （`platform(1) → app(N) → service(M) → instance(K)`）纵向组成分解的**第三层**（一个应用可含多个服务）；
            与应用字典（5.19）同构（编码不可变 + 展示名必填 + 停用不删除）。
          </li>
          <li>
            命名定档（决策 105）：服务 label 定名 **`svc`**（值 = `service_code`）——字典类 `ServiceDict`、编码字段
            `service_code`、label `svc`；**放弃 `service` 命名**（与 §5.15 机制 B 既有归一规则及既有 `service_name`
            字段撞名）；**既有 `service_name` label / 字段保留不动**。
          </li>
          <li>
            与服务应用关联（决策 105）：服务与应用的关联经**资源行**的 `app_code` + `service_code` 承载
            （本字典不设父子字段）；服务与业务域 `biz` **正交**（`service : biz = N:1`，主归属唯一）。
          </li>
          <li>
            红线硬化：`service_code` 创建后不可改（编码规范：小写字母 / 数字 / 连字符 ≤ 64，表单醒目提示）；
            编辑仅开放 `service_name` / `description` / 状态；不提供删除入口（停用不删除）；
            禁止用展示名当编码（`svc` label 恒取 `service_code`）。
          </li>
          <li>
            与资源行 `service_name` 的关系（决策 105）：资源侧 `service_code` 为**可选字段**（仅 application /
            generic_target 适用），留空即纯自由文本、向后兼容；资源行既有必填字段 `service_name` MVP 不改、仍参与
            application 判重键 `(domain, service_name, endpoint)`；**软约束**：填写 `service_code` 时约定
            `service_name` 宜与服务字典展示名一致（不强校验）。
          </li>
          <li>
            消费链路：资源录入 / 编辑表单与 Excel 导入校验只读消费本字典
            （`GET /api/v2/platform/service-dict`）且只允许引用未停用条目；资源详情展示字典 `service_name`
            （字典缺条目时回退显示编码）。
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
            登记服务
          </Button>
        </Space>

        <Table
          rowKey="service_code"
          dataSource={records}
          columns={columns}
          size="small"
          pagination={TABLE_PAGINATION}
          locale={{ emptyText: '暂无服务，请点击「登记服务」创建' }}
        />
      </Card>

      {/* 登记服务弹窗 */}
      <Modal
        title="登记服务"
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
          title="服务编码创建后不可修改"
          style={{ marginBottom: 16 }}
        >
          服务编码由小写字母、数字、连字符组成且长度不超过 64；一旦创建即作为资源归属服务的唯一标识，
          随标签用于服务维度聚合，请谨慎填写。
        </Callout>
        <Form form={registerForm} layout="vertical" name="register-service">
          <Form.Item
            label="服务编码"
            name="service_code"
            rules={[
              { required: true, message: '请输入服务编码' },
              { pattern: SERVICE_CODE_RE, message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）' },
            ]}
          >
            <Input placeholder="例如 teacher-identity-api / order-service-api" maxLength={64} />
          </Form.Item>
          <Form.Item label="服务名" name="service_name" rules={[{ required: true, message: '请输入服务名' }]}>
            <Input placeholder="例如 教师身份核验接口" maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="选填，说明该服务的用途或包含的资源范围" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 受限编辑弹窗：仅 服务名 / 描述 / 状态，服务编码只读展示 */}
      <Modal
        title={`编辑服务「${editing?.service_name ?? ''}」`}
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
            <Descriptions.Item label="服务编码">
              <Text code style={{ fontSize: 12 }}>
                {editing.service_code}
              </Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                创建后不可修改
              </Text>
            </Descriptions.Item>
          </Descriptions>
        )}
        <Form form={editForm} layout="vertical" name="edit-service" initialValues={{ status: 'enabled' }}>
          <Form.Item label="服务名" name="service_name" rules={[{ required: true, message: '请输入服务名' }]}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            extra="停用后该服务不可被新增 / 编辑资源选用；已归属的存量资源保留历史值"
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
