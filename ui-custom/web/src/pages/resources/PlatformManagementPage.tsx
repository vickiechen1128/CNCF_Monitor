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
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { appPlatformRelApi, applicationDictApi, platformDictApi } from '../../api/resources'
import type { AppPlatformRel, ApplicationDict, PlatformDict } from '../../types/resource'
import { Callout } from '../../components/Callout'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { DictLifecycleNotice } from './DictLifecycleNotice'
import {
  DictionaryAuditDrawer,
  DictionaryMergeButton,
  DictionaryRevokeButton,
  DictionaryStatusBadge,
} from './DictionaryLifecycleActions'
import {
  DICTIONARY_ACTIVE_STATUSES,
  dictionaryNameSuffix,
  dictionaryStatusOf,
  isDictionaryTerminal,
} from './dictionaryLifecycle'

const { Text } = Typography

/** 平台页专属生命周期补充说明（仅在「查看规则」抽屉中展示，避免首屏堆叠说明块） */
const PLATFORM_LIFECYCLE_RULES = [
  '平台编码是应用归属平台的权威标识，随应用归属派生为监控标签，用于按平台维度聚合，创建后不可修改。',
  '平台是「平台 → 应用 → 服务 → 实例」层级的顶层组织单元：应用必须归属至少一个平台，且恰有一个主平台。',
  '停用平台不删除：存量应用保留原归属，仅不再可被新增 / 编辑应用条目选用。',
]

/** 平台编码规范（§5.21 / 契约快照 §5C：小写字母 / 数字 / 连字符，≤ 64，创建后不可改） */
const PLATFORM_CODE_PATTERN = /^[a-z0-9-]{1,64}$/

/**
 * 平台字典维护页（Module_07 §5.21 / 决策 104；契约快照 §5C）
 *
 * 与业务 / 应用字典页同构：编码不可变 + 展示名必填 + 停用不删除（无删除入口）。
 * 平台是四层实体层级 `platform(1) → app(N) → service(M) → instance(K)` 的顶层，
 * 应用经「所属平台」挂靠（**必挂**，D42：应用必须归属至少一个平台且恰有一个主平台）；
 * 本页提供「关联应用」反查入口，用于回答「本平台下有哪些应用」。
 */
export function PlatformManagementPage() {
  const [list, setList] = useState<PlatformDict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [drawer, setDrawer] = useState<{ open: boolean; record: PlatformDict | null }>({ open: false, record: null })
  const [actingCode, setActingCode] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  /** D42 / G4：关联应用反查抽屉——回答「本平台下有哪些应用」。 */
  const [appsTarget, setAppsTarget] = useState<PlatformDict | null>(null)

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
    return list.filter((d) => {
      const status = dictionaryStatusOf(d)
      if (scope === 'active' && !DICTIONARY_ACTIVE_STATUSES.includes(status)) return false
      if (!kw) return true
      return (
        d.platform_code.toLowerCase().includes(kw) ||
        d.platform_name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [list, keyword, scope])

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
      // §5.21 / 决策 22 同口径：停用 / 终态条目以名称后缀标识
      render: (v: string, r: PlatformDict) => (
        <EllipsisText>{`${v}${dictionaryNameSuffix(dictionaryStatusOf(r))}`}</EllipsisText>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      width: 260,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : <Text type="secondary">-</Text>),
    },
    {
      title: '引用数',
      dataIndex: 'reference_count',
      key: 'reference_count',
      width: 90,
      render: (v?: number) => <Text type={v ? undefined : 'secondary'}>{v ?? 0}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (_: unknown, r: PlatformDict) => (
        <DictionaryStatusBadge status={dictionaryStatusOf(r)} mergedInto={r.merged_into} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 320,
      render: (_: unknown, r: PlatformDict) => {
        const status = dictionaryStatusOf(r)
        const terminal = isDictionaryTerminal(status)
        const mergeOptions = list
          .filter((item) => dictionaryStatusOf(item) === 'enabled' && item.platform_code !== r.platform_code)
          .map((item) => ({ code: item.platform_code, name: item.platform_name }))
        return (
          <Space size={0} wrap>
            <Button type="link" size="small" onClick={() => setAppsTarget(r)}>
              关联应用
            </Button>
            <Button type="link" size="small" disabled={terminal} onClick={() => openEdit(r)}>
              编辑
            </Button>
            {!terminal && (
              <Button
                type="link"
                size="small"
                danger={r.enabled}
                loading={actingCode === r.platform_code}
                onClick={() => toggleStatus(r)}
              >
                {r.enabled ? '停用' : '启用'}
              </Button>
            )}
            <DictionaryRevokeButton
              name={r.platform_name}
              status={status}
              referenceCount={r.reference_count ?? 0}
              onRevoke={() => platformDictApi.revoke(r.platform_code)}
              onDone={() => void load()}
            />
            <DictionaryMergeButton
              name={r.platform_name}
              status={status}
              referenceCount={r.reference_count ?? 0}
              options={mergeOptions}
              onMerge={(targetCode) => platformDictApi.merge(r.platform_code, targetCode)}
              onDone={() => void load()}
            />
          </Space>
        )
      },
    },
  ]

  return (
    <MainLayout>
      <Card
        title="平台管理"
        extra={
          <Space>
            <Button onClick={() => setAuditOpen(true)}>变更日志</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              登记平台
            </Button>
          </Space>
        }
      >
        {/* F7 / 决策 112：字典 ≠ 可删除对象（四字典页共用同一份文案） */}
        <DictLifecycleNotice extraRules={PLATFORM_LIFECYCLE_RULES} />
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
          <FilterItem label="范围" width={200}>
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as 'active' | 'all')}
              options={[
                { value: 'active', label: '有效条目' },
                { value: 'all', label: '全部' },
              ]}
            />
          </FilterItem>
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
        <PlatformAppsDrawer record={appsTarget} onClose={() => setAppsTarget(null)} />
        <DictionaryAuditDrawer
          dictionaryType="platform"
          open={auditOpen}
          onClose={() => setAuditOpen(false)}
        />
      </Card>
    </MainLayout>
  )
}

