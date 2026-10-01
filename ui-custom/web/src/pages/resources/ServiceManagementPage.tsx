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
import { serviceDictApi } from '../../api/resources'
import type { ServiceDict } from '../../types/resource'
import { Callout } from '../../components/Callout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { DictLifecycleNotice } from './DictLifecycleNotice'

const { Text } = Typography

/** 服务编码规范（§5.22 / 契约快照 §5D：小写字母 / 数字 / 连字符，≤ 64，创建后不可改） */
const SERVICE_CODE_PATTERN = /^[a-z0-9-]{1,64}$/

/**
 * 服务字典维护页（Module_07 §5.22 / 决策 105；契约快照 §5D）
 *
 * 与应用字典页同构：编码不可变 + 展示名必填 + 停用不删除（无删除入口）。
 * 服务为四层实体层级的第三层；{v2.49 决策 112} 应用↔服务 / 服务↔业务的关系权威由字典
 * `app_code` / `biz_code` 承载（资源行字段仅为实例归属的镜像）。
 */
export function ServiceManagementPage() {
  const [list, setList] = useState<ServiceDict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [drawer, setDrawer] = useState<{ open: boolean; record: ServiceDict | null }>({ open: false, record: null })
  const [actingCode, setActingCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await serviceDictApi.list()
      setList(res.data?.list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '服务字典加载失败，请稍后重试')
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
        d.service_code.toLowerCase().includes(kw) ||
        d.service_name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw),
    )
  }, [list, keyword])

  const toggleStatus = useCallback(
    (record: ServiceDict) => {
      const next = !record.enabled
      const actionText = next ? '启用' : '停用'
      Modal.confirm({
        title: `确认${actionText}服务「${record.service_name}」？`,
        content: next
          ? '启用后，该服务重新可被新增 / 编辑资源选用。'
          : '停用后，该服务不再可被新增 / 编辑资源选用；已挂靠该服务的存量资源保留历史值，仍可正常展示。',
        okText: `确认${actionText}`,
        cancelText: '取消',
        okButtonProps: next ? undefined : { danger: true },
        onOk: async () => {
          setActingCode(record.service_code)
          try {
            await serviceDictApi.update(record.service_code, { enabled: next })
            message.success(`服务「${record.service_name}」已${actionText}`)
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
  const openEdit = (record: ServiceDict) => setDrawer({ open: true, record })

  const columns: ColumnsType<ServiceDict> = [
    {
      title: '服务编码',
      dataIndex: 'service_code',
      key: 'service_code',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '服务名',
      dataIndex: 'service_name',
      key: 'service_name',
      width: 200,
      // §5.22 / 决策 22 同口径：停用条目以「服务名（已停用）」标识
      render: (v: string, r: ServiceDict) =>
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
      render: (_: unknown, r: ServiceDict) => (
        <Space size={12}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openEdit(r)}>
            编辑
          </Button>
          {/* 低频状态操作（停用 / 启用）收进「更多」菜单（对齐原型 ServiceManagementPage） */}
          <Dropdown
            trigger={['click']}
            menu={{
              items: [{ key: 'toggle', label: r.enabled ? '停用' : '启用', danger: r.enabled }],
              onClick: () => toggleStatus(r),
            }}
          >
            <Button type="link" size="small" style={{ padding: 0 }} loading={actingCode === r.service_code}>
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
        title="服务管理"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              登记服务
            </Button>
          </Space>
        }
      >
        {/* F7 / 决策 112：字典 ≠ 可删除对象（四字典页共用同一份文案） */}
        <DictLifecycleNotice />
        <div style={{ marginBottom: 16 }}>
          <Callout tone="info" title="服务编码是资源归属服务的权威标识">
            服务编码会随资源标签一起用于按服务维度聚合监控，<Text strong>创建后不可修改</Text>；
            停用服务不删除，仅不再可被新增 / 编辑资源选用，存量资源保留原归属。
            服务归属为可选字段，仅「应用服务」与「其他监控目标」可挂（主机 / 数据库 / 中间件不挂，基础设施非服务）。
          </Callout>
        </div>
        {error && (
          <Alert
            type="error"
            showIcon
            message="服务字典加载失败，请稍后重试"
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
              placeholder="搜索服务编码 / 名称 / 描述"
              style={{ width: 220 }}
              value={keyword}
              onSearch={(v) => setKeyword(v)}
              onChange={(e) => e.target.value === '' && setKeyword('')}
            />
          </FilterItem>
        </FilterBar>
        <Table<ServiceDict>
          rowKey="service_code"
          dataSource={filtered}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无服务，请点击「登记服务」创建" /> }}
          pagination={{ ...TABLE_PAGINATION, showSizeChanger: true }}
        />
        <ServiceDictDrawer
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

interface ServiceDictDrawerProps {
  open: boolean
  /** 编辑态为行 record；登记态为 null */
  record: ServiceDict | null
  onCancel: () => void
  onSuccess: () => void
}

interface ServiceDictFormValues {
  service_code?: string
  service_name: string
  description?: string
  /** 表单内用布尔承载启用状态，提交即为契约的 `enabled` */
  enabled?: boolean
}

/**
 * 服务字典登记 / 受限编辑抽屉（§5.22 红线 / 契约快照 §5D）
 *
 * 登记含编码规范校验；编辑仅开放 服务名 / 描述 / 启用状态，`service_code` 只读展示且不随请求体。
 */
export function ServiceDictDrawer({ open, record, onCancel, onSuccess }: ServiceDictDrawerProps) {
  const [form] = Form.useForm<ServiceDictFormValues>()
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
        service_code: record.service_code,
        service_name: record.service_name,
        description: record.description,
        enabled: record.enabled,
      })
    } else {
      form.setFieldsValue({ enabled: true })
    }
  }, [open, record, form])

  const handleSubmit = async () => {
    let values: ServiceDictFormValues
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
        await serviceDictApi.update(record.service_code, {
          service_name: values.service_name,
          description: values.description,
          enabled: !!values.enabled,
        })
        message.success('服务信息已更新')
      } else {
        await serviceDictApi.create({
          service_code: values.service_code!,
          service_name: values.service_name,
          description: values.description,
        })
        message.success(`服务「${values.service_name}」已登记`)
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
      title={isEdit ? `编辑服务「${record?.service_name ?? ''}」` : '登记服务'}
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
        message={isEdit ? '仅可修改服务名、描述与启用状态' : '服务编码创建后不可修改'}
        description={
          isEdit
            ? `服务编码「${record?.service_code}」创建后不可修改；服务名仅用于界面展示（监控标签取编码），修改不影响存量资源与监控配置。`
            : '服务编码由小写字母、数字、连字符组成且不超过 64 字符；一旦创建即作为资源归属服务的唯一标识，随标签用于服务维度聚合，请谨慎填写。'
        }
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          name="service_code"
          label="服务编码"
          rules={[
            { required: true, message: '请输入服务编码' },
            {
              pattern: SERVICE_CODE_PATTERN,
              message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）',
            },
          ]}
          extra="小写字母 / 数字 / 连字符，≤ 64；创建后不可改"
        >
          <Input placeholder="例如 order-api / pay-callback" maxLength={64} disabled={isEdit} />
        </Form.Item>
        <Form.Item
          name="service_name"
          label="服务名"
          rules={[{ required: true, whitespace: true, message: '请输入服务名' }]}
        >
          <Input placeholder="例如 订单接口服务" maxLength={64} />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="选填，说明该服务的用途或所属应用范围" maxLength={200} />
        </Form.Item>
        {isEdit && (
          <Form.Item
            name="enabled"
            label="状态"
            extra="停用后该服务不可被新增 / 编辑资源选用；已挂靠的存量资源保留历史值"
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

export default ServiceManagementPage
