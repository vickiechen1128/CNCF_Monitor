import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Menu,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../layouts/MainLayout'
import { attributeDefinitionApi, ciModelApi } from '../../api/attributes'
import type {
  AttributeDefinition,
  AttributeDefinitionInput,
  AttributeGroup,
  AttributeValueType,
  BuiltinField,
  CIModel,
} from '../../types/attribute'
import { ATTRIBUTE_STATUS_LABEL, ATTRIBUTE_TYPE_LABEL } from '../../types/attribute'
import type { ResourceCategory } from '../../types/resource'
import { RESOURCE_TYPES, RESOURCE_TYPE_MAP } from './resourceMeta'
import { FIELD_GROUP_LABEL, FIELD_GROUP_ORDER } from './resourceFieldSchema'

const { Text, Paragraph } = Typography

interface FieldFormValues {
  resource_category: ResourceCategory
  attribute_key: string
  display_name: string
  value_type: AttributeValueType
  display_group: AttributeGroup
  display_order?: number
  required?: boolean
  enum_options?: string[]
  description?: string
}

/** 自定义 / 已移出字段列表分页；内置字段量小且按分组排序后一次看全，不分页。 */
const FIELD_PAGINATION = {
  pageSize: 10,
  showSizeChanger: false,
  showTotal: (total: number) => `共 ${total} 个字段`,
}

/**
 * CI 模型配置页（SRS Module_07 v2.2 §5.8 FR-32）。
 *
 * 左侧六类 CI 平铺（与「资源管理」共用 RESOURCE_TYPES / RESOURCE_TYPE_MAP 单一来源），
 * 点击一类即切换右侧到该类型的**完整模型**：内置字段区（只读、按分组排序为一张表）
 * + 自定义字段区（增删改、分页）；已移出字段降级为自定义区内的切换链接。
 *
 * 字段分组 / 来源是字段属性，不是导航实体，故不做成左侧折叠树——避免「点分组只看局部」
 * 并由此派生出「全部字段」这类别扭入口。
 * 2026-11-19 排版修复：原 `<Tabs tabPosition="left" items=[...children:null]>` 会为空白内容
 * 面板预留整列宽度，真实详情却在 Tabs 之外，导致一大片空白；改为 flex 两列彻底消除。
 */
