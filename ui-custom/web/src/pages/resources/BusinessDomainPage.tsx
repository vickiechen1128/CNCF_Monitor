import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { businessDomainApi } from '../../api/resources'
import type { BusinessDomain } from '../../types/resource'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'

const { Text } = Typography

/** 业务编码规范（决策 48：小写字母 / 数字 / 连字符，≤ 64，创建后不可改） */
const BIZ_CODE_PATTERN = /^[a-z0-9-]{1,64}$/

/** infra 兜底条目（无业务归属设备，禁止停用，决策 48 红线） */
const INFRA_CODE = 'infra'

/** 业务分组字典维护页（Module_07 §3.1 / §5.18 / §11.1/§11.2，决策 48，M07-OPS-10）。 */
export function BusinessDomainPage() {
  const [list, setList] = useState<BusinessDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [drawer, setDrawer] = useState<{ open: boolean; record: BusinessDomain | null }>({ open: false, record: null })
  const [actingCode, setActingCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await businessDomainApi.list()
      setList(res.data?.list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '业务分组加载失败，请稍后重试')
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
        d.code.toLowerCase().includes(kw) ||
        d.name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw),
    )
  }, [list, keyword])

  const toggleEnabled = useCallback(
    async (record: BusinessDomain, enabled: boolean) => {
      setActingCode(record.code)
      try {
        await businessDomainApi.update(record.code, { enabled })
        message.success(enabled ? `「${record.name}」已启用` : `「${record.name}」已停用`)
        await load()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '状态切换失败，请稍后重试')
      } finally {
        setActingCode(null)
      }
    },
    [load],
  )

  const openCreate = () => setDrawer({ open: true, record: null })
  const openEdit = (record: BusinessDomain) => setDrawer({ open: true, record })

  const columns: ColumnsType<BusinessDomain> = [
    {
      title: '业务编码',
      dataIndex: 'code',
      key: 'code',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '业务名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      // 决策 22 / §11.1：「停用业务以『业务名（已停用）』标识」
      render: (v: string, r: BusinessDomain) =>
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
      render: (v: boolean) =>
        v ? <Badge status="success" text="已启用" /> : <Badge status="default" text="已停用" />,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_: unknown, r: BusinessDomain) => {
        const infra = r.code === INFRA_CODE
        return (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => openEdit(r)}>
              编辑
            </Button>
            <Popconfirm
              title={r.enabled ? '停用业务分组' : '启用业务分组'}
              description={
                r.enabled
                  ? `停用后「${r.name}」不再可供新资源选用，存量资源保留历史值。`
                  : `启用后「${r.name}」恢复为新资源可选用。`
              }
              okText={r.enabled ? '确认停用' : '确认启用'}
              okButtonProps={r.enabled ? { danger: true } : undefined}
              cancelText="取消"
              disabled={infra && r.enabled}
              onConfirm={() => void toggleEnabled(r, !r.enabled)}
            >
              <Tooltip title={infra && r.enabled ? 'infra 为无业务归属设备的兜底分组，不可停用' : undefined}>
                <Button
                  type="link"
                  size="small"
                  loading={actingCode === r.code}
                  disabled={infra && r.enabled}
                >
                  {r.enabled ? '停用' : '启用'}
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <MainLayout>
      <Card
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              登记业务
            </Button>
          </Space>
        }
      >
        {error && (
          <Alert
            type="error"
            showIcon
            message="业务分组加载失败，请稍后重试"
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
              placeholder="搜索业务编码 / 名称 / 描述"
              style={{ width: 220 }}
              value={keyword}
              onSearch={(v) => setKeyword(v)}
              onChange={(e) => e.target.value === '' && setKeyword('')}
            />
          </FilterItem>
        </FilterBar>
        <Table<BusinessDomain>
          rowKey="code"
          dataSource={filtered}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无业务分组" /> }}
          pagination={{ ...TABLE_PAGINATION, showSizeChanger: true }}
        />
        <BusinessDomainDrawer
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

interface BusinessDomainDrawerProps {
  open: boolean
  /** 编辑态为行 record；登记态为 null */
  record: BusinessDomain | null
  onCancel: () => void
  onSuccess: () => void
}

interface BusinessDomainFormValues {
  code?: string
  name: string
  description?: string
  enabled?: boolean
}

/** 业务分组登记 / 受限编辑抽屉（决策 48）：登记含编码规范校验；编辑仅开放名称/描述/状态 */
export function BusinessDomainDrawer({ open, record, onCancel, onSuccess }: BusinessDomainDrawerProps) {
  const [form] = Form.useForm<BusinessDomainFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isEdit = !!record

  useEffect(() => {
    if (!open) return
    form.resetFields()
    // 编辑回显：编码只读展示（提交载荷不含 code，决策 48）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    if (record) {
      form.setFieldsValue({
        code: record.code,
        name: record.name,
        description: record.description,
        enabled: record.enabled,
      })
    } else {
      form.setFieldsValue({ enabled: true })
    }
  }, [open, record, form])

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (record) {
        await businessDomainApi.update(record.code, {
          name: values.name,
          description: values.description,
          enabled: values.enabled ?? true,
        })
        message.success('业务分组已更新')
      } else {
        await businessDomainApi.create({
          code: values.code!,
          name: values.name,
          description: values.description,
        })
        message.success('业务分组已登记')
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
      title={isEdit ? '编辑业务分组' : '登记业务分组'}
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
              {isEdit ? '保存' : '提交'}
            </Button>
          </Space>
        </div>
      }
    >
      {submitError && (
        <Alert type="error" showIcon message="保存失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      <Alert
        type="info"
        showIcon
        message={isEdit ? '仅可修改业务名称、描述与启用状态' : '编码创建后不可改'}
        description={
          isEdit
            ? `业务编码「${record?.code}」创建后不可修改；修改展示名不影响存量资源与监控配置。`
            : '业务编码用于资源归属的不可变键（如 payment、data-api），登记后不可修改。'
        }
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          name="code"
          label="业务编码"
          rules={[
            { required: true, message: '请输入业务编码' },
            {
              pattern: BIZ_CODE_PATTERN,
              message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）',
            },
          ]}
          extra="小写字母 / 数字 / 连字符，≤ 64；创建后不可改"
        >
          <Input placeholder="如 payment、data-api" disabled={isEdit} />
        </Form.Item>
        <Form.Item
          name="name"
          label="业务名称"
          rules={[{ required: true, whitespace: true, message: '请输入业务名称' }]}
        >
          <Input placeholder="如 支付业务、数据接口业务" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="业务分组用途说明（可选）" />
        </Form.Item>
        {isEdit && (
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  )
}

export default BusinessDomainPage