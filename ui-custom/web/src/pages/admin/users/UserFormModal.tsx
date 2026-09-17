import { useEffect, useState } from 'react'
import { Form, Input, Modal, Select, Typography, message } from 'antd'
import { userApi } from '../../../api/admin'
import type { UserCreateInput, UserItem, UserUpdateInput } from '../../../types/admin'

const { Text } = Typography

interface UserFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  user?: UserItem | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 用户创建 / 编辑表单（Module_06 §6.3）。
 * - 创建态 create：username / display_name / password 均可编辑；
 * - 编辑态 edit：仅 display_name 可编辑，username 显示为不可变（契约 §2 规定 username 创建后不可变更）。
 * - forceRender 替代 destroyOnHidden：保证每次打开由 effect reset+回显（网域登记弹窗同款通病修复）。
 */
export function UserFormModal({ open, mode, user, onCancel, onSuccess }: UserFormModalProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({ role: 'user' })
    if (mode === 'edit' && user) {
      form.setFieldsValue({ display_name: user.display_name, role: user.role ?? 'user' })
    }
  }, [open, mode, user, form])

  const handleOk = async () => {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      // 字段校验失败，错误已由 Form.Item 置于字段下方；不提交
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'create') {
        const input: UserCreateInput = {
          username: String(values.username),
          display_name: String(values.display_name),
          password: String(values.password),
          role: String(values.role ?? 'user'),
        }
        await userApi.create(input)
        message.success('用户已创建')
      } else if (user) {
        const input: UserUpdateInput = {
          display_name: String(values.display_name),
          role: String(values.role ?? 'user'),
        }
        await userApi.update(user.id, input)
        message.success('用户信息已更新')
      }
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
      title={mode === 'create' ? '新建用户' : '编辑用户'}
      open={open}
      onCancel={submitting ? undefined : onCancel}
      onOk={handleOk}
      confirmLoading={submitting}
      okText="提交"
      cancelText="取消"
      forceRender
      width={520}
    >
      <Form form={form} layout="vertical" name="user-form" requiredMark>
        {mode === 'create' ? (
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="例如：ops01" maxLength={64} />
          </Form.Item>
        ) : (
          <Form.Item label="用户名" extra="用户名创建后不可修改">
            <Input value={user?.username ?? ''} disabled />
          </Form.Item>
        )}

        <Form.Item
          label="显示名称"
          name="display_name"
          rules={[{ required: true, message: '请输入显示名称' }]}
        >
          <Input placeholder="例如：运维一号" maxLength={64} />
        </Form.Item>

        <Form.Item
          label="角色"
          name="role"
          rules={[{ required: true, message: '请选择角色' }]}
          extra="管理员可管理用户/租户/网域与配置下发；普通用户仅可登录查看"
        >
          <Select
            options={[
              { value: 'admin', label: '管理员' },
              { value: 'user', label: '普通用户' },
            ]}
            placeholder="请选择角色"
          />
        </Form.Item>

        {mode === 'create' ? (
          <Form.Item
            label="初始密码"
            name="password"
            rules={[{ required: true, message: '请输入初始密码' }]}
          >
            <Input.Password placeholder="请输入初始密码" maxLength={128} />
          </Form.Item>
        ) : (
          <Text type="secondary">如需重置密码，请在列表操作中使用「重置密码」。</Text>
        )}
      </Form>
    </Modal>
  )
}