export function CIModelPage() {
  const [models, setModels] = useState<CIModel[]>([])
  const [category, setCategory] = useState<ResourceCategory>('host')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removedFields, setRemovedFields] = useState<AttributeDefinition[]>([])
  const [showRemoved, setShowRemoved] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AttributeDefinition | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<FieldFormValues>()
  const watchedType = Form.useWatch('value_type', form)
  const watchedCategory = Form.useWatch('resource_category', form)

  const loadModels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await ciModelApi.list()
      setModels(res.data?.list ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 CI 模型失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadModels()
  }, [loadModels])

  const model = useMemo(
    () => models.find((item) => item.resource_category === category),
    [models, category],
  )

  /** 已移出字段：切换类别或打开「已移出」视图时加载。 */
  const loadRemoved = useCallback(async () => {
    try {
      const res = await attributeDefinitionApi.list(category, 'removed')
      setRemovedFields(res.data?.list ?? [])
    } catch {
      setRemovedFields([])
    }
  }, [category])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (showRemoved) void loadRemoved()
  }, [showRemoved, loadRemoved])

  const availableGroups = model?.available_groups ?? []

  /** 内置字段按分组、组内顺序排成一张表，六组一次看全。 */
  const builtinRows = useMemo(() => {
    const fields = model?.builtin_fields ?? []
    return [...fields].sort(
      (a, b) =>
        FIELD_GROUP_ORDER.indexOf(a.display_group) - FIELD_GROUP_ORDER.indexOf(b.display_group) ||
        a.display_order - b.display_order ||
        a.key.localeCompare(b.key),
    )
  }, [model])

  const menuItems = RESOURCE_TYPES.map((type) => ({ key: type, label: RESOURCE_TYPE_MAP[type] }))

  const selectCategory = (next: ResourceCategory) => {
    if (next !== category) {
      setCategory(next)
      setShowRemoved(false)
    }
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      resource_category: category,
      value_type: 'text',
      display_group: 'profile',
      display_order: 0,
      required: false,
    } as FieldFormValues)
    setModalOpen(true)
  }

  const openEdit = (record: AttributeDefinition) => {
    setEditing(record)
    form.resetFields()
    form.setFieldsValue({
      resource_category: record.resource_category,
      attribute_key: record.attribute_key,
      display_name: record.display_name,
      value_type: record.value_type,
      display_group: record.display_group,
      display_order: record.display_order,
      required: record.required,
      enum_options: record.enum_options ?? [],
      description: record.description,
    })
    setModalOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    const input: AttributeDefinitionInput = {
      attribute_key: values.attribute_key,
      display_name: values.display_name,
      value_type: values.value_type,
      resource_category: values.resource_category,
      enum_options: values.value_type === 'enum' ? values.enum_options ?? [] : [],
      required: values.required,
      display_group: values.display_group,
      display_order: values.display_order ?? 0,
      description: values.description,
    }
    setSaving(true)
    try {
      if (editing) {
        await attributeDefinitionApi.update(editing.id, input)
        message.success('自定义字段已更新')
      } else {
        await attributeDefinitionApi.create(input)
        message.success('自定义字段已登记，资源表单即可填写')
      }
      // 表单内可直接选择 CI 类型，无需先切左侧类别；保存后跟随到字段所属类型。
      // 必须退出「已移出」视图：同类别下恢复一个已移出字段时 selectCategory 不会
      // 触发切换，removedFields 仍是旧快照，会让刚恢复的字段继续显示在已移出列表。
      selectCategory(values.resource_category)
      setShowRemoved(false)
      setModalOpen(false)
      await loadModels()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = (record: AttributeDefinition) => {
    Modal.confirm({
      title: `移除自定义字段「${record.display_name}」？`,
      content: '系统会按引用情况处理：无资源使用时删除字段；已有资源使用时字段移出模型、历史值保留。',
      okButtonProps: { danger: true },
      okText: '移除',
      onOk: async () => {
        try {
          const res = await attributeDefinitionApi.remove(record.id)
          const result = res.data
          if (result?.mode === 'removed') {
            message.success(`字段已移出模型，${result.usage_count} 条资源的已有值已保留`)
          } else {
            message.success('字段已删除')
          }
          await loadModels()
          if (showRemoved) await loadRemoved()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '移除失败')
        }
      },
    })
  }

  const groupColumn = {
    title: '分组',
    dataIndex: 'display_group_label',
    width: 120,
    // 右侧「分组」列直接下拉筛选，六组固定且按 platform 定义顺序展示
    filters: FIELD_GROUP_ORDER.map((group) => ({ text: FIELD_GROUP_LABEL[group], value: group })),
    filterMultiple: false,
    onFilter: (value: unknown, record: { display_group: AttributeGroup }) =>
      record.display_group === String(value),
  }

  const builtinColumns: ColumnsType<BuiltinField> = [
    groupColumn,
    { title: '展示名', dataIndex: 'label', width: 160 },
    { title: '字段 key', dataIndex: 'key', width: 180, render: (key: string) => <Tag>{key}</Tag> },
    {
      title: '值类型',
      dataIndex: 'value_type',
      width: 100,
      render: (type: BuiltinField['value_type']) => (type === 'datetime' ? '日期' : ATTRIBUTE_TYPE_LABEL[type as AttributeValueType] ?? type),
    },
    { title: '必填', dataIndex: 'required', width: 80, render: (required: boolean) => (required ? '是' : '否') },
    {
      title: '来源',
      key: 'source',
      width: 100,
      render: () => <Tag color="blue">平台内置</Tag>,
    },
  ]

  const customColumns: ColumnsType<AttributeDefinition> = [
    { title: '展示名', dataIndex: 'display_name', width: 160 },
    { title: '字段 key', dataIndex: 'attribute_key', width: 180, render: (key: string) => <Tag>{key}</Tag> },
    {
      title: '值类型',
      dataIndex: 'value_type',
      width: 100,
      render: (type: AttributeValueType) => ATTRIBUTE_TYPE_LABEL[type] ?? type,
    },
    groupColumn,
    { title: '组内排序', dataIndex: 'display_order', width: 100 },
    { title: '必填', dataIndex: 'required', width: 80, render: (required: boolean) => (required ? '是' : '否') },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" danger onClick={() => remove(record)}>
            移除
          </Button>
        </Space>
      ),
    },
  ]

  const removedColumns: ColumnsType<AttributeDefinition> = [
    { title: '展示名', dataIndex: 'display_name', width: 160 },
    { title: '字段 key', dataIndex: 'attribute_key', width: 180, render: (key: string) => <Tag>{key}</Tag> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: () => <Tag>{ATTRIBUTE_STATUS_LABEL.removed}</Tag>,
    },
    {
      title: '说明',
      key: 'note',
      render: () => <Text type="secondary">重新登记同名 key 可恢复为「在模型中」，历史值自动回显</Text>,
    },
  ]

  return (
    <MainLayout>
      <Card
        title="CI 模型配置"
        extra={
          <Space>
            <Button onClick={() => void loadModels()}>刷新</Button>
            <Button type="primary" onClick={openCreate} data-testid="create-custom-field">
              新增自定义字段
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          内置字段由平台维护并随版本更新，不可增删改；自定义字段可自行登记，且可选择登记到任意 CI 类型。
          移除时系统按引用情况处理：无资源使用时删除，已有资源使用时移出模型并保留历史值。
        </Paragraph>

        {error && (
          <Alert
            type="error"
            showIcon
            message="CI 模型加载失败"
            description={error}
            action={
              <Button size="small" onClick={() => void loadModels()}>
                重新加载
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ width: 160, flex: '0 0 160px', borderRight: '1px solid #f0f0f0' }}>
            <Menu
              mode="inline"
              selectedKeys={[category]}
              items={menuItems}
              onClick={({ key }) => selectCategory(key as ResourceCategory)}
              data-testid="ci-category-menu"
            />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading && !model ? (
              <Empty description="正在加载 CI 模型…" />
            ) : model ? (
              <>
                <Text strong style={{ fontSize: 16 }}>
                  {model.category_label}
                </Text>
                <Paragraph type="secondary" style={{ marginTop: 4 }}>
                  共 {model.builtin_fields.length} 个内置字段、{model.custom_fields.length} 个自定义字段
                </Paragraph>

                <div style={{ marginTop: 16 }} data-testid="builtin-field-section">
                  <Space style={{ marginBottom: 8 }}>
                    <Text strong>内置字段</Text>
                    <Text type="secondary">平台维护，只读；按分组排序展示</Text>
                  </Space>
                  <Table
                    rowKey="key"
                    size="small"
                    columns={builtinColumns}
                    dataSource={builtinRows}
                    pagination={false}
                    scroll={{ x: 860 }}
                    locale={{ emptyText: '该类别暂无内置字段' }}
                  />
                </div>

                <div style={{ marginTop: 24 }} data-testid="custom-field-section">
                  <Space style={{ marginBottom: 8 }}>
                    <Text strong>{showRemoved ? '已移出字段' : '自定义字段'}</Text>
                    <Button size="small" type="link" onClick={() => setShowRemoved((value) => !value)}>
                      {showRemoved ? '返回在模型中的字段' : '查看已移出字段'}
                    </Button>
                  </Space>
                  {showRemoved ? (
                    <Table
                      key={`${category}-removed`}
                      rowKey="id"
                      size="small"
                      columns={removedColumns}
                      dataSource={removedFields}
                      pagination={FIELD_PAGINATION}
                      scroll={{ x: 760 }}
                      locale={{ emptyText: '暂无已移出字段' }}
                    />
                  ) : (
                    <Table
                      key={`${category}-custom`}
                      rowKey="id"
                      size="small"
                      columns={customColumns}
                      dataSource={model.custom_fields}
                      pagination={FIELD_PAGINATION}
                      scroll={{ x: 900 }}
                      locale={{ emptyText: '还没有自定义字段，点右上角「新增自定义字段」登记' }}
                    />
                  )}
                </div>
              </>
            ) : (
              !loading && <Empty description="暂无 CI 模型数据" />
            )}
          </div>
        </div>
      </Card>

      <Drawer
        title={
          editing
            ? `编辑自定义字段 · ${editing.attribute_key}`
            : `新增自定义字段 · ${RESOURCE_TYPE_MAP[watchedCategory ?? category]}`
        }
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        width={520}
        forceRender
        data-testid="custom-field-drawer"
        footer={
          <Space>
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => void submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="CI 类型"
            name="resource_category"
            rules={[{ required: true, message: '请选择 CI 类型' }]}
            extra={editing ? '已有字段不可改类型' : '可直接选择要登记到的 CI 类型，无需先切换左侧类别'}
          >
            <Select
              disabled={!!editing}
              options={RESOURCE_TYPES.map((type) => ({ value: type, label: RESOURCE_TYPE_MAP[type] }))}
            />
          </Form.Item>
          <Form.Item
            label="字段 key"
            name="attribute_key"
            rules={[
              { required: true, message: '请输入字段 key' },
              { pattern: /^[a-z][a-z0-9_]{1,63}$/, message: '小写字母开头，仅含小写字母、数字与下划线' },
            ]}
            extra="创建后不可修改；若与「已移出」字段同名，保存后该字段自动恢复"
          >
            <Input disabled={!!editing} placeholder="例如 rack_position" />
          </Form.Item>
          <Form.Item label="展示名" name="display_name" rules={[{ required: true, message: '请输入展示名' }]}>
            <Input placeholder="例如 机柜位置" maxLength={100} />
          </Form.Item>
          <Form.Item label="值类型" name="value_type" rules={[{ required: true }]}>
            <Select options={Object.entries(ATTRIBUTE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="分组" name="display_group" rules={[{ required: true, message: '请选择分组' }]} extra="分组用于资源表单与模型页的字段归类">
            <Select options={availableGroups.map((option) => ({ value: option.value, label: option.label }))} />
          </Form.Item>
          <Form.Item label="组内排序" name="display_order" extra="数字越小越靠前；相同则按字段 key 排序">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {watchedType === 'enum' && (
            <Form.Item label="枚举值" name="enum_options" rules={[{ required: true, message: '请填写枚举值' }]}>
              <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={[',', ';']} />
            </Form.Item>
          )}
          <Form.Item label="必填" name="required" valuePropName="checked">
            <Switch checkedChildren="必填" unCheckedChildren="选填" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Drawer>
    </MainLayout>
  )
}

export default CIModelPage
