/**
 * 通知渠道新增 / 编辑抽屉（PL-3 通知渲染桥，2026-09-28）。
 * 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
 *
 * 凭据口径（关键约束）：
 *  - 响应已脱敏，编辑时**不回显** webhook_url 真实值——仅把脱敏值作占位提示，留空=不修改；
 *  - secret 永不回显，secret_set=true 时提示「已设置，留空不修改」；
 *  - 更新请求仅传需修改字段（未填 webhook_url/secret 即不提交该字段，服务端保留原值）。
 *
 * 校验失败（400 bad_request，中文原因）逐字段映射回表单（无法定位字段时落通用错误条）。
 * Step 3.7：含 Form 且 use(open) 回显 → 强制 forceRender，禁用 destroyOnHidden/Close。
 */
import { useEffect, useState } from 'react'
import { Alert, App, Button, Drawer, Form, Input, Select, Switch, Typography } from 'antd'
import { isApiError } from '../../api/client'
import type {
  CreateNotifyChannelPayload,
  NotifyChannel,
  NotifyChannelType,
  UpdateNotifyChannelPayload,
} from '../../types/alertmanager'
import { NOTIFY_CHANNEL_TYPE_OPTIONS } from './alertmanagerConstants'

const { Text } = Typography

export interface NotifyChannelDrawerProps {
  open: boolean
  /** 编辑对象；null = 新增 */
  record: NotifyChannel | null
  onClose: () => void
  onCreate: (payload: CreateNotifyChannelPayload) => Promise<void>
  onUpdate: (id: string, payload: UpdateNotifyChannelPayload) => Promise<void>
}

interface FormValues {
  name: string
  type: NotifyChannelType
  webhook_url?: string
  secret?: string
  enabled: boolean
}

/** webhook 地址合法性：仅接受 http/https，与后端校验口径一致 */
function isValidWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 把后端返回的中文校验原因映射到对应表单字段（名称 / 类型 / Webhook / 密钥）。
 * 无法定位时返回 null，由抽屉展示通用错误条——避免「只弹一句 toast、用户不知道改哪」。
 */
function mapErrorToField(message: string): keyof FormValues | null {
  const msg = message.toLowerCase()
  if (msg.includes('webhook') || msg.includes('url') || msg.includes('地址')) return 'webhook_url'
  if (msg.includes('名称') || msg.includes('name')) return 'name'
  if (msg.includes('类型') || msg.includes('type')) return 'type'
  if (msg.includes('密钥') || msg.includes('secret') || msg.includes('加签')) return 'secret'
  return null
}

export function NotifyChannelDrawer({ open, record, onClose, onCreate, onUpdate }: NotifyChannelDrawerProps) {
  const { message } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = record !== null

  useEffect(() => {
    if (!open) return
    // forceRender 常驻挂载 + 父级 key={drawerSeq} 每次打开重挂：submitting/error 随挂载重置为
    // false/null（故此处不再同步 setState，避免 set-state-in-effect）；本 effect 只做表单重置与回显。
    form.resetFields()
    if (record) {
      // webhook_url / secret 不回填（响应脱敏），留空即不修改
      form.setFieldsValue({
        name: record.name,
        type: record.type,
        enabled: record.enabled,
        webhook_url: '',
        secret: '',
      })
    }
  }, [open, record, form])

  const handleFinish = async (values: FormValues) => {
    setSubmitting(true)
    setError(null)
    const name = values.name.trim()
    const webhookUrl = values.webhook_url?.trim() ?? ''
    const secret = values.secret?.trim() ?? ''
    try {
      if (record) {
        const payload: UpdateNotifyChannelPayload = { name, type: values.type, enabled: values.enabled }
        if (webhookUrl) payload.webhook_url = webhookUrl
        if (secret) payload.secret = secret
        await onUpdate(record.id, payload)
        message.success('通知渠道已更新')
      } else {
        const payload: CreateNotifyChannelPayload = {
          name,
          type: values.type,
          webhook_url: webhookUrl,
          enabled: values.enabled,
        }
        if (secret) payload.secret = secret
        await onCreate(payload)
        message.success('通知渠道已创建')
      }
      setSubmitting(false)
      onClose()
    } catch (e) {
      const reason = e instanceof Error ? e.message : '保存失败，请稍后重试'
      const field = isApiError(e) && e.errorType === 'bad_request' ? mapErrorToField(reason) : null
      if (field) {
        form.setFields([{ name: field, errors: [reason] }])
      } else {
        setError(reason)
      }
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? '编辑通知渠道' : '新增通知渠道'}
      open={open}
      onClose={onClose}
      width={560}
      forceRender
      extra={
        <Button type="primary" loading={submitting} onClick={form.submit}>
          {isEdit ? '保存修改' : '创建渠道'}
        </Button>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        通知渠道是告警最终送达的目标机器人；配置告警分派时只引用渠道 ID，真实地址仅平台侧存储。
      </Text>

      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'feishu', enabled: true }}
        onFinish={handleFinish}
      >
        <Form.Item
          name="name"
          label="渠道名称"
          rules={[{ required: true, message: '请填写渠道名称' }]}
        >
          <Input placeholder="如：SRE 飞书群、数据库团队群" maxLength={64} />
        </Form.Item>

        <Form.Item
          name="type"
          label="渠道类型"
          rules={[{ required: true, message: '请选择渠道类型' }]}
        >
          <Select options={NOTIFY_CHANNEL_TYPE_OPTIONS} placeholder="请选择机器人类型" />
        </Form.Item>

        <Form.Item
          name="webhook_url"
          label="机器人 Webhook"
          rules={[
            {
              validator: (_rule, value: string | undefined) => {
                const v = (value ?? '').trim()
                if (!isEdit && !v) return Promise.reject(new Error('请填写机器人 Webhook 地址'))
                if (v && !isValidWebhookUrl(v)) {
                  return Promise.reject(new Error('Webhook 地址需为合法的 http/https 链接'))
                }
                return Promise.resolve()
              },
            },
          ]}
          extra={
            isEdit
              ? `当前地址：${record?.webhook_url ?? '-'}（已脱敏）；留空表示不修改，变更请重新粘贴完整地址`
              : '机器人完整地址（含 token），仅在平台侧存储，列表按脱敏展示'
          }
        >
          <Input
            placeholder={isEdit ? (record?.webhook_url ?? '留空不修改') : 'https://.../机器人 Webhook 地址'}
            allowClear
          />
        </Form.Item>

        <Form.Item
          name="secret"
          label="签名密钥（选填）"
          extra={
            isEdit && record?.secret_set
              ? '已设置，留空不修改'
              : '钉钉 / 飞书启用加签时需要；留空表示不设置加签'
          }
        >
          <Input placeholder={isEdit && record?.secret_set ? '已设置，留空不修改' : '选填，加签密钥'} allowClear />
        </Form.Item>

        <Form.Item name="enabled" label="启用状态" valuePropName="checked">
          <Switch checkedChildren="启用" unCheckedChildren="停用" />
        </Form.Item>
      </Form>

      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message="保存失败"
          description={error}
        />
      )}
    </Drawer>
  )
}