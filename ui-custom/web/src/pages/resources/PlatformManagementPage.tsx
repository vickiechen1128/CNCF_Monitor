import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DownOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { platformDictApi } from '../../api/resources'
import type { PlatformDict } from '../../types/resource'
import { Callout } from '../../components/Callout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'

const { Text } = Typography

/** 平台编码规范（§5.21 / 契约快照 §5C：小写字母 / 数字 / 连字符，≤ 64，创建后不可改） */
const PLATFORM_CODE_PATTERN = /^[a-z0-9-]{1,64}$/

/**
 * 平台字典维护页（Module_07 §5.21 / 决策 104；契约快照 §5C）
 *
 * 与业务 / 应用字典页同构：编码不可变 + 展示名必填 + 停用不删除（无删除入口）。
 * 平台是四层实体层级 `platform(1) → app(N) → service(M) → instance(K)` 的顶层，
 * 应用经「所属平台」可选挂靠；本页不提供任何平台填写控件之外的层级选择器。
 */
export function PlatformManagementPage() {
  const [list, setList] = useState<PlatformDict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [drawer, setDrawer] = useState<{ open: boolean; record: PlatformDict | null }>({ open: false, record: null })
  const [actingCode, setActingCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await platformDictApi.list()
      setList(res.data?.list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '平台字典加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return list
    return list.filter(
      (d) =>
        d.platform_code.toLowerCase().includes(kw) ||
        d.platform_name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw),
    )
  }, [list, keyword])

  const toggleStatus = useCallback(
    (record: PlatformDict) => {
      const next = !record.enabled
      const actionText = next ? '启用' : '停用'
      Modal.confirm({
        title: `确认${actionText}平台「${record.platform_name}」？`,
        content: next
          ? '启用后，该平台重新可被新增 / 编辑应用条目选用。'
          : '停用后，该平台不再可被新增 / 编辑应用条目选用；已挂靠该平台的存量应用保留历史值，仍可正常展示。',
        okText: `确认${actionText}`,
        cancelText: '取消',
        okButtonProps: next ? undefined : { danger: true },
        onOk: async () => {
          setActingCode(record.platform_code)
          try {
            await platformDictApi.update(record.platform_code, { enabled: next })
            message.success(`平台「${record.platform_name}」已${actionText}`)
            await load()
          } catch (e) {
            message.error(e instanceof Error ? e.message : '状态切换失败，请稍后重试')
          } finally {
            setActingCode(null)
          }
        },
      })
    },
    [load],
  )

  const openCreate = () => setDrawer({ open: true, record: null })
  const openEdit = (record: PlatformDict) => setDrawer({ open: true, record })

  const columns: ColumnsType<PlatformDict> = [
    {
      title: '平台编码',
      dataIndex: 'platform_code',
      key: 'platform_code',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '平台名',
      dataIndex: 'platform_name',
      key: 'platform_name',
      width: 200,
      // §5.21 / 决策 22 同口径：停用条目以「平台名（已停用）」标识
      render: (v: string, r: PlatformDict) =>
        r.enabled ? <EllipsisText>{v}</EllipsisText> : <EllipsisText>{`${v}（已停用）`}</EllipsisText>,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      width: 260,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : <Text type="secondary">-</Text>),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (v: boolean) => (v ? <Badge status="success" text="启用" /> : <Badge status="default" text="停用" />),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 140,
      render: (_: unknown, r: PlatformDict) => (
        <Space size={12}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(r)}>
            编辑
          </Button>
          {/* 低频状态操作（停用 / 启用）收进「更多」菜单（对齐原型 PlatformManagementPage） */}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [{ key: 'toggle', label: r.enabled ? '停用' : '启用', danger: r.enabled }],
              onClick: () => toggleStatus(r),
            }}
          >
            <Button type="link" size="small" style={{ padding: 0 }} loading={actingCode === r.platform_code}>
              更多 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <Card
        title="平台管理"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              登记平台
            </Button>
          </Space>
        }
      >
        <div style={{ marginBottom: 16 }}>
          <Callout tone="info" title="平台编码是应用归属平台的权威标识">
            平台编码随应用归属派生为监控标签、用于按平台维度聚合，<Text strong>创建后不可修改</Text>；
            停用平台不删除，仅不再可被新增 / 编辑应用条目选用，存量应用保留原归属。
            平台是「平台 → 应用 → 服务 → 实例」层级的最顶层，应用通过「所属平台」挂靠（可选）。
          </Callout>
        </div>
        {error && (
          <Alert
            type="error"
            showIcon
            message="平台字典加载失败，请稍后重试"
            description={error}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
                重新加载
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}
        <FilterBar>
          <FilterItem label="关键字" width={260}>
            <Input.Search
              allowClear
              placeholder="搜索平台编码 / 名称 / 描述"
              style={{ width: 220 }}
              value={keyword}
              onSearch={(v) => setKeyword(v)}
              onChange={(e) => e.target.value === '' && setKeyword('')}
            />
          </FilterItem>
        </FilterBar>
        <Table<PlatformDict>
          rowKey="platform_code"
          dataSource={filtered}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无平台，请点击「登记平台」创建" /> }}
          pagination={{ ...TABLE_PAGINATION, showSizeChanger: true }}
        />
        <PlatformDictDrawer
          open={drawer.open}
          record={drawer.record}
          onCancel={() => setDrawer({ open: false, record: null })}
          onSuccess={() => {
            setDrawer({ open: false, record: null })
            void load()
          }}
        />
      </Card>
    </MainLayout>
  )
}

