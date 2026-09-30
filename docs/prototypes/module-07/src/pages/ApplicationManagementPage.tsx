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
  Tag,
  Typography,
} from 'antd'
import type { TableProps, FormInstance } from 'antd'
import { DownOutlined, ExclamationCircleFilled, InfoCircleFilled, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { Callout } from '../components/Callout'
import { ReviewNote } from '../components/ReviewNote'
import { TABLE_PAGINATION } from '../components/tablePresets'
import {
  APP_CODE_RE,
  mockApplicationDict,
  // {v2.49} 决策 110 / 111：应用↔平台 M:N——平台字典只读消费（多选 + 主平台单选）
  mockPlatformDict,
  resolvePlatformName,
  isPlatformDisabled,
} from '../mocks/module-07'
import type { AppDictEntry } from '../mocks/module-07'

const { Title, Text } = Typography
const { Option } = Select

interface RegisterForm {
  app_code: string
  app_name: string
  // {v2.49} 决策 110 / 111：应用关联的全部平台（多选）+ 主平台（单选，须属于已选集合）
  platform_codes?: string[]
  primary_platform_code?: string
  description?: string
}

interface EditForm {
  app_name: string
  platform_codes?: string[]
  primary_platform_code?: string
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

  // {v2.49} 决策 110 / 111：应用↔平台 M:N——「所属平台」多选下拉（只读消费平台字典启用条目）；
  // 编辑存量条目时，其原关联平台若已停用 / 已不在字典，保留历史值展示（不可新选，但不清空）。
  const platformOptions = (selected?: string[]) => {
    const enabledOptions = mockPlatformDict
      .filter((d) => d.status === 'enabled')
      .map((d) => (
        <Option key={d.platform_code} value={d.platform_code}>
          {d.platform_name}（{d.platform_code}）
        </Option>
      ))
    const legacy = (selected ?? []).filter(
      (c) => !!c && !mockPlatformDict.some((d) => d.platform_code === c && d.status === 'enabled'),
    )
    return [
      ...enabledOptions,
      ...legacy.map((c) => (
        <Option key={c} value={c}>
          {resolvePlatformName(c)}（已停用）
        </Option>
      )),
    ]
  }

  // {v2.49} 决策 111：主平台只能从**已选平台集合**中选（未选平台时主平台置空）
  const primaryPlatformOptions = (selected?: string[]) =>
    (selected ?? []).map((c) => (
      <Option key={c} value={c}>
        {resolvePlatformName(c)}
        {isPlatformDisabled(c) ? '（已停用）' : ''}
      </Option>
    ))

  const registerPlatforms = Form.useWatch('platform_codes', registerForm) as string[] | undefined
  const editPlatforms = Form.useWatch('platform_codes', editForm) as string[] | undefined
  // 主平台必须属于已选集合：平台选择变化后清掉不在集合内的主平台
  const syncPrimary = (form: FormInstance, codes?: string[]) => {
    const primary = form.getFieldValue('primary_platform_code') as string | undefined
    if (primary && !(codes ?? []).includes(primary)) form.setFieldValue('primary_platform_code', undefined)
  }

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
    const platformCodes = values.platform_codes && values.platform_codes.length > 0 ? values.platform_codes : undefined
    const created: AppDictEntry = {
      app_code: values.app_code.trim(),
      app_name: values.app_name.trim(),
      platform_codes: platformCodes,
      // 主平台只能落在已选集合内（服务端唯一性校验演示）
      primary_platform_code:
        values.primary_platform_code && platformCodes?.includes(values.primary_platform_code)
          ? values.primary_platform_code
          : undefined,
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
      platform_codes: record.platform_codes,
      primary_platform_code: record.primary_platform_code,
      description: record.description,
      status: record.status,
    })
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!editing) return
    const values = await editForm.validateFields()
    const platformCodes = values.platform_codes && values.platform_codes.length > 0 ? values.platform_codes : undefined
    setRecords((prev) =>
      prev.map((d) =>
        d.app_code === editing.app_code
          ? {
              ...d,
              app_name: values.app_name.trim(),
              platform_codes: platformCodes,
              primary_platform_code:
                values.primary_platform_code && platformCodes?.includes(values.primary_platform_code)
                  ? values.primary_platform_code
                  : undefined,
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
      // {v2.49} 决策 110 / 111：应用↔平台 M:N「所属平台」列——多平台 Tag 列表 + 主平台标记；未挂显示 -；已停用平台加「（已停用）」
      title: '所属平台',
      dataIndex: 'platform_codes',
      key: 'platform_codes',
      width: 220,
      render: (_: unknown, record: AppDictEntry) => {
        const codes = record.platform_codes ?? []
        if (codes.length === 0) return '-'
        return (
          <Space size={[4, 4]} wrap>
            {codes.map((c) => (
              <Tag key={c} color={isPlatformDisabled(c) ? 'default' : 'purple'}>
                {resolvePlatformName(c)}
                {isPlatformDisabled(c) ? '（已停用）' : ''}
                {c === record.primary_platform_code ? '（主）' : ''}
              </Tag>
            ))}
          </Space>
        )
      },
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
            {'{v2.49} 决策 110 / 111'}：应用↔平台关系由「单值可选父级（`platform_code`）」改为 <Text strong>多对多</Text>
            （`app_platform_rel(app_code, platform_code, is_primary)`）——一套软件可同时部署在多个平台（如授权平台 + 实验室平台）；
            应用表单「所属平台」改为<Text strong>多选 + 主平台单选</Text>（同一应用至多一个主平台，主平台只能从已选平台中选、主平台必须属于已选集合）；
            存量单值 `platform_code` 一次性迁入关联表（转入一行、`is_primary=true`），迁移后应用侧单值字段废弃。
            这仍是应用自身的纵向分解，与决策 96 的 biz↔app 横向正交是两个维度、不冲突。
            平台停用不解绑存量关联、仅不可新选；{' {v0.2} '}起补「平台 → 子系统」聚合拓扑视图（只读），MVP 仅提供本关系维护表单。
          </li>
          <li>
            红线硬化补充：仅 `app_name` / 平台关联（多选 + 主平台）/ `description` / 状态 可编辑（`app_code` 仍不可改）；
            应用侧平台关联只允许引用未停用平台条目（编辑存量时保留已停用历史关联展示、不可新选）。
          </li>
          <li>
            {'{v2.49} 决策 112'}：本页为<Text strong>字典</Text>（编码取值权威），**不是「可删除的对象」**——
            应用编码即 label 值，删除会断历史时序，故生命周期为「启用 ↔ 停用」；真正可删除的是<Text strong>资源（Resource）</Text>（被采集 Job 引用时阻断）。
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
          {/* {v2.49} 决策 110 / 111：应用↔平台 M:N——「所属平台」多选 + 「主平台」单选（主平台须属于已选集合） */}
          <Form.Item
            label="所属平台"
            name="platform_codes"
            extra="选填：应用关联的平台（可多选，支持一套软件跨多个平台）；仅可选启用中的平台，留空则无平台归属、不注入 platform 标签"
          >
            <Select
              mode="multiple"
              placeholder="选填，可多选"
              showSearch
              allowClear
              optionFilterProp="label"
              onChange={(vals: string[]) => syncPrimary(registerForm, vals)}
            >
              {platformOptions(registerPlatforms)}
            </Select>
          </Form.Item>
          <Form.Item
            label="主平台"
            name="primary_platform_code"
            dependencies={['platform_codes']}
            rules={[
              {
                validator: (_, value) => {
                  const codes = registerForm.getFieldValue('platform_codes') as string[] | undefined
                  if (value && !(codes ?? []).includes(value)) return Promise.reject(new Error('主平台必须属于已选平台'))
                  return Promise.resolve()
                },
              },
            ]}
            extra="选填：应用主平台（至多一个，用于资源未填平台时的兜底归属）；只能从已选平台中选择"
          >
            <Select
              placeholder="选填，需先选择所属平台"
              allowClear
              disabled={!registerPlatforms || registerPlatforms.length === 0}
            >
              {primaryPlatformOptions(registerPlatforms)}
            </Select>
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
          <Form.Item
            label="所属平台"
            name="platform_codes"
            extra="选填：应用关联的平台（可多选）；仅可选启用中的平台，留空则无平台归属；原关联的已停用平台保留展示、不可新选"
          >
            <Select
              mode="multiple"
              placeholder="选填，可多选"
              showSearch
              allowClear
              optionFilterProp="label"
              onChange={(vals: string[]) => syncPrimary(editForm, vals)}
            >
              {platformOptions(editPlatforms)}
            </Select>
          </Form.Item>
          <Form.Item
            label="主平台"
            name="primary_platform_code"
            dependencies={['platform_codes']}
            rules={[
              {
                validator: (_, value) => {
                  const codes = editForm.getFieldValue('platform_codes') as string[] | undefined
                  if (value && !(codes ?? []).includes(value)) return Promise.reject(new Error('主平台必须属于已选平台'))
                  return Promise.resolve()
                },
              },
            ]}
            extra="选填：应用主平台（至多一个，用于资源未填平台时的兜底归属）；只能从已选平台中选择"
          >
            <Select
              placeholder="选填，需先选择所属平台"
              allowClear
              disabled={!editPlatforms || editPlatforms.length === 0}
            >
              {primaryPlatformOptions(editPlatforms)}
            </Select>
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
