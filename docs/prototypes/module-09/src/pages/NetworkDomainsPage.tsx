import { useRef, useState } from 'react'
import { Card, Table, Tag, Button, Space, Modal, Form, Input, Select, message, Tooltip, Typography, Steps, Alert, Dropdown, Drawer, Descriptions } from 'antd'
import { EditOutlined, ReloadOutlined, CopyOutlined, DownOutlined, EyeOutlined, CloudUploadOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  networkDomains,
  edgeAgents,
  edgeAgentInstallGuide,
  TOKEN_MASK,
  deriveRemoteWriteUrl,
  deriveConfigDownloadUrl,
  gatewayConstraintNote,
  channelLabel,
  channelTip,
  type Channel,
  type NetworkDomain,
  type NetworkDomainStatus,
  type NetworkDomainRegistrationStatus,
  type AgentType,
  type DomainType,
} from '../mocks/module-09'
import dayjs from 'dayjs'

const { Text } = Typography

const statusColor: Record<NetworkDomainStatus, string> = {
  online: 'success',
  offline: 'error',
  unknown: 'default',
}

const statusLabel: Record<NetworkDomainStatus, string> = {
  online: '在线',
  offline: '离线',
  unknown: '未知',
}

/** {v1.33} 下发通道 Tag 颜色（决策 31/32/33）：local=中性 / agent_pull=蓝 */
const channelColor: Record<Channel, string> = {
  local: 'default',
  agent_pull: 'blue',
}

const domainTypeColor: Record<DomainType, string> = {
  management: 'blue',
  edge: 'cyan',
}

const domainTypeLabel: Record<DomainType, string> = {
  management: '管理域',
  edge: '边缘域',
}

const registrationStatusColor: Record<NetworkDomainRegistrationStatus, string> = {
  created: 'default',
  monitored: 'processing',
}

const registrationStatusLabel: Record<NetworkDomainRegistrationStatus, string> = {
  created: '已创建未纳管',
  monitored: '已纳管',
}

const agentTypeLabel: Record<AgentType, string> = {
  vmagent: 'VMAgent',
  'prometheus-agent': 'Prometheus Agent',
}

/** zone_type 标签颜色映射 */
const zoneTypeColor: Record<string, string> = {
  internet: 'volcano',
  extranet: 'purple',
  'private-network': 'cyan',
  'region-beijing': 'geekblue',
  'region-shanghai': 'geekblue',
  'region-shenzhen': 'geekblue',
}

/** 计算相对时间（如「5 分钟前」「2 小时前」） */
function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return ''
  const now = dayjs()
  const date = dayjs(dateStr, 'YYYY-MM-DD HH:mm:ss')
  if (!date.isValid()) return dateStr
  const diffMinutes = now.diff(date, 'minute')
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = now.diff(date, 'hour')
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = now.diff(date, 'day')
  return `${diffDays} 天前`
}

