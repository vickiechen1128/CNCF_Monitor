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
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { applicationDictApi } from '../../api/resources'
import type { ApplicationDict } from '../../types/resource'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'

const { Text } = Typography

/** 应用编码规范（§5.19 / 决策 92：小写字母 / 数字 / 连字符，≤ 64，创建后不可改） */
const APP_CODE_PATTERN = /^[a-z0-9-]{1,64}$/

/** 应用字典维护页（Module_07 §5.19 / 决策 92，与业务管理页同构：code 不可变 + 展示名必填 + 停用不删除）。 */
export function ApplicationDictPage() {
  const [list, setList] = useState<ApplicationDict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [drawer, setDrawer] = useState<{ open: boolean; record: ApplicationDict | null }>({ open: false, record: null })
  const [actingCode, setActingCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await applicationDictApi.list()
      setList(res.data?.list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '应用字典加载失败，请稍后重试')
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
        d.app_code.toLowerCase().includes(kw) ||
        d.app_name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw),
    )
  }, [list, keyword])

  const toggleStatus = useCallback(
    async (record: ApplicationDict, next: ApplicationDict['status']) => {
      setActingCode(record.app_code)
      try {
        await applicationDictApi.update(record.app_code, { status: next })
        message.success(next === 'enabled' ? `「${record.app_name}」已启用` : `「${record.app_name}」已停用`)
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
  const openEdit = (record: ApplicationDict) => setDrawer({ open: true, record })

  const columns: ColumnsType<ApplicationDict> = [
    {
      title: '应用编码',
      dataIndex: 'app_code',
      key: 'app_code',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '应用名',
      dataIndex: 'app_name',
      key: 'app_name',
      width: 200,
      // §5.19 / 决策 22 同口径：停用条目以「应用名（已停用）」标识
      render: (v: string, r: ApplicationDict) =>
        r.status === 'enabled' ? <EllipsisText>{v}</EllipsisText> : <EllipsisText>{`${v}（已停用）`}</EllipsisText>,
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
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: ApplicationDict['status']) =>
        v === 'enabled' ? <Badge status="success" text="已启用" /> : <Badge status="default" text="已停用" />,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_: unknown, r: ApplicationDict) => {
        const enabled = r.status === 'enabled'
        return (
          <Space size={0}>
            <Button type="link" size="small" onClick={() => openEdit(r)}>
              编辑
            </Button>
            <Popconfirm
              title={enabled ? '停用应用' : '启用应用'}
              description={
                enabled
                  ? `停用后「${r.app_name}」不再可供新增 / 编辑资源选用，存量资源保留历史值，采集与聚合不受影响。`
                  : `启用后「${r.app_name}」恢复为新资源可选用。`
              }
              okText={enabled ? '确认停用' : '确认启用'}
              okButtonProps={enabled ? { danger: true } : undefined}
              cancelText="取消"
              onConfirm={() => void toggleStatus(r, enabled ? 'disabled' : 'enabled')}
            >
              <Button type="link" size="small" loading={actingCode === r.app_code}>
                {enabled ? '停用' : '启用'}
              </Button>
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
              登记应用
            </Button>
          </Space>
        }
      >
        {error && (
          <Alert
            type="error"
            showIcon
            message="应用字典加载失败，请稍后重试"
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
              placeholder="搜索应用编码 / 名称 / 描述"
              style={{ width: 220 }}
              value={keyword}
              onSearch={(v) => setKeyword(v)}
              onChange={(e) => e.target.value === '' && setKeyword('')}
            />
          </FilterItem>
        </FilterBar>
        <Table<ApplicationDict>
          rowKey="app_code"
          dataSource={filtered}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无应用，请点击「登记应用」创建" /> }}
          pagination={{ ...TABLE_PAGINATION, showSizeChanger: true }}
        />
        <ApplicationDictDrawer
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

interface ApplicationDictDrawerProps {
  open: boolean
  /** 编辑态为行 record；登记态为 null */
  record: ApplicationDict | null
  onCancel: () => void
  onSuccess: () => void
}

interface ApplicationDictFormValues {
  app_code?: string
  app_name: string
  description?: string
  /** 表单内用布尔承载启用状态（Switch），提交时转为 status 枚举 */
  enabled?: boolean
}

/** 应用字典登记 / 受限编辑抽屉（§5.19 红线）：登记含编码规范校验；编辑仅开放 应用名/描述/状态 */
export function ApplicationDictDrawer({ open, record, onCancel, onSuccess }: ApplicationDictDrawerProps) {
  const [form] = Form.useForm<ApplicationDictFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isEdit = !!record

  useEffect(() => {
    if (!open) return
    form.resetFields()
    // 编辑回显：编码只读展示（提交载荷不含 app_code，§5.19 红线①）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    if (record) {
      form.setFieldsValue({
        app_code: record.app_code,
        app_name: record.app_name,
        description: record.description,
        enabled: record.status === 'enabled',
      })
    } else {
      form.setFieldsValue({ enabled: true })
    }
  }, [open, record, form])

  const handleSubmit = async () => {
    let values: ApplicationDictFormValues
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
        await applicationDictApi.update(record.app_code, {
          app_name: values.app_name,
          description: values.description,
          status: values.enabled ? 'enabled' : 'disabled',
        })
        message.success('应用信息已更新')
      } else {
        await applicationDictApi.create({
          app_code: values.app_code!,
          app_name: values.app_name,
          description: values.description,
        })
        message.success('应用已登记')
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
      title={isEdit ? '编辑应用' : '登记应用'}
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
        message={isEdit ? '仅可修改应用名、描述与启用状态' : '应用编码创建后不可改'}
        description={
          isEdit
            ? `应用编码「${record?.app_code}」创建后不可修改；应用名仅用于界面展示（监控标签取编码），修改不影响存量资源与监控配置。`
            : '应用编码是资源归属应用的不可变键（如 order-service、pay-service），随资源标签用于按应用聚合监控，登记后不可修改。'
        }
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          name="app_code"
          label="应用编码"
          rules={[
            { required: true, message: '请输入应用编码' },
            {
              pattern: APP_CODE_PATTERN,
              message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）',
            },
          ]}
          extra="小写字母 / 数字 / 连字符，≤ 64；创建后不可改"
        >
          <Input placeholder="如 order-service、pay-service" disabled={isEdit} />
        </Form.Item>
        <Form.Item
          name="app_name"
          label="应用名"
          rules={[{ required: true, whitespace: true, message: '请输入应用名' }]}
        >
          <Input placeholder="如 订单服务、支付服务" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="应用字典用途说明（可选）" />
        </Form.Item>
        {isEdit && (
          <Form.Item
            name="enabled"
            label="启用状态"
            valuePropName="checked"
            extra="停用后该应用不再可供新增 / 编辑资源选用；存量资源保留历史值，采集与聚合不受影响"
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  )
}

export default ApplicationDictPage
