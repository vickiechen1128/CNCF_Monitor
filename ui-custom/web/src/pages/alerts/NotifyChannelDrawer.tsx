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
import { Link } from 'react-router-dom'
import { isApiError } from '../../api/client'
import { notifyTemplatesApi } from '../../api/alertmanager'
import type {
  CreateNotifyChannelPayload,
  NotifyChannel,
  NotifyChannelType,
  NotifyTemplate,
  UpdateNotifyChannelPayload,
} from '../../types/alertmanager'
import { NOTIFY_CHANNEL_TYPE_OPTIONS, NOTIFY_TEMPLATES_PATH } from './alertmanagerConstants'

const { Text } = Typography

/** 已存密钥在前端的占位值：可见地表示「已设置」，提交时原样保留、不当作真实密钥。 */
const MASKED_SECRET = '***'

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
  /** 是否启用签名/加签；仅飞书 / 钉钉有效 */
  signing_enabled?: boolean
  secret?: string
  /** 绑定的通知模板 ID；undefined = 使用平台内置默认模板 */
  default_template_id?: number
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
  if (msg.includes('模板') || msg.includes('template')) return 'default_template_id'
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
  const [templates, setTemplates] = useState<NotifyTemplate[]>([])
  const isEdit = record !== null
  const channelType = Form.useWatch('type', form)
  const signingEnabled = Form.useWatch('signing_enabled', form)
  const isWebhook = channelType === 'webhook'
  const usesTemplate = !isWebhook
  const supportsSigning = channelType === 'feishu' || channelType === 'dingtalk'
  const signingLabel = channelType === 'dingtalk' ? '加签密钥' : '签名密钥'
  const secretRequired = supportsSigning && signingEnabled

  // 模板下拉选项：仅当前渠道类型下的模板，内置默认置顶并标注（渠道 ↔ 模板一等绑定，dev-feedback #30）。
  const typeTemplates = templates.filter((t) => t.channel_type === channelType)
  const hasBuiltin = typeTemplates.some((t) => t.is_builtin)
  const templateOptions = [...typeTemplates]
    .sort((a, b) => Number(b.is_builtin) - Number(a.is_builtin))
    .map((t) => ({
      value: Number(t.id),
      label: t.is_builtin ? `${t.name}（平台内置默认）` : t.name,
    }))

  // 打开抽屉时拉取模板列表（失败不阻断表单：无权限/接口异常时下拉为空，仍可保存渠道）。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await notifyTemplatesApi.list()
        if (cancelled) return
        const items = res.data?.items ?? []
        setTemplates(items)
        // 飞书有内置模板：未选择时自动选中，既满足「模板必填」也保留零配置体验。
        if (form.getFieldValue('type') === 'feishu' && !form.getFieldValue('default_template_id')) {
          const builtin = items.find((t) => t.is_builtin && t.channel_type === 'feishu')
          if (builtin) form.setFieldValue('default_template_id', Number(builtin.id))
        }
      } catch {
        if (!cancelled) setTemplates([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, form])

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
        // IM 机器人地址本身就是脱敏串（如 https://open.feishu.cn/***），直接回填让用户看到已配置；
        // 自定义 Webhook 返回完整地址。提交时未改动的 IM 脱敏串不会回传。
        webhook_url: record.webhook_url,
        signing_enabled: record.secret_set,
        // 已存密钥用 *** 占位，用户能看到「已设置」；提交时 *** 视为保留原值。
        secret: record.secret_set ? MASKED_SECRET : '',
        default_template_id: record.default_template_id,
      })
    } else {
      form.setFieldsValue({ signing_enabled: false })
    }
  }, [open, record, form])

  const handleFinish = async (values: FormValues) => {
    setSubmitting(true)
    setError(null)
    const name = values.name.trim()
    const webhookUrl = values.webhook_url?.trim() ?? ''
    const secret = values.secret?.trim() ?? ''
    const usesTemplate = values.type !== 'webhook'
    const canSign = values.type === 'feishu' || values.type === 'dingtalk'
    const wantSign = canSign && values.signing_enabled === true
    // IM 渠道编辑时回填的是脱敏串（如 https://open.feishu.cn/***）；未改动则不回传。
    const maskedURLUnchanged = record?.type !== 'webhook' && webhookUrl === (record?.webhook_url ?? '')
    try {
      if (record) {
        const payload: UpdateNotifyChannelPayload = { name, type: values.type }
        if (webhookUrl && !maskedURLUnchanged) payload.webhook_url = webhookUrl
        if (wantSign) {
          // *** 表示沿用已存密钥；只有用户粘贴了新密钥才提交。
          if (secret && secret !== MASKED_SECRET) payload.secret = secret
        } else {
          // 关闭签名（或切换到不支持签名的类型）：显式清空已存密钥。
          payload.secret = ''
        }
        // 自定义 Webhook 显式解绑模板；IM 类型始终提交所选模板（必填）。
        payload.default_template_id = usesTemplate ? (values.default_template_id ?? 0) : 0
        await onUpdate(record.id, payload)
        message.success('通知渠道已更新')
      } else {
        const payload: CreateNotifyChannelPayload = {
          name,
          type: values.type,
          webhook_url: webhookUrl,
        }
        if (wantSign && secret && secret !== MASKED_SECRET) payload.secret = secret
        if (usesTemplate && values.default_template_id) payload.default_template_id = values.default_template_id
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
        通知渠道是告警最终送达的目标；配置告警分派时只引用渠道 ID，真实地址仅平台侧存储。
      </Text>

      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'feishu' }}
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
          <Select
            options={NOTIFY_CHANNEL_TYPE_OPTIONS}
            placeholder="请选择渠道类型"
            onChange={(v: NotifyChannelType) => {
              form.setFieldValue('default_template_id', undefined)
              // 飞书有内置模板：切到飞书时自动选中，满足模板必填。
              if (v === 'feishu') {
                const builtin = templates.find((t) => t.is_builtin && t.channel_type === 'feishu')
                if (builtin) form.setFieldValue('default_template_id', Number(builtin.id))
              }
              // 渠道类型变化后，目标地址与密钥对应的机器人类型都变了：清空地址，
              // 关闭签名并清空旧密钥，由用户按新类型重新填写。
              if (v !== record?.type) {
                form.setFieldsValue({ webhook_url: '', signing_enabled: false, secret: '' })
              }
            }}
          />
        </Form.Item>

        {usesTemplate && (
          <Form.Item
            name="default_template_id"
            label="通知模板"
            required
            rules={[{ required: true, message: '请选择通知模板' }]}
            extra={
              hasBuiltin ? (
                <>
                  模板必填；飞书已自动选中内置默认模板，也可到
                  <Link to={NOTIFY_TEMPLATES_PATH}>通知模板</Link>
                  复制后自定义。
                </>
              ) : (
                <>
                  该渠道类型没有内置模板，必须选择自定义模板；没有合适的请先到
                  <Link to={NOTIFY_TEMPLATES_PATH}>通知模板</Link>
                  新建。
                </>
              )
            }
          >
            <Select
              options={templateOptions}
              placeholder={hasBuiltin ? '请选择通知模板' : '请选择自定义模板'}
              notFoundContent="该渠道类型下暂无模板，请先到通知模板页新建自定义模板"
            />
          </Form.Item>
        )}

        <Form.Item
          name="webhook_url"
          label="Webhook 地址"
          required
          rules={[
            {
              // 编辑时回填原值（IM 为脱敏串）：保持原值=不修改；清空则必须重新填写完整地址。
              required: true,
              message: '请填写 Webhook 地址',
            },
            {
              validator: (_rule, value: string | undefined) => {
                const v = (value ?? '').trim()
                if (v && !isValidWebhookUrl(v)) {
                  return Promise.reject(new Error('Webhook 地址需为合法的 http/https 链接'))
                }
                return Promise.resolve()
              },
            },
          ]}
          extra={
            isWebhook
              ? '平台会把 Alertmanager 原始告警 JSON POST 到该地址，不渲染模板、不签名。'
              : isEdit
                ? '当前地址已脱敏显示（路径 / token 显示为 ***）；保持原值表示不修改，清空后必须重新填写完整地址'
                : '完整机器人地址（含 token），仅在平台侧存储'
          }
        >
          <Input placeholder="https://.../Webhook 地址" allowClear />
        </Form.Item>

        {supportsSigning && (
          <Form.Item
            name="signing_enabled"
            label="签名设置"
            valuePropName="checked"
            extra={
              channelType === 'dingtalk'
                ? '仅当钉钉机器人安全设置开启「加签」时打开；关闭会清空已存密钥'
                : '仅当飞书机器人安全设置开启「签名校验」时打开；关闭会清空已存密钥'
            }
          >
            <Switch
              checkedChildren="已启用"
              unCheckedChildren="未启用"
              onChange={(checked) => {
                if (!checked) form.setFieldValue('secret', '')
              }}
            />
          </Form.Item>
        )}

        {supportsSigning && signingEnabled && (
          <Form.Item
            name="secret"
            label={signingLabel}
            required={supportsSigning && signingEnabled}
            rules={[
              {
                required: secretRequired,
                message:
                  channelType === 'dingtalk'
                    ? '请填写钉钉加签密钥；未开启加签请关闭开关'
                    : '请填写飞书签名密钥；未开启签名校验请关闭开关',
              },
            ]}
            extra={
              isEdit && record?.secret_set
                ? '已设置（显示为 ***）；保留 *** 表示不修改，粘贴新值则覆盖；如需关闭请关闭上方开关'
                : '填写机器人后台安全设置中生成的密钥'
            }
          >
            <Input placeholder="粘贴签名/加签密钥" allowClear />
          </Form.Item>
        )}

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