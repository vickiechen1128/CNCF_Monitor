import { useRef, useState } from 'react'
import { Card, Table, Tag, Button, Space, Modal, Form, Input, Select, message, Tooltip, Typography, Steps, Alert, Dropdown } from 'antd'
import { EditOutlined, ReloadOutlined, PlusOutlined, CopyOutlined, DeleteOutlined, DownOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  networkDomains,
  edgeAgentInstallGuide,
  TOKEN_MASK,
  deriveRemoteWriteUrl,
  type NetworkDomain,
  type NetworkDomainStatus,
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

const agentTypeLabel: Record<AgentType, string> = {
  vmagent: 'VMAgent',
  'prometheus-agent': 'Prometheus Agent',
}

export function NetworkDomainsPage() {
  const [data, setData] = useState<NetworkDomain[]>(networkDomains)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  // 决策 17：安装指引为页面顶部常驻提示区；注册成功后滚动并高亮该提示区（guideHighlight 控制高亮态）
  const guideRef = useRef<HTMLDivElement>(null)
  const [guideHighlight, setGuideHighlight] = useState(false)
  const [form] = Form.useForm<Partial<NetworkDomain>>()

  const handleEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    form.setFieldsValue(record)
    setIsModalOpen(true)
  }

  const handleCreate = () => {
    setEditingDomain(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const handleSave = (values: Partial<NetworkDomain>) => {
    if (editingDomain) {
      const isDefaultManagement = editingDomain.id === 'default'
      setData((prev) =>
        prev.map((item) =>
          item.id === editingDomain.id
            ? {
                ...item,
                ...values,
                // default 管理域的 domain_type 不可变更
                domain_type: isDefaultManagement ? 'management' : (values.domain_type ?? item.domain_type),
                updated_at: new Date().toLocaleString('zh-CN', { hour12: false }),
              }
            : item
        )
      )
      message.success('网域已更新')
    } else {
      const now = new Date().toLocaleString('zh-CN', { hour12: false })
      const id = values.name?.toLowerCase().replace(/\s+/g, '-') || `domain-${Date.now()}`
      const newDomain: NetworkDomain = {
        id,
        name: values.name || '',
        description: values.description || '',
        domain_type: 'edge',
        tenant_id: values.tenant_id || 'platform_admin',
        token: `tk_${Math.random().toString(36).slice(2, 14)}`,
        agent_type: values.agent_type || 'vmagent',
        // 决策 14：Remote Write URL 默认由平台自动推导（中心 ingress + 网域路径），留空自动生成，可手动覆盖
        remote_write_url: values.remote_write_url || deriveRemoteWriteUrl(id),
        status: 'unknown',
        last_heartbeat: '-',
        agent_version: '-',
        created_at: now,
        updated_at: now,
      }
      setData((prev) => [...prev, newDomain])
      message.success('网域已创建')
      // 决策 17：注册成功后滚动并高亮页面顶部「安装指引」提示区（不弹窗），引导完成 Agent 接入
      window.setTimeout(() => {
        setGuideHighlight(true)
        guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 200)
      window.setTimeout(() => setGuideHighlight(false), 4000)
    }
    setIsModalOpen(false)
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
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            注册网域
          </Button>
        }
      >
        {/* 决策 17：安装指引为页面顶部常驻提示区（通用操作流程），注册成功后滚动并高亮此区域；行内不再提供安装指引入口 */}
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
                  适用于所有新注册的边缘网域；采集器与 blackbox exporter 由 Edge Sync Agent 启动后自动部署（并入第③步描述），无需手动分步安装。
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
              // 决策 16：运行态字段标注——状态 / 最后心跳由 Edge Sync Agent 心跳上报更新，
              // 注册（登记制）阶段为 unknown / '-'，安装指引完成后 Agent 上线变为 online；组件明细请查看「Agent 状态」页
              title: (
                <Tooltip title="运行态字段：由 Edge Sync Agent 心跳自动更新。注册/安装指引完成前为 unknown，Agent 上线后为 online；组件明细请查看「Agent 状态」页">
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
                <Tooltip title="运行态字段：由 Edge Sync Agent 心跳自动更新；注册/安装指引完成前为 '-'，Agent 上线后为心跳时间">
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
            字段语义：列表字段分两类——配置字段（ID / 名称 / 类型 / Agent 类型 / Token / Remote Write URL，注册或编辑时设置）与
            运行态字段（状态 / 最后心跳，由 Edge Sync Agent 心跳自动上报更新，注册/安装指引完成前为 unknown / '-'）。
            注册与编辑表单仅维护配置字段；组件明细与诊断请查看「Agent 状态」页。新网域接入流程见页面顶部「安装指引」提示区（注册成功将自动滚动高亮该区域）。
          </Text>
        </div>
      </Card>

      <Modal
        title={editingDomain ? '编辑网域' : '注册网域'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="name"
            label="网域名称"
            rules={[{ required: true, message: '请输入网域名称' }]}
          >
            <Input placeholder="例如：政务网 A 区" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="描述该网域的用途与网络特征" />
          </Form.Item>
          {!editingDomain && (
            <>
              <Form.Item name="tenant_id" label="租户 ID" extra="注册后不可修改（一个租户可拥有多个网域，网域归属租户后不可变更）">
                <Input placeholder="例如：platform_admin" />
              </Form.Item>
              {/* 决策 12/16：Agent 类型下拉保留，但 MVP 阶段仅 vmagent 一个选项（prometheus-agent 枚举保留、v0.2+ 开放） */}
              <Form.Item name="agent_type" label="Agent 类型" initialValue="vmagent" extra="MVP 阶段固定 vmagent；prometheus-agent v0.2+ 开放为可选">
                <Select
                  options={[{ value: 'vmagent', label: 'VMAgent' }]}
                  disabled
                />
              </Form.Item>
              <Form.Item name="remote_write_url" label="Remote Write URL" extra="留空由平台自动推导（中心 ingress + 网域路径），可手动覆盖">
                <Input placeholder="留空则自动生成，例如 https://metriccenter.example.com/api/v2/ingest/<domain-id>/prometheus" />
              </Form.Item>
              <Form.Item>
                <Text type="secondary">
                  注册为登记制：仅生成网域元数据（ID / 类型 / Remote Write 目标，后者自动推导）与认证 Token；
                  Agent IP / 主机名 / 状态 / 最后心跳由 Edge Sync Agent 心跳上报自动补全，无需在此填写。
                </Text>
              </Form.Item>
              <Alert
                type="info"
                showIcon
                message="注册 → 安装指引 → 自动上线（闭环）"
                description="网域注册是必要前置步骤：Edge Sync Agent 启动时必须携带平台签发的 NETWORK_DOMAIN_ID 与 TOKEN，Token 只能由注册时生成，无法靠 Agent 自行发现；注册完成后将自动打开「安装指引」，下载离线包并注入凭据后，Agent 启动即可心跳自动注册到该网域并出现在「Agent 状态」页。"
              />
            </>
          )}
          {editingDomain?.id === 'default' && (
            <Form.Item>
              <Text type="secondary">
                管理域 "default" 仅允许修改名称与描述，禁止删除；Agent 类型固定 vmagent、Remote Write 目标由中心配置。
              </Text>
            </Form.Item>
          )}
          {editingDomain && editingDomain.id !== 'default' && (
            <>
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
