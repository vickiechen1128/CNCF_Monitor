import { Button, Descriptions, Drawer, Space, Typography, message } from 'antd'
import type { NetworkDomain } from '../../../types/config-center'

const { Text } = Typography

interface OnboardDomainDrawerProps {
  open: boolean
  domain: NetworkDomain | null
  submitting?: boolean
  /** 纳管提交：父级负责调用 API 并在成功后 reload；本组件只做确认 */
  onSubmit: () => Promise<void>
  onClose: () => void
}

/**
 * 网域纳管 Drawer（M09 v3 契约 §2.2）。
 * v3 纳管接口不接收请求体：Token、中心接入地址与指标回传地址由后端签发/推导，
 * 因此这里只做信息确认；纳管成功后由父级用一次性 Modal 展示明文 Token。
 */
export function OnboardDomainDrawer({ open, domain, submitting, onSubmit, onClose }: OnboardDomainDrawerProps) {
  const handleFinish = async () => {
    if (!domain) return
    try {
      await onSubmit()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '纳管失败，请稍后重试')
    }
  }

  return (
    <Drawer
      title="网域纳管（监控接入）"
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} disabled={!domain} onClick={handleFinish}>
            确认纳管
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 16 }}>
        网域的行政创建与租户分配由「系统与平台管理 · 网域管理」负责；纳管后平台自动签发接入 Token，
        并生成中心接入地址与指标回传地址。
      </Text>

      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="网域名称">{domain?.name ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="网域 ID">
          <Text code>{domain?.id ?? '-'}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="云归属">{domain?.cloud_code || '-'}</Descriptions.Item>
        <Descriptions.Item label="网络区域类型">{domain?.zone_type || '-'}</Descriptions.Item>
      </Descriptions>

      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 16 }}>
        确认纳管后：平台签发接入 Token（仅本次显示，请立即保存），采集节点按安装指引部署后即可回连。
      </Text>
    </Drawer>
  )
}

export default OnboardDomainDrawer
