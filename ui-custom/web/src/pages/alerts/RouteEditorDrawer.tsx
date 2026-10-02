/**
 * 「路由规则」编辑抽屉（v0.3-b 三段式表单 T08-F11 + v0.3-c 联动 T08-F13）。
 *
 * 契约：Module_08 §11.7（编辑态三段式）/ §5.2（字段清单）；设计提案 §3.4（编辑态）/ §3.5（控件选型）。
 * 三段式：① 这条规则管什么（名称 + 父路由）；② 匹配什么告警（标签条件，多条 AND，留空 = 匹配所有）；
 * ③ 发给谁、怎么发（接收人 / 分组键 / 发送节奏 / 继续匹配 / 启用）。
 *
 * v0.3-c 联动（T08-F13）：
 * - 接收人下拉数据源 = **已启用通知渠道**派生的 `ReceiverName()`（与 `useRouteEditor.knownReceivers` 同源）；
 *   引用悬空（不在已启用清单内）→ 选项与字段下方红字「未定义」+ **保存阻断**（抽屉内即拦，不回传页面）；
 * - 分组键 Tags 提供标签名联想，复用 `GET /silences/label-options`（决策 71，零后端改动），
 *   长列表按 `ROUTE_LABEL_OPTION_LIMIT` 限制条数；
 * - `repeat_interval` 不整除 `group_interval` → 警告级提示（不阻断）+ 明示 AM 向上取整后的实际值；
 *   `group_interval` 兼作通知管道 timeout、`continue` 语义 → 说明性 Tooltip。
 *
 * 保存语义：本地预检只做「提示」，真正阻断与保存由页面（useRouteEditor.save）统一裁决：
 * - 接收人悬空（引用未启用 / 不存在的渠道）→ 红字阻断；
 * - `repeat_interval` 不整除 `group_interval` → 警告级提示（不阻断，与 AM 向上取整行为一致）。
 *
 * Step 3.7：含 Form 且 `useEffect(open)` 回显 → 强制 `forceRender`，禁用 `destroyOnHidden/Close`。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
} from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import {
  parseRouteDuration,
  validateRouteNodeFields,
  validateRouteReceivers,
  type RouteEditNode,
  type RouteIssue,
} from './routeTree'
import {
  ROUTE_LABEL_OPTION_LIMIT,
  filterRouteLabelOptions,
  isRouteLabelClipped,
  toRouteLabelSelectOptions,
  useRouteLabelOptions,
} from './routeLabels'

const { Text } = Typography

/** 分组间隔 Tooltip（AM 官方：单次发送耗时超过 group_interval 会被取消 → 漏发） */
const GROUP_INTERVAL_TIMEOUT_TIP =
  '分组间隔同时充当通知管道的超时：单次发送耗时超过它会被取消导致漏发，请留出余量'

/** 继续匹配 Tooltip（默认 false = 命中即停） */
const CONTINUE_TIP = '关闭 = 命中即停（只走这一条）；打开 = 命中后继续匹配后续同级路由，可能收到多条通知'

/** 分组键说明（留空 = 不分组） */
const GROUP_BY_TIP = '留空 = 不分组（同批告警合并为一条通知）；填写标签名则按该标签分组，如 alertname、instance'

/** 接收人说明（PRD §11.7：下拉数据源 = 已启用通知渠道） */
const RECEIVER_TIP =
  '下拉只列已启用通知渠道的接收人（ReceiverName()）；引用已停用 / 已删除渠道的接收人会判为悬空并阻断保存'

/** 接收人悬空红字（PRD §11.7：引用悬空 → 红字「未定义」） */
const RECEIVER_DANGLING_TIP = '未定义：该接收人不在已启用通知渠道清单内（渠道已停用或已删除），请改选后再保存'

/** 毫秒 → 人类可读时长（仅用于「AM 向上取整到 X」提示；取最大可整除单位） */
function formatDurationMs(ms: number): string {
  const units: [string, number][] = [
    ['d', 24 * 60 * 60 * 1000],
    ['h', 60 * 60 * 1000],
    ['m', 60 * 1000],
    ['s', 1000],
  ]
  for (const [suffix, size] of units) {
    if (ms % size === 0) return `${ms / size}${suffix}`
  }
  return `${ms}ms`
}

export interface RouteEditorParentOption {
  value: string
  label: string
}

