import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Space, Switch, Typography, message } from 'antd'
import { attributeDefinitionApi, resourceAttributeApi } from '../../api/attributes'
import type { AttributeDefinition, ResourceAttributeValue } from '../../types/attribute'
import { ATTRIBUTE_TYPE_LABEL } from '../../types/attribute'
import type { ResourceListItem } from './useResources'

const { Text } = Typography

interface Props {
  open: boolean
  record: ResourceListItem | null
  onClose: () => void
  onSaved?: () => void
}

/**
 * 单个资源的扩展能力属性编辑抽屉（SRS Module_07 v2.1 §5.8 FR-31）。
 *
 * 表单字段由「CI 模型配置」登记的自定义字段动态生成（布尔 / 数值 / 文本 / 枚举），
 * 因此登记新字段后无需改动本页面。has_npu / has_gpu 属于内置能力字段，仍在「编辑资源」表单维护。
 */
export function ResourceAttributesDrawer({ open, record, onClose, onSaved }: Props) {
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    if (!record) return
    setLoading(true)
    setError(null)
    try {
      const [defsRes, valuesRes] = await Promise.all([
        attributeDefinitionApi.list(record.resource_category, 'active'),
        resourceAttributeApi.list(record.resource_id),
      ])
      const activeDefs = defsRes.data?.list ?? []
      setDefinitions(activeDefs)
      const stored: Record<string, string> = {}
      for (const item of valuesRes.data?.list ?? []) {
        stored[item.key] = item.value
      }
      const initial: Record<string, unknown> = {}
      for (const def of activeDefs) {
        const raw = stored[def.attribute_key]
        if (def.value_type === 'boolean') {
          initial[def.attribute_key] = raw === 'true'
        } else if (def.value_type === 'number') {
          initial[def.attribute_key] = raw ? Number(raw) : undefined
        } else {
          initial[def.attribute_key] = raw ?? undefined
        }
      }
      form.setFieldsValue(initial)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载能力属性失败')
    } finally {
      setLoading(false)
    }
  }, [form, record])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load()
  }, [open, load])

  const submit = async () => {
    if (!record) return
    const formValues = (await form.validateFields()) as Record<string, unknown>
    const payload: ResourceAttributeValue[] = []
    for (const def of definitions) {
      const raw = formValues[def.attribute_key]
      if (def.value_type === 'boolean') {
        // 布尔显式落 true/false，避免「未填」与「false」混淆
        payload.push({ key: def.attribute_key, value: raw === true ? 'true' : 'false' })
        continue
      }
      if (raw === undefined || raw === null || raw === '') continue
      payload.push({ key: def.attribute_key, value: String(raw) })
    }
    setSaving(true)
    try {
      await resourceAttributeApi.replace(record.resource_id, payload)
      message.success('能力属性已保存')
      onSaved?.()
      onClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const fields = useMemo(() => {
    return definitions.map((def) => {
      switch (def.value_type) {
        case 'boolean':
          return (
            <Form.Item
              key={def.id}
              label={def.display_name}
              name={def.attribute_key}
              valuePropName="checked"
              extra={def.description}
            >
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
          )
        case 'number':
          return (
            <Form.Item
              key={def.id}
              label={def.display_name}
              name={def.attribute_key}
              extra={def.description}
              rules={def.required ? [{ required: true, message: '请填写' }] : undefined}
            >
              <InputNumber style={{ width: '100%' }} placeholder={`数值（${ATTRIBUTE_TYPE_LABEL.number}）`} />
            </Form.Item>
          )
        case 'enum':
          return (
            <Form.Item
              key={def.id}
              label={def.display_name}
              name={def.attribute_key}
              extra={def.description}
              rules={def.required ? [{ required: true, message: '请选择' }] : undefined}
            >
              <Select
                allowClear
                placeholder="请选择"
                options={(def.enum_options ?? []).map((option) => ({ value: option, label: option }))}
              />
            </Form.Item>
          )
        default:
          return (
            <Form.Item
              key={def.id}
              label={def.display_name}
              name={def.attribute_key}
              extra={def.description}
              rules={def.required ? [{ required: true, message: '请填写' }] : undefined}
            >
              <Input placeholder="文本" maxLength={500} />
            </Form.Item>
          )
      }
    })
  }, [definitions])

  return (
    <Drawer
      title={record ? `能力属性 · ${record.instance_name || record.resource_id}` : '能力属性'}
      width={520}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()} data-testid="save-resource-attributes">
            保存
          </Button>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {definitions.length === 0 && !loading ? (
        <Text type="secondary">
          该资源类别还没有登记自定义字段。请到「资源管理 → CI 模型配置」登记字段后再填写。
        </Text>
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="NPU / GPU 芯片请在「编辑资源」表单中勾选"
          />
          <Form form={form} layout="vertical">
            {fields}
          </Form>
        </>
      )}
    </Drawer>
  )
}
