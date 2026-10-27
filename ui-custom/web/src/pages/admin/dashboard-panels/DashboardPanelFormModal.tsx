import { useEffect, useState } from 'react'
import { Form, Input, Modal, message } from 'antd'
import { dashboardPanelApi } from '../../../api/dashboardPanels'

interface DashboardPanelFormModalProps {
  open: boolean
  panel?: import('../../../api/dashboardPanels').DashboardPanel | null
  onCancel: () => void
  onSuccess: () => void
}

export function DashboardPanelFormModal({ open, panel, onCancel, onSuccess }: DashboardPanelFormModalProps) {
  const [form] = Form.useForm<{ name: string; url: string }>()
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (panel) form.setFieldsValue({ name: panel.name, url: panel.url })
  }, [open, panel, form])

  const handleSubmit = async () => {
    let values: { name: string; url: string }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      const input = { name: values.name.trim(), url: values.url.trim() }
      if (panel) {
        await dashboardPanelApi.update(panel.id, input)
      } else {
        await dashboardPanelApi.create(input)
      }
      message.success(panel ? '面板修改成功' : '面板挂载成功')
      onSuccess()
      onCancel()
    } catch (err) {
      message.error(err instanceof Error ? err.message : panel ? '修改失败，请稍后重试' : '挂载失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title={panel ? '编辑面板' : '新增面板'}
      open={open}
      onCancel={submitting ? undefined : onCancel}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="提交"
      okButtonProps={{ 'aria-label': '提交' }}
      cancelText="取消"
      forceRender
      width={640}
    >
      <Form form={form} layout="vertical" name="dashboard-panel-form" requiredMark>
        <Form.Item
          label="面板名称"
          name="name"
          rules={[{ required: true, whitespace: true, message: '请输入面板名称' }]}
        >
          <Input placeholder="例如：节点监控大屏" maxLength={100} />
        </Form.Item>
        <Form.Item
          label="Grafana URL"
          name="url"
          extra="粘贴完整的仪表盘地址，系统会以 kiosk 模式内嵌展示"
          rules={[
            { required: true, whitespace: true, message: '请输入 Grafana URL' },
            {
              validator: (_rule, value: string | undefined) => {
                if (!value) return Promise.resolve()
                try {
                  const url = new URL(value.trim())
                  if (!['http:', 'https:'].includes(url.protocol) || !url.host || !url.pathname.startsWith('/d/')) {
                    return Promise.reject(new Error('请输入有效的 Grafana 仪表盘 http/https 地址'))
                  }
                  return Promise.resolve()
                } catch {
                  return Promise.reject(new Error('请输入有效的 Grafana 仪表盘地址'))
                }
              },
            },
          ]}
        >
          <Input.TextArea rows={4} maxLength={2048} placeholder="http://grafana.example.com:3000/d/..." />
        </Form.Item>
      </Form>
    </Modal>
  )
}
