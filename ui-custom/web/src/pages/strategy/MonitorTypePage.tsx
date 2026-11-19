import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { getStoredUser } from '../../api/client'
import { monitorTypeApi } from '../../api/monitorTypes'
import { applyMonitorTypeList } from './useMonitorTypeCatalog'
import type {
  MonitorType,
  MonitorTypeImpact,
  MonitorTypeInput,
  MonitorTypeOperator,
  MonitorTypeRuleLogic,
  ScopeField,
} from '../../types/monitorType'
import { OPERATOR_LABEL } from '../../types/monitorType'
import { CATEGORY_MAP } from './strategyConstants'
import { MainLayout } from '../../layouts/MainLayout'

const { Text, Paragraph } = Typography

interface RuleFormValue {
  field: string
  operator: MonitorTypeOperator
  values?: string[]
  priority?: number
}

interface MonitorTypeFormValues {
  code: string
  name: string
  resource_category: string
  rule_logic: MonitorTypeRuleLogic
  description?: string
  enabled?: boolean
  rules: RuleFormValue[]
}

const OPERATORS_BY_KIND: Record<string, MonitorTypeOperator[]> = {
  boolean: ['eq', 'in'],
  os_family: ['eq', 'in'],
  text: ['eq', 'contains', 'contains_any', 'in', 'regexp'],
}

/** 字段可选值：布尔与 OS 家族给固定选项，其余允许自由输入 */
function valueOptionsFor(field?: ScopeField): { options?: string[]; freeText: boolean } {
  if (!field) return { freeText: true }
  if (field.kind === 'boolean') return { options: ['true', 'false'], freeText: false }
  if (field.kind === 'os_family') return { options: ['linux', 'windows'], freeText: false }
  return { freeText: true }
}

/**
 * 监控对象类型管理页（SRS Module_01 v1.3 §5.6）。
 *
 * 核心价值：新增一种监控对象类型只需在此配置「类型定义 + 推导规则」，保存即生效，
 * 不需要改代码或升级版本；规则字段来自服务端白名单，前端不硬编码物理列名。
 */
