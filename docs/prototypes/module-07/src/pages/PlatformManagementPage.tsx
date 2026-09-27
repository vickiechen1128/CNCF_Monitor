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
import { PLATFORM_CODE_RE, mockPlatformDict } from '../mocks/module-07'
import type { PlatformDictEntry } from '../mocks/module-07'

const { Title, Text } = Typography

interface RegisterForm {
  platform_code: string
  platform_name: string
  description?: string
}

interface EditForm {
  platform_name: string
  description?: string
  status: PlatformDictEntry['status']
}

/**
 * 平台字典管理页（PRD 5.21 / 决策 104 / 107）
 * 列表 + 登记 + 受限编辑 + 停用；与业务 / 应用字典页同构的红线：
 * 平台编码创建后不可改、仅 平台名/描述/状态 可编辑、停用不删除（无删除入口）、
 * 平台名修改不触发监控配置重生成（label 存 platform_code）。
 * 平台为四层实体（platform → app → service → instance）的顶层，应用经「所属平台」挂靠。
 */
export default function PlatformManagementPage() {
  const { message, modal } = App.useApp()
  // 平台字典由本页维护（mock 演示字典落 DB、平台管理页维护）
  const [records, setRecords] = useState<PlatformDictEntry[]>(mockPlatformDict)

  // ---------- 登记 ----------
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerForm] = Form.useForm<RegisterForm>()

  // ---------- 编辑 ----------
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<PlatformDictEntry | null>(null)
  const [editForm] = Form.useForm<EditForm>()

  const openRegister = () => {
    registerForm.resetFields()
    setRegisterOpen(true)
  }

  const submitRegister = async () => {
    const values = await registerForm.validateFields()
    // 编码规范（小写字母/数字/连字符 ≤64）已由表单检验；这里再做服务端侧重复校验演示
    const duplicated = records.some((d) => d.platform_code === values.platform_code.trim())
    if (duplicated) {
      registerForm.setFields([{ name: 'platform_code', errors: ['该平台编码已存在'] }])
      return
    }
    const created: PlatformDictEntry = {
      platform_code: values.platform_code.trim(),
      platform_name: values.platform_name.trim(),
      description: values.description?.trim() || undefined,
      status: 'enabled',
    }
    setRecords((prev) => [...prev, created])
    setRegisterOpen(false)
    message.success(`平台「${created.platform_name}」已登记`)
  }

  const openEdit = (record: PlatformDictEntry) => {
    setEditing(record)
    editForm.setFieldsValue({
      platform_name: record.platform_name,
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
        d.platform_code === editing.platform_code
          ? {
              ...d,
              platform_name: values.platform_name.trim(),
              description: values.description?.trim() || undefined,
              status: values.status,
            }
          : d,
      ),
    )
    setEditOpen(false)
    message.success('平台信息已更新')
  }

  const toggleStatus = (record: PlatformDictEntry) => {
    // 停用不删除：仅流转状态，存量应用保留历史值
    const nextStatus = record.status === 'enabled' ? 'disabled' : 'enabled'
    const actionText = nextStatus === 'disabled' ? '停用' : '启用'
    modal.confirm({
      title: `确认${actionText}平台「${record.platform_name}」？`,
      content:
        nextStatus === 'disabled'
          ? '停用后，该平台不再可被新增 / 编辑应用条目选用；已挂靠该平台的存量应用保留历史值，仍可正常展示。'
          : '启用后，该平台重新可被新增 / 编辑应用条目选用。',
      okText: `确认${actionText}`,
      onOk: () => {
        setRecords((prev) =>
          prev.map((d) => (d.platform_code === record.platform_code ? { ...d, status: nextStatus } : d)),
        )
        message.success(`平台「${record.platform_name}」已${actionText}`)
      },
    })
  }

  const columns: TableProps<PlatformDictEntry>['columns'] = [
    {
      title: '平台编码',
      dataIndex: 'platform_code',
      key: 'platform_code',
      render: (v: string) => (
        <Text code style={{ fontSize: 12 }}>
          {v}
        </Text>
      ),
    },
    {
      title: '平台名',
      dataIndex: 'platform_name',
      key: 'platform_name',
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
      render: (v: PlatformDictEntry['status']) =>
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
        <Title level={4}>平台管理</Title>
        <Text type="secondary">维护平台字典，应用的所属平台（平台编码）在本页登记</Text>
      </div>

      <Callout
        tone="info"
        icon={<InfoCircleFilled />}
        title="平台编码是应用归属平台的权威标识"
        style={{ marginBottom: 16 }}
      >
        平台编码会随应用归属派生为监控标签、用于按平台维度聚合，<Text strong>创建后不可修改</Text>；
        停用平台不删除，仅不再可被新增 / 编辑应用条目选用，存量应用保留原归属。
        平台是「平台 → 应用 → 服务 → 实例」层级的最顶层，应用通过「所属平台」挂靠（可选）。
      </Callout>

      <ReviewNote title="设计说明（面向产品 / 技术评审）" style={{ margin: '0 0 16px' }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>
            {'{v2.45} 决策 104 / 107'}：新增平台层 `platform` 与平台字典 `PlatformDict`——四层实体层级
            （`platform(1) → app(N) → service(M) → instance(K)`）纵向组成分解的顶层；与业务分组字典（5.18）、
            应用字典（5.19）、云字典（5.20）同规约（编码不可变 + 展示名必填 + 停用不删除）。
          </li>
          <li>
            命名定档（决策 104）：四层实体顶层定名 **`platform`（平台）**——字典类 `PlatformDict`、编码字段
            `platform_code`、label `platform`；**放弃 `system` 命名**（`system` 在 M07 已承载
            `ResourceLabel.source=system`、标签保护层级「system 层」、主机 `os_dict` 等多重既有语义，复用必撞名）。
          </li>
          <li>
            与业务维度正交（决策 96 / 107）：决策 96 裁定的 biz↔app 横向正交只约束「应用挂业务 / 业务挂应用」，
            **不约束应用是否有上级平台**；本字段是应用自身的纵向上级、非业务父级，两者不冲突。
          </li>
          <li>
            红线硬化：`platform_code` 创建后不可改（编码规范：小写字母 / 数字 / 连字符 ≤ 64，表单醒目提示）；
            编辑仅开放 `platform_name` / `description` / 状态；不提供删除入口（停用不删除）；
            禁止用展示名当编码（`platform` label 恒取 `platform_code`）。
          </li>
          <li>
            消费链路：应用登记 / 编辑表单只读消费本字典（`GET /api/v2/platform/platform-dict`）且只允许引用未停用条目；
            应用列表展示字典 `platform_name`，字典缺条目时回退显示编码；资源侧 `platform` label 经 `app_code` →
            应用条目父级 `platform_code` **派生注入**（资源行不新增字段）。
          </li>
          <li>
            交付范围（决策 107）：平台字典本体（模型 + 字段口径 + 只读消费接口 + Excel 声明 sheet + 本维护页）随 MVP 交付；
            **「平台 → 子系统」分层可视化界面归 {'{v0.2}'}**（与应用字典父子分解界面同期），MVP 应用表单仅提供「所属平台」下拉。
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
            登记平台
          </Button>
        </Space>

        <Table
          rowKey="platform_code"
          dataSource={records}
          columns={columns}
          size="small"
          pagination={TABLE_PAGINATION}
          locale={{ emptyText: '暂无平台，请点击「登记平台」创建' }}
        />
      </Card>

      {/* 登记平台弹窗 */}
      <Modal
        title="登记平台"
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
          title="平台编码创建后不可修改"
          style={{ marginBottom: 16 }}
        >
          平台编码由小写字母、数字、连字符组成且长度不超过 64；一旦创建即作为应用归属平台的唯一标识，
          随应用归属派生为监控标签、用于平台维度聚合，请谨慎填写。
        </Callout>
        <Form form={registerForm} layout="vertical" name="register-platform">
          <Form.Item
            label="平台编码"
            name="platform_code"
            rules={[
              { required: true, message: '请输入平台编码' },
              { pattern: PLATFORM_CODE_RE, message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）' },
            ]}
          >
            <Input placeholder="例如 ecommerce / public-data-auth" maxLength={64} />
          </Form.Item>
          <Form.Item label="平台名" name="platform_name" rules={[{ required: true, message: '请输入平台名' }]}>
            <Input placeholder="例如 公共数据授权运营平台" maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="选填，说明该平台的用途或包含的应用范围" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 受限编辑弹窗：仅 平台名 / 描述 / 状态，平台编码只读展示 */}
      <Modal
        title={`编辑平台「${editing?.platform_name ?? ''}」`}
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
            <Descriptions.Item label="平台编码">
              <Text code style={{ fontSize: 12 }}>
                {editing.platform_code}
              </Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                创建后不可修改
              </Text>
            </Descriptions.Item>
          </Descriptions>
        )}
        <Form form={editForm} layout="vertical" name="edit-platform" initialValues={{ status: 'enabled' }}>
          <Form.Item label="平台名" name="platform_name" rules={[{ required: true, message: '请输入平台名' }]}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            extra="停用后该平台不可被新增 / 编辑应用条目选用；已挂靠的存量应用保留历史值"
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
