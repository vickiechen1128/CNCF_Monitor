import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined, StarFilled, StarOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { appPlatformRelApi, applicationDictApi, platformDictApi } from '../../api/resources'
import type { AppPlatformRel, ApplicationDict, PlatformDict } from '../../types/resource'
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

/** 应用编码规范（§5.19 / 决策 92：小写字母 / 数字 / 连字符，≤ 64，创建后不可改） */
const APP_CODE_PATTERN = /^[a-z0-9-]{1,64}$/

/** 停用后缀（§5.21 / 决策 22 同口径：停用条目以「名（已停用）」标识） */
const DISABLED_SUFFIX = '（已停用）'

/**
 * 应用↔平台关联增量同步（决策 111 / §5.24 / D42）
 *
 * 顺序固定为「新增 → 主平台切换 → 解绑」：
 * - 先补齐新增关联（一律以 `is_primary=false` 建立），保证后续解绑时应用仍至少保留一个平台；
 * - 再切换主平台（服务端 `SetPrimary=true` 会先清同应用其余主平台）；
 * - 最后解绑本次未保留的关联——此时既不会删到零个平台，也不会删掉当前主平台。
 *
 * 原「解绑 → 新增」顺序在 D42 落地后会失败：切换唯一平台时先解绑会让应用短暂零平台而被拒。
 * **任一请求失败即抛错**，由调用方提示——关系变更不静默丢弃。
 */
async function syncAppPlatformRels(
  appCode: string,
  nextCodes: string[],
  primaryCode: string | undefined,
  original: AppPlatformRel[],
) {
  // ① 新增：本次新选的关联（主平台统一在 ② 切换，避免与存量主平台冲突）
  const created: AppPlatformRel[] = []
  for (const code of nextCodes.filter((c) => !original.some((r) => r.platform_code === c))) {
    const res = await appPlatformRelApi.create({ app_code: appCode, platform_code: code, is_primary: false })
    if (res.data) created.push(res.data)
  }
  const current = [...original.filter((r) => nextCodes.includes(r.platform_code)), ...created]
  // ② 主平台切换：置新主（服务端 SetPrimary=true 会先清同应用其余主平台）。
  // 表单已保证主平台必填且属于已选集合，故此处不需要「取消主平台」分支（D42 禁止）。
  if (primaryCode) {
    const target = current.find((r) => r.platform_code === primaryCode && !r.is_primary)
    if (target) await appPlatformRelApi.update(target.rel_id, { is_primary: true })
  }
  // ③ 解绑：本次未保留的关联
  for (const rel of original.filter((r) => !nextCodes.includes(r.platform_code))) {
    await appPlatformRelApi.remove(rel.rel_id)
  }
}

