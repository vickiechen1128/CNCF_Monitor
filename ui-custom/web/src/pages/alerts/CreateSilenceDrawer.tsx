/**
 * 创建静默抽屉：匹配器(matchers) + 起止时间 + 原因，即时生效（不进 M09 变更单）。
 * 契约：决策 56 授权提示「静默影响当前授权网域」；越权创建被拒展示行级错误。
 * v1.16 决策 71：
 *  - 改用 Form.List 驱动匹配条件行（修复原 Form.useWatch 鸡生蛋渲染死锁，dev-feedback 第 10 条）；
 *  - 标签分组联想（label-options 聚合端点，四层并集：系统与采集 / 标签模板 / 规则标签 / 网域标识）；
 *  - is_regex=true 前端正则预检（AM 侧 400 兜底保留）；
 *  - 「从资源清单选择实例」生成 resource_id matcher（实例级静默，UUID 稳定不随 IP/端口变化）；
 *    置于匹配条件行之后作「快捷添加」入口，与手填行的关系由引导文案说明（用户反馈 2026-09-11）；
 *  - 实例选择对标 M07 双框布局（用户确认 2026-09-11）：「CI 类型」框 + 「实例名」框；
 *    数据按所选类型懒加载 + keyword 服务端搜索（M07 §6.1 resource_category 必填），
 *    替代原五类并发合并（每类 100 条会被静默截断）；
 *  - initialValues 移入组件内（修复模块层 dayjs 冻结导致默认起止时间漂移）。
 *  - 字段名用「告警标签」而非「标签名」，说明文案显式区分「告警携带的标签」与
 *    「标签模板管理」中的模板标签，避免歧义（用户反馈 2026-09-11）。
 *  - 「生效方式」动线（用户反馈 2026-09-11）：立即生效（默认，starts_at=提交时刻）/
 *    定时生效（starts_at=所选未来时间，创建后为「待生效」，到点 AM 自动启用）。
 *    后端 starts_at 本就原样透传、状态按时间推导（silence/service.go silenceStatusAt），
 *    待生效此前不可达的问题在动线而不在后端能力。
 */
import { useEffect, useRef, useState } from 'react'
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Collapse,
  Drawer,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Switch,
  DatePicker,
  Typography,
  Divider,
} from 'antd'
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined, AimOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { CreateSilencePayload } from '../../types/alertmanager'
import type { Resource, ResourceCategory } from '../../types/resource'
import { readValidateErrors, alertmanagerSilenceApi } from '../../api/alertmanager'
import { resourceApi } from '../../api/resources'

const { Text } = Typography

export interface CreateSilenceDrawerProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: CreateSilencePayload) => Promise<void>
}

interface MatcherRow {
  name: string
  value: string
  is_equal: boolean
  is_regex: boolean
}

/** 生效方式：now=立即生效（默认）；scheduled=定时生效（创建后「待生效」，到点自动启用） */
type StartMode = 'now' | 'scheduled'

interface FormValues {
  matchers: MatcherRow[]
  start_mode: StartMode
  starts_at: dayjs.Dayjs | null
  ends_at: dayjs.Dayjs
  comment: string
}

/** 每次挂载重建默认值（组件随 drawerSeq key 重挂）：默认立即生效 24h、1 个空匹配器。 */
function makeInitialValues(): FormValues {
  return {
    matchers: [{ name: '', value: '', is_equal: true, is_regex: false }],
    start_mode: 'now',
    starts_at: dayjs(),
    ends_at: dayjs().add(24, 'hour'),
    comment: '',
  }
}

/**
 * 资源下拉展示文案（实例名口径同 M01：host=instance_name、db/mw=instance_ip、app=service_name、generic=target_name）。
 * 类别已由「CI 类型」框表达，括号内不再重复类别名；数据库/中间件保留子类型（如 MySQL）；
 * IP 缺失时直接省略括号，不再显示「-」占位符（用户反馈 2026-09-11）。
 */
