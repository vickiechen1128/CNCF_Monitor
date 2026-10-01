import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  MinusCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { MainLayout } from '../layouts/MainLayout'
import V03Badge from '../components/StageBadge'
import {
  type Matcher,
  type NotifierType,
  type Route,
  mockNotifiers,
  mockRoutes,
} from '../mocks/module-08'

const { Text } = Typography

const notifierColors: Record<NotifierType, string> = {
  feishu: '#3370FF',
  dingtalk: '#0ECDEB',
  email: '#1481FD',
  wecom: '#00B578',
  webhook: '#86909C',
}

const notifierLabels: Record<NotifierType, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  email: '邮件',
  wecom: '企业微信',
  webhook: 'Webhook',
}

function formatMatchers(matchers: Matcher[]): string {
  if (matchers.length === 0) return '（所有告警）'
  return matchers.map((m) => `${m.name}${m.isRegex ? '=~' : '='}"${m.value}"`).join(' 且 ')
}

/** route 段作者模式（决策 113）：手写接管 / 平台管理——顶部徽标展示 */
type RouteAuthorMode = 'handwritten' | 'platform'

const ROUTE_MODE_LABEL: Record<RouteAuthorMode, string> = {
  handwritten: '手写接管',
  platform: '平台管理',
}

const ROUTE_MODE_COLOR: Record<RouteAuthorMode, string> = {
  handwritten: 'default',
  platform: 'processing',
}

/** 常驻顺序说明（提案 §3.2/§3.3：顺序 = 生效顺序，是本功能第一类语义） */
const ROUTE_ORDER_TIP = '路由顺序 = 生效顺序：先匹配到的先生效'

