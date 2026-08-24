import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import config from 'antd/locale/zh_CN'
import type { ColumnsType } from 'antd/es/table'
import { EyeOutlined, QuestionCircleOutlined, ReloadOutlined, RollbackOutlined } from '@ant-design/icons'
import { deploymentApi } from '../../../api/configCenter'
import type { Channel, ConfigDeployment, DeploymentStatus } from '../../../types/config-center'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { EllipsisText } from '../../../components/EllipsisText'
import { MainLayout } from '../../../layouts/MainLayout'
import { useDeployments, fetchAllDomains } from './useDeployments'
import {
  CURRENT_USER,
  channelColor,
  channelLabel,
  channelTip,
  deploymentStatusColor,
  deploymentStatusLabel,
} from '../configCenterConstants'

const { Text } = Typography

/**
 * 下发记录页（Module_09 契约 §5 / PRD §3.5 / §9.1 回滚中心）。
 * 部署 ID / 网域 / 下发通道 / 配置版本 / 来源变更单号 / 状态(failed 带错误 Tooltip) / 开始时间 / 操作。
 * 操作：详情 + 回滚（非 pending/rolled_back 可点）+ 重试（仅 local 且 failed；决策 40-2 agent_pull 不展示）。
 * 深链定位：?change_no 收窄到该变更单发布记录、?network_domain 再收窄到该网域（对接 config-preview「查看发布记录」）。
 * 状态矩阵：加载 / 空态 / 接口错误 / 权限不足。
 */