function resourceDisplay(r: Resource): string {
  const cat = r.resource_category
  if (cat === 'host') {
    const h = r as { instance_name?: string; private_ip?: string }
    return h.private_ip ? `${h.instance_name || '-'}（${h.private_ip}）` : h.instance_name || '-'
  }
  if (cat === 'database') {
    const d = r as { instance_ip?: string; port?: number; database_type?: string }
    const addr = d.port ? `${d.instance_ip || '-'}:${d.port}` : d.instance_ip || '-'
    return d.database_type ? `${addr}（${d.database_type}）` : addr
  }
  if (cat === 'middleware') {
    const m = r as { instance_ip?: string; port?: number; middleware_type?: string }
    const addr = m.port ? `${m.instance_ip || '-'}:${m.port}` : m.instance_ip || '-'
    return m.middleware_type ? `${addr}（${m.middleware_type}）` : addr
  }
  if (cat === 'application') {
    const a = r as { service_name?: string }
    return a.service_name || '-'
  }
  const g = r as { target_name?: string; instance_ip?: string; port?: number }
  const name = g.target_name || g.instance_ip || '-'
  const addr = g.port ? `${g.instance_ip}:${g.port}` : g.instance_ip || ''
  return addr && addr !== name ? `${name}（${addr}）` : name
}

/** 正则预检（决策 71）：is_regex=true 时 value 必须是合法正则；AM 侧 400 兜底保留。 */
function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

/**
 * 「从资源清单选择实例」的 CI 类型选项（对标 M07 资源页五类 Tab）。
 * M07 §6.1：GET /resources 的 resource_category 必填（缺失直接 400），
 * 故按所选类型单类拉取 + keyword 服务端搜索（每类仍限 100，但可搜到任意实例，不再被截断）。
 */
// 注意：不用 ReadonlyArray——rc-select 的 options prop 是可变数组类型（readonly 不兼容）
const CI_TYPE_OPTIONS: { value: ResourceCategory; label: string }[] = [
  { value: 'host', label: '主机' },
  { value: 'database', label: '数据库' },
  { value: 'middleware', label: '中间件' },
  { value: 'application', label: '应用' },
  { value: 'generic_target', label: '通用目标' },
]

type CiType = ResourceCategory

function ciTypeLabel(v: CiType): string {
  return CI_TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v
}

