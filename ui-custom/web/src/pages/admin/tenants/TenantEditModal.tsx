import { useEffect, useState } from 'react'
import { Form, Input, Modal, Switch, message } from 'antd'
import { tenantAdminApi } from '../../../api/admin'
import type { TenantEditInput } from '../../../types/admin'
import type { Tenant } from '../../../types/domain'

interface TenantEditModalProps {
  open: boolean
  tenant?: Tenant | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 租户编辑弹窗（契约 §3：仅允许编辑 name / multi_site_enabled）。
 * MVP 不开放新建与禁用（页面无「新建租户」「禁用」入口），本弹窗仅编辑。
 */
export function TenantEditModal({ open, tenant, onCancel, onSuccess }: TenantEditModalProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (tenant) {
      form.setFieldsValue({ name: tenant.name, multi_site_enabled: tenant.multi_site_enabled })
    }
  }, [open, tenant, form])

  const handleOk = async () => {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    if (!tenant) return
    setSubmitting(true)
    try {
      const input: TenantEditInput = {
        name: String(values.name),
        multi_site_enabled: Boolean(values.multi_site_enabled),
      }
      await tenantAdminApi.update(tenant.id, input)
      message.success('租户信息已更新')
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
      else message.error('提交失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="编辑租户"
      open={open}
      onCancel={submitting ? undefined : onCancel}
      onOk={handleOk}
      confirmLoading={submitting}
      okText="提交"
      cancelText="取消"
      forceRender
      width={480}
    >
      <Form form={form} layout="vertical" name="tenant-edit-form" requiredMark>
        <Form.Item label="租户名称" name="name" rules={[{ required: true, message: '请输入租户名称' }]}>
          <Input placeholder="请输入租户名称" maxLength={64} />
        </Form.Item>
        <Form.Item label="多站点采集" name="multi_site_enabled" valuePropName="checked">
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>
      </Form>
    </Modal>
  )
}