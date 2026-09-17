import { useEffect, useState } from 'react'
import { Form, Input, Modal, message } from 'antd'
import { userApi } from '../../../api/admin'
import type { ResetPasswordInput, UserItem } from '../../../types/admin'

interface ResetPasswordModalProps {
  open: boolean
  user?: UserItem | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 管理员重置密码二次确认弹窗（契约 §2 PUT /users/:id/password）。
 * forceRender 保证每次打开由 effect reset。
 */
export function ResetPasswordModal({ open, user, onCancel, onSuccess }: ResetPasswordModalProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
  }, [open, form])

  const handleOk = async () => {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    if (!user) return
    setSubmitting(true)
    try {
      const input: ResetPasswordInput = { new_password: String(values.new_password) }
      await userApi.resetPassword(user.id, input)
      message.success(`已重置「${user.username}」的密码`)
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
      else message.error('重置密码失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="重置密码"
      open={open}
      onCancel={submitting ? undefined : onCancel}
      onOk={handleOk}
      confirmLoading={submitting}
      okText="确认重置"
      cancelText="取消"
      forceRender
      width={480}
    >
      {user && <p style={{ marginBottom: 16 }}>将为用户「{user.username}」设置新密码，重置后其旧会话将失效。</p>}
      <Form form={form} layout="vertical" name="reset-password-form" requiredMark>
        <Form.Item
          label="新密码"
          name="new_password"
          rules={[{ required: true, message: '请输入新密码' }]}
        >
          <Input.Password placeholder="请输入新密码" maxLength={128} />
        </Form.Item>
      </Form>
    </Modal>
  )
}