export function MonitorTypePage() {
  // 写操作仅管理员（2026-11-19 用户裁定；后端 monitor-types 写路由挂 RequireAdmin）
  const isAdmin = getStoredUser()?.role === 'admin'
  const [items, setItems] = useState<MonitorType[]>([])
  const [scopeFields, setScopeFields] = useState<ScopeField[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<MonitorType | null>(null)
  const [saving, setSaving] = useState(false)
  const [impact, setImpact] = useState<MonitorTypeImpact | null>(null)
  const [form] = Form.useForm<MonitorTypeFormValues>()
  // 规则字段候选随资源类别变化；useWatch 必须在组件顶层调用（不能放进 Form.List 的渲染函数里）
  const watchedCategory = Form.useWatch('resource_category', form)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [listRes, fieldRes] = await Promise.all([monitorTypeApi.list(), monitorTypeApi.scopeFields()])
      const list = listRes.data?.list ?? []
      setItems(list)
      // 同步给全局目录缓存：新增/改名/停用后，采集 Job、采集器管理等下拉立即跟随
      applyMonitorTypeList(list)
      setScopeFields(fieldRes.data?.list ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载监控对象类型失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const fieldsByCategory = useMemo(() => {
    const map = new Map<string, ScopeField[]>()
    for (const field of scopeFields) {
      for (const category of field.categories) {
        const list = map.get(category) ?? []
        list.push(field)
        map.set(category, list)
      }
    }
    return map
  }, [scopeFields])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      resource_category: 'host',
      rule_logic: 'all',
      enabled: true,
      rules: [{ field: 'has_npu', operator: 'eq', values: ['true'] }],
    } as unknown as MonitorTypeFormValues)
    setDrawerOpen(true)
  }

  const openEdit = (record: MonitorType) => {
    setEditing(record)
    form.resetFields()
    form.setFieldsValue({
      code: record.code,
      name: record.name,
      resource_category: record.resource_category,
      rule_logic: record.rule_logic,
      description: record.description,
      enabled: record.enabled,
      rules: record.rules.map((rule) => ({
        field: rule.field,
        operator: rule.operator,
        values: rule.values ?? [],
        priority: rule.priority,
      })),
    })
    setDrawerOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    const input: MonitorTypeInput = {
      code: values.code,
      name: values.name,
      resource_category: values.resource_category as MonitorTypeInput['resource_category'],
      rule_logic: values.rule_logic,
      description: values.description,
      enabled: values.enabled,
      rules: (values.rules ?? []).map((rule) => ({
        field: rule.field,
        operator: rule.operator,
        values: rule.operator === 'always' ? [] : rule.values ?? [],
        priority: rule.priority,
      })),
    }
    setSaving(true)
    try {
      if (editing) {
        await monitorTypeApi.update(editing.code, input)
        message.success('监控对象类型已更新，规则即时生效')
      } else {
        await monitorTypeApi.create(input)
        message.success('监控对象类型已创建，新建采集 Job 时可立即选择')
      }
      setDrawerOpen(false)
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (record: MonitorType, enabled: boolean) => {
    try {
      await monitorTypeApi.update(record.code, {
        name: record.name,
        resource_category: record.resource_category,
        rule_logic: record.rule_logic,
        description: record.description,
        enabled,
        rules: record.rules,
      })
      message.success(enabled ? '已启用' : '已停用；存量 Job 保留并显示提示')
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const remove = (record: MonitorType) => {
    Modal.confirm({
      title: `删除监控对象类型「${record.name}」？`,
      content: '仅无引用的用户自定义类型可删除；内置类型只能停用。',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await monitorTypeApi.remove(record.code)
          message.success('已删除')
          await load()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败（可能仍被引用）')
        }
      },
    })
  }

  const showImpact = async (record: MonitorType) => {
    try {
      const res = await monitorTypeApi.impact(record.code)
      setImpact(res.data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '影响面查询失败')
    }
  }

  const columns: ColumnsType<MonitorType> = [
    {
      title: '编码',
      dataIndex: 'code',
      width: 180,
      render: (code: string) => <Text code>{code}</Text>,
    },
    { title: '名称', dataIndex: 'name', width: 160 },
    {
      title: '资源类别',
      dataIndex: 'resource_category',
      width: 120,
      render: (category: string) => CATEGORY_MAP[category as keyof typeof CATEGORY_MAP] ?? category,
    },
    {
      title: '推导规则',
      dataIndex: 'rules',
      render: (rules: MonitorType['rules'], record) => (
        <Space size={[4, 4]} wrap>
          <Tag color={record.rule_logic === 'any' ? 'orange' : 'blue'}>
            {record.rule_logic === 'any' ? 'OR' : 'AND'}
          </Tag>
          {rules.map((rule, index) => (
            <Tag key={`${rule.field}-${index}`}>
              {rule.field} {OPERATOR_LABEL[rule.operator]}
              {rule.operator !== 'always' ? ` ${(rule.values ?? []).join('/')}` : ''}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 120,
      render: (enabled: boolean, record) => (
        <Switch
          checked={enabled}
          checkedChildren="启用"
          unCheckedChildren="停用"
          disabled={!isAdmin}
          onChange={(next) => void toggleEnabled(record, next)}
        />
      ),
    },
    {
      title: '来源',
      dataIndex: 'is_builtin',
      width: 90,
      render: (builtin: boolean) => (builtin ? <Tag>内置</Tag> : <Tag color="green">自定义</Tag>),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      render: (_, record) => (
        <Space>
          {isAdmin && (
            <Button size="small" onClick={() => openEdit(record)} data-testid={`edit-${record.code}`}>
              编辑
            </Button>
          )}
          <Button size="small" onClick={() => void showImpact(record)} data-testid={`impact-${record.code}`}>
            影响面
          </Button>
          {isAdmin && !record.is_builtin && (
            <Button size="small" danger onClick={() => remove(record)} data-testid={`delete-${record.code}`}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <Card
        title="监控对象类型"
        extra={
          <Space>
            {!isAdmin && <Text type="secondary">只读：仅管理员可新增/修改类型</Text>}
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>
              刷新
            </Button>
            {isAdmin && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} data-testid="create-monitor-type">
                新增类型
              </Button>
            )}
          </Space>
        }
      >
        <Paragraph type="secondary">
          监控对象类型由「类型定义 + 推导规则」组成：规则描述如何从资源属性识别该类型。
          新增类型保存即生效，无需改代码或升级版本；同一资源可同时命中多个类型，从而被多个采集器分别采集。
          保存后即可到「指标库」给该类型挂接指标。
        </Paragraph>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Table
          rowKey="code"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有监控对象类型" /> }}
        />
      </Card>

      <Drawer
        title={editing ? `编辑监控对象类型 · ${editing.code}` : '新增监控对象类型'}
        width={720}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()} data-testid="submit-monitor-type">
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="编码"
            name="code"
            rules={[
              { required: true, message: '请输入编码' },
              { pattern: /^[a-z][a-z0-9_]{1,63}$/, message: '小写字母开头，仅含小写字母、数字与下划线' },
            ]}
            extra="全局唯一、创建后不可修改，例如 host_npu"
          >
            <Input placeholder="例如 host_npu" disabled={!!editing} />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如 NPU 主机" maxLength={100} />
          </Form.Item>
          <Form.Item
            label="资源类别"
            name="resource_category"
            rules={[{ required: true, message: '请选择资源类别' }]}
            extra="决定候选实例池的边界；规则字段由该类别可选字段决定"
          >
            <Select
              options={Object.entries(CATEGORY_MAP).map(([value, label]) => ({ value, label }))}
              onChange={() => {
                // 类别变化后原字段可能不再适用，清空规则让用户重选
                form.setFieldValue('rules', [{ operator: 'eq', values: [] }])
              }}
            />
          </Form.Item>
          <Form.Item label="规则组合方式" name="rule_logic" extra="同一类型内多条规则的组合语义">
            <Radio.Group>
              <Radio.Button value="all">全部满足（AND）</Radio.Button>
              <Radio.Button value="any">满足任一（OR）</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} maxLength={200} placeholder="说明该类型的采集语义（可选）" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>

          <Form.Item label="推导规则" required>
            <Form.List name="rules">
              {(fields, { add, remove: removeRule }) => {
                const availableFields = fieldsByCategory.get(watchedCategory ?? '') ?? []
                return (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {fields.map((field) => {
                      const selected = form.getFieldValue(['rules', field.name, 'field']) as string | undefined
                      const spec = scopeFields.find((item) => item.key === selected)
                      const operators = OPERATORS_BY_KIND[spec?.kind ?? 'text'] ?? OPERATORS_BY_KIND.text
                      const valueHint = valueOptionsFor(spec)
                      return (
                        <Space key={field.key} align="start" wrap>
                          <Form.Item
                            name={[field.name, 'field']}
                            rules={[{ required: true, message: '请选择字段' }]}
                            style={{ marginBottom: 8, minWidth: 180 }}
                          >
                            <Select
                              placeholder="字段"
                              options={availableFields.map((item) => ({ value: item.key, label: item.label }))}
                            />
                          </Form.Item>
                          <Form.Item
                            name={[field.name, 'operator']}
                            rules={[{ required: true, message: '请选择操作符' }]}
                            style={{ marginBottom: 8, minWidth: 150 }}
                          >
                            <Select
                              placeholder="操作符"
                              options={operators.map((operator) => ({
                                value: operator,
                                label: OPERATOR_LABEL[operator],
                              }))}
                            />
                          </Form.Item>
                          <Form.Item name={[field.name, 'values']} style={{ marginBottom: 8, minWidth: 220 }}>
                            <Select
                              mode={valueHint.freeText ? 'tags' : 'multiple'}
                              placeholder={valueHint.freeText ? '输入后回车添加' : '选择取值'}
                              options={(valueHint.options ?? []).map((value) => ({ value, label: value }))}
                              tokenSeparators={[',', ';']}
                            />
                          </Form.Item>
                          <Button danger size="small" onClick={() => removeRule(field.name)}>
                            删除
                          </Button>
                        </Space>
                      )
                    })}
                    <Button type="dashed" onClick={() => add({ operator: 'eq', values: [] })} block>
                      + 添加规则
                    </Button>
                  </Space>
                )
              }}
            </Form.List>
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title={impact ? `影响面 · ${impact.code}` : '影响面'}
        open={!!impact}
        onCancel={() => setImpact(null)}
        footer={null}
      >
        {impact && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="被采集器映射引用">{impact.references.mappings}</Descriptions.Item>
            <Descriptions.Item label="被采集 Job 引用">{impact.references.jobs}</Descriptions.Item>
            <Descriptions.Item label="被监控规则引用">{impact.references.rules}</Descriptions.Item>
            <Descriptions.Item label="被指标锚点引用">{impact.references.metric_anchors}</Descriptions.Item>
            <Descriptions.Item label="当前匹配资源数">{impact.matched_resources}</Descriptions.Item>
            <Descriptions.Item label="规则条数">{impact.rule_count}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </MainLayout>
  )
}
