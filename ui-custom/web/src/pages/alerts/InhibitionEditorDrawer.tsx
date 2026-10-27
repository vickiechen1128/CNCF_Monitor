import { useEffect } from 'react'
import { Button, Drawer, Form, Input, Select, Space, Switch } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import type { InhibitionRule, RouteEditMatcher } from '../../types/alertmanager'

interface MatcherFormValue {
  name?: string
  value?: string
  op?: string
}

interface InhibitionFormValues {
  name?: string
  source_matchers: MatcherFormValue[]
  target_matchers: MatcherFormValue[]
  equal?: string[]
  enabled: boolean
}

interface InhibitionEditorDrawerProps {
  open: boolean
  rule: InhibitionRule | null
  onCancel: () => void
  onSubmit: (rule: InhibitionRule) => void
}

function MatcherFields({ name, label, testId }: { name: 'source_matchers' | 'target_matchers'; label: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <Form.Item label={label} required>
        <Form.List name={name}>
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ width: '100%' }}>
              {fields.map((field) => (
                <Space key={field.key} align="baseline">
                  <Form.Item name={[field.name, 'name']} rules={[{ required: true, message: '请输入标签名' }]} noStyle>
                    <Input placeholder="标签名" style={{ width: 150 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'op']} noStyle initialValue="=">
                    <Select
                      aria-label="匹配方式"
                      style={{ width: 80 }}
                      options={[{ value: '=', label: '=' }, { value: '!=', label: '!=' }, { value: '=~', label: '=~' }, { value: '!~', label: '!~' }]}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'value']} rules={[{ required: true, message: '请输入标签值' }]} noStyle>
                    <Input placeholder="标签值" style={{ width: 220 }} />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined aria-label="删除匹配条件" onClick={() => remove(field.name)} />}
                </Space>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ op: '=' })}>
                添加匹配条件
              </Button>
            </Space>
          )}
        </Form.List>
      </Form.Item>
    </div>
  )
}

function toMatchers(values: MatcherFormValue[]): RouteEditMatcher[] {
  return values.map((item) => ({
    name: (item.name ?? '').trim(),
    value: item.value ?? '',
    is_equal: item.op === '=' || item.op === '=~',
    is_regex: item.op === '=~' || item.op === '!~',
  }))
}

function fromMatchers(values: RouteEditMatcher[]): MatcherFormValue[] {
  return values.map((item) => ({
    name: item.name,
    value: item.value,
    op: item.is_regex ? (item.is_equal ? '=~' : '!~') : (item.is_equal ? '=' : '!='),
  }))
}

export function InhibitionEditorDrawer({ open, rule, onCancel, onSubmit }: InhibitionEditorDrawerProps) {
  const [form] = Form.useForm<InhibitionFormValues>()

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      name: rule?.name ?? '',
      source_matchers: rule ? fromMatchers(rule.source_matchers) : [{ op: '=' }],
      target_matchers: rule ? fromMatchers(rule.target_matchers) : [{ op: '=' }],
      equal: rule?.equal ?? [],
      enabled: rule?.enabled ?? true,
    })
  }, [open, rule, form])

  const handleSubmit = async () => {
    let values: InhibitionFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    onSubmit({
      id: rule?.id ?? '',
      name: (values.name ?? '').trim(),
      source_matchers: toMatchers(values.source_matchers),
      target_matchers: toMatchers(values.target_matchers),
      equal: values.equal ?? [],
      enabled: values.enabled,
    })
  }

  return (
    <Drawer
      title={rule ? '编辑抑制规则' : '新增抑制规则'}
      open={open}
      onClose={onCancel}
      footer={(
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" aria-label="确定" onClick={() => void handleSubmit()}>确定</Button>
        </Space>
      )}
      forceRender
      width={640}
    >
      <Form form={form} layout="vertical" name="inhibition-editor">
        <Form.Item label="规则名称" name="name">
          <Input placeholder="例如：网域离线抑制次生告警" maxLength={100} />
        </Form.Item>
        <MatcherFields name="source_matchers" label="源告警匹配（根因告警）" testId="source-matchers" />
        <MatcherFields name="target_matchers" label="目标告警匹配（被抑制告警）" testId="target-matchers" />
        <Form.Item label="等同标签" name="equal" extra="源告警与目标告警的这些标签值必须相同">
          <Select mode="tags" aria-label="等同标签" placeholder="例如：network_domain" tokenSeparators={[',', ' ']} />
        </Form.Item>
        <Form.Item label="启用状态" name="enabled" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </Form>
    </Drawer>
  )
}
