import { Form, Input, Select, Tag, Tooltip, Drawer, Typography, Space, Button, message } from 'antd'
import type { NetworkDomain } from '../../../types/config-center'
import {
  agentTypeLabel,
  channelColor,
  channelLabel,
  channelTip,
  deriveRemoteWriteUrl,
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
 * - agent_type MVP 固定 vmagent；remote_write_url 留空自动推导、可手动覆盖；
 *   local 通道（default）为只读确认纳管（不生成 Token / Remote Write）。
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

        <Form.Item label="目标网域">
          <Input value={domain ? `${domain.name}（${domain.id}，租户：${domain.tenant_id}）` : ''} disabled />
        </Form.Item>

        <Form.Item label="下发通道（只读）">
          {domain && (
            <Tooltip title={channelTip[domain.channel]}>
              <Tag color={channelColor[domain.channel]}>{channelLabel[domain.channel]}</Tag>
            </Tooltip>
          )}
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: '18px', marginTop: 4 }}>
            {isLocal
              ? 'default 网域固定 local 通道：采集器与中心同机，由中心直接写盘并 reload，无需 Edge Agent / Token / 安装指引。'
              : '非 default 网域固定 agent_pull 通道（Edge Sync Agent 心跳拉取配置包）；通道切换属 v0.4+ 演化场景，MVP 不提供。'}
          </div>
        </Form.Item>

        {isLocal ? (
          <Form.Item label="指标采集器类型">
            <Input value="无" disabled />
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: '18px', marginTop: 4 }}>
              local 通道网域（default）由中心负责采集，无独立采集器进程，不涉及采集器类型。
            </div>
          </Form.Item>
        ) : (
          <Form.Item
            name="agent_type"
            label="指标采集器类型"
            extra="MVP 阶段固定 vmagent（纳管时无需选择）；prometheus-agent 枚举保留、v0.2+ 开放"
          >
            <Select options={[{ value: 'vmagent', label: agentTypeLabel.vmagent }]} disabled />
          </Form.Item>
        )}

        {!isLocal && (
          <Form.Item
            name="remote_write_url"
            label="Remote Write URL"
            extra="留空由平台自动推导（中心 ingress + 网域路径），可手动覆盖；语义为该网域视角的可达地址（网闸映射后地址）"
          >
            <Input placeholder="留空则自动生成，例如 https://metriccenter.example.com/api/v2/ingest/<domain-id>/prometheus" />
          </Form.Item>
        )}

        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征" />
        </Form.Item>

        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          {isLocal
            ? '确认纳管后随即生效：由中心直接写盘并 reload（无 Token / 安装步骤）。'
            : '确认纳管后自动签发 Token 与 Remote Write URL；Agent 主机信息与心跳状态在接入后自动补全，接入步骤见页面顶部「安装指引」。'}
        </Text>
      </Form>
    </Drawer>
  )
}

export default OnboardDomainDrawer