export function NetworkDomainsPage() {
  const [data, setData] = useState<NetworkDomain[]>(networkDomains)
  // 编辑弹窗：仅维护监控参数（网域名称/租户等行政字段由 Module_06 维护，只读展示）
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  // {v1.29} 纳管弹窗：从 Module_06 行政已创建（created）的网域中选择并填写监控参数
  const [isOnboardOpen, setIsOnboardOpen] = useState(false)
  const [onboardTarget, setOnboardTarget] = useState<NetworkDomain | null>(null)
  // 决策 36-1：右侧详情抽屉
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [drawerDomain, setDrawerDomain] = useState<NetworkDomain | null>(null)
  // 决策 17：安装指引为页面顶部常驻提示区；纳管成功后滚动并高亮该提示区（guideHighlight 控制高亮态）
  const guideRef = useRef<HTMLDivElement>(null)
  const [guideHighlight, setGuideHighlight] = useState(false)
  const [form] = Form.useForm<Partial<NetworkDomain>>()
  const [onboardForm] = Form.useForm<Partial<NetworkDomain>>()

  /** 存在 agent_pull 通道网域：决定 Token / Agent 类型 / 安装指引等字段是否展示（决策 31/32/33） */
  const hasAgentPull = data.some((d) => d.channel === 'agent_pull')

  /** 打开详情抽屉 */
  const openDetail = (record: NetworkDomain) => {
    setDrawerDomain(record)
    setIsDrawerOpen(true)
  }

  const handleEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    form.setFieldsValue({ ...record })
    setIsEditOpen(true)
  }

  /** {v1.29}/{v1.35} 纳管网域：仅通过行内「纳管」按钮触发，预选当前行网域；移除右上角入口（决策 34/35） */
  const openOnboard = (record: NetworkDomain) => {
    setOnboardTarget(record)
    onboardForm.resetFields()
    onboardForm.setFieldsValue({ id: record.id, agent_type: 'vmagent', remote_write_url: '', center_endpoint: '' })
    setIsOnboardOpen(true)
  }

  const submitOnboard = (values: Partial<NetworkDomain>) => {
    const target = onboardTarget
    if (!target) {
      message.error('请选择要纳管的网域')
      return
    }
    setData((prev) =>
      prev.map((item) =>
        item.id === target.id
          ? {
              ...item,
              // {v1.34} 非 default 网域纳管固定 channel=agent_pull（决策 33，MVP 不提供通道选择/切换）
              channel: 'agent_pull',
              agent_type: values.agent_type ?? 'vmagent',
              // 决策 14：Remote Write URL 默认由平台自动推导（中心 ingress + 网域路径），留空自动生成，可手动覆盖
              remote_write_url: values.remote_write_url || deriveRemoteWriteUrl(item.id),
              // {v1.31} 中心接入地址（网闸映射后的中心可达地址）：边缘域纳管必填，用于合成配置包绝对下载地址
              center_endpoint: values.center_endpoint || '',
              // 纳管即自动签发 Token（PRD 3.1.1 凭据前置签发）
              token: `tk_${Math.random().toString(36).slice(2, 14)}`,
              registration_status: 'monitored',
              updated_at: new Date().toLocaleString('zh-CN', { hour12: false }),
            }
          : item
      )
    )
    message.success(`网域 "${target.name}" 已纳管，请按页面顶部安装指引接入 Edge Agent`)
    setIsOnboardOpen(false)
    // 决策 17：纳管成功后滚动并高亮页面顶部「安装指引」提示区（不弹窗），引导完成 Agent 接入
    window.setTimeout(() => {
      setGuideHighlight(true)
      guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)
    window.setTimeout(() => setGuideHighlight(false), 4000)
  }

  const handleSave = (values: Partial<NetworkDomain>) => {
    if (!editingDomain) return
    // {v1.33} 按下发通道区分可编辑字段：local 通道（default）不维护 Agent 相关监控参数（PRD 4.1 为空且不展示）
    const isLocal = editingDomain.channel === 'local'
    setData((prev) =>
      prev.map((item) =>
        item.id === editingDomain.id
          ? {
              ...item,
              ...values,
              // 行政字段（名称/租户/类型/网络区域类型）由 Module_06 维护，此处不落库变更
              name: item.name,
              tenant_id: item.tenant_id,
              domain_type: isLocal ? 'management' : item.domain_type,
              // {v1.31} zone_type 为 M06 行政字段：本页纳管只读引用，不在此维护
              zone_type: item.zone_type,
              // {v1.33} local 通道：不生成 Token / Agent 类型 / Remote Write / 中心接入地址
              token: isLocal ? '' : (values.registration_status === 'monitored' ? (item.token || `tk_${Math.random().toString(36).slice(2, 14)}`) : ''),
              remote_write_url: isLocal ? '' : (values.registration_status === 'monitored' ? (item.remote_write_url || deriveRemoteWriteUrl(item.id)) : ''),
              center_endpoint: isLocal ? '' : (values.registration_status === 'monitored' ? (values.center_endpoint ?? item.center_endpoint) : ''),
              agent_type: isLocal ? '' : (values.agent_type ?? item.agent_type),
              updated_at: new Date().toLocaleString('zh-CN', { hour12: false }),
            }
          : item
      )
    )
    message.success('网域监控参数已更新')
    setIsEditOpen(false)
  }

  const handleResetToken = (record: NetworkDomain) => {
    Modal.confirm({
      title: '重置 Token',
      content: `确定要重置网域 "${record.name}" 的接入 Token 吗？旧 Token 将立即失效。`,
      okText: '确认重置',
      okType: 'primary',
      cancelText: '取消',
      onOk: () => {
        setData((prev) =>
          prev.map((item) =>
            item.id === record.id
              ? { ...item, token: `tk_${Math.random().toString(36).slice(2, 14)}`, updated_at: new Date().toLocaleString('zh-CN', { hour12: false }) }
              : item
          )
        )
        message.success('Token 已重置')
      },
    })
  }

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token).then(() => message.success('Token 已复制'))
  }

  // {v1.29} 对已由 Module_06 行政创建的网域执行监控纳管：打开纳管弹窗填写监控参数（Token 自动签发 / Remote Write 自动推导）
  const handleMonitor = (record: NetworkDomain) => {
    openOnboard(record)
  }

  return (
    <MainLayout>
      <Card
        title="网域纳管"
      >
        {/* 决策 17：安装指引为页面顶部常驻提示区（通用操作流程），纳管成功后滚动并高亮此区域；行内不再提供安装指引入口。
            {v1.33} 仅在存在 channel=agent_pull 网域时展示（决策 31/32/33）：local 通道由中心直接采集、无 Edge Agent 安装环节 */}
        {hasAgentPull && (
          <div
            ref={guideRef}
            style={{
              marginBottom: 16,
              borderRadius: 8,
              outline: guideHighlight ? '2px solid #0ECDEB' : 'none',
              outlineOffset: 4,
              transition: 'outline 0.3s',
            }}
          >
            <Alert
              type="info"
              showIcon
              message="新网域接入操作流程（安装指引）"
              description={
                <div>
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                    适用于所有已纳管的 <Text code>agent_pull</Text> 通道网域（远端/隔离采集节点）；local 通道网域（如 default）由中心直接采集，
                    无需安装 Edge Sync Agent。采集器与 blackbox exporter 由 Edge Sync Agent 启动后自动部署（并入第③步描述），无需手动分步安装。
                  </Typography.Paragraph>
                  <Steps
                    size="small"
                    direction="vertical"
                    current={-1}
                    items={edgeAgentInstallGuide.steps.map((s) => ({ title: s.title, description: s.description }))}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>
                      边缘节点组件构成：
                    </Text>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {edgeAgentInstallGuide.components.map((c) => (
                        <li key={c.name} style={{ marginBottom: 2 }}>
                          <Text strong>{c.name}</Text>（{c.required ? '必装' : '可选'}）：{c.role}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>
                      凭据获取与交付：
                    </Text>
                    <Text type="secondary">
                      <Text code>NETWORK_DOMAIN_ID</Text> 为对应网域 ID（网域列表首列）；<Text code>TOKEN</Text> 通过网域行内「复制」按钮获取（UI 完全脱敏展示）。
                      交付方式：{edgeAgentInstallGuide.delivery}；校验和算法：{edgeAgentInstallGuide.checksum_algorithm}；
                      systemd 单元：{edgeAgentInstallGuide.systemd_unit}。
                    </Text>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <Text strong style={{ display: 'block', marginBottom: 4 }}>
                      网闸 / 隔离区连接约束（{`{v1.31}`}）：
                    </Text>
                    <Text type="secondary">{gatewayConstraintNote}。配置包下载地址示例：{' '}
                      {networkDomains
                        .filter((d) => d.channel === 'agent_pull' && d.center_endpoint)
                        .map((d) => `${d.id} → ${deriveConfigDownloadUrl(d)}`)
                        .join('；') || '（暂无已纳管 agent_pull 网域）'}
                    </Text>
                  </div>
                </div>
              }
            />
          </div>
        )}
        <Table
          dataSource={data}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => openDetail(record),
          })}
          columns={[
            {
              // 决策 36-1：网域名称 + ID 合并为单列，两行显示
              title: '网域',
              key: 'domain',
              width: 180,
              render: (_: unknown, record: NetworkDomain) => (
                <div>
                  <div style={{ lineHeight: '22px' }}>{record.name}</div>
                  <Text type="secondary" style={{ fontSize: 12, lineHeight: '18px' }}>{record.id}</Text>
                </div>
              ),
            },
            {
              // {v1.36 原型修正} zone_type 提升为列表主列（第 2 列）：政务云场景按网络区域识别，公有云场景按 region 识别
              title: '网络区域类型',
              key: 'zone_type',
              width: 130,
              render: (_: unknown, record: NetworkDomain) =>
                record.zone_type ? (
                  <Tag color={zoneTypeColor[record.zone_type] ?? 'default'}>{record.zone_type}</Tag>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            {
              // {v1.29} 网域生命周期：created = 已由 Module_06 行政创建；monitored = 已完成监控纳管
              title: '纳管状态',
              dataIndex: 'registration_status',
              key: 'registration_status',
              width: 120,
              render: (status: NetworkDomainRegistrationStatus) => (
                <Tag color={registrationStatusColor[status]}>{registrationStatusLabel[status]}</Tag>
              ),
            },
            {
              // {v1.33} 下发通道（决策 31/32/33）：local（中心同机写盘 reload）/ agent_pull（Edge Sync Agent 心跳拉包）
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
              // 决策 36-1：运行状态 = 状态 + 心跳合并，仅 agent_pull 展示，local 显示 '-'
              title: '运行状态',
              key: 'running_status',
              width: 180,
              render: (_: unknown, record: NetworkDomain) => {
                if (record.channel === 'agent_pull' && record.status) {
                  return (
                    <Space size={4}>
                      <Tag color={statusColor[record.status]} style={{ marginRight: 0 }}>{statusLabel[record.status]}</Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {'· '}{formatRelativeTime(record.last_heartbeat)}
                      </Text>
                    </Space>
                  )
                }
                return <Text type="secondary">-</Text>
              },
            },
            {
              // 决策 36-1：凭据列，仅 agent_pull 显示脱敏 Token + 复制按钮，local 显示 '-'
              title: '凭据',
              key: 'credential',
              width: 110,
              render: (_: unknown, record: NetworkDomain) =>
                record.channel === 'agent_pull' && record.token ? (
                  <Space size={2}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{TOKEN_MASK}</Text>
                    <Tooltip title="复制 Token">
                      <Button type="text" size="small" icon={<CopyOutlined />} onClick={(e) => { e.stopPropagation(); handleCopyToken(record.token) }} />
                    </Tooltip>
                  </Space>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            {
              // {v1.36 操作列修正} 三槽位固定结构：主操作·详情·更多
              // 主操作：未纳管→纳管（文本链接），已纳管→编辑（文本链接）；详情常驻；更多仅 agent_pull 已纳管行显示重置 Token
              title: '操作',
              key: 'action',
              width: 240,
              render: (_: unknown, record: NetworkDomain) => {
                // 判断「更多」是否有可选项：仅 agent_pull 已纳管行有重置 Token
                const hasMoreItems = record.channel === 'agent_pull' && record.registration_status === 'monitored'
                return (
                  <Space size="small" onClick={(e) => e.stopPropagation()}>
                    {record.registration_status === 'created' ? (
                      <Button type="link" size="small" icon={<CloudUploadOutlined />} onClick={() => handleMonitor(record)}>
                        纳管
                      </Button>
                    ) : (
                      <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
                        编辑
                      </Button>
                    )}
                    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
                      详情
                    </Button>
                    {hasMoreItems && (
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: 'reset-token',
                              icon: <ReloadOutlined />,
                              label: '重置 Token',
                              onClick: () => handleResetToken(record),
                            },
                          ],
                        }}
                      >
                        <Button size="small">
                          更多 <DownOutlined />
                        </Button>
                      </Dropdown>
                    )}
                  </Space>
                )
              },
            },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            字段语义：网域列（名称 + ID，行政字段由 Module_06「网域管理」创建与维护，本页不可修改）；
            网络区域类型（zone_type，行政字段由 M06 登记，本页只读展示）；
            下发通道（local / agent_pull）按网域固定（default=local、其他=agent_pull，MVP 不可编辑）；
            local 通道网域（default）由中心直接采集，仅展示网域与下发通道，不生成凭据、运行状态显示「-」；
            agent_pull 通道网域的凭据（Token）由纳管时自动签发，运行状态由 Edge Sync Agent 心跳上报更新；
            纳管与编辑表单仅维护监控配置字段；操作列三槽位：主操作（纳管/编辑 随行状态变化）+ 详情（常驻）+ 更多（重置 Token，仅 agent_pull 已纳管行）；
            点击「详情」或行可查看中心接入地址、Remote Write URL、Agent 类型及各组件运行状态概览。
            新网域接入流程见页面顶部「安装指引」提示区（纳管成功将自动滚动高亮该区域）。
          </Text>
        </div>
      </Card>

      {/* 决策 36-1：右侧详情抽屉 */}
      <Drawer
        title={drawerDomain ? `网域详情 - ${drawerDomain.name}` : '网域详情'}
        placement="right"
        width={480}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        {drawerDomain && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 24 }}>
              <Descriptions.Item label="网域名称">{drawerDomain.name}</Descriptions.Item>
              <Descriptions.Item label="网域 ID"><Text code>{drawerDomain.id}</Text></Descriptions.Item>
              <Descriptions.Item label="域类型">
                <Tag color={domainTypeColor[drawerDomain.domain_type]}>{domainTypeLabel[drawerDomain.domain_type]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="纳管状态">
                <Tag color={registrationStatusColor[drawerDomain.registration_status]}>{registrationStatusLabel[drawerDomain.registration_status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="下发通道">
                <Tooltip title={channelTip[drawerDomain.channel]}>
                  <Tag color={channelColor[drawerDomain.channel]}>{channelLabel[drawerDomain.channel]}</Tag>
                </Tooltip>
              </Descriptions.Item>
              <Descriptions.Item label="中心接入地址">
                {drawerDomain.channel === 'agent_pull' && drawerDomain.center_endpoint ? (
                  <Text code>{drawerDomain.center_endpoint}</Text>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Remote Write URL">
                {drawerDomain.channel === 'agent_pull' && drawerDomain.remote_write_url ? (
                  <Text code style={{ fontSize: 12, wordBreak: 'break-all' }}>{drawerDomain.remote_write_url}</Text>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Agent 类型">
                {drawerDomain.channel === 'agent_pull' && drawerDomain.agent_type ? (
                  <Tag color="blue">{agentTypeLabel[drawerDomain.agent_type as AgentType]}</Tag>
                ) : (
                  <Text type="secondary">-</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="描述">
                {drawerDomain.description || <Text type="secondary">-</Text>}
              </Descriptions.Item>
            </Descriptions>

            {/* 组件运行状态概览 */}
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>组件运行状态概览</Text>
              {(() => {
                const agents = edgeAgents.filter((a) => a.network_domain_id === drawerDomain.id)
                if (agents.length === 0) {
                  return (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {drawerDomain.channel === 'local' ? 'local 通道网域由中心直接采集，无边缘组件部署。' : '暂无已注册的 Edge Agent 实例。'}
                    </Text>
                  )
                }
                return (
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    {agents.map((agent) => (
                      <Card key={agent.id} size="small" type="inner" title={`${agent.hostname}（${agent.agent_ip}）`}>
                        <Descriptions column={1} size="small">
                          <Descriptions.Item label="Edge Sync Agent">
                            <Tag color={statusColor[agent.status]}>{statusLabel[agent.status]}</Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="采集器">
                            <Tag color={agent.collector_status === 'running' ? 'success' : agent.collector_status === 'stopped' ? 'error' : 'default'}>
                              {agent.collector_status === 'running' ? '运行中' : agent.collector_status === 'stopped' ? '已停止' : '未知'}
                            </Tag>
                          </Descriptions.Item>
                          <Descriptions.Item label="配置同步">
                            <Tag color={agent.config_sync_status === 'in_sync' ? 'success' : agent.config_sync_status === 'out_of_sync' ? 'error' : 'default'}>
                              {agent.config_sync_status === 'in_sync' ? '已同步' : agent.config_sync_status === 'out_of_sync' ? '未同步' : agent.config_sync_status === 'manual_override' ? '手动覆盖' : '未知'}
                            </Tag>
                          </Descriptions.Item>
                          {agent.components.filter((c) => c.type === 'blackbox_exporter').length > 0 && (
                            <Descriptions.Item label="blackbox exporter">
                              <Tag color={agent.components.find((c) => c.type === 'blackbox_exporter')?.status === 'running' ? 'success' : 'error'}>
                                {agent.components.find((c) => c.type === 'blackbox_exporter')?.status === 'running' ? '运行中' : '异常'}
                              </Tag>
                            </Descriptions.Item>
                          )}
                          {agent.last_error && (
                            <Descriptions.Item label="最近错误">
                              <Text type="danger" style={{ fontSize: 12 }}>{agent.last_error}</Text>
                            </Descriptions.Item>
                          )}
                        </Descriptions>
                      </Card>
                    ))}
                  </Space>
                )
              })()}
            </div>
          </>
        )}
      </Drawer>

      {/* {v1.29}/{v1.35} 纳管弹窗：仅通过行内「纳管」按钮触发，自动预选当前行网域，移除全局选择器（决策 34/35） */}
      <Modal
        title="纳管网域（监控接入）"
        open={isOnboardOpen}
        onCancel={() => setIsOnboardOpen(false)}
        onOk={() => onboardForm.submit()}
        okText="确认纳管"
        cancelText="取消"
      >
        <Form form={onboardForm} layout="vertical" onFinish={submitOnboard}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Module_06 行政创建 → Module_09 监控纳管"
            description="网域的行政创建与租户分配由「系统设置」模块（Module_06 网域管理）负责；此处将已创建的网域接入监控——确认纳管后自动签发 Token、自动推导 Remote Write URL。default 管理域固定 local 通道、由系统预置且默认已纳管；其余网域纳管固定 agent_pull 通道（决策 33，MVP 不提供通道选择/切换）。"
          />
          <Form.Item label="目标网域">
            <Input value={onboardTarget ? `${onboardTarget.name}（${onboardTarget.id}，租户：${onboardTarget.tenant_id}）` : ''} disabled />
          </Form.Item>
          {/* {v1.34} 下发通道只读展示（决策 33）：非 default 网域固定 agent_pull，MVP 不可编辑 */}
          <Form.Item label="下发通道（只读）">
            <Tooltip title={channelTip['agent_pull']}>
              <Tag color={channelColor['agent_pull']}>{channelLabel['agent_pull']}</Tag>
            </Tooltip>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: '18px', marginTop: 4 }}>
              非 default 网域固定 agent_pull 通道（Edge Sync Agent 心跳拉取配置包）；通道切换属 v0.4+ 演化场景，MVP 不提供。
            </div>
          </Form.Item>
          {/* 决策 12/16：Agent 类型下拉保留，但 MVP 阶段固定 vmagent（PRD：纳管时无需选择）；prometheus-agent 枚举保留、v0.2+ 开放 */}
          <Form.Item name="agent_type" label="Agent 类型" initialValue="vmagent" extra="MVP 阶段固定 vmagent（纳管时无需选择）；prometheus-agent v0.2+ 开放为可选">
            <Select options={[{ value: 'vmagent', label: 'VMAgent' }]} disabled />
          </Form.Item>
          {/* 决策 14：Remote Write URL 默认由平台自动推导（中心 ingress + 网域路径），留空自动生成，可手动覆盖 */}
          <Form.Item name="remote_write_url" label="Remote Write URL" extra="留空由平台自动推导（中心 ingress + 网域路径），可手动覆盖；语义为该网域视角的可达地址（网闸映射后地址）">
            <Input placeholder="留空则自动生成，例如 https://metriccenter.example.com/api/v2/ingest/<domain-id>/prometheus" />
          </Form.Item>
          {/* {v1.31} 中心接入地址：该网域视角的中心可达地址（网闸映射后地址），边缘域纳管必填；用于合成配置包绝对下载地址（PRD 6.1） */}
          <Form.Item
            name="center_endpoint"
            label="中心接入地址"
            rules={[{ required: true, message: '边缘域纳管必填：该网域视角的中心可达地址（网闸映射后地址）' }]}
            extra="如 https://10.8.0.5:8443（网闸/防火墙地址映射后的中心地址）；配置拉取地址 = 中心接入地址 + 固定相对路径合成绝对地址下发给 Agent（PRD 6.1）"
          >
            <Input placeholder="https://<center-address>:<port>" />
          </Form.Item>
          <Form.Item>
            <Text type="secondary">
              纳管成功后自动签发 Token 与 Remote Write URL；Agent IP / 主机名 / 状态 / 最后心跳由 Edge Sync Agent
              心跳上报自动补全，接入步骤见页面顶部「安装指引」。
            </Text>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑弹窗：行政字段只读展示，仅维护监控参数（PRD 3.1 网域编辑） */}
      <Modal
        title="编辑网域（监控参数）"
        open={isEditOpen}
        onCancel={() => setIsEditOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="行政字段由 Module_06 维护，本表单仅维护监控配置"
            description="网域名称 / 所属租户 / 类型等行政字段的修改请前往「系统设置」模块（Module_06 网域管理）；此处仅维护描述与监控参数。"
          />
          <Form.Item label="网域名称（行政字段，只读）">
            <Input value={editingDomain?.name} disabled />
          </Form.Item>
          <Form.Item label="所属租户（行政字段，只读）">
            <Input value={editingDomain?.tenant_id} disabled />
          </Form.Item>
          <Form.Item label="网络区域类型（行政字段，只读）">
            <Input value={editingDomain?.zone_type || '-'} disabled />
          </Form.Item>
          {/* {v1.34} 下发通道只读展示（决策 33）：MVP 不提供通道选择/切换，通道切换属 v0.4+ 演化场景 */}
          <Form.Item label="下发通道（只读）">
            {editingDomain && (
              <Tooltip title={channelTip[editingDomain.channel]}>
                <Tag color={channelColor[editingDomain.channel]}>{channelLabel[editingDomain.channel]}</Tag>
              </Tooltip>
            )}
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', lineHeight: '18px', marginTop: 4 }}>
              MVP 按网域固定（default=local，其他=agent_pull），不可编辑；通道切换与混合通道为 v0.4+ 演化场景。
            </div>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征" />
          </Form.Item>
          {editingDomain?.channel === 'local' && (
            <Form.Item>
              <Text type="secondary">
                local 通道网域（default）由中心直接采集：不生成 Token / Agent 类型 / Remote Write URL / 中心接入地址，
                不提供安装指引，无 Edge Agent 心跳语义；下发通道固定 local 不可编辑。
              </Text>
            </Form.Item>
          )}
          {editingDomain && editingDomain.channel === 'agent_pull' && (
            <>
              {/* {v1.29} 编辑时可切换纳管状态，用于演示取消纳管 / 重新纳管 */}
              <Form.Item name="registration_status" label="纳管状态" extra="切换为「已创建未纳管」即取消纳管：清空 Token / Remote Write / 中心接入地址，网域退出监控上下文">
                <Select
                  options={[
                    { value: 'created', label: '已创建未纳管' },
                    { value: 'monitored', label: '已纳管' },
                  ]}
                />
              </Form.Item>
              {/* 决策 16：编辑表单补全 PRD 3.1 要求的可编辑配置字段（Agent 类型、Remote Write 目标），与列表配置字段对齐 */}
              <Form.Item name="agent_type" label="Agent 类型" extra="MVP 阶段固定 vmagent；prometheus-agent 枚举保留、v0.2+ 开放（当前域演示）">
                <Select
                  options={[
                    { value: 'vmagent', label: 'VMAgent' },
                    { value: 'prometheus-agent', label: 'Prometheus Agent（v0.2+ 开放）' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="remote_write_url" label="Remote Write URL">
                <Input placeholder="留空则自动推导（该网域视角的可达地址，网闸映射后地址）" />
              </Form.Item>
              {/* {v1.31} 中心接入地址为监控纳管字段，纳管后可修改（网闸策略调整时） */}
              <Form.Item
                name="center_endpoint"
                label="中心接入地址"
                extra="该网域视角的中心可达地址（网闸映射后地址），用于合成配置包绝对下载地址（PRD 6.1）"
              >
                <Input placeholder="https://<center-address>:<port>" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </MainLayout>
  )
}

export default NetworkDomainsPage