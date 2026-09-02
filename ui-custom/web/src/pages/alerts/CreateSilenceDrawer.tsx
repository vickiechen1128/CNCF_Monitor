/**
 * 创建静默抽屉：匹配器(matchers) + 起止时间 + 原因，即时生效（不进 M09 变更单）。
 * 契约：决策 56 授权提示「静默影响当前授权网域」；越权创建被拒展示行级错误。
 */
import { useState } from 'react'
import {
  Alert,
  App,
  Button,
  Drawer,
  Form,
  Input,
  Space,
  Switch,
  DatePicker,
  Typography,
  Divider,
} from 'antd'
import { PlusOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { CreateSilencePayload } from '../../types/alertmanager'
import { readValidateErrors } from '../../api/alertmanager'

const { Text } = Typography

export interface CreateSilenceDrawerProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: CreateSilencePayload) => Promise<void>
}

/** 表单数据转换：初始值 1 个空匹配器，is_equal=true，is_regex=false */
const initialValues = {
  matchers: [{ name: '', value: '', is_equal: true, is_regex: false }],
  starts_at: dayjs(),
  ends_at: dayjs().add(24, 'hour'),
  comment: '',
}

export function CreateSilenceDrawer({ open, onClose, onSubmit }: CreateSilenceDrawerProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<typeof initialValues>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Array<{ message: string }>>([])

  const handleFinish = async (values: typeof initialValues) => {
    setSubmitting(true)
    setError(null)
    setErrors([])

    if (!values.ends_at || values.ends_at.isBefore(values.starts_at) || values.ends_at.isSame(values.starts_at)) {
      setError('失效时间必须晚于生效时间')
      setSubmitting(false)
      return
    }

    // 过滤空匹配器（name/value 都为空）
    const matchers = (values.matchers ?? [])
      .filter((m) => m.name.trim() && m.value.trim())
      .map((m) => ({
        name: m.name.trim(),
        value: m.value.trim(),
        is_equal: m.is_equal,
        is_regex: m.is_regex,
      }))

    if (matchers.length === 0) {
      setError('至少需要一个有效的匹配条件（标签名和匹配值都不能为空）')
      setSubmitting(false)
      return
    }

    const payload: CreateSilencePayload = {
      matchers,
      starts_at: values.starts_at.toISOString(),
      ends_at: values.ends_at.toISOString(),
      comment: values.comment.trim(),
    }

    try {
      await onSubmit(payload)
      message.success('静默创建成功，已即时生效')
      setSubmitting(false)
      onClose()
    } catch (e) {
      const detail = readValidateErrors(e)
      if (detail?.items) {
        setErrors(detail.items)
        const total = detail.items.length
        setError(`${total} 项校验错误：${detail.note ?? ''}`)
      } else {
        setError(e instanceof Error ? e.message : '创建静默失败，请稍后重试')
      }
      setSubmitting(false)
    }
  }

  const matcherList = Form.useWatch('matchers', form) || []

  return (
    <Drawer
      title="创建静默"
      open={open}
      onClose={onClose}
      width={640}
      forceRender={true}
      extra={
        <Button type="primary" loading={submitting} onClick={form.submit}>
          提交创建
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        message="静默影响范围"
        description="根据决策 56 授权规则：本静默仅作用于当前登录账号授权网域范围内的告警。越权匹配会被服务端拒绝创建。"
        style={{ marginBottom: 24 }}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={initialValues}
        onFinish={handleFinish}
      >
        <div>
          <Text strong>匹配条件（matchers）</Text>
          <Divider style={{ margin: '8px 0 16px 0' }} />
          {matcherList.map((_, index) => (
            <Space key={index} align="start" style={{ marginBottom: 12 }}>
              <Form.Item
                name={['matchers', index, 'name']}
                label="标签名"
                rules={[{ required: true, message: '请输入标签名' }]}
                style={{ marginBottom: 0, width: 140 }}
              >
                <Input placeholder="如 severity" />
              </Form.Item>
              <Form.Item
                name={['matchers', index, 'value']}
                label="匹配值"
                rules={[{ required: true, message: '请输入匹配值' }]}
                style={{ marginBottom: 0, width: 160 }}
              >
                <Input placeholder="如 critical" />
              </Form.Item>
              <Form.Item
                name={['matchers', index, 'is_equal']}
                label="相等"
                valuePropName="checked"
                initialValue={true}
                style={{ marginBottom: 0, width: 60 }}
              >
                <Switch />
              </Form.Item>
              <Form.Item
                name={['matchers', index, 'is_regex']}
                label="正则"
                valuePropName="checked"
                initialValue={false}
                style={{ marginBottom: 0, width: 60 }}
              >
                <Switch />
              </Form.Item>
              {matcherList.length > 1 && (
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    const current = form.getFieldValue('matchers')
                    current.splice(index, 1)
                    form.setFieldValue('matchers', current)
                  }}
                  style={{ marginTop: 30 }}
                />
              )}
            </Space>
          ))}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => {
              const current = form.getFieldValue('matchers') || []
              form.setFieldValue('matchers', [
                ...current,
                { name: '', value: '', is_equal: true, is_regex: false },
              ])
            }}
            style={{ width: '100%', marginBottom: 16 }}
          >
            添加匹配条件
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item
            name="starts_at"
            label="生效时间"
            rules={[{ required: true, message: '请选择生效时间' }]}
            style={{ flex: 1 }}
          >
            <DatePicker
              showTime
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="选择生效时间"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            name="ends_at"
            label="失效时间"
            rules={[{ required: true, message: '请选择失效时间' }]}
            style={{ flex: 1 }}
          >
            <DatePicker
              showTime
              format="YYYY-MM-DD HH:mm:ss"
              placeholder="选择失效时间"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </div>

        <Form.Item
          name="comment"
          label="静默原因"
          rules={[{ required: true, message: '请填写静默原因，便于后续追溯' }]}
        >
          <Input.TextArea
            placeholder="请说明为什么要静默这些告警，例如：正在灰度发布，预期会产生告警..."
            rows={3}
          />
        </Form.Item>
      </Form>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="创建失败"
          description={
            <div>
              <Text>{error}</Text>
              {errors.length > 0 && (
                <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                  {errors.map((err, idx) => (
                    <li key={idx} style={{ marginBottom: 4 }}>
                      {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          }
        />
      )}
    </Drawer>
  )
}