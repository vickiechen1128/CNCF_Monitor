/**
 * 通知模板提交 / 复制自定义抽屉（PL-3 通知渲染桥，2026-09-28）。
 * 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
 *
 * 模板形态：Alertmanager 标准 Go template 文本（**不是脚本**，平台不执行任意代码）。
 * 校验在服务端执行（Go template 解析 + amtool 等价工序），前端不做模板解析；
 * 校验失败返回 400 bad_request，`data.items` 为行级错误，逐条渲染在编辑框下方。
 *
 * Step 3.7：含 Form 且 use(open) 回显 → 强制 forceRender，禁用 destroyOnHidden/Close。
 */
import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Select, Typography } from 'antd'
import { readValidateErrors } from '../../api/alertmanager'
import type { NotifyChannelType, SubmitNotifyTemplatePayload, ValidateErrorItem } from '../../types/alertmanager'
import { NOTIFY_CHANNEL_TYPE_OPTIONS } from './alertmanagerConstants'

const { Text } = Typography

export interface NotifyTemplateInitial {
  name: string
  channelType: NotifyChannelType
  content: string
}

export interface NotifyTemplateDrawerProps {
  open: boolean
  /** create=提交自定义模板；clone=复制已有模板后自定义 */
  mode: 'create' | 'clone'
  /** 预填内容（复制模板时带上原名称与内容） */
  initial: NotifyTemplateInitial
  onClose: () => void
  onSubmit: (payload: SubmitNotifyTemplatePayload) => Promise<void>
}

interface FormValues {
  name: string
  channel_type: NotifyChannelType
  content: string
}

export function NotifyTemplateDrawer({ open, mode, initial, onClose, onSubmit }: NotifyTemplateDrawerProps) {
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<ValidateErrorItem[]>([])

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      name: initial.name,
      channel_type: initial.channelType,
      content: initial.content,
    })
  }, [open, initial, form])

  const handleFinish = async (values: FormValues) => {
    setSubmitting(true)
    setError(null)
    setErrors([])
    try {
      await onSubmit({
        name: values.name.trim(),
        channel_type: values.channel_type,
        content: values.content,
      })
      setSubmitting(false)
      onClose()
    } catch (e) {
      const detail = readValidateErrors(e)
      if (detail?.items?.length) {
        setErrors(detail.items)
        setError(detail.note ? `模板校验失败：${detail.note}` : '模板校验失败，请按下方提示修改后重新提交')
      } else {
        setError(e instanceof Error ? e.message : '提交失败，请稍后重试')
      }
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={mode === 'clone' ? '复制并自定义模板' : '提交自定义模板'}
      open={open}
      onClose={onClose}
      width={720}
      forceRender
      extra={
        <Button type="primary" loading={submitting} onClick={form.submit}>
          {mode === 'clone' ? '保存为新模板' : '提交模板'}
        </Button>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        模板是 Alertmanager 标准 Go template 文本，用于决定告警通知长什么样；平台按模板渲染为各渠道卡片，
        时区与证书由平台统一处理，你只需关注内容与样式。
      </Text>

      <Form form={form} layout="vertical" onFinish={handleFinish}>
        <Form.Item
          name="name"
          label="模板名称"
          rules={[{ required: true, message: '请填写模板名称' }]}
        >
          <Input placeholder="如：安全告警-飞书卡片" maxLength={64} />
        </Form.Item>

        <Form.Item
          name="channel_type"
          label="适用渠道类型"
          rules={[{ required: true, message: '请选择适用渠道类型' }]}
        >
          <Select options={NOTIFY_CHANNEL_TYPE_OPTIONS} placeholder="请选择该模板适用的机器人类型" />
        </Form.Item>

        <Form.Item
          name="content"
          label="模板内容（Go template）"
          rules={[{ required: true, message: '请填写模板内容' }]}
        >
          <Input.TextArea
            rows={16}
            spellCheck={false}
            placeholder={'{{ define "feishu.card" }}…{{ end }}'}
            style={{
              fontFamily: 'SFMono-Regular, Consolas, Menlo, monospace',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          />
        </Form.Item>
      </Form>

      {/* 服务端行级校验错误（复用 M08 挂载抽屉的行级错误展示形态），紧随编辑区便于对照修改 */}
      {errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message="模板校验未通过（未保存、未生效）"
          description={
            <div>
              <Text>请按下述行级提示修改后重新提交：</Text>
              <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                {errors.map((err, idx) => (
                  <li key={idx} style={{ marginBottom: 4, fontSize: 13 }}>
                    {err.file ? (
                      <Text code style={{ marginRight: 8 }}>
                        {err.file}
                        {err.line > 0 ? `:${err.line}` : ''}
                      </Text>
                    ) : null}
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          }
        />
      )}

      {error && errors.length === 0 && (
        <Alert type="error" showIcon style={{ marginTop: 8 }} message="提交失败" description={error} />
      )}

      <Text type="secondary" style={{ display: 'block', marginTop: 16, fontSize: 12 }}>
        提交后会先做模板校验，校验通过才留痕；失败不改动现有模板。
      </Text>
    </Drawer>
  )
}
