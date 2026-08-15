import { useRef, useState } from 'react'
import { Card, Table, Tag, Button, Space, Modal, Form, Input, Select, message, Tooltip, Typography, Steps, Alert, Dropdown } from 'antd'
import { EditOutlined, ReloadOutlined, CopyOutlined, DeleteOutlined, DownOutlined, QuestionCircleOutlined, CloudUploadOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  networkDomains,
  edgeAgentInstallGuide,
  TOKEN_MASK,
  deriveRemoteWriteUrl,
  type NetworkDomain,
  type NetworkDomainStatus,
  type NetworkDomainRegistrationStatus,
  type AgentType,
  type DomainType,
} from '../mocks/module-09'

const { Text } = Typography

const statusColor: Record<NetworkDomainStatus, string> = {
  online: 'success',
  offline: 'error',
  unknown: 'default',
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

export function NetworkDomainsPage() {
  const [data, setData] = useState<NetworkDomain[]>(networkDomains)
  // 编辑弹窗：仅维护监控参数（网域名称/租户等行政字段由 Module_06 维护，只读展示）
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  // {v1.29} 纳管弹窗：从 Module_06 行政已创建（created）的网域中选择并填写监控参数
  const [isOnboardOpen, setIsOnboardOpen] = useState(false)
  const [onboardTarget, setOnboardTarget] = useState<NetworkDomain | null>(null)
  // 决策 17：安装指引为页面顶部常驻提示区；纳管成功后滚动并高亮该提示区（guideHighlight 控制高亮态）
  const guideRef = useRef<HTMLDivElement>(null)
  const [guideHighlight, setGuideHighlight] = useState(false)
  const [form] = Form.useForm<Partial<NetworkDomain>>()
  const [onboardForm] = Form.useForm<Partial<NetworkDomain>>()

  /** 可纳管网域：Module_06 已行政创建（created）且尚未纳管的网域 */
  const pendingOnboardDomains = data.filter((d) => d.registration_status === 'created')

  const handleEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    form.setFieldsValue({ ...record })
    setIsEditOpen(true)
  }

  /** {v1.29} 纳管网域：入参 record 用于行内「纳管」按钮预选网域；不传则弹窗内自选 */
  const openOnboard = (record?: NetworkDomain) => {
    setOnboardTarget(record ?? null)
    onboardForm.resetFields()
    onboardForm.setFieldsValue({ id: record?.id, agent_type: 'vmagent', remote_write_url: '' })
    setIsOnboardOpen(true)
  }

  const submitOnboard = (values: Partial<NetworkDomain>) => {
    const target = onboardTarget ?? data.find((d) => d.id === values.id)
    if (!target) {
      message.error('请选择要纳管的网域')
      return
    }
    setData((prev) =>
      prev.map((item) =>
        item.id === target.id
          ? {
              ...item,
              agent_type: values.agent_type ?? 'vmagent',
              // 决策 14：Remote Write URL 默认由平台自动推导（中心 ingress + 网域路径），留空自动生成，可手动覆盖
              remote_write_url: values.remote_write_url || deriveRemoteWriteUrl(item.id),
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
    const isDefaultManagement = editingDomain.id === 'default'
    setData((prev) =>
      prev.map((item) =>
        item.id === editingDomain.id
          ? {
              ...item,
              ...values,
              // 行政字段（名称/租户/类型）由 Module_06 维护，此处不落库变更
              name: item.name,
              tenant_id: item.tenant_id,
              domain_type: isDefaultManagement ? 'management' : item.domain_type,
              // {v1.29} 取消纳管时清空 Token/Remote Write，重新纳管后由 submitOnboard 重新生成
              token: values.registration_status === 'monitored' ? (item.token || `tk_${Math.random().toString(36).slice(2, 14)}`) : '',
              remote_write_url: values.registration_status === 'monitored' ? (item.remote_write_url || deriveRemoteWriteUrl(item.id)) : '',
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

  const handleDelete = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('管理域禁止删除')
      return
    }
    Modal.confirm({
      title: '删除网域',
      content: `确定要删除网域 "${record.name}" 吗？删除前请确认该网域下已无资源绑定。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setData((prev) => prev.filter((item) => item.id !== record.id))
        message.success('网域已删除')
      },
    })
  }

  return (
    <MainLayout>
      <Card
        title="网域管理"
        extra={
          // {v1.29} M09 不再提供「新增网域」：网域行政创建由 Module_06「网域管理」负责，本页仅做监控纳管
          <Tooltip title="网域行政创建请前往 Module_06「网域管理」；此处将已创建的网域接入监控">
            <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => openOnboard()}>
              纳管网域
            </Button>
          </Tooltip>
        }
      >
        {/* 决策 17：安装指引为页面顶部常驻提示区（通用操作流程），纳管成功后滚动并高亮此区域；行内不再提供安装指引入口 */}
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
                  适用于所有新纳管的边缘网域；采集器与 blackbox exporter 由 Edge Sync Agent 启动后自动部署（并入第③步描述），无需手动分步安装。
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
              </div>
            }
          />
        </div>
        <Table
          dataSource={data}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '网域 ID', dataIndex: 'id', key: 'id' },
            { title: '网域名称', dataIndex: 'name', key: 'name' },
            {
              title: '类型',
              dataIndex: 'domain_type',
              key: 'domain_type',
              render: (type: DomainType) => <Tag color={domainTypeColor[type]}>{domainTypeLabel[type]}</Tag>,
            },
            {
              // {v1.29} 网域生命周期：created = 已由 Module_06 行政创建；monitored = 已完成监控纳管
              title: '纳管状态',
              dataIndex: 'registration_status',
              key: 'registration_status',
              render: (status: NetworkDomainRegistrationStatus) => (
                <Tag color={registrationStatusColor[status]}>{registrationStatusLabel[status]}</Tag>
              ),
            },
            {
              // 决策 16：运行态字段标注——状态 / 最后心跳由 Edge Sync Agent 心跳上报更新，
              // 纳管（登记制）阶段为 unknown / '-'，安装指引完成后 Agent 上线变为 online；组件明细请查看「Agent 状态」页
              title: (
                <Tooltip title="运行态字段：由 Edge Sync Agent 心跳自动更新。纳管/安装指引完成前为 unknown，Agent 上线后为 online；组件明细请查看「Agent 状态」页">
                  <Space size={4}>
                    状态
                    <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                  </Space>
                </Tooltip>
              ),
              dataIndex: 'status',
              key: 'status',
              render: (status: NetworkDomainStatus) => <Tag color={statusColor[status]}>{status}</Tag>,
            },
            {
              title: 'Agent 类型',
              dataIndex: 'agent_type',
              key: 'agent_type',
              render: (type: AgentType) => <Tag color="blue">{agentTypeLabel[type]}</Tag>,
            },
            {
              title: (
                <Tooltip title="运行态字段：由 Edge Sync Agent 心跳自动更新；纳管/安装指引完成前为 '-'，Agent 上线后为心跳时间">
                  <Space size={4}>
                    最后心跳
                    <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                  </Space>
                </Tooltip>
              ),
              dataIndex: 'last_heartbeat',
              key: 'last_heartbeat',
            },
            {
              title: 'Token',
              dataIndex: 'token',
              key: 'token',
              width: 140,
              render: (token: string) => (
                <Space>
                  <Text type="secondary">{TOKEN_MASK}</Text>
                  <Tooltip title="点击复制完整 Token">
                    <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => handleCopyToken(token)} />
                  </Tooltip>
                </Space>
              ),
            },
            {
              title: 'Remote Write URL',
              dataIndex: 'remote_write_url',
              key: 'remote_write_url',
              ellipsis: true,
            },
            {
              // 决策 17：安装指引已提升为页面顶部常驻提示区（通用流程），行内不再提供安装指引按钮；
              // 操作列仅保留「编辑 / 更多（重置 Token）/ 删除」
              title: '操作',
              key: 'action',
              width: 190,
              render: (_: unknown, record: NetworkDomain) => (
                <Space size="small">
                  {record.registration_status === 'created' && (
                    <Button size="small" type="primary" icon={<CloudUploadOutlined />} onClick={() => handleMonitor(record)}>
                      纳管
                    </Button>
                  )}
                  <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
                    编辑
                  </Button>
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
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={record.domain_type === 'management'}
                    onClick={() => handleDelete(record)}
                  >
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            字段语义：行政字段（ID / 名称 / 类型）由 Module_06「网域管理」创建与维护，本页不可修改；监控配置字段（Agent 类型 /
            Token / Remote Write URL，纳管或编辑时设置）与运行态字段（状态 / 最后心跳，由 Edge Sync Agent 心跳自动上报更新，
            纳管/安装指引完成前为 unknown / '-'）。纳管与编辑表单仅维护监控配置字段；组件明细与诊断请查看「Agent 状态」页。
            新网域接入流程见页面顶部「安装指引」提示区（纳管成功将自动滚动高亮该区域）。
          </Text>
        </div>
      </Card>

      {/* {v1.29} 纳管弹窗：从 Module_06 行政已创建（created）的网域中选择，填写监控参数；M09 不创建行政记录 */}
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
            description="网域的行政创建与租户分配由「系统设置」模块（Module_06 网域管理）负责；此处将已创建的网域接入监控——确认纳管后自动签发 Token、自动推导 Remote Write URL。default 管理域由系统预置且默认已纳管。"
          />
          <Form.Item
            name="id"
            label="选择网域"
            rules={[{ required: true, message: '请选择要纳管的网域' }]}
            extra={onboardTarget ? undefined : '仅列出 Module_06 已行政创建且未纳管的网域'}
          >
            <Select
              placeholder="请选择网域"
              disabled={!!onboardTarget}
              options={pendingOnboardDomains.map((d) => ({
                value: d.id,
                label: `${d.name}（${d.id}，租户：${d.tenant_id}）`,
              }))}
              notFoundContent="暂无可纳管的网域：请先在 Module_06「网域管理」完成行政创建与租户分配"
            />
          </Form.Item>
          {/* 决策 12/16：Agent 类型下拉保留，但 MVP 阶段固定 vmagent（PRD：纳管时无需选择）；prometheus-agent 枚举保留、v0.2+ 开放 */}
          <Form.Item name="agent_type" label="Agent 类型" initialValue="vmagent" extra="MVP 阶段固定 vmagent（纳管时无需选择）；prometheus-agent v0.2+ 开放为可选">
            <Select options={[{ value: 'vmagent', label: 'VMAgent' }]} disabled />
          </Form.Item>
          {/* 决策 14：Remote Write URL 默认由平台自动推导（中心 ingress + 网域路径），留空自动生成，可手动覆盖 */}
          <Form.Item name="remote_write_url" label="Remote Write URL" extra="留空由平台自动推导（中心 ingress + 网域路径），可手动覆盖">
            <Input placeholder="留空则自动生成，例如 https://metriccenter.example.com/api/v2/ingest/<domain-id>/prometheus" />
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
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征" />
          </Form.Item>
          {editingDomain?.id === 'default' && (
            <Form.Item>
              <Text type="secondary">
                管理域 "default" 由系统预置且默认已纳管，禁止删除与取消纳管；Agent 类型固定 vmagent、Remote Write 目标由中心配置。
              </Text>
            </Form.Item>
          )}
          {editingDomain && editingDomain.id !== 'default' && (
            <>
              {/* {v1.29} 编辑时可切换纳管状态，用于演示取消纳管 / 重新纳管 */}
              <Form.Item name="registration_status" label="纳管状态" extra="切换为「已创建未纳管」即取消纳管：清空 Token / Remote Write，网域退出监控上下文">
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
                <Input placeholder="留空则自动推导" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </MainLayout>
  )
}

export default NetworkDomainsPage
