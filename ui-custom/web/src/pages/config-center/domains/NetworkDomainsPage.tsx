import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Collapse,
  ConfigProvider,
  Descriptions,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import config from 'antd/locale/zh_CN'
import {
  CloudUploadOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { networkDomainMonitorApi } from '../../../api/configCenter'
import type { NetworkDomain } from '../../../types/config-center'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { MainLayout } from '../../../layouts/MainLayout'
import { useSkin } from '../../../skinContext'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { useNetworkDomains } from './useNetworkDomains'
import { OnboardDomainDrawer, type OnboardInput } from './OnboardDomainDrawer'
import { EdgePackageDownloadPanel } from './EdgePackageDownloadPanel'
import { NetworkDomainDetailDrawer } from './NetworkDomainDetailDrawer'
import { PlainTokenModal } from './PlainTokenModal'
import {
  TOKEN_CREDENTIAL_TIP,
  TOKEN_MASK,
  TOKEN_USER_GUIDE,
  agentTypeLabel,
  channelColor,
  channelLabel,
  deriveRegistrationStatus,
  formatRelativeTime,
  monitoredStatusColor,
  monitoredStatusLabel,
  registrationStatusColor,
  registrationStatusLabel,
} from '../configCenterConstants'

const { Text } = Typography

/**
 * 网域纳管列表页（Module_09 §11.1 页面状态矩阵）。
 * PRD v1.79 §3.1.1 / §11.3：7 列收敛为 5 列（网域 / 纳管状态 / 采集节点在线 / 凭据 / 操作）；
 * 网络区域类型、下发通道两列已下沉至详情抽屉。详情抽屉 + 行内纳管/编辑 + 顶部安装指引占位（agent_pull）；
 * local（default）恒显 '-'，绝不误展示 agent_pull 专属字段（C1~C4 裁剪占位）。
 * 覆盖：加载 / 空态 / 接口错误 / 权限不足状态。
 */
export function NetworkDomainsPage() {
  // 品牌色走皮肤 token（单一来源，见 skins.ts 设计约束）
  const { tokens } = useSkin()
  const {
    data,
    loading,
    error,
    permissionDenied,
    filters,
    setFilters,
    page,
    pageSize,
    onPageSizeChange,
    reload,
  } = useNetworkDomains()

  const [onboardOpen, setOnboardOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [detailDomain, setDetailDomain] = useState<NetworkDomain | null>(null)
  const [onboardDomain, setOnboardDomain] = useState<NetworkDomain | null>(null)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  const [plainToken, setPlainToken] = useState<{ title: string; token: string; tokenMasked?: string; domainName?: string } | null>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const [guideHighlight, setGuideHighlight] = useState(false)
  // 安装指引折叠态（PRD §1109 常驻提示区）：默认收起，local 通道用户无需细看；agent_pull 纳管成功自动展开
  const [guideOpen, setGuideOpen] = useState(false)
  // F-33：行内「更多 → 下载安装包」打开独立 Modal（复用懒加载面板，关闭即不发请求）
  const [downloadOpen, setDownloadOpen] = useState(false)

  // M06 网域管理 -> M09 网域纳管深链：预选网域并打开纳管抽屉（R4）
  const [searchParams] = useSearchParams()
  const deepLinkHandled = useRef(false)
  useEffect(() => {
    if (deepLinkHandled.current) return
    const targetId = searchParams.get('network_domain')
    if (!targetId || data.items.length === 0) return
    const target = data.items.find((d) => d.id === targetId && !d.is_monitored)
    if (target) {
      deepLinkHandled.current = true
      /* eslint-disable react-hooks/set-state-in-effect */
      setOnboardDomain(target)
      setOnboardOpen(true)
      /* eslint-enable react-hooks/set-state-in-effect */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.items])

  const openDetail = (record: NetworkDomain) => {
    setDetailDomain(record)
    setDetailOpen(true)
  }

  const handleOnboard = (record: NetworkDomain) => {
    setOnboardDomain(record)
    setOnboardOpen(true)
  }

  const handleMonitorSubmit = async (input: OnboardInput) => {
    if (!onboardDomain) return
    setSubmitting(true)
    try {
      const res = await networkDomainMonitorApi.monitor(onboardDomain.id, input)
      message.success(`网域 "${onboardDomain.name}" 已纳管`)
      setOnboardOpen(false)
      // MEDIUM-1：纳管 agent_pull 域成功 → /monitor 单次返回明文 token，用一次性 Modal 展示引导保存
      if (onboardDomain.channel === 'agent_pull' && res.data?.token) {
        setPlainToken({
          title: `网域「${onboardDomain.name}」接入 Token（仅本次可见）`,
          token: res.data.token,
          tokenMasked: res.data.token_masked,
          domainName: onboardDomain.name,
        })
      }
      reload()
      // 决策 17：纳管成功滚动并高亮顶部安装指引区（agent_pull），并展开指引
      if (onboardDomain.channel === 'agent_pull') {
        setGuideOpen(true)
        window.setTimeout(() => {
          setGuideHighlight(true)
          if (typeof guideRef.current?.scrollIntoView === 'function') {
            guideRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 200)
        window.setTimeout(() => setGuideHighlight(false), 4000)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleEditSubmit = async (values: { description?: string; agent_type?: string; remote_write_url?: string }) => {
    if (!editingDomain) return
    setSubmitting(true)
    try {
      await networkDomainMonitorApi.update(editingDomain.id, {
        agent_type: editingDomain.channel === 'local' ? undefined : (values.agent_type as NetworkDomain['agent_type']),
        remote_write_url: editingDomain.channel === 'local' ? undefined : values.remote_write_url,
        description: values.description,
      })
      message.success('网域监控参数已更新')
      setEditOpen(false)
      reload()
    } finally {
      setSubmitting(false)
    }
  }

  // HIGH-1：list 接口不返回明文 token（仅 token_masked 脱敏串），列表行不再提供「复制明文」；
  // 明文仅在纳管成功 / 重置 Token 的单次响应中获取，经一次性 PlainTokenModal 展示复制。
  // 用户可见文案见 TOKEN_USER_GUIDE / TOKEN_CREDENTIAL_TIP（F-30）。
  const handleResetToken = (record: NetworkDomain) => {
    Modal.confirm({
      title: '重置 Token',
      content: `确定要重置网域 "${record.name}" 的接入 Token 吗？旧 Token 将立即失效。`,
      okText: '确认重置',
      okType: 'primary',
      cancelText: '取消',
      okButtonProps: { loading: submitting },
      onOk: async () => {
        try {
          const res = await networkDomainMonitorApi.resetToken(record.id)
          const token = res.data?.token
          // LOW-1：明文 Token 改用一次性高对比 Modal 展示，避免常驻 toast 暴露明文
          if (token) {
            setPlainToken({
              title: `网域「${record.name}」新 Token（仅本次可见）`,
              token,
              tokenMasked: res.data?.token_masked,
              domainName: record.name,
            })
          } else {
            message.success('Token 已重置')
          }
          reload()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '重置失败，请稍后重试')
        }
      },
    })
  }

  const columns: ColumnsType<NetworkDomain> = [
    {
      title: '网域',
      key: 'domain',
      width: 200,
      fixed: 'left',
      render: (_: unknown, record: NetworkDomain) => (
        <div>
          <div style={{ lineHeight: '22px' }}>{record.name}</div>
          <Text type="secondary" style={{ fontSize: 12, lineHeight: '18px' }}>{record.id}</Text>
        </div>
      ),
    },
    {
      title: '纳管状态',
      key: 'registration_status',
      width: 120,
      render: (_: unknown, record: NetworkDomain) => {
        const st = deriveRegistrationStatus(record)
        return <Tag color={registrationStatusColor[st]}>{registrationStatusLabel[st]}</Tag>
      },
    },
    {
      // PRD v1.79 §3.1.1：第 3 列「运行状态」更名「采集节点在线」（决策 82 配套）+ 列头 Tooltip 点明粒度：
      // 本列为「该网域采集节点的心跳状态」（网域粒度聚合），与「采集节点状态」页（节点/组件级诊断）
      // 构成「网域层概览 → 节点层诊断」的层级关系、不是重复；与「纳管状态」（配置态）也不同，非重复列。
      title: (
        <Tooltip title="该网域采集节点的心跳状态，网域粒度的聚合视图；节点与组件级诊断请见「采集节点状态」页。与「纳管状态」（配置态）不同，属运行态">
          <Space size={4}>
            采集节点在线
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'monitored_status',
      width: 180,
      render: (_: unknown, record: NetworkDomain) => {
        if (record.channel === 'agent_pull' && record.monitored_status) {
          return (
            <Space size={4}>
              <Tag color={monitoredStatusColor[record.monitored_status]} style={{ marginRight: 0 }}>
                {monitoredStatusLabel[record.monitored_status]}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>· {formatRelativeTime(record.last_heartbeat)}</Text>
            </Space>
          )
        }
        return <Text type="secondary">-</Text>
      },
    },
    {
      title: '凭据',
      key: 'credential',
      width: 110,
      // HIGH-1：list 不返回明文 token，故凭据列仅展示脱敏串，不提供「复制明文」按钮；
      // 用户可见文案见 TOKEN_CREDENTIAL_TIP（F-30：Tooltip 用普通用户语言说明「为何只有脱敏值 / 丢了怎么重置」）
      render: (_: unknown, record: NetworkDomain) =>
        record.channel === 'agent_pull' && record.token_masked ? (
          <Tooltip title={TOKEN_CREDENTIAL_TIP}>
            <Text type="secondary" style={{ fontSize: 12 }}>{TOKEN_MASK}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      fixed: 'right',
      render: (_: unknown, record: NetworkDomain) => {
        const isMonitored = record.is_monitored
        // F-33：下载入口从页面级主按钮改为**行内按需**——仅边缘域（agent_pull）行提供「更多」下拉；
        // 中心直连域（local）无需部署采集节点，整行不出现下载入口。
        // 「重置 Token」仅已纳管边缘域才有意义，故按 isMonitored 动态拼接菜单项。
        const moreItems: MenuProps['items'] =
          record.channel === 'agent_pull'
            ? [
                ...(isMonitored
                  ? [
                      {
                        key: 'reset-token',
                        icon: <ReloadOutlined />,
                        label: '重置 Token',
                        onClick: () => handleResetToken(record),
                      },
                    ]
                  : []),
                {
                  key: 'download-package',
                  icon: <DownloadOutlined />,
                  label: '下载安装包',
                  onClick: () => setDownloadOpen(true),
                },
              ]
            : []
        return (
          <Space size="small">
            {!isMonitored ? (
              <Button type="link" size="small" icon={<CloudUploadOutlined />} onClick={() => handleOnboard(record)}>
                纳管
              </Button>
            ) : (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditingDomain(record); setEditOpen(true) }}>
                编辑
              </Button>
            )}
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(record)}>
              详情
            </Button>
            {moreItems.length > 0 && (
              <Dropdown menu={{ items: moreItems }}>
                <Button size="small">更多 <DownOutlined /></Button>
              </Dropdown>
            )}
          </Space>
        )
      },
    },
  ]

  if (permissionDenied) {
    return (
      <MainLayout>
        <ConfigProvider locale={config}>
          <div style={{ marginTop: 80 }}>
            <Empty description="当前账号无此页面查看权限" />
          </div>
        </ConfigProvider>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card title="网域纳管">
        {/* F-33 动线前置：本条提示常驻在折叠指引**之外**，让中心直连域用户一眼确认「无需部署、无需下载」，
            不必展开指引；下方折叠区只保留边缘域（agent_pull）的部署动线。 */}
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message="中心直连域（如 default / local 通道）：无需部署采集节点，平台直接采集；仅登记新增的边缘域需要安装采集节点。"
        />
        {/* PRD §1109：安装指引为页面顶部常驻提示区（不随是否有 agent_pull 网域而隐藏） */}
        <div
            ref={guideRef}
            style={{
              marginBottom: 16,
              borderRadius: 8,
              outline: guideHighlight ? `2px solid ${tokens.colorPrimary}` : 'none',
              outlineOffset: 4,
              transition: 'outline 0.3s',
            }}
          >
            <Collapse
              ghost
              size="small"
              activeKey={guideOpen ? ['guide'] : []}
              onChange={(k) => setGuideOpen(k.includes('guide'))}
              items={[
                {
                  key: 'guide',
                  label: (
                    <Space size={8}>
                      <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                      {/* F-33：标题限定为「边缘域」，与折叠区外的常驻提示分工——直连域用户不必点进来 */}
                      <Text strong>边缘域接入操作流程（安装指引）</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>点击展开</Text>
                    </Space>
                  ),
                  children: (
                    <div>
                      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                        边缘域（agent_pull）需部署 Edge Sync Agent 才能回连平台，按下方步骤接入。
                      </Typography.Paragraph>
                      <Steps
                        size="small"
                        direction="vertical"
                        current={-1}
                        items={[
                          {
                            // F-30：补入「复制 Token」为第 1 步——此前四步流程未提示 Token 需在纳管成功后立即复制
                            title: '复制并保存接入 Token',
                            description: (
                              <span>
                                {TOKEN_USER_GUIDE}
                                <br />
                                部署采集节点时请把 Token 填入 systemd 的 <Typography.Text code>TOKEN</Typography.Text> 环境变量（见下方「启动 / 守护」步骤）。
                              </span>
                            ),
                          },
                          {
                            title: '下载安装包',
                            description: (
                              <span>
                                从下方清单下载对应版本的 Edge Sync Agent 离线安装包。
                                <br />
                                接入配置（Token / 中心地址 / Remote Write URL）在纳管时自动签发，部署时以环境变量（或 systemd Environment）注入，不会写入二进制。
                              </span>
                            ),
                          },
                          {
                            title: '解压部署',
                            description: (
                              <span>
                                解压到 <Typography.Text code>/opt/apps</Typography.Text>（程序只读），数据目录用独立可写路径
                                <Typography.Text code>/opt/data/edge-sync-agent</Typography.Text>，并按架构链接二进制：
                                <pre style={{ margin: '8px 0 0 0', padding: 8, background: '#f5f5f5', borderRadius: 4, fontSize: 12, whiteSpace: 'pre-wrap' }}>{`sudo mkdir -p /opt/apps/edge-sync-agent /opt/data/edge-sync-agent
sudo tar -xzf edge-sync-agent-*.tar.gz -C /opt/apps/edge-sync-agent --strip-components=1
sudo ln -sf /opt/apps/edge-sync-agent/bin/edge-sync-agent-linux-amd64 \\
             /opt/apps/edge-sync-agent/edge-sync-agent`}</pre>
                              </span>
                            ),
                          },
                          {
                            title: '启动 / 守护',
                            description: (
                              <span>
                                编辑 <Typography.Text code>/etc/systemd/system/edge-sync-agent.service</Typography.Text> 的
                                <Typography.Text code>[Service] Environment=</Typography.Text>，
                                填写必填项 <Typography.Text code>NETWORK_DOMAIN_ID / TOKEN / CENTER_ENDPOINT</Typography.Text>，并按需覆盖数据目录
                                <Typography.Text code>EDGE_CONFIG_ROOT / EDGE_WAL_DIR</Typography.Text> 指向 <Typography.Text code>/opt/data/edge-sync-agent</Typography.Text>，然后拉起：
                                <pre style={{ margin: '8px 0 0 0', padding: 8, background: '#f5f5f5', borderRadius: 4, fontSize: 12, whiteSpace: 'pre-wrap' }}>{`sudo install -m 0644 /opt/apps/edge-sync-agent/packaging/edge-sync-agent.service \\
             /etc/systemd/system/
# 编辑上文件 Environment=（见上），随后：
sudo systemctl daemon-reload
sudo systemctl enable --now edge-sync-agent`}</pre>
                              </span>
                            ),
                          },
                          {
                            title: '心跳回连',
                            description: (
                              <span>
                                Agent 自动连接平台拉取配置并上报数据；可在本页「采集节点在线」列或网域详情查看心跳与运行情况。
                                <br />
                                调试期可改走前台运行（见部署文档），用 <Typography.Text code>journalctl -u edge-sync-agent -f</Typography.Text> 查看日志。
                              </span>
                            ),
                          },
                        ]}
                      />
                      <EdgePackageDownloadPanel active={guideOpen} />
                    </div>
                  ),
                },
              ]}
            />
          </div>

        {error && (
          <Alert
            type="error"
            showIcon
            message="网域纳管列表加载失败，请稍后重试"
            description={error}
            action={<Button size="small" icon={<ReloadOutlined />} onClick={reload}>重新加载</Button>}
            style={{ marginBottom: 16 }}
          />
        )}

        <FilterBar>
          <FilterItem label="关键词" width={280}>
            <Input.Search
              placeholder="按网域名称 / ID 搜索"
              allowClear
              style={{ width: 220 }}
              onSearch={(v) => setFilters({ ...filters, keyword: v || '' })}
            />
          </FilterItem>
        </FilterBar>

        <Table<NetworkDomain>
          rowKey="id"
          dataSource={data.items}
          loading={loading}
          columns={columns}
          scroll={TABLE_SCROLL_X}
          locale={{
            emptyText: (
              <Empty description="暂无网域，请先在「系统与平台管理 · 网域管理」完成行政登记">
                <Button type="primary" icon={<CloudUploadOutlined />} disabled>
                  网域纳管
                </Button>
              </Empty>
            ),
          }}
          pagination={{
            ...TABLE_PAGINATION,
            current: page,
            pageSize,
            total: data.total,
            onChange: (p, pz) => onPageSizeChange(p, pz),
          }}
        />
      </Card>

      <OnboardDomainDrawer
        open={onboardOpen}
        domain={onboardDomain}
        submitting={submitting}
        onSubmit={handleMonitorSubmit}
        onClose={() => setOnboardOpen(false)}
      />

      <NetworkDomainDetailDrawer
        open={detailOpen}
        domain={detailDomain}
        onClose={() => setDetailOpen(false)}
      />

      <PlainTokenModal
        open={plainToken !== null}
        title={plainToken?.title}
        token={plainToken?.token ?? ''}
        tokenMasked={plainToken?.tokenMasked}
        domainName={plainToken?.domainName}
        onClose={() => setPlainToken(null)}
      />

      {/* F-33：行内「更多 → 下载安装包」入口——与折叠指引内的面板共用同一组件，active 控制懒加载 */}
      <Modal
        title="离线安装包下载"
        open={downloadOpen}
        onCancel={() => setDownloadOpen(false)}
        footer={null}
        width={640}
        destroyOnHidden
      >
        <EdgePackageDownloadPanel active={downloadOpen} />
      </Modal>

      <Drawer
        title="编辑网域（监控参数）"
        placement="right"
        width={520}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        // forceRender（替代 destroyOnHidden）：Drawer 首次打开时内容惰性挂载，导致
        // EditDomainForm 的 useEffect(domain) setFieldsValue 在字段注册前执行被吞、
        // 编辑回显首次为空；forceRender 保证内容常驻挂载、打开即正确回显（#19 通病，网域编辑抽屉）。
        forceRender
      >
        {editingDomain && (
          <EditDomainForm
            domain={editingDomain}
            submitting={submitting}
            onSubmit={handleEditSubmit}
          />
        )}
      </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}

function EditDomainForm({
  domain,
  submitting,
  onSubmit,
}: {
  domain: NetworkDomain
  submitting: boolean
  onSubmit: (values: { description?: string; agent_type?: string; remote_write_url?: string }) => Promise<void>
}) {
  const [form] = Form.useForm<{ description?: string; agent_type?: string; remote_write_url?: string }>()
  useEffect(() => {
    form.setFieldsValue({
      description: domain.description,
      agent_type: domain.agent_type ?? 'vmagent',
      remote_write_url: domain.remote_write_url,
    })
  }, [domain, form])

  const isLocal = domain.channel === 'local'

  return (
    <Form form={form} layout="vertical" onFinish={onSubmit}>
      <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
        <Descriptions.Item label="网域名称">{domain.name}</Descriptions.Item>
        <Descriptions.Item label="归属租户">{domain.tenant_id}</Descriptions.Item>
      </Descriptions>
      <Form.Item label="下发通道（只读）">
        <Tag color={channelColor[domain.channel]}>{channelLabel[domain.channel]}</Tag>
      </Form.Item>
      {!isLocal && (
        <Form.Item name="agent_type" label="指标采集器类型">
          <Select options={[{ value: 'vmagent', label: agentTypeLabel.vmagent }]} disabled />
        </Form.Item>
      )}
      {!isLocal && (
        <Form.Item name="remote_write_url" label="Remote Write URL">
          <Input placeholder="留空则自动推导（该网域视角的可达地址，网闸映射后地址）" />
        </Form.Item>
      )}
      <Form.Item name="description" label="描述">
        <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征" />
      </Form.Item>
      {isLocal && (
        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          local 通道网域（default）由中心直接采集，不生成 Token / Remote Write 等接入配置，无 Edge Agent 心跳。
        </Text>
      )}
      <div style={{ textAlign: 'right', marginTop: 8 }}>
        <Space>
          <Button onClick={() => form.resetFields()}>恢复</Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>保存</Button>
        </Space>
      </div>
    </Form>
  )
}

export default NetworkDomainsPage