interface PlatformDictDrawerProps {
  open: boolean
  /** 编辑态为行 record；登记态为 null */
  record: PlatformDict | null
  onCancel: () => void
  onSuccess: () => void
}

interface PlatformDictFormValues {
  platform_code?: string
  platform_name: string
  description?: string
  /** 表单内用布尔承载启用状态，提交即为契约的 `enabled` */
  enabled?: boolean
}

/**
 * 平台字典登记 / 受限编辑抽屉（§5.21 红线 / 契约快照 §5C）
 *
 * 登记含编码规范校验；编辑仅开放 平台名 / 描述 / 启用状态，`platform_code` 只读展示且不随请求体。
 */
export function PlatformDictDrawer({ open, record, onCancel, onSuccess }: PlatformDictDrawerProps) {
  const [form] = Form.useForm<PlatformDictFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isEdit = !!record

  useEffect(() => {
    if (!open) return
    form.resetFields()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    if (record) {
      form.setFieldsValue({
        platform_code: record.platform_code,
        platform_name: record.platform_name,
        description: record.description,
        enabled: record.enabled,
      })
    } else {
      form.setFieldsValue({ enabled: true })
    }
  }, [open, record, form])

  const handleSubmit = async () => {
    let values: PlatformDictFormValues
    // antd 校验拒签属预期（字段内联报错由 Form 自展示）；捕获后直接返回，
    // 避免 `void handleSubmit()` 下的 Unhandled Rejection
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (record) {
        await platformDictApi.update(record.platform_code, {
          platform_name: values.platform_name,
          description: values.description,
          enabled: !!values.enabled,
        })
        message.success('平台信息已更新')
      } else {
        await platformDictApi.create({
          platform_code: values.platform_code!,
          platform_name: values.platform_name,
          description: values.description,
        })
        message.success(`平台「${values.platform_name}」已登记`)
      }
      onSuccess()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '保存失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? `编辑平台「${record?.platform_name ?? ''}」` : '登记平台'}
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={460}
      // forceRender：Form 常驻挂载，首次打开即正确回显（#19 同源问题）
      forceRender
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} disabled={submitting} onClick={() => void handleSubmit()}>
              {isEdit ? '保存' : '登记'}
            </Button>
          </Space>
        </div>
      }
    >
      {submitError && (
        <Alert type="error" showIcon message="保存失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      <Alert
        type={isEdit ? 'info' : 'warning'}
        showIcon
        message={isEdit ? '仅可修改平台名、描述与启用状态' : '平台编码创建后不可修改'}
        description={
          isEdit
            ? `平台编码「${record?.platform_code}」创建后不可修改；平台名仅用于界面展示（监控标签取编码），修改不影响存量应用与监控配置。`
            : '平台编码由小写字母、数字、连字符组成且不超过 64 字符；一旦创建即作为应用归属平台的唯一标识，随应用归属派生为监控标签、用于平台维度聚合，请谨慎填写。'
        }
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          name="platform_code"
          label="平台编码"
          rules={[
            { required: true, message: '请输入平台编码' },
            {
              pattern: PLATFORM_CODE_PATTERN,
              message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）',
            },
          ]}
          extra="小写字母 / 数字 / 连字符，≤ 64；创建后不可改"
        >
          <Input placeholder="例如 ecommerce / public-data-auth" maxLength={64} disabled={isEdit} />
        </Form.Item>
        <Form.Item
          name="platform_name"
          label="平台名"
          rules={[{ required: true, whitespace: true, message: '请输入平台名' }]}
        >
          <Input placeholder="例如 公共数据授权运营平台" maxLength={64} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="选填，说明该平台的用途或包含的应用范围" maxLength={200} />
        </Form.Item>
        {isEdit && (
          <Form.Item
            name="enabled"
            label="状态"
            extra="停用后该平台不可被新增 / 编辑应用条目选用；已挂靠的存量应用保留历史值"
          >
            <Select
              placeholder="选择状态"
              options={[
                { value: true, label: '启用' },
                { value: false, label: '停用' },
              ]}
            />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  )
}

export default PlatformManagementPage