export function DeploymentsPage() {
  const { data, loading, error, permissionDenied, onPageSizeChange, reload, locChangeNo, locDomain } =
    useDeployments()
  const [domains, setDomains] = useState<{ id: string; name: string }[]>([])
  const [domainError, setDomainError] = useState(false)
  const [detail, setDetail] = useState<ConfigDeployment | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    fetchAllDomains()
      .then((list) => setDomains(list.map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => setDomainError(true))
  }, [])

  const domainMap = useMemo(() => new Map(domains.map((d) => [d.id, d.name])), [domains])

  const openDetail = (record: ConfigDeployment) => {
    setDetail(record)
    setDetailOpen(true)
  }

  /** {决策 42-3} 重试：仅服务 local 通道（agent_pull 发布失败归平台侧自动重试，本页不展示重试按钮） */
  const handleRetry = (record: ConfigDeployment) => {
    Modal.confirm({
      title: '重试下发',
      content: (
        <>
          确定对配置版本 <Text code>{record.config_version_id}</Text>（来源变更单 {record.source_change_no}）重新下发吗？
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              local 通道重试：重新写中心配置目录并 reload，立即生效
            </Text>
          </div>
        </>
      ),
      okText: '重试',
      onOk: async () => {
        setActionLoading(true)
        try {
          const res = await deploymentApi.retry(record.id, CURRENT_USER)
          message.success(`重试成功：${res.data.config_version_id} 已重新下发并生效（操作人：${CURRENT_USER}）`)
          reload()
        } catch (e) {
          message.error(e instanceof Error ? e.message : '重试失败，请稍后重试')
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  /** 回滚：local 同步 reload 生效；agent_pull 异步（待 Edge Sync Agent 心跳拉取，约 30s） */
  const handleRollback = (record: ConfigDeployment) => {
    const isAgentPull = record.channel === 'agent_pull'
    Modal.confirm({
      title: '回滚配置',
      content: (
        <>
          确定将网域 <Text strong>{domainMap.get(record.network_domain_id) ?? record.network_domain_id}</Text>{' '}
          回滚到上一可用配置版本吗？
          {isAgentPull ? (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                agent_pull 通道回滚（异步生效）：确认后重新发布历史版本配置包，待 Edge Sync Agent 下次心跳拉取后生效（约 30s），进度可在「采集节点状态」页查看。
              </Text>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                local 通道回滚（同步生效）：确认后重新下发上一版本，中心写盘并 reload，立即生效。
              </Text>
            </div>
          )}
        </>
      ),
      okText: '确认回滚',
      okType: 'primary',
      onOk: async () => {
        setActionLoading(true)
        try {
          const res = await deploymentApi.rollback(record.config_version_id, CURRENT_USER)
          message.success(
            isAgentPull
              ? `已回滚：历史版本 ${res.data.config_version_id} 待 Edge Sync Agent 拉取生效（约 30s）`
              : '已回滚到上一版本，配置已 reload 生效',
          )
          reload()
        } catch (e) {
          message.error(e instanceof Error ? e.message : '回滚失败，请稍后重试')
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const columns: ColumnsType<ConfigDeployment> = [
    {
      title: '部署 ID',
      dataIndex: 'id',
      key: 'id',
      fixed: 'left',
      width: 180,
      render: (id: string) => (
        <EllipsisText code maxWidth={160}>
          {id}
        </EllipsisText>
      ),
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      render: (id: string) => <Text>{domainMap.get(id) ?? id}</Text>,
    },
    {
      title: '下发通道',
      dataIndex: 'channel',
      key: 'channel',
      width: 110,
      render: (channel: Channel) => (
        <Tooltip title={channelTip[channel]}>
          <Tag color={channelColor[channel]}>{channelLabel[channel]}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '配置版本',
      dataIndex: 'config_version_id',
      key: 'config_version_id',
      render: (id: string) => <Tag>{id}</Tag>,
    },
    {
      title: '来源变更单号',
      dataIndex: 'source_change_no',
      key: 'source_change_no',
      render: (no: string) => <Text code>{no}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: DeploymentStatus, record: ConfigDeployment) => {
        const tag = <Tag color={deploymentStatusColor[status]}>{deploymentStatusLabel[status]}</Tag>
        return status === 'failed' && record.error_message ? (
          <Tooltip title={record.error_message}>{tag}</Tooltip>
        ) : (
          tag
        )
      },
    },
    { title: '开始时间', dataIndex: 'triggered_at', key: 'triggered_at', width: 170 },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 200,
      render: (_: unknown, record: ConfigDeployment) => (
        <Space>
          <Tooltip title="查看详情">
            <Button size="small" aria-label="查看详情" icon={<EyeOutlined />} onClick={() => openDetail(record)} />
          </Tooltip>
          {/* 决策 40-2：重试仅 local 且 failed；agent_pull 发布失败归平台侧自动重试 */}
          {record.status === 'failed' && record.channel === 'local' && (
            <Button size="small" type="primary" ghost icon={<ReloadOutlined />} onClick={() => handleRetry(record)}>
              重试
            </Button>
          )}
          <Button
            size="small"
            icon={<RollbackOutlined />}
            disabled={record.status === 'rolled_back' || record.status === 'pending'}
            onClick={() => handleRollback(record)}
          >
            回滚
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        {locChangeNo && (
        <Alert
          type="info"
          showIcon
          message={`当前定位：变更单 ${locChangeNo}${locDomain ? ` · 网域 ${domainMap.get(locDomain) ?? locDomain}` : ''} 的发布记录`}
          description="从「配置变更确认」页跳转而来。列表已按该变更单过滤；如需查看全部记录，请清除定位条件。"
          closable
          style={{ marginBottom: 16 }}
        />
      )}
      {permissionDenied && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="权限不足"
          description="当前账号无查看下发记录的权限，请联系管理员开通。"
        />
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="下发记录加载失败"
          description={error}
          action={<Button size="small" onClick={reload}>重试</Button>}
        />
      )}
      {domainError && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="网域信息加载失败" description="部分网域名可能无法显示。" />
      )}
      <Card
        title={
          <Space size={4}>
            配置发布与回滚记录
            <Tooltip title="每次发布、回滚及重试都会自动留痕，用于排查「最后一次生效时间/结果」；出问题时可按历史版本一键回滚。">
              <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
            </Tooltip>
          </Space>
        }
      >
        <Table<ConfigDeployment>
          rowKey="id"
          size="small"
          scroll={TABLE_SCROLL_X}
          loading={loading}
          dataSource={data.items}
          pagination={{
            ...TABLE_PAGINATION,
            current: data.items.length ? undefined : 1,
            total: data.total,
            onChange: onPageSizeChange,
          }}
          locale={{
            emptyText: loading ? '加载中…' : <Empty description="暂无下发记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
          }}
          columns={columns}
        />
      </Card>

      <Drawer
        title={detail ? `下发记录详情：${detail.id}` : '下发记录详情'}
        width={560}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        extra={
          detail && (
            <Space>
              {detail.status === 'failed' && detail.channel === 'local' && (
                <Button type="primary" ghost icon={<ReloadOutlined />} loading={actionLoading} onClick={() => handleRetry(detail)}>
                  重试
                </Button>
              )}
              <Button
                icon={<RollbackOutlined />}
                loading={actionLoading}
                disabled={detail.status === 'rolled_back' || detail.status === 'pending'}
                onClick={() => handleRollback(detail)}
              >
                回滚
              </Button>
            </Space>
          )
        }
      >
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="部署 ID">
              <Text code>{detail.id}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="网域">
              {domainMap.get(detail.network_domain_id) ?? detail.network_domain_id}（{detail.network_domain_id}）
            </Descriptions.Item>
            <Descriptions.Item label="下发通道">
              <Tag color={channelColor[detail.channel]}>{channelLabel[detail.channel]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="配置版本">
              <Text code>{detail.config_version_id}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="来源变更单号">
              <Text code>{detail.source_change_no}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="含 blackbox.yml">
              {detail.includes_blackbox ? <Tag color="cyan">是</Tag> : '否'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={deploymentStatusColor[detail.status]}>{deploymentStatusLabel[detail.status]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="错误信息">{detail.error_message || '-'}</Descriptions.Item>
            <Descriptions.Item label="操作人">{detail.triggered_by}</Descriptions.Item>
            <Descriptions.Item label="开始时间">{detail.triggered_at}</Descriptions.Item>
            <Descriptions.Item label="结束时间">{detail.completed_at || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}

export default DeploymentsPage