import { Descriptions, Drawer, Space, Tag, Tooltip, Typography } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'
import type { NetworkDomain } from '../../../types/config-center'
import {
  agentTypeLabel,
  channelColor,
  channelLabel,
  channelTip,
  deriveRegistrationStatus,
  domainTypeColor,
  domainTypeLabel,
  formatRelativeTime,
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
        <>
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
          <Descriptions.Item label="描述">
            {domain.description || <Text type="secondary">-</Text>}
          </Descriptions.Item>
        </Descriptions>

        {/* M06 决策 82 配套：运行态信息收敛为「采集节点情况」描述区块（与列表「采集节点在线」列一致，
            网域粒度聚合视图；节点与组件级诊断归「采集节点状态」页 v0.2）。
            仅用 NetworkDomain 现有字段（monitored_status / last_heartbeat / agent_version）；
            节点数量 MVP 无后端聚合字段，以 '-' 占位并注明归属范围。 */}
        <Descriptions title="采集节点情况" column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item
            label={
              <Tooltip title="该网域采集节点（Edge Sync Agent）的心跳状态，网域粒度的聚合视图；节点与组件级诊断请见「采集节点状态」页">
                <Space size={4}>
                  采集节点在线
                  <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                </Space>
              </Tooltip>
            }
          >
            {domain.channel === 'agent_pull' && domain.monitored_status ? (
              <Tag color={monitoredStatusColor[domain.monitored_status]}>
                {monitoredStatusLabel[domain.monitored_status]}
              </Tag>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="采集节点版本">
            {domain.channel === 'agent_pull' && domain.agent_version ? (
              <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>{domain.agent_version}</Text>
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="最近心跳">
            {domain.channel === 'agent_pull' && domain.last_heartbeat ? (
              formatRelativeTime(domain.last_heartbeat)
            ) : (
              <Text type="secondary">-</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="采集节点数量">
            <Space size={4}>
              <Text type="secondary">-</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>节点列表与计数为 v0.2 采集节点状态页范围</Text>
            </Space>
          </Descriptions.Item>
        </Descriptions>
        </>
      )}
    </Drawer>
  )
}

export default NetworkDomainDetailDrawer