/** 应用字典维护页（Module_07 §5.19 / 决策 92，与业务管理页同构：code 不可变 + 展示名必填 + 停用不删除）。 */
export function ApplicationDictPage() {
  const [list, setList] = useState<ApplicationDict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [drawer, setDrawer] = useState<{ open: boolean; record: ApplicationDict | null }>({ open: false, record: null })
  const [actingCode, setActingCode] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  // 平台字典（决策 104）：仅用于「所属平台」下拉选项与「所属平台」列展示名解析
  const [platforms, setPlatforms] = useState<PlatformDict[]>([])
  // 决策 111：应用↔平台关联（`app_platform_rel`）为平台关系权威，列表「平台」列据此反查
  const [rels, setRels] = useState<AppPlatformRel[]>([])

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
    // 平台字典失败不影响应用字典主流程：缺条时列按 platform_code 回退展示
    try {
      const pf = await platformDictApi.list()
      setPlatforms(pf.data?.list ?? [])
    } catch {
      setPlatforms([])
    }
    // 关联失败同样降级为空集合：列按「无关联」展示 '-'
    try {
      const rl = await appPlatformRelApi.list()
      setRels(rl.data?.list ?? [])
    } catch {
      setRels([])
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
        d.app_code.toLowerCase().includes(kw) ||
        d.app_name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [list, keyword, scope])

  /** app_code → 该应用的平台关联集合（决策 111：M:N，按关联建立顺序展示） */
  const relsByApp = useMemo(() => {
    const map = new Map<string, AppPlatformRel[]>()
    for (const rel of rels) {
      const hit = map.get(rel.app_code)
      if (hit) hit.push(rel)
      else map.set(rel.app_code, [rel])
    }
    return map
  }, [rels])

  /** 平台编码 → 展示名（缺条目回退编码，非启用平台加对应状态后缀） */
  const platformLabel = (code: string) => {
    const hit = platforms.find((p) => p.platform_code === code)
    if (!hit) return code
    return `${hit.platform_name}${dictionaryNameSuffix(dictionaryStatusOf(hit))}`
  }

  const toggleStatus = useCallback(
    async (record: ApplicationDict, next: 'enabled' | 'disabled') => {
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
      // §5.19 / 决策 22 同口径：停用 / 终态条目以名称后缀标识
      render: (v: string, r: ApplicationDict) => (
        <EllipsisText>{`${v}${dictionaryNameSuffix(dictionaryStatusOf(r))}`}</EllipsisText>
      ),
    },
    {
      // 决策 111：应用↔平台改为 M:N——「平台」列罗列全部关联平台 Tag，
      // 主平台加「（主）」标记、停用平台加「（已停用）」、无关联显示 '-'
      title: '所属平台',
      key: 'platform_codes',
      width: 240,
      render: (_: unknown, r: ApplicationDict) => {
        const appRels = relsByApp.get(r.app_code) ?? []
        if (appRels.length === 0) return <Text type="secondary">-</Text>
        return (
          <Space size={[4, 4]} wrap>
            {appRels.map((rel) => {
              const disabled = platforms.some(
                (p) => p.platform_code === rel.platform_code && dictionaryStatusOf(p) !== 'enabled',
              )
              return (
                <Tag key={rel.rel_id} color={disabled ? 'default' : 'purple'}>
                  {`${platformLabel(rel.platform_code)}${rel.is_primary ? '（主）' : ''}`}
                </Tag>
              )
            })}
          </Space>
        )
      },
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
      render: (_: unknown, r: ApplicationDict) => (
        <DictionaryStatusBadge status={dictionaryStatusOf(r)} mergedInto={r.merged_into} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 260,
      render: (_: unknown, r: ApplicationDict) => {
        const status = dictionaryStatusOf(r)
        const terminal = isDictionaryTerminal(status)
        const mergeOptions = list
          .filter((item) => dictionaryStatusOf(item) === 'enabled' && item.app_code !== r.app_code)
          .map((item) => ({ code: item.app_code, name: item.app_name }))
        return (
          <Space size={0} wrap>
            <Button type="link" size="small" disabled={terminal} onClick={() => openEdit(r)}>
              编辑
            </Button>
            {!terminal && (
              <Popconfirm
                title={r.status === 'enabled' ? '停用应用' : '启用应用'}
                description={
                  r.status === 'enabled'
                    ? `停用后「${r.app_name}」不再可供新增 / 编辑资源选用，存量资源保留历史值，采集与聚合不受影响。`
                    : `启用后「${r.app_name}」恢复为新资源可选用。`
                }
                okText={r.status === 'enabled' ? '确认停用' : '确认启用'}
                okButtonProps={r.status === 'enabled' ? { danger: true } : undefined}
                cancelText="取消"
                onConfirm={() => void toggleStatus(r, r.status === 'enabled' ? 'disabled' : 'enabled')}
              >
                <Button type="link" size="small" loading={actingCode === r.app_code}>
                  {r.status === 'enabled' ? '停用' : '启用'}
                </Button>
              </Popconfirm>
            )}
            <DictionaryRevokeButton
              name={r.app_name}
              status={status}
              referenceCount={r.reference_count ?? 0}
              onRevoke={() => applicationDictApi.revoke(r.app_code)}
              onDone={() => void load()}
            />
            <DictionaryMergeButton
              name={r.app_name}
              status={status}
              referenceCount={r.reference_count ?? 0}
              options={mergeOptions}
              onMerge={(targetCode) => applicationDictApi.merge(r.app_code, targetCode)}
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
        extra={
          <Space>
            <Button onClick={() => setAuditOpen(true)}>变更日志</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              登记应用
            </Button>
          </Space>
        }
      >
        {/* F7 / 决策 112：字典 ≠ 可删除对象（四字典页共用同一份文案） */}
        <DictLifecycleNotice />
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
          platforms={platforms}
          onCancel={() => setDrawer({ open: false, record: null })}
          onSuccess={() => {
            setDrawer({ open: false, record: null })
            void load()
          }}
        />
        <DictionaryAuditDrawer
          dictionaryType="application"
          open={auditOpen}
          onClose={() => setAuditOpen(false)}
        />
      </Card>
    </MainLayout>
  )
}

interface ApplicationDictDrawerProps {
  open: boolean
  /** 编辑态为行 record；登记态为 null */
  record: ApplicationDict | null
  /** 平台字典（决策 104）：下拉仅列启用项，编辑态已停用 / 已下线的历史值保留展示 */
  platforms?: PlatformDict[]
  onCancel: () => void
  onSuccess: () => void
}

interface ApplicationDictFormValues {
  app_code?: string
  app_name: string
  description?: string
  /** 表单内用布尔承载启用状态（Switch），提交时转为 status 枚举 */
  enabled?: boolean
  /** {v2.49 决策 111 / M07 SRS v2.0} 关联平台（多选）：应用↔平台 M:N 的全部关联平台编码 */
  platform_codes?: string[]
}

/**
 * 应用字典登记 / 受限编辑抽屉（§5.19 红线）
 *
 * 登记含编码规范校验；编辑仅开放 应用名 / 描述 / 状态 / 关联平台。
 * 关联平台为**单字段**（M07 SRS v2.0 §5 / NFR-22）：多选平台后，通过标签左侧星标
 * 切换主平台；只选一个平台时自动成为主平台。
 * **应用字典写链路不再承载 `platform_code`**（决策 111 废弃该单值字段）：
 * 提交序列为「先 PUT 应用基础字段 → 再对 `app-platform-rel` 做增量 diff」。
 */
export function ApplicationDictDrawer({
  open,
  record,
  platforms = [],
  onCancel,
  onSuccess,
}: ApplicationDictDrawerProps) {
  const [form] = Form.useForm<ApplicationDictFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  /** 编辑态打开时反查的存量关联（diff 基线；登记态为空数组） */
  const [originalRels, setOriginalRels] = useState<AppPlatformRel[]>([])
  /** 当前主平台（由标签星标切换）；实际生效值由 effectivePrimaryCode 统一推导 */
  const [primaryCode, setPrimaryCode] = useState<string | undefined>(undefined)
  const isEdit = !!record
  /** 当前已选平台（多选值），驱动主平台星标与停用项回显 */
  const selectedCodes = Form.useWatch('platform_codes', form) as string[] | undefined

  /**
   * 「关联平台」多选下拉：仅启用平台可选；已选中的停用 / 已下线平台保留历史值展示
   * （不可新选，但不清空）。按 `value` 去重，避免启用项与回显项重复渲染。
   */
  const platformOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>()
    for (const p of platforms.filter((x) => dictionaryStatusOf(x) === 'enabled')) {
      options.set(p.platform_code, { value: p.platform_code, label: `${p.platform_name}（${p.platform_code}）` })
    }
    // 历史停用关联回显（决策 111）：已关联但已停用的平台须始终作为可选 / 回显项，
    // 不依赖当前选中态（Form.useWatch 存在一帧滞后，下拉打开瞬间可能尚未同步）。
    // 以加载的存量关联 originalRels 为准，保证「已下线平台」在抽屉打开后即可选 / 回显，
    // 且用户清空选择后仍可重新勾选，不丢失历史关联。
    for (const rel of originalRels) {
      if (options.has(rel.platform_code)) continue
      const hit = platforms.find((p) => p.platform_code === rel.platform_code)
      options.set(rel.platform_code, {
        value: rel.platform_code,
        label: `${hit?.platform_name ?? rel.platform_code}${DISABLED_SUFFIX}`,
      })
    }
    return [...options.values()]
  }, [platforms, originalRels])

  /**
   * 生效主平台：保留用户显式星标（只要仍在已选集合内），否则自动取首个启用平台，
   * 再退化到首个已选平台——保证「应用有且仅有一个主平台」（D42）。
   */
  const effectivePrimaryCode = useMemo(() => {
    const codes = selectedCodes ?? []
    if (primaryCode && codes.includes(primaryCode)) return primaryCode
    const firstEnabled = codes.find((code) =>
      platforms.some((p) => p.platform_code === code && dictionaryStatusOf(p) === 'enabled'),
    )
    return firstEnabled ?? codes[0]
  }, [primaryCode, selectedCodes, platforms])

  useEffect(() => {
    if (!open) return
    form.resetFields()
    // 编辑回显：编码只读展示（提交载荷不含 app_code，§5.19 红线①）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    setPrimaryCode(undefined)
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
    // 平台关联（决策 111）：编辑态反查存量关联作为 diff 基线，登记态无基线
    if (!record) {
      setOriginalRels([])
      return
    }
    appPlatformRelApi
      .list({ app_code: record.app_code })
      .then((res) => {
        const list = res.data?.list ?? []
        setOriginalRels(list)
        form.setFieldsValue({ platform_codes: list.map((r) => r.platform_code) })
        setPrimaryCode(list.find((r) => r.is_primary)?.platform_code)
      })
      .catch(() => setOriginalRels([]))
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
    const nextCodes = values.platform_codes ?? []
    // 主平台兜底：优先星标值，否则按「首个启用平台 → 首个已选平台」推导
    const primaryCode = nextCodes.includes(effectivePrimaryCode ?? '') ? effectivePrimaryCode : undefined
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (record) {
        // ① 应用基础字段（决策 111：不再随请求体发送 platform_code）
        await applicationDictApi.update(record.app_code, {
          app_name: values.app_name,
          description: values.description,
          status: values.enabled ? 'enabled' : 'disabled',
        })
        // ② 平台关联增量 diff（新增 POST / 解绑 DELETE / 主平台切换 PUT）
        await syncAppPlatformRels(record.app_code, nextCodes, primaryCode, originalRels)
        message.success('应用信息已更新')
      } else {
        const appCode = values.app_code!
        // D42：应用必须归属至少一个平台；首个编码即主平台，故把主平台排到最前，
        // 服务端「首个关联自动置主」即可一步到位，无需额外 SetPrimary 往返。
        const orderedPlatforms = primaryCode
          ? [primaryCode, ...nextCodes.filter((code) => code !== primaryCode)]
          : nextCodes
        await applicationDictApi.create({
          app_code: appCode,
          app_name: values.app_name,
          description: values.description,
          platform_codes: orderedPlatforms,
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
        message={isEdit ? '仅可修改应用名、描述、平台关联与启用状态' : '应用编码创建后不可改'}
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
        <Form.Item
          name="platform_codes"
          label="关联平台"
          rules={[
            {
              validator: (_, value?: string[]) =>
                (value ?? []).length > 0
                  ? Promise.resolve()
                  : Promise.reject(new Error('应用必须归属至少一个平台，请选择关联平台')),
            },
          ]}
          extra="必填：至少选择一个平台；点击标签左侧星标设为主平台，仅一个平台时自动为主平台；仅启用平台可新选，已停用的历史关联保留展示"
        >
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="必选，可多选"
            options={platformOptions}
            tagRender={(props) => {
              const code = String(props.value)
              const label = String(props.label ?? code)
              const isPrimary = code === effectivePrimaryCode
              const selectable =
                platforms.some((p) => p.platform_code === code && dictionaryStatusOf(p) === 'enabled')
              return (
                <Tag
                  color={isPrimary ? 'gold' : undefined}
                  closable={props.closable}
                  onClose={props.onClose}
                  style={{ marginInlineEnd: 4 }}
                >
                  <Tooltip
                    title={
                      isPrimary
                        ? '主平台：决定资源兜底归属与告警派单方向'
                        : selectable
                          ? '设为主平台'
                          : '已停用平台不能设为主平台'
                    }
                  >
                    <button
                      type="button"
                      aria-label={isPrimary ? `主平台 ${label}` : `设为主平台 ${label}`}
                      disabled={!selectable && !isPrimary}
                      onClick={(event) => {
                        event.stopPropagation()
                        if (selectable) setPrimaryCode(code)
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        padding: 0,
                        marginRight: 4,
                        cursor: selectable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {isPrimary ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                    </button>
                  </Tooltip>
                  {label}
                </Tag>
              )
            }}
          />
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