export interface RouteEditorDrawerProps {
  open: boolean
  /** 正在编辑的节点；`null` = 新建（此时父路由默认顶层） */
  node: RouteEditNode | null
  /** 父路由下拉选项（已排除自身与其后代，避免成环） */
  parentOptions: RouteEditorParentOption[]
  /** 接收人下拉候选项：已启用渠道接收人 ∪ 树中已引用（后者供导入存量值回显，见 F13） */
  receiverOptions: string[]
  /**
   * 已启用通知渠道派生的接收人名（`ReceiverName()`，与 `useRouteEditor.knownReceivers` 同源）。
   * F13：下拉数据源 + 悬空判定基准；缺省回落 `receiverOptions`。
   * 取不到清单（非管理员）时传空数组 → **不判定、不阻断**（沿用 validateRouteReceivers 口径）。
   */
  knownReceivers?: string[]
  /** 全树预检结论（抽屉按 node_id 过滤本节点相关结论展示） */
  issues: RouteIssue[]
  onClose: () => void
  /** 提交（新建时 `id` 为空串，由页面分配）；返回 true 表示已接受并关闭 */
  onSubmit: (node: RouteEditNode) => void
}

interface RouteFormValues {
  name?: string
  parent_id?: string
  matchers?: { name?: string; value?: string; is_regex?: boolean; exclude?: boolean }[]
  receiver?: string
  group_by?: string[]
  group_wait?: string
  group_interval?: string
  repeat_interval?: string
  continue?: boolean
  enabled?: boolean
}

/** 表单值 → 编辑态节点（id 沿用入参；新建为空串，由页面分配） */
function toRouteEditNode(node: RouteEditNode | null, values: RouteFormValues): RouteEditNode {
  const parentId = values.parent_id ?? ''
  return {
    id: node?.id ?? '',
    parent_id: parentId,
    name: (values.name ?? '').trim(),
    matchers: (values.matchers ?? []).map((m) => ({
      name: (m?.name ?? '').trim(),
      value: m?.value ?? '',
      is_regex: m?.is_regex === true,
      is_equal: m?.exclude !== true,
    })),
    receiver: (values.receiver ?? '').trim(),
    group_by: (values.group_by ?? []).map((g) => String(g).trim()).filter((g) => g.length > 0),
    group_wait: (values.group_wait ?? '').trim(),
    group_interval: (values.group_interval ?? '').trim(),
    repeat_interval: (values.repeat_interval ?? '').trim(),
    continue: values.continue === true,
    order: node?.order ?? 0,
    enabled: values.enabled !== false,
    raw_yaml: '',
  }
}

