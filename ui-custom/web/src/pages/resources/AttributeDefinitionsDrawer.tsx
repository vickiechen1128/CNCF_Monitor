import { useCallback, useEffect, useState } from 'react'
import { Button, Drawer, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { attributeDefinitionApi } from '../../api/attributes'
import type { AttributeDefinition, AttributeDefinitionInput, AttributeValueType } from '../../types/attribute'
import { ATTRIBUTE_TYPE_LABEL } from '../../types/attribute'
import type { ResourceCategory } from '../../types/resource'
import { CATEGORY_MAP } from '../strategy/strategyConstants'

interface Props {
  open: boolean
  onClose: () => void
}

interface DefinitionFormValues {
  attribute_key: string
  display_name: string
  value_type: AttributeValueType
  resource_category: ResourceCategory
  enum_options?: string[]
  required?: boolean
  enabled?: boolean
  description?: string
}

/**
 * 扩展属性字典抽屉（SRS Module_07 v2.1 §5.8 FR-31 / NFR-23）。
 *
 * 登记一个能力 key 即可在资源表单/导入中使用，全程不改表结构、不发版；
 * 已被资源使用的 key 只允许停用，不允许物理删除。
 */
export function AttributeDefinitionsDrawer({ open, onClose }: Props) {
  const [items, setItems] = useState<AttributeDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<AttributeDefinition | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm<DefinitionFormValues>()
  const watchedType = Form.useWatch('value_type', form)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await attributeDefinitionApi.list()
      setItems(res.data?.list ?? [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载扩展属性字典失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load()
  }, [open, load])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ value_type: 'text', resource_category: 'host', enabled: true } as DefinitionFormValues)
    setModalOpen(true)
  }

  const openEdit = (record: AttributeDefinition) => {
    setEditing(record)
    form.resetFields()
    form.setFieldsValue({
      attribute_key: record.attribute_key,
      display_name: record.display_name,
      value_type: record.value_type,
      resource_category: record.resource_category,
      enum_options: record.enum_options ?? [],
      required: record.required,
      enabled: record.enabled,
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
      enabled: values.enabled,
      description: values.description,
    }
    setSaving(true)
    try {
      if (editing) {
        await attributeDefinitionApi.update(editing.id, input)
        message.success('扩展属性已更新')
      } else {
        await attributeDefinitionApi.create(input)
        message.success('扩展属性已登记，可直接在资源/导入中使用')
      }
      setModalOpen(false)
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = (record: AttributeDefinition) => {
    Modal.confirm({
      title: `删除扩展属性「${record.display_name}」？`,
      content: '已被资源使用的属性只能停用，不能删除。',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await attributeDefinitionApi.remove(record.id)
          message.success('已删除')
          await load()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败（可能仍被使用）')
        }
      },
    })
  }

  const columns: ColumnsType<AttributeDefinition> = [
    { title: '属性 key', dataIndex: 'attribute_key', width: 170, render: (key: string) => <Tag>{key}</Tag> },
    { title: '展示名', dataIndex: 'display_name', width: 160 },
    {
      title: '值类型',
      dataIndex: 'value_type',
      width: 100,
      render: (type: AttributeValueType) => ATTRIBUTE_TYPE_LABEL[type] ?? type,
    },
    {
      title: '适用类别',
      dataIndex: 'resource_category',
      width: 120,
      render: (category: ResourceCategory) => CATEGORY_MAP[category] ?? category,
    },
    {
      title: '枚举值',
      dataIndex: 'enum_options',
      render: (options?: string[]) =>
        options && options.length > 0 ? <Space size={[4, 4]} wrap>{options.map((o) => <Tag key={o}>{o}</Tag>)}</Space> : '-',
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (enabled: boolean) => (enabled ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Button size="small" danger onClick={() => remove(record)}>
            删除
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Drawer
        title="扩展属性字典"
        width={880}
        open={open}
        onClose={onClose}
        extra={
          <Space>
            <Button onClick={() => void load()}>刷新</Button>
            <Button type="primary" onClick={openCreate} data-testid="create-attribute-definition">
              登记属性
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={false}
          scroll={{ x: 820 }}
        />
      </Drawer>

      <Modal
        title={editing ? `编辑扩展属性 · ${editing.attribute_key}` : '登记扩展属性'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void submit()}
        confirmLoading={saving}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="属性 key"
            name="attribute_key"
            rules={[
              { required: true, message: '请输入属性 key' },
              { pattern: /^[a-z][a-z0-9_]{1,63}$/, message: '小写字母开头，仅含小写字母、数字与下划线' },
            ]}
            extra="创建后不可修改，例如 dpu_model"
          >
            <Input disabled={!!editing} placeholder="例如 dpu_model" />
          </Form.Item>
          <Form.Item label="展示名" name="display_name" rules={[{ required: true, message: '请输入展示名' }]}>
            <Input placeholder="例如 DPU 型号" maxLength={100} />
          </Form.Item>
          <Form.Item label="适用资源类别" name="resource_category" rules={[{ required: true }]}>
            <Select
              disabled={!!editing}
              options={Object.entries(CATEGORY_MAP).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item label="值类型" name="value_type" rules={[{ required: true }]}>
            <Select
              disabled={!!editing}
              options={Object.entries(ATTRIBUTE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          {watchedType === 'enum' && (
            <Form.Item label="枚举值" name="enum_options" rules={[{ required: true, message: '请填写枚举值' }]}>
              <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={[',', ';']} />
            </Form.Item>
          )}
          <Form.Item label="必填" name="required" valuePropName="checked">
            <Switch checkedChildren="必填" unCheckedChildren="选填" />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