interface PlatformAppsDrawerProps {
  /** 非空即打开；展示该平台下关联的应用（经 `app_platform_rel` 反查）。 */
  record: PlatformDict | null
  onClose: () => void
}

/**
 * 平台关联应用抽屉（D42 / G4）
 *
 * 组织视角下「平台 = 应用的聚合」，故平台页必须能回答「本平台下有哪些应用」。
 * 数据经 `GET /app-platform-rel?platform_code=...` 反查关联 + 应用字典解析展示名，
 * 只读展示，不在此处维护关系（关系在应用管理页维护）。
 */
export function PlatformAppsDrawer({ record, onClose }: PlatformAppsDrawerProps) {
  const [rels, setRels] = useState<AppPlatformRel[]>([])
  const [apps, setApps] = useState<ApplicationDict[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!record) return
    let cancelled = false
    // 打开抽屉即重置加载态；沿用本模块既有抓取 effect 模式（同 ApplicationDictPage）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    Promise.all([appPlatformRelApi.list({ platform_code: record.platform_code }), applicationDictApi.list()])
      .then(([relRes, appRes]) => {
        if (cancelled) return
        setRels(relRes.data?.list ?? [])
        setApps(appRes.data?.list ?? [])
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '关联应用加载失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [record])

  const appName = useCallback(
    (code: string) => {
      const hit = apps.find((a) => a.app_code === code)
      if (!hit) return code
      return `${hit.app_name}${dictionaryNameSuffix(dictionaryStatusOf(hit))}`
    },
    [apps],
  )

  const columns: ColumnsType<AppPlatformRel> = [
    {
      title: '应用编码',
      dataIndex: 'app_code',
      key: 'app_code',
      width: 180,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '应用名',
      dataIndex: 'app_code',
      key: 'app_name',
      width: 200,
      render: (v: string) => <EllipsisText>{appName(v)}</EllipsisText>,
    },
    {
      title: '归属',
      dataIndex: 'is_primary',
      key: 'is_primary',
      width: 90,
      render: (v: boolean) =>
        v ? <Badge status="processing" text="主平台" /> : <Text type="secondary">关联平台</Text>,
    },
  ]

  return (
    <Drawer
      title={record ? `「${record.platform_name}」下的应用` : '关联应用'}
      open={!!record}
      onClose={onClose}
      width={560}
      forceRender
    >
      <Callout tone="info" title="应用是平台的组织单元">
        应用↔平台关系在「应用管理」页维护；此处只读展示。每个应用必须有且仅有一个主平台，主平台标记即该应用的归属方向。
      </Callout>
      {error && <Alert type="error" showIcon message="关联应用加载失败" description={error} style={{ marginTop: 16 }} />}
      <Table<AppPlatformRel>
        rowKey="rel_id"
        dataSource={rels}
        loading={loading}
        columns={columns}
        size="small"
        style={{ marginTop: 16 }}
        scroll={TABLE_SCROLL_X}
        locale={{ emptyText: <Empty description="该平台下暂无关联应用" /> }}
        pagination={{ ...TABLE_PAGINATION, showSizeChanger: false }}
      />
    </Drawer>
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