export function RouteEditorDrawer({
  open,
  node,
  parentOptions,
  receiverOptions,
  knownReceivers,
  issues,
  onClose,
  onSubmit,
}: RouteEditorDrawerProps) {
  const [form] = Form.useForm<RouteFormValues>()
  /** 新建：页面传入 `id` 为空串的空白节点模板 */
  const isNew = !node || node.id === ''
  const isRoot = node?.parent_id === ''

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      name: node?.name ?? '',
      parent_id: node?.parent_id ?? '',
      matchers: (node?.matchers ?? []).map((m) => ({
        name: m.name,
        value: m.value,
        is_regex: m.is_regex,
        exclude: !m.is_equal,
      })),
      receiver: node?.receiver ?? '',
      group_by: node?.group_by ?? [],
      group_wait: node?.group_wait ?? '',
      group_interval: node?.group_interval ?? '',
      repeat_interval: node?.repeat_interval ?? '',
      continue: node?.continue ?? false,
      enabled: node?.enabled ?? true,
    })
  }, [open, node, form])

  // 本节点相关结论（全树结论按 node_id 过滤；新建节点尚无 id，只看整树级结论）
  const nodeIssues = useMemo(() => {
    const id = node?.id ?? ''
    return (issues ?? []).filter((i) => i.node_id === id || i.node_id === '')
  }, [issues, node])

  // 接收人下拉数据源 = 已启用通知渠道（ReceiverName()）；缺省回落候选项全集
  const enabledReceiverNames = useMemo(
    () => (knownReceivers ?? receiverOptions ?? []).map((n) => (n ?? '').trim()).filter((n) => n.length > 0),
    [knownReceivers, receiverOptions],
  )
  /** 清单为空 = 取不到（如非管理员）→ 不判定悬空（与 validateRouteReceivers 同口径） */
  const canJudgeReceiver = enabledReceiverNames.length > 0
  const enabledReceiverSet = useMemo(() => new Set(enabledReceiverNames), [enabledReceiverNames])

  // 实时预检（随表单值变化）：matcher 合法性 + 时长合法性 + 不整除警告 + 接收人悬空
  const watched = Form.useWatch([], form) as RouteFormValues | undefined
  const draftIssues = useMemo(() => {
    const values = watched ?? {}
    const draft = toRouteEditNode(node, { ...values, name: values.name ?? node?.name ?? '' })
    return [...validateRouteNodeFields(draft), ...validateRouteReceivers([draft], enabledReceiverNames)]
  }, [watched, node, enabledReceiverNames])

  const liveIssues = useMemo(() => {
    const merged = [...nodeIssues]
    const seen = new Set(merged.map((i) => `${i.code}:${i.field}`))
    for (const i of draftIssues) {
      const key = `${i.code}:${i.field}`
      if (!seen.has(key)) {
        seen.add(key)
        merged.push(i)
      }
    }
    return merged
  }, [nodeIssues, draftIssues])

  const blocking = liveIssues.filter((i) => i.level === 'error')
  const warnings = liveIssues.filter((i) => i.level === 'warning')

  /** 当前接收人是否悬空（不在已启用渠道清单内；清单为空时不判定） */
  const currentReceiver = ((watched?.receiver ?? node?.receiver ?? '') as string).trim()
  const receiverDangling = canJudgeReceiver && currentReceiver !== '' && !enabledReceiverSet.has(currentReceiver)

  // 下拉：已启用渠道接收人 ∪ 当前引用值（存量手写 receiver 仍可回显，但标红「未定义」）
  const receiverSelectOptions = useMemo(() => {
    const names = new Set(receiverOptions ?? [])
    for (const n of enabledReceiverNames) names.add(n)
    if (node?.receiver) names.add(node.receiver)
    return Array.from(names)
      .filter((n) => n.trim().length > 0)
      .sort()
      .map((n) => ({
        value: n,
        // 悬空项红字标注（清单取不到时不标注，避免误判）
        label:
          canJudgeReceiver && !enabledReceiverSet.has(n) ? (
            <Space size={4}>
              {n}
              <Text type="danger">未定义</Text>
            </Space>
          ) : (
            n
          ),
      }))
  }, [receiverOptions, enabledReceiverNames, enabledReceiverSet, canJudgeReceiver, node])

  // 分组键联想：复用静默页 label-options（决策 71）；取数失败静默降级为空（可手写输入）
  const labelOptions = useRouteLabelOptions(open)
  const [labelKeyword, setLabelKeyword] = useState('')
  const filteredLabels = useMemo(
    () => filterRouteLabelOptions(labelOptions, labelKeyword),
    [labelOptions, labelKeyword],
  )
  const labelSelectOptions = useMemo(() => toRouteLabelSelectOptions(filteredLabels), [filteredLabels])
  const labelClipped = isRouteLabelClipped(labelOptions.length, filteredLabels.length)

  /** 不整除时 AM 实际生效值（向上取整到分组间隔的整数倍），用于友好提示 */
  const repeatAdjustHint = useMemo(() => {
    const interval = parseRouteDuration(((watched?.group_interval ?? node?.group_interval ?? '') as string).trim())
    const repeat = parseRouteDuration(((watched?.repeat_interval ?? node?.repeat_interval ?? '') as string).trim())
    if (interval === null || repeat === null || interval <= 0 || repeat % interval === 0) return null
    return formatDurationMs(Math.ceil(repeat / interval) * interval)
  }, [watched, node])

  const handleFinish = (values: RouteFormValues) => {
    // 阻断：存在 error 级结论时不回传（页面 save 亦会二次预检，双保险）
    if (blocking.length > 0) return
    onSubmit(toRouteEditNode(node, values))
  }

  return (
    <Drawer
      title={
        <Space size={8}>
          {isNew ? '新建路由规则' : '编辑路由规则'}
          {isRoot && <Text type="secondary" style={{ fontSize: 12 }}>（顶层路由，不可删除、不可移动）</Text>}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={720}
      forceRender
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            onClick={form.submit}
            disabled={blocking.length > 0}
            data-testid="route-editor-save"
          >
            保存
          </Button>
        </Space>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        保存后不会立即生效：会生成整份 alertmanager.yml 并提交挂载，进入变更单人工确认后才写盘 reload。
      </Text>

      <Form form={form} layout="vertical" onFinish={handleFinish} preserve={false}>
        {/* ① 这条规则管什么 */}
        <Text strong>① 这条规则管什么</Text>
        <Form.Item
          name="name"
          label="路由名称"
          extra="仅用于界面识别，会以注释形式写进配置（Alertmanager 本身没有名称字段）"
        >
          <Input placeholder="如：主机宕机专用" maxLength={64} />
        </Form.Item>
        <Form.Item
          name="parent_id"
          label="父路由"
          extra="决定这条规则挂在哪一层：层级 = 告警先经过父路由、再进入本条"
        >
          <Select
            options={parentOptions}
            placeholder="请选择父路由（顶层路由留此项为空）"
            disabled={isRoot}
            allowClear
          />
        </Form.Item>

        <Divider style={{ margin: '8px 0 16px' }} />

        {/* ② 匹配什么告警 */}
        <Text strong>② 匹配什么告警</Text>
        <Text type="secondary" style={{ display: 'block', margin: '4px 0 8px' }}>
          多个条件为「且」关系；留空 = 匹配所有告警（等同顶层路由的兜底行为）
        </Text>
        <Form.List name="matchers">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
                  <Form.Item {...restField} name={[name, 'name']} style={{ marginBottom: 0 }}>
                    <Input placeholder="标签名，如 severity" style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item {...restField} name={[name, 'value']} style={{ marginBottom: 0 }}>
                    <Input placeholder="值，如 critical" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, 'is_regex']}
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Checkbox>正则</Checkbox>
                  </Form.Item>
                  <Form.Item
                    {...restField}
                    name={[name, 'exclude']}
                    valuePropName="checked"
                    style={{ marginBottom: 0 }}
                  >
                    <Checkbox>排除</Checkbox>
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    aria-label="删除匹配条件"
                    icon={<MinusCircleOutlined />}
                    onClick={() => remove(name)}
                  />
                </Space>
              ))}
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() => add({ name: '', value: '', is_regex: false, exclude: false })}
              >
                添加匹配条件
              </Button>
            </>
          )}
        </Form.List>

        <Divider style={{ margin: '16px 0' }} />

        {/* ③ 发给谁、怎么发 */}
        <Text strong>③ 发给谁、怎么发</Text>
        <Form.Item
          name="receiver"
          label="接收人"
          extra={
            receiverDangling ? (
              <Text type="danger" data-testid="route-editor-receiver-dangling">
                {RECEIVER_DANGLING_TIP}
              </Text>
            ) : (
              RECEIVER_TIP
            )
          }
        >
          <Select
            options={receiverSelectOptions}
            placeholder="请选择接收人"
            allowClear
            showSearch
            optionFilterProp="value"
          />
        </Form.Item>
        <Form.Item
          name="group_by"
          label="分组键"
          extra={
            <Space direction="vertical" size={0}>
              <span>{GROUP_BY_TIP}</span>
              {labelClipped && (
                <Text type="secondary">
                  标签较多：仅显示前 {ROUTE_LABEL_OPTION_LIMIT} 个，输入关键词可精确查找
                </Text>
              )}
            </Space>
          }
        >
          <Select
            mode="tags"
            tokenSeparators={[',']}
            options={labelSelectOptions}
            onSearch={setLabelKeyword}
            placeholder="输入分组键后回车，如 alertname、instance"
            allowClear
          />
        </Form.Item>

        <Card size="small" title="发送节奏" style={{ marginBottom: 16 }}>
          <Space size={12} wrap style={{ display: 'flex' }}>
            <Form.Item name="group_wait" label="初次等待" style={{ marginBottom: 0, minWidth: 140 }}>
              <Input placeholder="如 30s" />
            </Form.Item>
            <Form.Item
              name="group_interval"
              label={
                <Tooltip title={GROUP_INTERVAL_TIMEOUT_TIP}>
                  <span>分组间隔</span>
                </Tooltip>
              }
              style={{ marginBottom: 0, minWidth: 140 }}
            >
              <Input placeholder="如 5m" />
            </Form.Item>
            <Form.Item name="repeat_interval" label="重复间隔" style={{ marginBottom: 0, minWidth: 140 }}>
              <Input placeholder="如 4h" />
            </Form.Item>
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            初次等待 = 告警攒多久发第一条；分组间隔 = 同组下一批等多久；重复间隔 = 同一告警多久重发一次。
            支持 ms/s/m/h/d/w/y 及其组合（如 1h30m）。
          </Text>
          {/* 不整除：AM 会向上取整 → 警告级（可保存），把实际生效值说清楚 */}
          {repeatAdjustHint && (
            <Text type="warning" data-testid="route-editor-repeat-adjust" style={{ fontSize: 12, display: 'block' }}>
              重复间隔不是分组间隔的整数倍，保存后 Alertmanager 会向上取整到 {repeatAdjustHint}
              （可以保存；如需精确节奏，请把分组间隔调成能整除的值）。
            </Text>
          )}
        </Card>

        <Space size={48}>
          <Form.Item
            name="continue"
            label={
              <Tooltip title={CONTINUE_TIP}>
                <span>继续匹配</span>
              </Tooltip>
            }
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="enabled"
            label="启用"
            valuePropName="checked"
            extra="关闭后该路由及其子路由不会写进配置"
          >
            <Switch />
          </Form.Item>
        </Space>
      </Form>

      {/* 预检结论：红字阻断（error）/ 黄字警告（warning，不阻断） */}
      {blocking.length > 0 && (
        <div data-testid="route-editor-blocking">
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 16 }}
            message="本条路由存在必须修正的问题（保存会被阻断）"
            description={
              <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                {blocking.map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
              </ul>
            }
          />
        </div>
      )}
      {warnings.length > 0 && (
        <div data-testid="route-editor-warning">
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message="可以保存，但建议确认"
            description={
              <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                {warnings.map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
              </ul>
            }
          />
        </div>
      )}
    </Drawer>
  )
}
