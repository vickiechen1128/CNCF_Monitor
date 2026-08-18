import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, Table, Tag, Button, Space, Modal, message, Tooltip, Typography, Alert, Drawer, Descriptions } from 'antd'
import { RollbackOutlined, EyeOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { EllipsisText } from '../components/EllipsisText'
import { TABLE_SCROLL_X, TABLE_PAGINATION } from '../components/tablePresets'
import {
  configDeployments,
  configVersions,
  networkDomains,
  channelLabel,
  channelTip,
  type Channel,
  type ConfigDeployment,
  type DeploymentStatus,
} from '../mocks/module-09'

const { Text } = Typography

/** 当前登录用户（决策 19/20：MVP 预置，与配置变更确认页确认人一致；用户管理接入后同步为真实用户） */
const CURRENT_USER = '张伟（运维）'

const statusColor: Record<DeploymentStatus, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  rolled_back: 'warning',
}

const statusLabel: Record<DeploymentStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败',
  rolled_back: '已回滚',
}

export function DeploymentsPage() {
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<ConfigDeployment[]>(configDeployments)
  const [detailRecord, setDetailRecord] = useState<ConfigDeployment | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 定位参数（PRD 3.4 全链路关联）：从配置变更确认页「记录 / 查看发布记录」跳转携带 change_no + network_domain，定位到该变更的发布/回滚记录
  const locChangeNo = searchParams.get('change_no')
  const locDomain = searchParams.get('network_domain')

  const versionMap = useMemo(() => {
    return Object.fromEntries(configVersions.map((v) => [v.id, v.id]))
  }, [])

  const domainMap = useMemo(() => {
    return Object.fromEntries(networkDomains.map((d) => [d.id, d.name]))
  }, [])

  /** 定位过滤：change_no 收窄到该变更单的发布记录；network_domain 再收窄到该网域 */
  const filteredData = useMemo(() => {
    let list = data
    if (locChangeNo) list = list.filter((d) => d.source_change_no === locChangeNo)
    if (locDomain) list = list.filter((d) => d.network_domain_id === locDomain)
    return list
  }, [data, locChangeNo, locDomain])

  const openDetail = (record: ConfigDeployment) => {
    setDetailRecord(record)
    setDrawerOpen(true)
  }

  /** {v1.37} 下发失败重试（决策 37-2）：复用原 ConfigDeployment 记录（failed → running → success/failed，retry_count 递增），
   *  与「回滚另生成一条 rolled_back 记录」区分——重试 = 同一动作（同一 ConfigVersion）的再次尝试
   *  {v1.39 决策 39-2}：local 通道 reload 失败重试留本页；agent_pull 通道拉包失败归采集节点状态页
   *  {v1.40 决策 40-2}：agent_pull 行不再展示「重试」按钮（发布失败=平台故障，重试归平台侧），本函数仅服务 local 通道 */
  const handleRetry = (record: ConfigDeployment) => {
    const isAgentPull = record.channel === 'agent_pull'
    if (isAgentPull) {
      // 防御分支：按钮已隐藏（决策 40-2），此处不再引导跳转
      message.info('agent_pull 发布失败属平台侧故障，已触发平台自动重试，无需人工操作')
      return
    }
    Modal.confirm({
      title: '重试下发',
      content: (
        <>
          确定对配置版本 <Text code>{record.config_version_id}</Text>（来源变更单 {record.source_change_no}）重新下发吗？
          重试复用本下发记录（重试次数 +1），成功后状态更新为「成功」；重试失败则保持「失败」并更新最近错误。
          <div style={{ marginTop: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              local 通道重试：重新写中心配置目录并 reload，立即生效
            </Text>
          </div>
        </>
      ),
      okText: '重试',
      onOk: () => {
        const now = new Date().toLocaleString('zh-CN', { hour12: false })
        setData((prev) =>
          prev.map((item) =>
            item.id === record.id
              ? {
                  ...item,
                  status: 'success',
                  retry_count: item.retry_count + 1,
                  error_message: '',
                  completed_at: now,
                }
              : item
          )
        )
        message.success(`重试成功：配置已重新写盘并 reload 生效（确认人：${CURRENT_USER}）`)
      },
    })
  }

  const handleRollback = (record: ConfigDeployment) => {
    const previousVersions = configVersions
      .filter((v) => v.network_domain_id === record.network_domain_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
    const previous = previousVersions.find((v) => v.id !== record.config_version_id)
    // {v1.20}/{v1.33} 回滚生效语义按下发通道区分：local 通道立即 reload（同步生效）；
    // agent_pull 通道重新发布历史版本，待 Edge Sync Agent 下次心跳拉取生效（异步生效，准实时 30s）
    const channel = record.channel || networkDomains.find((d) => d.id === record.network_domain_id)?.channel
    const isAgentPull = channel === 'agent_pull'

    Modal.confirm({
      title: '回滚配置',
      content: previous ? (
        <>
          确定将网域 <Text strong>{domainMap[record.network_domain_id]}</Text> 回滚到版本{' '}
          <Text code>{previous.id}</Text> 吗？
          {isAgentPull && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                agent_pull 通道回滚（异步生效）：确认后重新发布历史版本配置包，待 Edge Sync Agent 下次心跳拉取后生效（约 30s），进度可在「采集节点状态」页查看。
              </Text>
            </div>
          )}
          {!isAgentPull && (
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                local 通道回滚（同步生效）：确认后重新下发历史版本，中心写盘并 reload，立即生效。
              </Text>
            </div>
          )}
        </>
      ) : (
        '未找到可回滚的历史版本。'
      ),
      okText: '确认回滚',
      okType: 'primary',
      cancelText: '取消',
      onOk: () => {
        if (!previous) {
          message.warning('无可用回滚版本')
          return
        }
        const now = new Date().toLocaleString('zh-CN', { hour12: false })
        const rollbackDeployment: ConfigDeployment = {
          id: `deploy-${Date.now()}`,
          network_domain_id: record.network_domain_id,
          config_version_id: previous.id,
          source_change_no: previous.change_no,
          channel: channel ?? 'local',
          target_type: record.target_type,
          target_address: record.target_address,
          status: 'success',
          validation_status: 'passed',
          validation_error: '',
          includes_blackbox: record.includes_blackbox,
          error_message: '',
          retry_count: 0,
          triggered_by: CURRENT_USER,
          triggered_at: now,
          completed_at: now,
          created_at: now,
        }
        setData((prev) =>
          prev.map((item) =>
            item.id === record.id ? { ...item, status: 'rolled_back' } : item
          )
        )
        setData((prev) => [rollbackDeployment, ...prev])
        // {v1.20}/{v1.33} 回滚结果提示按下发通道区分
        message.success(
          isAgentPull
            ? `已回滚：已发布历史版本，待 Edge Sync Agent 下次心跳拉取生效（准实时 30s）（操作人：${CURRENT_USER}）`
            : `已回滚到上一版本，配置已 reload 生效（操作人：${CURRENT_USER}）`
        )
      },
    })
  }

  return (
    <MainLayout>
      {locChangeNo && (
        <Alert
          type="info"
          showIcon
          message={`当前定位：变更单 ${locChangeNo}${locDomain ? ` · 网域 ${domainMap[locDomain] ?? locDomain}` : ''} 的发布记录`}
          description="从「配置变更确认」页跳转而来。列表已按该变更单过滤；如需查看全部记录，请清除定位条件。"
          closable
          style={{ marginBottom: 16 }}
        />
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
        <Table
          dataSource={filteredData}
          rowKey="id"
          size="small"
          scroll={TABLE_SCROLL_X}
          pagination={TABLE_PAGINATION}
          columns={[
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
              render: (id: string) => <Text>{domainMap[id] ?? id}</Text>,
            },
            {
              // {v1.33} 下发通道（PRD 4.6）：local（中心直接 reload）/ agent_pull（Edge Sync Agent 拉包），与对应 NetworkDomain.channel 一致
              title: '下发通道',
              dataIndex: 'channel',
              key: 'channel',
              width: 110,
              render: (channel: Channel) => (
                <Tooltip title={channelTip[channel]}>
                  <Tag color={channel === 'local' ? 'default' : 'blue'}>{channelLabel[channel]}</Tag>
                </Tooltip>
              ),
            },
            {
              title: '配置版本',
              dataIndex: 'config_version_id',
              key: 'config_version_id',
              render: (id: string) => <Tag>{versionMap[id] ?? id}</Tag>,
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
              render: (status: DeploymentStatus, record: ConfigDeployment) => {
                const tag = <Tag color={statusColor[status]}>{statusLabel[status]}</Tag>
                // failed 状态悬浮展示 error_message，完整错误及全部字段见详情抽屉
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
              width: 180,
              render: (_: unknown, record: ConfigDeployment) => (
                <Space>
                  <Tooltip title="查看详情">
                    <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)} />
                  </Tooltip>
                  {/* {v1.37} 决策 37-2：failed 行内「重试」——复用原记录重新下发，与回滚（另生成记录）区分 */}
                  {/* {v1.40 决策 40-2}：agent_pull 行不展示「重试」按钮（发布失败=平台故障，重试归平台侧）；local 通道 retain 保留 */}
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
          ]}
        />
      </Card>

      {/* 下发记录详情 Drawer（断点修复：原「查看详情」为死按钮；含重试 / 回滚操作入口） */}
      <Drawer
        title={detailRecord ? `下发记录详情：${detailRecord.id}` : '下发记录详情'}
        width={560}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={
          detailRecord && (
            <Space>
              {/* {v1.40 决策 40-2}：抽屉内 agent_pull 同样不展示「重试」按钮（发布失败=平台故障，重试归平台侧） */}
              {detailRecord.status === 'failed' && detailRecord.channel === 'local' && (
                <Button type="primary" ghost icon={<ReloadOutlined />} onClick={() => handleRetry(detailRecord)}>
                  重试
                </Button>
              )}
              <Button
                icon={<RollbackOutlined />}
                disabled={detailRecord.status === 'rolled_back' || detailRecord.status === 'pending'}
                onClick={() => handleRollback(detailRecord)}
              >
                回滚
              </Button>
            </Space>
          )
        }
      >
        {detailRecord && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="部署 ID">
              <Text code>{detailRecord.id}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="网域">
              {domainMap[detailRecord.network_domain_id] ?? detailRecord.network_domain_id}（{detailRecord.network_domain_id}）
            </Descriptions.Item>
            <Descriptions.Item label="下发通道">
              <Tag color={detailRecord.channel === 'local' ? 'default' : 'blue'}>{channelLabel[detailRecord.channel]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="配置版本">
              <Text code>{detailRecord.config_version_id}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="来源变更单号">
              <Text code>{detailRecord.source_change_no}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="目标类型 / 地址">
              {detailRecord.target_type} · {detailRecord.target_address}
            </Descriptions.Item>
            <Descriptions.Item label="含 blackbox.yml">
              {detailRecord.includes_blackbox ? <Tag color="cyan">是</Tag> : '否'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={statusColor[detailRecord.status]}>{statusLabel[detailRecord.status]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="错误信息">{detailRecord.error_message || '-'}</Descriptions.Item>
            <Descriptions.Item label="重试次数">{detailRecord.retry_count}</Descriptions.Item>
            <Descriptions.Item label="操作人">{detailRecord.triggered_by}</Descriptions.Item>
            <Descriptions.Item label="开始时间">{detailRecord.triggered_at}</Descriptions.Item>
            <Descriptions.Item label="结束时间">{detailRecord.completed_at}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </MainLayout>
  )
}

export default DeploymentsPage
