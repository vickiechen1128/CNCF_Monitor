import { Form, Input, Select, Tag, Drawer, Typography, Space, Button, message } from 'antd'
import type { NetworkDomain } from '../../../types/config-center'
import { FieldLabel } from '../../../components/FieldLabel'
import {
  agentTypeLabel,
  deriveRemoteWriteUrl,
  DOMAIN_FIELD_TIP,
  domainTypeColor,
  domainTypeLabel,
} from '../configCenterConstants'

const { Text } = Typography

export interface OnboardInput {
  agent_type?: NetworkDomain['agent_type']
  remote_write_url?: string
  description?: string
}

interface OnboardDomainDrawerProps {
  open: boolean
  domain: NetworkDomain | null
  submitting?: boolean
  /** 纳管提交：父级负责调用 API 并在成功后 reload；本组件负责表单校验与关闭控制 */
  onSubmit: (input: OnboardInput) => Promise<void>
  onClose: () => void
}

interface FormValues {
  agent_type: NetworkDomain['agent_type']
  remote_write_url?: string
  description?: string
}

/**
 * 网域纳管 Drawer（Module_09 契约 §3）。
 * - 仅通过行内「纳管」按钮触发，预选当前行网域（入口单一化，决策 34/35）。
 * - 行政字段（名称/租户/类型）由 M06 维护，只读展示。
 * - agent_type MVP 固定 vmagent；remote_write_url（用户术语「指标回传地址」）留空自动推导、可手动覆盖；
 *   中心直连域（default）为只读确认纳管（不生成 Token / 回传地址）。
 */
export function OnboardDomainDrawer({ open, domain, submitting, onSubmit, onClose }: OnboardDomainDrawerProps) {
  const [form] = Form.useForm<FormValues>()

  const isLocal = domain?.channel === 'local'

  const handleFinish = async (values: FormValues) => {
    if (!domain) return
    try {
      await onSubmit({
        agent_type: values.agent_type ?? 'vmagent',
        remote_write_url: isLocal
          ? undefined
          : (values.remote_write_url?.trim() || deriveRemoteWriteUrl(domain.id)),
        description: values.description?.trim() || undefined,
      })
      form.resetFields()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '纳管失败，请稍后重试')
    }
  }

  const handleCancel = () => {
    form.resetFields()
    onClose()
  }

  return (
    <Drawer
      title="网域纳管（监控接入）"
      placement="right"
      width={520}
      open={open}
      onClose={handleCancel}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" loading={submitting} disabled={!domain} onClick={() => form.submit()}>
            确认纳管
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ agent_type: 'vmagent' }} onFinish={handleFinish}>
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 16 }}>
          网域的行政创建与租户分配由「系统与平台管理 · 网域管理」负责；此处仅填写监控纳管参数。
        </Text>

        <Form.Item label={<FieldLabel label="目标网域" tip={DOMAIN_FIELD_TIP.domain} />}>
          <Input value={domain ? `${domain.name}（${domain.id}，租户：${domain.tenant_id}）` : ''} disabled />
        </Form.Item>

        <Form.Item
          label={
            <FieldLabel
              label="接入方式"
              tip={isLocal ? DOMAIN_FIELD_TIP.channelLocal : DOMAIN_FIELD_TIP.channelAgentPull}
            />
          }
        >
          {domain && (
            <Tag color={domainTypeColor[domain.domain_type]}>{domainTypeLabel[domain.domain_type]}</Tag>
          )}
        </Form.Item>

        {isLocal ? (
          <Form.Item
            label={<FieldLabel label="指标采集器类型" tip={DOMAIN_FIELD_TIP.agentTypeLocal} />}
          >
            <Input value="无" disabled />
          </Form.Item>
        ) : (
          <Form.Item
            name="agent_type"
            label={<FieldLabel label="指标采集器类型" tip={DOMAIN_FIELD_TIP.agentType} />}
          >
            <Select options={[{ value: 'vmagent', label: agentTypeLabel.vmagent }]} disabled />
          </Form.Item>
        )}

        {!isLocal && (
          <Form.Item
            name="remote_write_url"
            label={<FieldLabel label="指标回传地址" tip={DOMAIN_FIELD_TIP.remoteWriteUrl} />}
          >
            <Input placeholder="留空则自动生成，例如 https://metriccenter.example.com/api/v2/ingest/<domain-id>/prometheus" />
          </Form.Item>
        )}

        <Form.Item
          name="description"
          label={<FieldLabel label="描述" tip={DOMAIN_FIELD_TIP.description} />}
        >
          <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征" />
        </Form.Item>

        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          {isLocal
            ? '确认纳管后随即生效：由平台直接写盘并生效（无 Token / 安装步骤）。'
            : '确认纳管后平台自动生成接入 Token 与指标回传地址；采集节点的主机信息与在线状态在接入后自动补全。接入步骤与离线安装包下载见页面顶部「安装指引 · 下载安装包」。'}
        </Text>
      </Form>
    </Drawer>
  )
}

export default OnboardDomainDrawer