export default function RoutesPage() {
  const [routes, setRoutes] = useState<Route[]>(mockRoutes)
  const [editing, setEditing] = useState<Route | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [form] = Form.useForm()

  // {v0.3} 决策 113：模式开关（T08-F12）为 v0.3-b 待实现，演示期恒为「手写接管」。
  const mode: RouteAuthorMode = 'handwritten'

  const notifierMap = useMemo(() => Object.fromEntries(mockNotifiers.map((n) => [n.id, n])), [])
  const notifierOptions = useMemo(
    () =>
      mockNotifiers
        .filter((n) => n.enabled)
        .map((n) => ({ value: n.id, label: `${n.name}（${notifierLabels[n.type]}）` })),
    []
  )
  /** 路由树：父路由选项（不能选自己） */
  const parentOptions = useMemo(
    () => routes.filter((r) => r.id !== editing?.id).map((r) => ({ value: r.id, label: r.name })),
    [routes, editing]
  )

  /** 按 order 排序、按层级缩进的路由树列表（根恒置顶） */
  const treeRoutes = useMemo(() => {
    const sorted = [...routes].sort((a, b) => a.order - b.order)
    const root = sorted.filter((r) => r.parent_id === null)
    const children = (parentId: string): Route[] => sorted.filter((r) => r.parent_id === parentId)
    const walk = (list: Route[], depth: number): Route[] =>
      list.flatMap((r) => [r, ...walk(children(r.id), depth + 1)])
    return walk(root, 0)
  }, [routes])

  /** 同一父路由下的兄弟（按 order 升序）——顺序调整的作用域 */
  const siblingsOf = (parentId: string | null) =>
    routes.filter((r) => r.parent_id === parentId).sort((a, b) => a.order - b.order)

  /**
   * 兄弟内重排：把 fromId 移到 toId 的位置，再按数组位置重排 order。
   * {v0.3} 提案 §3.2/§3.3：顺序靠**数组位置**承载（AM 的 routes[] 顺序即优先级），
   * order 仅作内部辅助，不再暴露为可填数字框——改用上移/下移 + 拖拽（原生 HTML5 draggable，零新增依赖）。
   */
  function reorder(parentId: string | null, fromId: string, toId: string) {
    if (fromId === toId) return
    setRoutes((prev) => {
      const sibs = prev.filter((r) => r.parent_id === parentId).sort((a, b) => a.order - b.order)
      const fromIdx = sibs.findIndex((r) => r.id === fromId)
      const toIdx = sibs.findIndex((r) => r.id === toId)
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return prev
      const reordered = [...sibs]
      const [moved] = reordered.splice(fromIdx, 1)
      reordered.splice(toIdx, 0, moved)
      const orderMap = new Map(reordered.map((r, i) => [r.id, i]))
      return prev.map((r) => (orderMap.has(r.id) ? { ...r, order: orderMap.get(r.id)! } : r))
    })
  }

  /** 上移 / 下移一格（根路由锁定，不参与） */
  function moveRoute(record: Route, dir: -1 | 1) {
    if (record.parent_id === null) return
    const sibs = siblingsOf(record.parent_id)
    const idx = sibs.findIndex((r) => r.id === record.id)
    const target = sibs[idx + dir]
    if (!target) return
    reorder(record.parent_id, record.id, target.id)
  }

  const columns = [
    {
      title: '路由名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: Route) => (
        <Space>
          {record.parent_id !== null && (
            <span className="text-tertiary" style={{ fontFamily: 'monospace' }}>
              └─
            </span>
          )}
          <Text strong={record.parent_id === null}>{name}</Text>
          {record.parent_id === null && <Tag color="blue">根</Tag>}
        </Space>
      ),
    },
    {
      title: '匹配条件',
      dataIndex: 'matchers',
      key: 'matchers',
      render: (matchers: Matcher[]) => (
        <Typography.Text code>{formatMatchers(matchers)}</Typography.Text>
      ),
    },
    {
      title: '接收人',
      key: 'receiver',
      render: (_: unknown, record: Route) => {
        const notifier = notifierMap[record.receiver_id]
        return notifier ? (
          <Space size={4}>
            <Tag color={notifierColors[notifier.type]}>{notifierLabels[notifier.type]}</Tag>
            <Text>{notifier.name}</Text>
          </Space>
        ) : (
          <Text type="danger">未定义</Text>
        )
      },
    },
    {
      title: '分组键',
      dataIndex: 'group_by',
      key: 'group_by',
      render: (keys: string[]) => keys.join(', '),
    },
    {
      title: '等待 / 间隔 / 重复',
      key: 'timing',
      render: (_: unknown, record: Route) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {record.group_wait} / {record.group_interval} / {record.repeat_interval}
        </Text>
      ),
    },
    {
      title: '继续匹配',
      dataIndex: 'continue',
      key: 'continue',
      width: 90,
      render: (cont: boolean) =>
        cont ? <Tag color="processing">是</Tag> : <Tag>否</Tag>,
    },
    {
      title: '排序',
      key: 'order',
      width: 96,
      render: (_: unknown, record: Route) => {
        // 根路由锁定：对应 AM 的 route: 本体，不可删除、不可移动
        if (record.parent_id === null) {
          return (
            <Tooltip title="根路由（对应 Alertmanager 的 route: 本体），不可删除、不可移动">
              <Text type="secondary" style={{ fontSize: 12 }}>
                <LockOutlined /> 锁定
              </Text>
            </Tooltip>
          )
        }
        const sibs = siblingsOf(record.parent_id)
        const idx = sibs.findIndex((r) => r.id === record.id)
        return (
          <Space size={0}>
            <Tooltip title="上移（提高优先级）">
              <Button
                type="text"
                size="small"
                aria-label="上移"
                icon={<ArrowUpOutlined />}
                disabled={idx <= 0}
                onClick={() => moveRoute(record, -1)}
              />
            </Tooltip>
            <Tooltip title="下移（降低优先级）">
              <Button
                type="text"
                size="small"
                aria-label="下移"
                icon={<ArrowDownOutlined />}
                disabled={idx < 0 || idx >= sibs.length - 1}
                onClick={() => moveRoute(record, 1)}
              />
            </Tooltip>
          </Space>
        )
      },
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 70,
      render: (enabled: boolean, record: Route) => (
        <Switch
          checked={enabled}
          onChange={(checked) => {
            setRoutes((prev) => prev.map((r) => (r.id === record.id ? { ...r, enabled: checked } : r)))
            message.success('路由规则已更新（演示）；正式生效以「配置管理」挂载 + 配置中心确认为准')
          }}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: Route) => (
        <Space size={0}>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditor(record)}>
            编辑
          </Button>
          {record.parent_id !== null && (
            <Popconfirm
              title="删除该路由规则？"
              description="删除后将重新生成 alertmanager.yml 并 reload"
              onConfirm={() => handleDelete(record.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  function openEditor(record: Route) {
    setEditing(record)
    form.setFieldsValue({
      ...record,
      matchers: record.matchers.map((m) => ({ ...m })),
    })
    setIsModalOpen(true)
  }

  function handleOpenModal() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      parent_id: 'rt-root',
      matchers: [],
      group_by: ['alertname'],
      group_wait: '30s',
      group_interval: '5m',
      repeat_interval: '4h',
      continue: true,
      enabled: true,
    })
    setIsModalOpen(true)
  }

  function handleDelete(id: string) {
    setRoutes((prev) => prev.filter((r) => r.id !== id))
    message.success('路由规则已删除（演示）；正式生效以「配置管理」挂载 + 配置中心确认为准')
  }

  /** 新建时 order 由「同父兄弟数量」派生（顺序靠数组位置，不再手填数字） */
  function nextOrder(parentId: string | null) {
    return routes.filter((r) => r.parent_id === parentId).length
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        const parentId = (values.parent_id as string) ?? null
        const base = {
          name: values.name as string,
          parent_id: parentId,
          matchers: (values.matchers ?? []) as Matcher[],
          receiver_id: values.receiver_id as string,
          group_by: (values.group_by ?? []) as string[],
          group_wait: (values.group_wait as string) || '30s',
          group_interval: (values.group_interval as string) || '5m',
          repeat_interval: (values.repeat_interval as string) || '4h',
          continue: values.continue as boolean,
          order: editing ? editing.order : nextOrder(parentId),
          enabled: values.enabled as boolean,
        }
        if (editing) {
          const updated: Route = { ...editing, ...base }
          setRoutes((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
          message.success(`路由规则「${updated.name}」已更新（演示）；正式生效以「配置管理」挂载 + 配置中心确认为准`)
        } else {
          const created: Route = {
            id: `rt-${dayjs().format('HHmmss')}-${Date.now()}`,
            ...base,
          }
          setRoutes((prev) => [...prev, created])
          message.success(`路由规则「${created.name}」已创建（演示）；正式生效以「配置管理」挂载 + 配置中心确认为准`)
        }
        setIsModalOpen(false)
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>
          路由规则
        </Typography.Title>
        <Text type="secondary">
          按告警标签（severity / team / network_domain 等）决定通知到哪个接收人、如何分组、何时重复
        </Text>
      </div>

      {/* {v0.3} 决策 113：route 段「单一作者 + 模式开关」。
          本页为 v0.3 生产基底——v0.3-a 只读路由树 + v0.3-b 表单编辑（模式开关 T08-F12 待实现）；
          MVP 仍以「配置管理」页文件挂载 + 配置中心（M09）变更确认为准，不直接 reload。 */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <Space size={8} wrap>
            <Text strong>{ROUTE_ORDER_TIP}</Text>
            <Tag color={ROUTE_MODE_COLOR[mode]}>{ROUTE_MODE_LABEL[mode]}</Tag>
          </Space>
        }
        description="路由规则对应 Alertmanager route 配置：整份 alertmanager.yml 经「配置管理」页文件挂载，进入配置中心（M09）变更单人工确认后下发生效，不边改边生效。告警规则的内容创作（表达式 / 触发条件 / 标签）在「监控策略」维护。"
      />

      <Card className="page-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
              新建路由规则
            </Button>
            <V03Badge />
            <Tooltip title="顺序即优先级：可点选行内上移 / 下移，或直接拖拽行调整同级顺序（根路由锁定不可移动）">
              <Text type="secondary" style={{ fontSize: 13 }}>
                共 {routes.length} 条路由规则
              </Text>
            </Tooltip>
          </Space>
          <Table
            rowKey="id"
            dataSource={treeRoutes}
            columns={columns}
            pagination={false}
            size="middle"
            onRow={(record) => {
              const draggable = record.parent_id !== null
              return {
                draggable,
                style: draggingId === record.id ? { background: '#E6FAFD' } : undefined,
                onDragStart: () => draggable && setDraggingId(record.id),
                onDragOver: (e) => {
                  if (draggable) e.preventDefault()
                },
                onDrop: (e) => {
                  e.preventDefault()
                  if (draggingId && draggingId !== record.id) {
                    const dragged = routes.find((r) => r.id === draggingId)
                    if (dragged && dragged.parent_id === record.parent_id) {
                      reorder(record.parent_id, draggingId, record.id)
                    }
                  }
                  setDraggingId(null)
                },
                onDragEnd: () => setDraggingId(null),
              }
            }}
          />
        </Space>
      </Card>

      <Modal
        title={
          <Space>
            {editing ? '编辑路由规则' : '新建路由规则'}
            <V03Badge />
          </Space>
        }
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="路由名称"
            rules={[{ required: true, message: '请输入路由名称' }]}
          >
            <Input placeholder="如：严重告警 → SRE 值班" />
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item name="parent_id" label="父路由" style={{ flex: 1 }}>
              <Select
                placeholder="不选则作为根路由"
                allowClear
                options={parentOptions}
              />
            </Form.Item>
            <Form.Item
              name="receiver_id"
              label="接收人"
              rules={[{ required: true, message: '请选择接收人' }]}
              style={{ flex: 1 }}
            >
              <Select placeholder="请选择接收人" options={notifierOptions} />
            </Form.Item>
          </Space>

          <Form.Item label="匹配条件（告警标签）">
            <Form.List name="matchers">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        rules={[{ required: true, message: '标签名' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="标签名，如 severity" style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'value']}
                        rules={[{ required: true, message: '值' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="值，如 critical" style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'isRegex']}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Checkbox>正则</Checkbox>
                      </Form.Item>
                      <Button
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(name)}
                      />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({ name: '', value: '', isRegex: false })}
                    block
                    icon={<PlusOutlined />}
                  >
                    添加匹配条件
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>

          <Form.Item name="group_by" label="分组键（group_by）">
            <Select
              mode="tags"
              placeholder="输入分组键后回车，如 alertname、severity、network_domain"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item name="group_wait" label="初次等待（group_wait）" style={{ flex: 1 }}>
              <Input placeholder="如 30s" />
            </Form.Item>
            <Form.Item name="group_interval" label="分组间隔（group_interval）" style={{ flex: 1 }}>
              <Input placeholder="如 5m" />
            </Form.Item>
            <Form.Item name="repeat_interval" label="重复间隔（repeat_interval）" style={{ flex: 1 }}>
              <Input placeholder="如 4h" />
            </Form.Item>
          </Space>
          {/* 顺序不再由数字框填写：新建时按同父兄弟数量自动排到末尾，之后在列表中上移/下移或拖拽（提案 §3.2/§3.3） */}
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item
              name="continue"
              label="继续匹配（continue）"
              valuePropName="checked"
              style={{ flex: 1 }}
            >
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked" style={{ flex: 1 }}>
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </MainLayout>
  )
}