export function CreateSilenceDrawer({ open, onClose, onSubmit }: CreateSilenceDrawerProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [initialValues] = useState<FormValues>(makeInitialValues)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Array<{ message: string }>>([])
  // matcher 标签分组选项（决策 71 四层并集）；加载失败降级为无联想（自由输入仍是合法能力）。
  const [labelGroupOptions, setLabelGroupOptions] = useState<
    NonNullable<React.ComponentProps<typeof AutoComplete>['options']>
  >([])
  // 从资源清单选择实例（对标 M07 双框布局）：CI 类型 + 实例名搜索。
  // 数据按所选类型懒加载 + keyword 服务端搜索（解决原五类并发合并时每类 100 条截断）。
  const [ciType, setCiType] = useState<CiType>('host')
  const [resources, setResources] = useState<Resource[]>([])
  const [resourcesLoading, setResourcesLoading] = useState(false)
  // 请求序号：类型切换/搜索词变化的乱序响应只采纳最后一次（防止旧结果覆盖新结果）。
  const searchSeqRef = useRef(0)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 按类型 + 关键字拉取资源（M07 §6.1 resource_category 必填；keyword 走服务端搜索）。 */
  const fetchResources = (category: CiType, keyword: string) => {
    const seq = ++searchSeqRef.current
    setResourcesLoading(true)
    resourceApi
      .list({ resource_category: category, keyword: keyword.trim() || undefined, page_size: 100 })
      .then((res) => {
        if (seq !== searchSeqRef.current) return
        setResources(res.data?.list ?? [])
      })
      .catch(() => {
        if (seq === searchSeqRef.current) setResources([])
      })
      .finally(() => {
        if (seq === searchSeqRef.current) setResourcesLoading(false)
      })
  }
  // Form.List 的写操作经 ref 供实例选择器使用（Form.List render prop 内赋值）。
  // 填充策略（用户反馈 2026-09-11）：优先填入第一个空行（告警标签与匹配值均空），
  // 避免已有空行时选择实例又追加一条、留下空白行让用户手动清理；无空行才追加。
  const fillOrAddMatcherRef = useRef<((row?: MatcherRow) => void) | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // 联想选项与资源清单均在抽屉打开时加载，失败静默降级（不阻塞表单）。
    alertmanagerSilenceApi
      .getLabelOptions()
      .then((res) => {
        if (cancelled) return
        const groups = res.data?.groups ?? []
        setLabelGroupOptions(
          groups.map((g) => ({
            label: <span>{g.label}</span>,
            title: g.label,
            options: g.items.map((it) => ({
              value: it.name,
              title: it.description || it.name,
              label: (
                <span>
                  <Text code>{it.name}</Text>
                  {it.description && (
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                      {it.description}
                    </Text>
                  )}
                </span>
              ),
            })),
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setLabelGroupOptions([])
      })
    // 实例清单：默认主机类拉取（M07 §6.1 resource_category 必填），搜索时带 keyword 服务端过滤；
    // 经微任务异步化规避 set-state-in-effect（fetchResources 内部同步 setLoading）
    void Promise.resolve().then(() => {
      if (!cancelled) fetchResources('host', '')
    })
    return () => {
      cancelled = true
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [open])

  const handleFinish = async (values: FormValues) => {
    setSubmitting(true)
    setError(null)
    setErrors([])

    // 生效方式动线：立即生效=提交时刻起；定时生效=用户所选未来时间（创建后「待生效」）。
    // 时间合法性（必填/晚于当前/晚于生效时间）均由字段 rules 内联校验（格子标红），
    // 提交能走到这里即已通过。
    const scheduled = values.start_mode === 'scheduled'
    const effectiveStarts = scheduled ? (values.starts_at as dayjs.Dayjs) : dayjs()

    // 过滤空匹配器（name/value 都为空）
    const matchers = (values.matchers ?? [])
      .filter((m) => m.name.trim() && m.value.trim())
      .map((m) => ({
        name: m.name.trim(),
        value: m.value.trim(),
        is_equal: m.is_equal,
        is_regex: m.is_regex,
      }))

    if (matchers.length === 0) {
      setError('至少需要一个有效的匹配条件（告警标签和匹配值都不能为空）')
      setSubmitting(false)
      return
    }

    const payload: CreateSilencePayload = {
      matchers,
      starts_at: effectiveStarts.toISOString(),
      ends_at: values.ends_at.toISOString(),
      comment: values.comment.trim(),
    }

    try {
      await onSubmit(payload)
      message.success(
        scheduled
          ? '静默创建成功，到生效时间后将自动启用（当前状态：待生效）'
          : '静默创建成功，已即时生效',
      )
      setSubmitting(false)
      onClose()
    } catch (e) {
      const detail = readValidateErrors(e)
      if (detail?.items) {
        setErrors(detail.items)
        const total = detail.items.length
        setError(`${total} 项校验错误：${detail.note ?? ''}`)
      } else {
        setError(e instanceof Error ? e.message : '创建静默失败，请稍后重试')
      }
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title="创建静默"
      open={open}
      onClose={onClose}
      width={680}
      forceRender={true}
      extra={
        <Button type="primary" loading={submitting} onClick={form.submit}>
          提交创建
        </Button>
      }
    >
      {/* 决策 56 授权约束：默认收起，点击展开，不挤占表单首屏（参考 M01 Collapse ghost 模式） */}
      <Collapse
        ghost
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          {
            key: 'silence-scope-note',
            label: (
              <span>
                <InfoCircleOutlined style={{ color: '#1677ff', marginRight: 8 }} />
                <Text strong>静默只对你有权限的网域生效</Text>
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                  点击展开说明
                </Text>
              </span>
            ),
            children: (
              <Text>
                本静默仅作用于你账号有权限的网域；若匹配条件包含权限之外的网域，创建会被系统拒绝。
              </Text>
            ),
          },
        ]}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={handleFinish}
      >
        <div>
          <Text strong>匹配条件</Text>
          <Divider style={{ margin: '8px 0 16px 0' }} />
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            按<Text strong>告警携带的标签</Text>匹配（如 <Text code>alertname</Text> 告警名称、
            <Text code>severity</Text> 级别、<Text code>resource_id</Text> 实例），
            不是「标签模板管理」里的模板标签；多条条件同时满足才会被静默（AND 关系）。
          </Text>

          <Form.List name="matchers">
            {(fields, { add, remove }) => {
              fillOrAddMatcherRef.current = (row?: MatcherRow) => {
                if (!row) {
                  add({ name: '', value: '', is_equal: true, is_regex: false })
                  return
                }
                // 优先填入第一个空行；无空行才追加（避免残留空白行）
                const list = (form.getFieldValue('matchers') ?? []) as MatcherRow[]
                const emptyIdx = list.findIndex((m) => !m?.name?.trim() && !m?.value?.trim())
                if (emptyIdx >= 0) {
                  form.setFieldValue(['matchers', emptyIdx, 'name'], row.name)
                  form.setFieldValue(['matchers', emptyIdx, 'value'], row.value)
                } else {
                  add(row)
                }
              }
              return (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="start" style={{ marginBottom: 12 }}>
                      <Form.Item
                        name={[field.name, 'name']}
                        label="告警标签"
                        rules={[{ required: true, message: '请选择或输入告警标签' }]}
                        style={{ marginBottom: 0, width: 240 }}
                      >
                        <AutoComplete
                          options={labelGroupOptions}
                          placeholder="选择或输入，如 alertname"
                          filterOption={(input, option) =>
                            String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'value']}
                        label="匹配值"
                        rules={[
                          { required: true, message: '请输入匹配值' },
                          {
                            validator: (_rule, value: string) => {
                              const row = (form.getFieldValue('matchers') ?? [])[field.name] as
                                | MatcherRow
                                | undefined
                              if (!row?.is_regex || !value) return Promise.resolve()
                              return isValidRegex(value)
                                ? Promise.resolve()
                                : Promise.reject(new Error('正则表达式不合法，请检查语法'))
                            },
                          },
                        ]}
                        style={{ marginBottom: 0, width: 200 }}
                      >
                        <Input placeholder="如 critical" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'is_equal']}
                        label="相等"
                        valuePropName="checked"
                        initialValue={true}
                        style={{ marginBottom: 0, width: 60 }}
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item
                        noStyle
                        shouldUpdate={(prev, next) =>
                          prev.matchers?.[field.name]?.is_regex !==
                          next.matchers?.[field.name]?.is_regex}
                      >
                        {() => (
                          <Form.Item
                            name={[field.name, 'is_regex']}
                            label="正则"
                            valuePropName="checked"
                            initialValue={false}
                            style={{ marginBottom: 0, width: 60 }}
                          >
                            <Switch
                              onChange={() => {
                                // 切换正则开关后立即重校验匹配值（非法正则即时暴露）
                                void form
                                  .validateFields([['matchers', field.name, 'value']])
                                  .catch(() => undefined)
                              }}
                            />
                          </Form.Item>
                        )}
                      </Form.Item>
                      {fields.length > 1 && (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => remove(field.name)}
                          style={{ marginTop: 30 }}
                        />
                      )}
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={() => add({ name: '', value: '', is_equal: true, is_regex: false })}
                    style={{ width: '100%', marginBottom: 16 }}
                  >
                    添加匹配条件
                  </Button>

                  {/* 快捷添加（决策 71）：与上方手填行的关系由引导文案显式说明——
                      选中实例 = 自动填入上方空行（无空行才新增一条 resource_id 匹配条件）。
                      双框布局对标 M07（用户确认 2026-09-11）：CI 类型框先收敛范围，
                      实例名框只列该类型资源，搜索走服务端 keyword。 */}
                  <div style={{ marginBottom: 16 }}>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                      <AimOutlined style={{ marginRight: 6 }} />
                      不想手填标签？直接从资源清单选择实例：上方有空行时自动填入，
                      否则新增一条 <Text code>resource_id</Text> 匹配条件（实例级静默）：
                    </Text>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Form.Item label="CI 类型" htmlFor="silence-instance-category" style={{ marginBottom: 0, width: 150 }}>
                        <Select
                          id="silence-instance-category"
                          value={ciType}
                          options={CI_TYPE_OPTIONS}
                          onChange={(v) => {
                            setCiType(v)
                            setResources([])
                            fetchResources(v, '')
                          }}
                        />
                      </Form.Item>
                      <Form.Item label="实例名" htmlFor="silence-instance-pick" style={{ marginBottom: 0, flex: 1 }}>
                        <Select
                          key={ciType}
                          id="silence-instance-pick"
                          showSearch
                          allowClear
                          loading={resourcesLoading}
                          placeholder={`搜索${ciTypeLabel(ciType)}实例…`}
                          style={{ width: '100%' }}
                          value={null}
                          options={resources.map((r) => ({ value: r.resource_id, label: resourceDisplay(r) }))}
                          filterOption={false}
                          onSearch={(kw) => {
                            // 服务端 keyword 搜索（300ms 防抖）；类型切换经 key 重挂清空输入
                            if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
                            searchTimerRef.current = setTimeout(() => fetchResources(ciType, kw), 300)
                          }}
                          onChange={(v) => {
                            if (v) fillOrAddMatcherRef.current?.({ name: 'resource_id', value: v, is_equal: true, is_regex: false })
                          }}
                          notFoundContent={resourcesLoading ? '加载中…' : '未找到匹配的实例'}
                        />
                      </Form.Item>
                    </div>
                  </div>
                </>
              )
            }}
          </Form.List>
        </div>

        {/* 生效方式 / 生效时间 / 失效时间同行紧凑排布（用户反馈 2026-09-11：原竖排
            DatePicker 占满整行观感松散）；放不下时自动换行。DatePicker 固定 280 宽，
            时间校验错误内联显示在字段下方（格子标红），不再走顶部 Alert。 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 16 }}>
          <Form.Item name="start_mode" label="生效方式" style={{ marginBottom: 12, width: 190 }}>
            <Radio.Group
              optionType="button"
              options={[
                { value: 'now', label: '立即生效' },
                { value: 'scheduled', label: '定时生效' },
              ]}
              onChange={(e) => {
                // 切到定时生效时清掉 preserve 的旧 starts_at（挂载时刻的兜底值），
                // 否则 required 校验恒过、用户未选时间也会以旧时间提交
                if (e.target.value === 'scheduled') form.setFieldValue('starts_at', null)
              }}
            />
          </Form.Item>

          {/* 定时生效才出现生效时间选择器（must be future，否则等价于立即生效） */}
          <Form.Item noStyle shouldUpdate={(p, n) => p.start_mode !== n.start_mode}>
            {() =>
              form.getFieldValue('start_mode') === 'scheduled' ? (
                <Form.Item
                  name="starts_at"
                  label="生效时间"
                  rules={[
                    { required: true, message: '请选择生效时间' },
                    {
                      validator: (_rule, v: dayjs.Dayjs | null) =>
                        !v || v.isAfter(dayjs())
                          ? Promise.resolve()
                          : Promise.reject(new Error('定时生效时间需晚于当前时间；如需现在开始请选择「立即生效」')),
                    },
                  ]}
                  style={{ marginBottom: 12, width: 280 }}
                >
                  <DatePicker
                    showTime
                    format="YYYY-MM-DD HH:mm:ss"
                    placeholder="选择生效时间"
                    style={{ width: '100%' }}
                    disabledDate={(d) => d.isBefore(dayjs(), 'day')}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>

          <Form.Item
            name="ends_at"
            label="失效时间"
            dependencies={['start_mode', 'starts_at']}
            rules={[
              { required: true, message: '请选择失效时间' },
              {
                validator: (_rule, v: dayjs.Dayjs | null) => {
                  if (!v) return Promise.resolve()
                  const scheduled = form.getFieldValue('start_mode') === 'scheduled'
                  if (scheduled) {
                    const starts = form.getFieldValue('starts_at') as dayjs.Dayjs | null
                    if (!starts) return Promise.resolve() // 生效时间的 required 已拦
                    return v.isAfter(starts)
                      ? Promise.resolve()
                      : Promise.reject(new Error('失效时间必须晚于生效时间'))
                  }
                  return v.isAfter(dayjs())
                    ? Promise.resolve()
                    : Promise.reject(new Error('失效时间必须晚于当前时间'))
                },
              },
            ]}
            style={{ marginBottom: 12, width: 280 }}
          >
            <DatePicker
              showTime
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="选择失效时间"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="comment"
          label="静默原因"
          rules={[{ required: true, message: '请填写静默原因，便于后续追溯' }]}
        >
          <Input.TextArea
            placeholder="请说明为什么要静默这些告警，例如：正在灰度发布，预期会产生告警..."
            rows={3}
          />
        </Form.Item>
      </Form>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="创建失败"
          description={
            <div>
              <Text>{error}</Text>
              {errors.length > 0 && (
                <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                  {errors.map((err, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          }
        />
      )}
    </Drawer>
  )
}
