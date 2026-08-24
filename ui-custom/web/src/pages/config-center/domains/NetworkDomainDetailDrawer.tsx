import { Descriptions, Drawer, Tag, Tooltip, Typography } from 'antd'
import type { NetworkDomain } from '../../../types/config-center'
import {
  agentTypeLabel,
  channelColor,
  channelLabel,
  channelTip,
  deriveRegistrationStatus,
  domainTypeColor,
  domainTypeLabel,
  monitoredStatusColor,
  monitoredStatusLabel,
  registrationStatusColor,
  registrationStatusLabel,
} from '../configCenterConstants'

const { Text } = Typography

interface NetworkDomainDetailDrawerProps {
  open: boolean
  domain: NetworkDomain | null
  onClose: () => void
}

/** 配置字段值：仅 agent_pull 展示，local 恒 '-'（契约 §10，C1/C2 占位） */
function ConfigValue({ channel, value }: { channel: NetworkDomain['channel']; value?: string }) {
  if (channel !== 'agent_pull' || !value) {
    return <Text type="secondary">-</Text>
  }
  return <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>{value}</Text>
}

/**
 * 网域详情抽屉（Module_09 契约 §3 / 决策 36-1）。
 * 配置字段（中心接入地址 / Remote Write URL / Agent 类型 / 描述）入 Drawer；
 * 行政字段（名称/租户/类型/网络区域类型）由 M06 维护，只读展示。
 */
export function NetworkDomainDetailDrawer({ open, domain, onClose }: NetworkDomainDetailDrawerProps) {
  return (
    <Drawer title={domain ? `网域详情 - ${domain.name}` : '网域详情'} placement="right" width={480} open={open} onClose={onClose}>
      {domain && (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="网域名称">{domain.name}</Descriptions.Item>
          <Descriptions.Item label="网域 ID">
            <Text code>{domain.id}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="域类型">
            <Tag color={domainTypeColor[domain.domain_type]}>{domainTypeLabel[domain.domain_type]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="归属租户">{domain.tenant_id}</Descriptions.Item>
          <Descriptions.Item label="网络区域类型">
            {domain.zone_type ? <Tag>{domain.zone_type}</Tag> : <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="纳管状态">
            <Tag color={registrationStatusColor[deriveRegistrationStatus(domain)]}>
              {registrationStatusLabel[deriveRegistrationStatus(domain)]}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="下发通道">
            <Tooltip title={channelTip[domain.channel]}>
              <Tag color={channelColor[domain.channel]}>{channelLabel[domain.channel]}</Tag>
            </Tooltip>
          </Descriptions.Item>
          <Descriptions.Item label="中心接入地址">
            <ConfigValue channel={domain.channel} value={domain.center_endpoint} />
          </Descriptions.Item>
          <Descriptions.Item label="Remote Write URL">
            <ConfigValue channel={domain.channel} value={domain.remote_write_url} />
          </Descriptions.Item>
          <Descriptions.Item label="指标采集器类型">
            {domain.channel === 'agent_pull' && domain.agent_type ? (
              <Tag color="blue">{agentTypeLabel[domain.agent_type]}</Tag>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="运行状态">
            {domain.channel === 'agent_pull' && domain.monitored_status ? (
              <Tag color={monitoredStatusColor[domain.monitored_status]}>
                {monitoredStatusLabel[domain.monitored_status]}
              </Tag>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="描述">
            {domain.description || <Text type="secondary">-</Text>}
          </Descriptions.Item>
        </Descriptions>
      )}
    </Drawer>
  )
}

export default NetworkDomainDetailDrawer