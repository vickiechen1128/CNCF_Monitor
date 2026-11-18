import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Space, Switch, message } from 'antd'
import { businessDomainApi } from '../../api/resources'
import type { BusinessDomain } from '../../types/resource'
import { BIZ_CODE_PATTERN } from './dictionaryRules'

interface BusinessDomainFormValues {
  code?: string
  name: string
  description?: string
  enabled?: boolean
}

export interface BusinessDomainDrawerProps {
  open: boolean
  /** 编辑态为行 record；登记态为 null */
  record: BusinessDomain | null
  onCancel: () => void
  /**
   * 保存成功回调。
   *
   * 登记态回传新建条目，便于调用方（如资源表单「登记业务」快捷入口）自动选中；
   * 编辑态回传 undefined。
   */
  onSuccess: (created?: BusinessDomain) => void
}

/**
 * 业务分组登记 / 受限编辑抽屉（决策 48）：登记含编码规范校验；编辑仅开放名称/描述/状态。
 *
 * 从业务字典页抽出，供「业务字典页登记」与「资源表单内快捷登记」复用，
 * 避免两处维护同一套编码校验与提交语义。
 */
export function BusinessDomainDrawer({ open, record, onCancel, onSuccess }: BusinessDomainDrawerProps) {
  const [form] = Form.useForm<BusinessDomainFormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const isEdit = !!record

  useEffect(() => {
    if (!open) return
    form.resetFields()
    // 编辑回显：编码只读展示（提交载荷不含 code，决策 48）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    if (record) {
      form.setFieldsValue({
        code: record.code,
        name: record.name,
        description: record.description,
        enabled: record.enabled,
      })
    } else {
      form.setFieldsValue({ enabled: true })
    }
  }, [open, record, form])

  const handleSubmit = async () => {
    let values: BusinessDomainFormValues
    // antd 校验拒签属预期（字段内联报错由 Form 自展示）；捕获后直接返回，
    // 避免 `void handleSubmit()` 下的 Unhandled Rejection（决策 48 编码规范校验用例）
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (record) {
        await businessDomainApi.update(record.code, {
          name: values.name,
          description: values.description,
          enabled: values.enabled ?? true,
        })
        message.success('业务分组已更新')
        onSuccess()
      } else {
        const created = await businessDomainApi.create({
          code: values.code!,
          name: values.name,
          description: values.description,
        })
        message.success('业务分组已登记')
        onSuccess(created.data)
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : '保存失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? '编辑业务分组' : '登记业务分组'}
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
        message={isEdit ? '仅可修改业务名称、描述与启用状态' : '编码创建后不可改'}
        description={
          isEdit
            ? `业务编码「${record?.code}」创建后不可修改；修改展示名不影响存量资源与监控配置。`
            : '业务编码用于资源归属的不可变键（如 payment、data-api），登记后不可修改。'
        }
        style={{ marginBottom: 16 }}
      />
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          name="code"
          label="业务编码"
          rules={[
            { required: true, message: '请输入业务编码' },
            {
              pattern: BIZ_CODE_PATTERN,
              message: '编码仅允许小写字母、数字、连字符（≤ 64 字符）',
            },
          ]}
          extra="小写字母 / 数字 / 连字符，≤ 64；创建后不可改"
        >
          <Input placeholder="如 payment、data-api" disabled={isEdit} />
        </Form.Item>
        <Form.Item
          name="name"
          label="业务名称"
          rules={[{ required: true, whitespace: true, message: '请输入业务名称' }]}
        >
          <Input placeholder="如 支付业务、数据接口业务" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="业务分组用途说明（可选）" />
        </Form.Item>
        {isEdit && (
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  )
}
