import { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { ReviewNote } from '../components/ReviewNote'
import { TABLE_PAGINATION } from '../components/tablePresets'
import { BIZ_CODE_RE, mockBusinessDomains } from '../mocks/module-07'
import type { BusinessDomain } from '../mocks/module-07'

const { Title, Text } = Typography

interface RegisterForm {
  biz_code: string
  biz_name: string
  description?: string
}

interface EditForm {
  biz_name: string
  description?: string
  status: BusinessDomain['status']
}

/**
 * 业务分组字典管理页（PRD 5.18 / 决策 48）
 * 列表 + 登记 + 受限编辑 + 停用；红线：biz_code 创建后不可改、仅 biz_name/description/status 可编辑、
 * 停用不删除（无删除入口）、infra 兜底条目禁止停用/删除、biz_name 修改不触发监控配置重生成。
 */
export default function BusinessManagementPage() {
  const { message, modal } = App.useApp()
  // 业务字典状态由本页维护（mock 演示决策 48：字典落 DB、业务管理页维护）
  const [records, setRecords] = useState<BusinessDomain[]>(mockBusinessDomains)

  // ---------- 登记 ----------
  const [registerOpen, setRegisterOpen] = useState(false)
  const [registerForm] = Form.useForm<RegisterForm>()

  // ---------- 编辑 ----------
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<BusinessDomain | null>(null)
  const [editForm] = Form.useForm<EditForm>()

  const openRegister = () => {
    registerForm.resetFields()
    setRegisterOpen(true)
  }

  const submitRegister = async () => {
    const values = await registerForm.validateFields()
    // 决策 48：编码规范（小写字母/数字/连字符 ≤64）已由表单检验；这里再做服务端侧重复校验演示
    const duplicated = records.some((d) => d.biz_code === values.biz_code.trim())
    if (duplicated) {
      registerForm.setFields([
        {
          name: 'biz_code',
          errors: ['该业务编码已存在'],
        },
      ])
      return
    }
    const created: BusinessDomain = {
      biz_code: values.biz_code.trim(),
      biz_name: values.biz_name.trim(),
      description: values.description?.trim() || undefined,
      status: 'enabled',
    }
    setRecords((prev) => [...prev, created])
    setRegisterOpen(false)
    message.success(`业务「${created.biz_name}」已登记`)
  }

  const openEdit = (record: BusinessDomain) => {
    setEditing(record)
    editForm.setFieldsValue({
      biz_name: record.biz_name,
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
        d.biz_code === editing.biz_code
          ? { ...d, biz_name: values.biz_name.trim(), description: values.description?.trim() || undefined, status: values.status }
          : d,
      ),
    )
    setEditOpen(false)
    message.success('业务信息已更新')
  }

  const toggleStatus = (record: BusinessDomain) => {
    // 决策 48：infra 兜底条目禁止停用
    if (record.biz_code === 'infra') {
      message.error('infra 为无业务归属设备的兜底分组，不可停用')
      return
    }
    // 停用不删除：仅流转状态，存量资源保留历史值（决策 48）
    const nextStatus = record.status === 'enabled' ? 'disabled' : 'enabled'
    const actionText = nextStatus === 'disabled' ? '停用' : '启用'
    modal.confirm({
      title: `确认${actionText}业务「${record.biz_name}」？`,
      content:
        nextStatus === 'disabled'
          ? '停用后，该业务不再可被新增 / 编辑资源选用；已归属该业务的存量资源保留历史值，仍可正常展示。'
          : '启用后，该业务重新可被新增 / 编辑资源选用。',
      okText: `确认${actionText}`,
      onOk: () => {
        setRecords((prev) =>
          prev.map((d) => (d.biz_code === record.biz_code ? { ...d, status: nextStatus } : d)),
        )
        message.success(`业务「${record.biz_name}」已${actionText}`)
      },
    })
  }

  const columns: TableProps<BusinessDomain>['columns'] = [
    {
      title: '业务编码',
      dataIndex: 'biz_code',
      key: 'biz_code',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '业务名',
      dataIndex: 'biz_name',
      key: 'biz_name',
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
      render: (v: BusinessDomain['status']) =>
        v === 'enabled' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, record) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            编辑
          </Button>
          {record.biz_code === 'infra' ? (
            <Tooltip title="infra 为无业务归属设备的兜底分组，不可停用">
              <Button type="link" size="small" disabled onClick={() => toggleStatus(record)}>
                停用
              </Button>
            </Tooltip>
          ) : (
            <Button type="link" size="small" onClick={() => toggleStatus(record)}>
              {record.status === 'enabled' ? '停用' : '启用'}
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Title level={4}>业务管理</Title>
        <Text type="secondary">维护业务分组字典，资源的业务归属（业务编码）在本页登记</Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="业务编码是资源归属业务域的权威标识"
        description={
          <span>
            业务编码（<Text code>biz_code</Text>）会随资源标签一起用于按业务维度聚合监控，<strong>创建后不可修改</strong>；
            停用业务不删除，仅不再可被新增 / 编辑资源选用，存量资源保留原归属。
          </span>
        }
      />

      <ReviewNote title="设计说明（面向产品 / 技术评审）" style={{ margin: '0 0 16px' }}>
        <ul style={{ paddingLeft: 18, margin: 0 }}>
          <li>{'{v2.23} 决策 48'}：业务分组字典由「配置文件预置只读」提级为「业务管理页维护」（mock 演示落 DB）；`business_domains.yaml` 仅首次启动 seed，`biz_code` 由本页管理。</li>
          <li>红线硬化（决策 48 / 6 / 21 / 22）：`biz_code` 创建后不可改（编码规范：小写字母 / 数字 / 连字符 ≤ 64，表单醒目提示）；编辑仅开放 `biz_name` / `description` / 状态；不提供删除入口（停用不删除）；`infra` 兜底条目禁止停用 / 删除；`biz_name` 修改不触发监控配置重新生成 / 下发。</li>
          <li>消费链路不变：资源录入 / Excel 导入仍只读消费本字典（`GET /api/v2/platform/business-domains`）；导入遇未登记业务报错引导「前往业务管理登记」。</li>
          <li>空态仅出现在 seed 前或异常场景（正常启动已 seed 导入 `infra` 兜底条目），因此列表通常非空。</li>
          <li>边界：本页为业务字典管理演示；业务编码被资源引用情况下的引用关系清单（谁引用了该业务）不在本页展示，见资源管理页 / Excel 导入校验。</li>
        </ul>
      </ReviewNote>

      <Card className="page-card">
        <Space style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#0ECDEB' }} onClick={openRegister}>
            登记业务
          </Button>
        </Space>

        <Table
          rowKey="biz_code"
          dataSource={records}
          columns={columns}
          size="small"
          pagination={TABLE_PAGINATION}
          locale={{ emptyText: '暂无业务分组，请点击「登记业务」创建' }}
        />
      </Card>

      {/* 登记业务弹窗（决策 48） */}
      <Modal
        title="登记业务"
        open={registerOpen}
        onCancel={() => setRegisterOpen(false)}
        onOk={submitRegister}
        okText="登记"
        cancelText="取消"
        width={520}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="业务编码创建后不可修改"
          description="业务编码由小写字母、数字、连字符组成且长度不超过 64；一旦创建即作为资源归属的唯一标识，随标签用于业务维度聚合，请谨慎填写。"
        />
        <Form form={registerForm} layout="vertical" name="register-business">
          <Form.Item
            label="业务编码"
            name="biz_code"
            rules={[
              { required: true, message: '请输入业务编码' },
              {
                pattern: BIZ_CODE_RE,
                message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）',
              },
            ]}
          >
            <Input placeholder="例如 payment / data-api" maxLength={64} />
          </Form.Item>
          <Form.Item label="业务名" name="biz_name" rules={[{ required: true, message: '请输入业务名' }]}>
            <Input placeholder="例如 支付业务 / 数据接口" maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} placeholder="选填，说明该业务的用途或包含的资源范围" maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 受限编辑弹窗（决策 48：仅 biz_name / description / status，biz_code 只读展示） */}
      <Modal
        title={`编辑业务「${editing?.biz_name ?? ''}」`}
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
            <Descriptions.Item label="业务编码">
              <Text code style={{ fontSize: 12 }}>{editing.biz_code}</Text>
              <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>创建后不可修改</Text>
            </Descriptions.Item>
          </Descriptions>
        )}
        <Form form={editForm} layout="vertical" name="edit-business" initialValues={{ status: 'enabled' }}>
          <Form.Item label="业务名" name="biz_name" rules={[{ required: true, message: '请输入业务名' }]}>
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} maxLength={200} />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              disabled={editing?.biz_code === 'infra'}
              options={[
                { value: 'enabled', label: '启用' },
                ...(editing?.biz_code === 'infra' ? [] : [{ value: 'disabled', label: '停用' }]),
              ]}
              placeholder="选择状态"
            />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}