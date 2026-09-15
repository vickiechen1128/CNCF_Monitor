import { useRef, useState, useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  message,
  Tooltip,
  Typography,
  Badge,
  Dropdown,
  Drawer,
  Descriptions,
  Empty,
} from 'antd'
import {
  EditOutlined,
  ReloadOutlined,
  CopyOutlined,
  DownOutlined,
  UpOutlined,
  EyeOutlined,
  CloudUploadOutlined,
  InfoCircleFilled,
  LinkOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { ReviewNote } from '../components/ReviewNote'
import { Callout } from '../components/Callout'
import { CALLOUT_TONES } from '../components/calloutTones'
import {
  networkDomains,
  edgeAgents,
  edgeAgentInstallGuide,
  TOKEN_MASK,
  deriveRemoteWriteUrl,
  deriveConfigDownloadUrl,
  type NetworkDomain,
  type NetworkDomainStatus,
  type NetworkDomainRegistrationStatus,
  type AgentType,
  type DomainType,
} from '../mocks/module-09'
import dayjs from 'dayjs'

const { Text } = Typography

/**
 * {v1.53} 用户侧术语口径（决策 74 / 79 / 80）：
 * 页面用户可见文案一律使用「采集节点 / 采集节点域 / 中心直连域 / 网络分区」；技术名
 * （Edge Sync Agent / 管理域 / 边缘域 / zone_type / local / agent_pull）只出现在
 * Tooltip、折叠技术说明与评审说明中，不作为行文主语。
 */

const statusBadge: Record<NetworkDomainStatus, { status: 'success' | 'error' | 'default'; label: string }> = {
  online: { status: 'success', label: '在线' },
  offline: { status: 'error', label: '离线' },
  unknown: { status: 'default', label: '未知' },
}

/**
 * {v1.53} 接入方式 = domain_type 的用户侧叫法（决策 74 / 79）：中心直连域 / 采集节点域；
 * 技术枚举 management / edge 不变。
 * 列表列、详情抽屉、纳管 / 编辑表单三处**必须共用下表中的同一份文案与配色**——
 * 历史上列表用 channel 另起一套「中心直连 / 采集节点回传」，导致同一页面列表与详情措辞打架。
 */
const domainTypeLabel: Record<DomainType, string> = {
  management: '中心直连域',
  edge: '采集节点域',
}

const domainTypeTip: Record<DomainType, string> = {
  management: '中心自己所在的网域（default）：采集器与中心同机，中心直接采集；无凭据、无采集节点安装步骤',
  edge: '中心访问不到的网域：需在该网域内一台常开机器上装采集节点（凭据认证 + 完整性校验），数据单向出站回传',
}

const domainTypeColor: Record<DomainType, string> = {
  management: 'blue',
  edge: 'cyan',
}

const registrationBadge: Record<
  NetworkDomainRegistrationStatus,
  { status: 'default' | 'processing' | 'success'; label: string; tip: string }
> = {
  created: {
    status: 'default',
    label: '已创建未纳管',
    tip: '网域已在「网域管理」登记，尚未配置监控接入参数，未签发凭据',
  },
  monitored: {
    status: 'processing',
    label: '已纳管',
    tip: '监控接入参数已配置、凭据已签发，等待采集节点上线或已上线',
  },
}

const agentTypeLabel: Record<AgentType, string> = {
  vmagent: 'VMAgent',
  'prometheus-agent': 'Prometheus Agent',
}

/**
 * {v1.53} 网络分区（zone_type）展示口径（决策 76）：
 * zone_type 是纯分类标签、不影响采集行为；政务云场景是「安全分区」，公有云场景是「region」。
 * 与 Module_06 的部署级字典（ZONE_TYPE_OPTIONS）保持同一套取值与叫法。
 */
const zoneTypeLabelOf = (value: string) => {
  const map: Record<string, string> = {
    internet: '互联网区',
    extranet: '政务外网区',
    'private-line': '专线区',
    dmz: 'DMZ',
    'cn-hangzhou': 'cn-hangzhou（region）',
    'cn-beijing': 'cn-beijing（region）',
  }
  return value ? (map[value] ?? value) : ''
}

const zoneTypeColor: Record<string, string> = {
  internet: 'volcano',
  extranet: 'purple',
  'private-line': 'cyan',
  dmz: 'gold',
  'cn-hangzhou': 'geekblue',
  'cn-beijing': 'geekblue',
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

/** 表单分组标题（左侧品牌色竖条 + 标题 + 说明），保证抽屉内表单层次一致（对齐《前端标准》§8） */
function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '6px 0 14px' }}>
        <span style={{ width: 3, height: 13, background: '#0ECDEB', borderRadius: 2, transform: 'translateY(1px)' }} />
        <Text strong style={{ fontSize: 13 }}>
          {title}
        </Text>
        {description && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {description}
          </Text>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * {v1.55} 安装命令模板（决策 71；PRD 验收项「安装指引为页面顶部常驻提示区」原文）。
 *
 * PRD 原文即规定：「`NETWORK_DOMAIN_ID` = 对应网域 ID、`TOKEN` 经**网域行内复制按钮**获取」
 * ——凭据本就由用户自行从列表行内复制，故面板只给**不含任何真实值的静态模板**，
 * 不再提供网域选择框、不再预填凭据（「按所选网域预填」是原型的自作主张、非 PRD 要求）。
 *
 * 相比「选网域 → 复制」的逐次切换，静态模板两点更好：
 *   ① 一个模板适配任意网域，批量接入无需反复切换选择框；
 *   ② 面板内不承载任何真实凭据，脱敏责任收敛到「行内复制」单一入口。
 */
const INSTALL_COMMAND_TEMPLATE = [
  '# 1) 获取并校验一体化离线包（离线交付：经网闸 / 摆渡拷入目标机器）',
  'sha256sum -c edge-sync-agent-v1.2.0-linux-amd64.tar.gz.sha256',
  '',
  '# 2) 配置本网域环境变量；<网域 ID> 与 <凭据> 请从上方列表对应行复制填入',
  'export NETWORK_DOMAIN_ID="<网域 ID>"',
  'export TOKEN="<凭据>"',
  '',
  '# 3) 解包并启动 Edge Sync Agent（systemd 托管、开机自启；采集器与拨测器由它自动部署）',
  'sudo tar -xzf edge-sync-agent-v1.2.0-linux-amd64.tar.gz -C /opt/metriccenter',
  'sudo systemctl enable --now metric-center-edge-agent',
].join('\n')

/** 接入指引 + 一键安装命令面板（可收起，状态记 localStorage） */
function GuidePanel({
  domains,
  focusDomainId,
  onCollapse,
}: {
  domains: NetworkDomain[]
  focusDomainId?: string
  onCollapse: () => void
}) {
  /** 无「已纳管的采集节点域」时不展示命令模板（未纳管没有凭据，装了也连不上） */
  const hasInstallable = domains.length > 0
  /** 深链 / 详情抽屉带入的「本次要接入」网域：只做提示与行高亮，**不再驱动命令内容**（决策 71） */
  const focusDomain = domains.find((d) => d.id === focusDomainId)

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(INSTALL_COMMAND_TEMPLATE).then(() =>
      message.success('已复制安装命令模板；请把 <网域 ID> 与 <凭据> 替换为列表对应行的值后执行')
    )
  }

  return (
    <Callout
      tone="brand"
      icon={<InfoCircleFilled />}
      title="网域接入指引：先纳管拿凭据，再装采集节点出数据"
      extra={
        <Button type="text" size="small" icon={<UpOutlined />} onClick={onCollapse} style={{ color: '#86909C' }}>
          收起
        </Button>
      }
      style={{ marginBottom: 12 }}
    >
      {/* {v1.69} 决策 73-1：补 MVP 单节点部署口径；决策 73-2：补「中心接入地址」方向性指引（机器如何到达中心由纳管登记地址决定） */}
      <div>
        中心访问不到这个网域，所以要在<b>该网域内的一台常开机器</b>上装一个「采集节点」，由它把数据单向回传给中心。
        采集节点与采集器由同一个离线包交付，装完即自动部署，无需逐个装组件。
        <b>一个网域只需装一个采集节点</b>即可覆盖全域采集目标（域内互通、一台可达全域；规模分片 / HA / 拨测多探测点为 v0.4+ 演化场景）。
        机器如何到达中心，由纳管时登记的「中心接入地址」决定——如需 nginx / 网闸转发，请先确认该地址已按你的网络策略登记。
      </div>

      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {/* {v1.55} 决策 71：收敛为 PRD 规定的 3 步人工步骤（「纳管取凭据」是平台侧前置动作、非操作者步骤，已从编号中移除） */}
        {['① 下载并校验一体化离线包', '② 配置 NETWORK_DOMAIN_ID / TOKEN 环境变量', '③ 启动 Edge Sync Agent'].map(
          (label, idx) => (
            <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {idx > 0 && <Text type="secondary" style={{ fontSize: 12 }}>›</Text>}
              <Tag style={{ background: '#FFFFFF', marginInlineEnd: 0 }}>{label}</Tag>
            </span>
          )
        )}
      </div>
      {/* {v1.55} 决策 71：命令改为静态模板后不再有选择框，深链带入的「本次要接入」网域改在此提示（并高亮列表行） */}
      {focusDomain && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            本次要接入：<Text strong style={{ fontSize: 12 }}>{focusDomain.name}</Text>（网域 ID{' '}
            <Text code style={{ fontSize: 12 }}>{focusDomain.id}</Text>
            ）——请在下方列表该行复制凭据，填入模板。
          </Text>
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px dashed ${CALLOUT_TONES.brand.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Space size={6}>
            <CodeOutlined style={{ color: '#0ECDEB' }} />
            <Text strong style={{ fontSize: 13 }}>
              安装命令模板
            </Text>
          </Space>
          <Button
            type="primary"
            size="small"
            icon={<CopyOutlined />}
            onClick={handleCopyCommand}
            disabled={!hasInstallable}
          >
            复制安装命令模板
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            模板不含真实凭据；<Text code style={{ fontSize: 12 }}>{'<网域 ID>'}</Text> 与{' '}
            <Text code style={{ fontSize: 12 }}>{'<凭据>'}</Text> 请从下方列表对应行复制后填入
          </Text>
        </div>
        {hasInstallable ? (
          <pre
            style={{
              margin: '10px 0 0',
              padding: '12px 14px',
              background: '#FFFFFF',
              border: '1px solid #E5E6EB',
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.8,
              fontFamily: 'SFMono-Regular, Consolas, monospace',
              color: '#4E5969',
              // {v1.55} 决策 71：命令改为静态模板后行数固定为 10 行（含空行），220 会裁掉末行 → 放到 280 完整展示
              maxHeight: 280,
              overflow: 'auto',
              whiteSpace: 'pre',
            }}
          >
            {INSTALL_COMMAND_TEMPLATE}
          </pre>
        ) : (
          <div style={{ marginTop: 10 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<Text type="secondary" style={{ fontSize: 12 }}>暂无可安装的网域：请先完成「已创建未纳管」网域的纳管</Text>}
            />
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            页面上凭据一律以掩码展示，<Text code style={{ fontSize: 12 }}>TOKEN</Text>{' '}
            只能经行内「凭据」列的复制按钮获取（PRD 规定的凭据获取方式）；
            凭据泄露时应先在行内「更多 → 重置凭据」作废旧值。
          </Text>
        </div>
      </div>
    </Callout>
  )
}

export function NetworkDomainsPage() {
  /**
   * {R4} 深链参数：M06「网域管理」列表的「去纳管 / 查看安装指引」会带 `network_domain=xxx` 跳转过来。
   * 初始状态直接由该参数派生（惰性初始化）——避免在 effect 中同步 setState 造成级联渲染。
   */
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const linkedIdFromUrl = searchParams.get('network_domain') ?? undefined
  const linkedTarget = useMemo(
    () => (linkedIdFromUrl ? networkDomains.find((d) => d.id === linkedIdFromUrl) : undefined),
    [linkedIdFromUrl]
  )
  const linkedIsOnboardTarget = linkedTarget?.registration_status === 'created'
  const linkedIsInstallGuideTarget =
    !!linkedTarget && linkedTarget.channel === 'agent_pull' && linkedTarget.registration_status === 'monitored'

  const [data, setData] = useState<NetworkDomain[]>(networkDomains)
  // 编辑抽屉：仅维护监控参数（网域名称/租户等行政字段由 Module_06 维护，只读展示）
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  // {v1.29} 纳管抽屉：从 Module_06 行政已创建（created）的网域中选择并填写监控参数
  const [isOnboardOpen, setIsOnboardOpen] = useState(!!linkedIsOnboardTarget)
  const [onboardTarget, setOnboardTarget] = useState<NetworkDomain | null>(
    linkedIsOnboardTarget && linkedTarget ? linkedTarget : null
  )
  // 决策 36-1：右侧详情抽屉
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [drawerDomain, setDrawerDomain] = useState<NetworkDomain | null>(null)
  // 决策 17：接入指引为页面顶部常驻提示区；纳管成功后滚动并高亮该区域（guideHighlight 控制高亮态）
  const guideRef = useRef<HTMLDivElement>(null)
  const [guideHighlight, setGuideHighlight] = useState(false)
  // {v1.53} 接入指引可收起，收起状态记 localStorage（延续决策 79「可关闭并记住」口径）
  const [guideCollapsed, setGuideCollapsed] = useState(() =>
    linkedIsInstallGuideTarget ? false : localStorage.getItem('m09-network-domain-guide-collapsed') === 'true'
  )
  /**
   * {v1.55} 决策 71：命令改为静态模板后，「当前选中网域」状态不再需要（也不再驱动命令内容）。
   * 保留单一 `focusDomainId` 承载各入口带入的「本次要接入」网域，仅用于 ① 面板提示 ② 列表行高亮：
   *   - M06「网域管理」深链 `?network_domain=xxx`
   *   - 本页详情抽屉「查看该网域的安装指引」、以及纳管成功后的自动引导
   */
  const [focusDomainId, setFocusDomainId] = useState<string | undefined>(linkedIdFromUrl)
  const [form] = Form.useForm<Partial<NetworkDomain>>()
  const [onboardForm] = Form.useForm<Partial<NetworkDomain>>()

  /** 存在 agent_pull 通道网域：决定凭据 / 采集节点 / 接入指引等字段是否展示（决策 31/32/33） */
  const hasAgentPull = data.some((d) => d.channel === 'agent_pull')

  /** 可安装网域 = agent_pull 且已纳管（未纳管尚未签发凭据，「凭据」列为空、模板无从填值） */
  const installableDomains = useMemo(
    () => data.filter((d) => d.channel === 'agent_pull' && d.registration_status === 'monitored'),
    [data]
  )

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
              // {v1.31} 中心接入地址（网闸映射后的中心可达地址）：采集节点域纳管必填，用于合成配置包绝对下载地址
              center_endpoint: values.center_endpoint || '',
              // 纳管即自动签发凭据（PRD 3.1.1 凭据前置签发）
              token: `tk_${Math.random().toString(36).slice(2, 14)}`,
              registration_status: 'monitored',
              updated_at: new Date().toLocaleString('zh-CN', { hour12: false }),
            }
          : item
      )
    )
    message.success(`网域 "${target.name}" 已纳管，可复制下方安装命令模板并填入该网域凭据执行`)
    setIsOnboardOpen(false)
    // 决策 17 / {v1.55}：纳管成功后展开接入指引并高亮该网域（不弹窗），引导完成采集节点安装
    setGuideCollapsed(false)
    localStorage.setItem('m09-network-domain-guide-collapsed', 'false')
    setFocusDomainId(target.id)
    window.setTimeout(() => {
      setGuideHighlight(true)
      guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 200)
    window.setTimeout(() => setGuideHighlight(false), 4000)
  }

  const handleSave = (values: Partial<NetworkDomain>) => {
    if (!editingDomain) return
    // {v1.33} 按接入方式区分可编辑字段：中心直连（default）不维护采集节点相关参数（PRD 4.1 为空且不展示）
    const isLocal = editingDomain.channel === 'local'
    setData((prev) =>
      prev.map((item) =>
        item.id === editingDomain.id
          ? {
              ...item,
              ...values,
              // 行政字段（名称/租户/类型/网络分区）由 Module_06 维护，此处不落库变更
              name: item.name,
              tenant_id: item.tenant_id,
              domain_type: isLocal ? 'management' : item.domain_type,
              // {v1.31} zone_type 为 M06 行政字段：本页纳管只读引用，不在此维护
              zone_type: item.zone_type,
              // {v1.33} 中心直连：不生成凭据 / 采集器类型 / Remote Write / 中心接入地址
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
      title: '重置凭据',
      content: `确定要重置网域 "${record.name}" 的接入凭据吗？旧凭据将立即失效，已安装的采集节点需重新配置后才能上报。`,
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
        message.success('凭据已重置，请重新复制安装命令到该网域机器更新')
      },
    })
  }

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token).then(() => message.success('凭据已复制'))
  }

  const collapseGuide = () => {
    setGuideCollapsed(true)
    localStorage.setItem('m09-network-domain-guide-collapsed', 'true')
  }
  const expandGuide = () => {
    setGuideCollapsed(false)
    localStorage.setItem('m09-network-domain-guide-collapsed', 'false')
  }

  // {v1.29} 对已由 Module_06 行政创建的网域执行监控纳管：打开纳管抽屉填写监控参数（凭据自动签发 / Remote Write 自动推导）
  const handleMonitor = (record: NetworkDomain) => {
    openOnboard(record)
  }

  /**
   * {R4} 深链定位：初始状态已由 URL 参数派生，本 effect 只负责与外部系统同步的 DOM 动作
   * （表单实例预填 + 滚动定位），不在 effect 内 setState（避免级联渲染）。
   */
  useEffect(() => {
    if (!linkedTarget) return
    if (linkedIsOnboardTarget) {
      onboardForm.setFieldsValue({ id: linkedTarget.id, agent_type: 'vmagent', remote_write_url: '', center_endpoint: '' })
      window.setTimeout(() => {
        document.getElementById('domain-table')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 200)
    } else if (linkedIsInstallGuideTarget) {
      window.setTimeout(() => {
        guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 200)
    }
    // 仅首次挂载时按 URL 参数定位一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <MainLayout>
      <Card title="网域纳管">
        {/* 决策 17 / {v1.53}：接入指引为页面顶部常驻提示区（通用操作流程）+ 一键复制安装命令（决策 75 配套）；
            仅在存在 channel=agent_pull 网域时展示（决策 31/32/33）——中心直连网域无采集节点安装环节 */}
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
            {guideCollapsed ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: CALLOUT_TONES.brand.bg,
                  border: `1px solid ${CALLOUT_TONES.brand.border}`,
                  borderRadius: 8,
                  padding: '8px 16px',
                  marginBottom: 12,
                }}
              >
                <InfoCircleFilled style={{ color: '#0ECDEB' }} />
                <Text style={{ fontSize: 13, color: '#4E5969' }}>
                  中心访问不到的网络：纳管网域 → 复制安装命令 → 在该网域一台常开机器上装采集节点。
                </Text>
                <Button
                  type="text"
                  size="small"
                  icon={<DownOutlined />}
                  onClick={expandGuide}
                  style={{ marginLeft: 'auto', color: '#1481FD' }}
                >
                  展开指引
                </Button>
              </div>
            ) : (
              <GuidePanel
                domains={installableDomains}
                focusDomainId={focusDomainId}
                onCollapse={collapseGuide}
              />
            )}
            <ReviewNote title="接入技术细节（面向产品 / 开发评审）" style={{ marginTop: 0 }}>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {edgeAgentInstallGuide.components.map((c) => (
                  <li key={c.name} style={{ marginBottom: 2 }}>
                    <Text strong>{c.name}</Text>（{c.required ? '必装' : '可选'}）：{c.role}
                  </li>
                ))}
              </ul>
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                <Text code>NETWORK_DOMAIN_ID</Text> 为对应网域 ID，与列表「网域」列 ID 行一致（复制前可据此核对）；
                <Text code>TOKEN</Text> 由纳管时自动签发，只能经行内凭据列的「复制」获取（PRD 规定的凭据获取方式）；
                本面板提供的是**不含凭据的命令模板**（页面展示一律掩码）。
                交付方式：{edgeAgentInstallGuide.delivery}；校验和算法：{edgeAgentInstallGuide.checksum_algorithm}；
                systemd 单元：{edgeAgentInstallGuide.systemd_unit}。
              </Text>
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                网闸 / 隔离约束（强制）：禁止中心 → 网域方向的主动连接，心跳 / 配置拉取 / 指标回传一律由采集节点单向出站发起；
                面向网域的中心地址为该网域视角的可达地址（网闸映射后地址）。配置包下载地址示例：{' '}
                {networkDomains
                  .filter((d) => d.channel === 'agent_pull' && d.center_endpoint)
                  .map((d) => `${d.id} → ${deriveConfigDownloadUrl(d)}`)
                  .join('；') || '（暂无已纳管的采集节点域）'}
              </Text>
            </ReviewNote>
          </div>
        )}
        <Table
          id="domain-table"
          dataSource={data}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          rowClassName={(record) => (record.id === focusDomainId ? 'row-linked' : '')}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: () => openDetail(record),
          })}
          columns={[
            {
              // 决策 36-1：网域名称 + 网域 ID 合并为单列；
              // {v1.53} 接入方式并入本列三合一——安装命令要用 NETWORK_DOMAIN_ID 填值，故 ID 需在列表内可核对；
              // {v1.55} 决策 71-1：两行各加「名称 / ID」行内标签——此前仅靠字号与颜色区分，
              //   评审反馈「分不清哪行是网域 ID、哪行是网域名称」（且 default 网域名称与 ID 恰好同字），改为显式标注。
              title: (
                <Tooltip title="第一行：网域名称；第二行：网域 ID（安装命令 NETWORK_DOMAIN_ID 取此值，可逐字符核对）">
                  <span>网域</span>
                </Tooltip>
              ),
              key: 'domain',
              width: 250,
              fixed: 'left',
              render: (_: unknown, record: NetworkDomain) => (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, lineHeight: '20px' }}>
                    <Text type="secondary" style={{ fontSize: 11, width: 26, flexShrink: 0 }}>名称</Text>
                    <span style={{ fontSize: 13 }}>{record.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <Text type="secondary" style={{ fontSize: 11, width: 26, flexShrink: 0 }}>ID</Text>
                    <Text
                      type="secondary"
                      style={{ fontSize: 12, lineHeight: '18px', fontFamily: 'SFMono-Regular, Consolas, monospace' }}
                    >
                      {record.id}
                    </Text>
                    <Tooltip title={domainTypeTip[record.domain_type]}>
                      <Tag
                        color={domainTypeColor[record.domain_type]}
                        style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: '16px', padding: '0 5px' }}
                      >
                        {domainTypeLabel[record.domain_type]}
                      </Tag>
                    </Tooltip>
                  </div>
                </div>
              ),
            },
            {
              // {v1.29} 网域生命周期：created = 已由 Module_06 行政创建；monitored = 已完成监控纳管
              title: '纳管状态',
              dataIndex: 'registration_status',
              key: 'registration_status',
              width: 130,
              render: (status: NetworkDomainRegistrationStatus) => {
                const cfg = registrationBadge[status]
                return (
                  <Tooltip title={cfg.tip}>
                    <Badge status={cfg.status} text={cfg.label} />
                  </Tooltip>
                )
              },
            },
            {
              // 决策 36-1：运行状态 = 状态 + 心跳合并，仅 agent_pull 展示，local 显示 '-'
              title: '运行状态',
              key: 'running_status',
              width: 180,
              render: (_: unknown, record: NetworkDomain) => {
                if (record.channel === 'agent_pull' && record.status) {
                  const cfg = statusBadge[record.status]
                  return (
                    <Space size={6}>
                      <Badge status={cfg.status} text={cfg.label} />
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
              // 决策 36-1：凭据列，仅 agent_pull 显示脱敏凭据 + 复制按钮，local 显示 '-'
              title: '凭据',
              key: 'credential',
              width: 110,
              render: (_: unknown, record: NetworkDomain) =>
                record.channel === 'agent_pull' && record.token ? (
                  <Space size={2}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{TOKEN_MASK}</Text>
                    <Tooltip title="复制凭据">
                      <Button
                        type="text"
                        size="small"
                        aria-label="复制凭据"
                        icon={<CopyOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCopyToken(record.token)
                        }}
                      />
                    </Tooltip>
                  </Space>
                ) : (
                  <Text type="secondary">-</Text>
                ),
            },
            {
              // {v1.36 操作列修正} 三槽位固定结构：主操作·详情·更多
              // 主操作：未纳管→纳管（文本链接），已纳管→编辑（文本链接）；详情常驻；更多仅 agent_pull 已纳管行显示重置凭据
              title: '操作',
              key: 'action',
              width: 230,
              fixed: 'right',
              render: (_: unknown, record: NetworkDomain) => {
                const hasMoreItems = record.channel === 'agent_pull' && record.registration_status === 'monitored'
                const isPrimaryOnboard = record.registration_status === 'created'
                return (
                  <Space size="small" onClick={(e) => e.stopPropagation()}>
                    {isPrimaryOnboard ? (
                      <Button
                        type="link"
                        size="small"
                        icon={<CloudUploadOutlined />}
                        style={{ paddingLeft: 0, fontWeight: 600 }}
                        onClick={() => handleMonitor(record)}
                      >
                        纳管
                      </Button>
                    ) : (
                      // {v1.69} 决策 70 遗留 #3 处置：已纳管行的主操作 = 编辑（本页主职责为监控参数维护），按 §8 主操作 600 字重与「纳管」对齐
                      <Button
                        type="link"
                        size="small"
                        icon={<EditOutlined />}
                        style={{ paddingLeft: 0, fontWeight: 600 }}
                        onClick={() => handleEdit(record)}
                      >
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
                              label: '重置凭据',
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
        {/* 字段语义为评审说明（含 Module_06 引用），移入 ReviewNote，由全局开关控制显隐 */}
        <ReviewNote title="字段语义说明（面向评审）" style={{ margin: '12px 0 0' }}>
          {'{v1.53} 列数治理：7 列 → 5 列（网域 / 纳管状态 / 运行状态 / 凭据 / 操作），符合《前端标准》§9.4 建议 ≤8 列。'}
          字段语义：网域列三合一（网域名称 + 网域 ID + 接入方式）——名称与 ID 为 Module_06「网域管理」创建的行政字段、本页不可修改；
          网域 ID 用等宽字体单独一行、且两行各带「名称 / ID」行内标签（决策 71-1），因为顶部安装命令模板要以 NETWORK_DOMAIN_ID 填值、需在列表内可核对；
          接入方式 = domain_type 的用户侧叫法（决策 74 / 79，管理域=中心直连域、边缘域=采集节点域），MVP 不可编辑，
          列表 / 详情抽屉 / 纳管与编辑表单三处共用同一份文案与配色；
          网络分区（zone_type，行政字段由 M06 登记、本页只读，可选）已从列表下沉至详情抽屉——M06「网域管理」已登记同名字段，列表不再重复占列；
          中心直连域（default）由中心直接采集，不签发凭据、无采集节点安装步骤，故运行状态与凭据显示「-」；
          采集节点域的凭据在纳管时自动签发，运行状态由采集节点心跳上报更新；
          安装指引为页面顶部常驻面板，含 PRD 规定的 3 步人工步骤（决策 71-3）与**不含真实值的安装命令模板**；
          模板不再按网域预填、也不提供网域选择框（决策 71：PRD 原文即规定「TOKEN 经网域行内复制按钮获取」，预填属原型自作主张）——
          用户复制模板后，从列表对应行补齐网域 ID 与凭据，一个模板适配任意网域、批量接入无需反复切换；
          纳管与编辑表单仅维护监控参数；操作列三槽位：主操作（纳管/编辑 随行状态变化）+ 详情（常驻）+ 更多（重置凭据，仅已纳管的采集节点域）；
          点击「详情」或行可查看网域配置字段（网络分区 / 中心接入地址 / Remote Write URL / 采集器类型）与「采集节点」运行摘要；
          组件明细与诊断不在本抽屉铺开（决策 72-1）——PRD §3.1 原文即规定「组件明细与诊断请查看『采集节点状态』页」，
          本抽屉原先铺开的组件卡片与采集节点状态页重复、且粒度更弱（配置同步缺分档与引导、最近错误直铺全文）；
          抽屉「采集节点」区块按三态给动线（决策 72-2）：未纳管仅陈述原因（主操作在列表行内「纳管」）、
          已纳管未上线给「查看本页安装指引」（页内定位并高亮该行）、已上线给跨页入口「查看采集节点状态」。
          新网域接入流程见页面顶部「网域接入指引」（纳管成功将自动展开并高亮该网域行，面板内提示「本次要接入」）。
          详情抽屉宽 720（决策 71-2），符合《前端标准》§8「结构化详情 → 右侧 Drawer ≥720px」。
        </ReviewNote>
      </Card>

      {/* 决策 36-1：右侧详情抽屉；{v1.55} 决策 71-2：宽 560 → 720，符合《前端标准》§8「结构化详情 → 右侧 Drawer ≥720px」（与 M06 / M07 一致） */}
      <Drawer
        title={drawerDomain ? `网域详情 - ${drawerDomain.name}` : '网域详情'}
        placement="right"
        width={720}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        {drawerDomain && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 24 }}>
              <Descriptions.Item label="网域名称">{drawerDomain.name}</Descriptions.Item>
              <Descriptions.Item label="网域 ID"><Text code>{drawerDomain.id}</Text></Descriptions.Item>
              <Descriptions.Item label="接入方式">
                <Tooltip title={domainTypeTip[drawerDomain.domain_type]}>
                  <Tag color={drawerDomain.domain_type === 'management' ? 'blue' : 'cyan'}>
                    {domainTypeLabel[drawerDomain.domain_type]}
                  </Tag>
                </Tooltip>
              </Descriptions.Item>
              <Descriptions.Item label="纳管状态">
                <Badge status={registrationBadge[drawerDomain.registration_status].status} text={registrationBadge[drawerDomain.registration_status].label} />
              </Descriptions.Item>
              <Descriptions.Item label="网络分区">
                {drawerDomain.zone_type ? (
                  <Tag color={zoneTypeColor[drawerDomain.zone_type] ?? 'default'}>{zoneTypeLabelOf(drawerDomain.zone_type)}</Tag>
                ) : (
                  <Text type="secondary">未登记（可选）</Text>
                )}
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
              <Descriptions.Item label="采集器类型">
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

            {/* {v1.56} 决策 72-1：本抽屉只承载「网域配置字段 + 网域粒度运行摘要」。
                组件档位（采集器 / 拨测器 / 配置同步分档 / 最近错误详情）与诊断归「采集节点状态」页
                ——PRD §3.1 原文：「组件明细与诊断请查看『采集节点状态』页」。
                原先在本抽屉铺开组件卡片，与采集节点状态页重复且粒度更弱（配置同步缺分档与引导按钮、
                最近错误直铺全文而非摘要 + Modal），用户会以为无事可做，故下沉为一行摘要 + 跨页入口。
                {v1.56} 决策 72-2：跨页入口按「纳管 → 上线」三态归位——
                  未纳管 created      → 仅陈述原因（签发凭据才可接入；主操作在列表行内「纳管」，抽屉不重复）
                  已纳管未上线        → 页内定位本页顶部安装指引（指引就在本页，给跨页按钮是动线绕远）
                  已纳管已上线        → 跨页到「采集节点状态」看组件明细与诊断
                原实现只判 monitored，导致「安装指引」按钮出现在已上线的网域上、而未纳管态的文案却写着
                「还没有上线的采集节点」（暗示去装机器，但此时尚无凭据、机器装不了）。 */}
            {(() => {
              const agents = edgeAgents.filter((a) => a.network_domain_id === drawerDomain.id)
              const onlineCount = agents.filter((a) => a.status === 'online').length
              const abnormalCount = agents.length - onlineCount
              return (
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 8 }}>采集节点</Text>
                  {drawerDomain.channel === 'local' ? (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      中心直连域由中心直接采集，不部署采集节点、无接入步骤。
                    </Text>
                  ) : drawerDomain.registration_status === 'created' ? (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      尚未纳管——纳管签发凭据后，才能把安装命令复制到该网域内的机器接入采集节点。
                    </Text>
                  ) : agents.length === 0 ? (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 13 }}>
                        该网域已纳管，但还没有采集节点上线。按页面顶部「网域接入指引」复制安装命令，到该网域内的机器执行。
                      </Text>
                      <Button
                        icon={<LinkOutlined />}
                        onClick={() => {
                          setFocusDomainId(drawerDomain.id)
                          setIsDrawerOpen(false)
                          window.setTimeout(() => guideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200)
                        }}
                      >
                        查看本页安装指引
                      </Button>
                    </Space>
                  ) : (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Text style={{ fontSize: 13 }}>
                        该网域有 <Text strong>{agents.length}</Text> 个采集节点：
                        <Text style={{ color: '#00B578' }}>{onlineCount} 在线</Text>
                        {abnormalCount > 0 && (
                          <>
                            、<Text style={{ color: '#FF4C3A' }}>{abnormalCount} 异常</Text>
                          </>
                        )}
                        {drawerDomain.last_heartbeat && (
                          <Text type="secondary">（最近心跳 {formatRelativeTime(drawerDomain.last_heartbeat)}）</Text>
                        )}
                      </Text>
                      <Button
                        icon={<LinkOutlined />}
                        onClick={() => {
                          setIsDrawerOpen(false)
                          navigate(`/node-status?network_domain=${drawerDomain.id}`)
                        }}
                      >
                        查看采集节点状态
                      </Button>
                    </Space>
                  )}
                </div>
              )
            })()}
          </>
        )}
      </Drawer>

      {/* {v1.29}/{v1.35}/{v1.53} 纳管抽屉：仅通过行内「纳管」按钮触发，自动预选当前行网域；
          表单含「网域信息 / 监控参数 / 后续动作」三组，按《前端标准》§8「需分组 → Drawer 内表单」 */}
      <Drawer
        title="纳管网域（监控接入）"
        placement="right"
        width={720}
        open={isOnboardOpen}
        onClose={() => setIsOnboardOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setIsOnboardOpen(false)}>取消</Button>
            <Button type="primary" onClick={() => onboardForm.submit()}>
              确认纳管
            </Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 16 }}>
          网域的登记与授权由「网域管理」负责；此处只配置监控接入参数。确认纳管后平台自动签发凭据并推导回传地址，
          接着复制安装命令到该网域内的机器即可。
        </Text>
        <Form form={onboardForm} layout="vertical" onFinish={submitOnboard}>
          <FormSection title="网域信息" description="来自「网域管理」，此处只读">
            <Form.Item label="目标网域">
              <Input value={onboardTarget ? `${onboardTarget.name}（${onboardTarget.id}，租户：${onboardTarget.tenant_id}）` : ''} disabled />
            </Form.Item>
            <Form.Item label="接入方式">
              <Tooltip title={domainTypeTip['edge']}>
                <Tag color={domainTypeColor['edge']}>{domainTypeLabel['edge']}</Tag>
              </Tooltip>
              <div style={{ fontSize: 12, color: '#86909C', lineHeight: '18px', marginTop: 4 }}>
                非 default 网域固定由该网域内的采集节点回传数据（技术枚举 agent_pull）；
                「中心直连域 ↔ 采集节点域」的切换属 v0.4+ 演化场景，MVP 不提供。
              </div>
            </Form.Item>
          </FormSection>

          <FormSection title="监控参数" description="MVP 仅需填写中心接入地址，其余可留空由平台推导">
            {/* 决策 12/16：采集器类型下拉保留，但 MVP 阶段固定 vmagent（PRD：纳管时无需选择） */}
            <Form.Item name="agent_type" label="采集器类型" initialValue="vmagent" extra="MVP 阶段固定 VMAgent（纳管时无需选择）；Prometheus Agent v0.2+ 开放为可选">
              <Select options={[{ value: 'vmagent', label: 'VMAgent' }]} disabled />
            </Form.Item>
            {/* 决策 14：Remote Write URL 默认由平台自动推导（中心 ingress + 网域路径），留空自动生成，可手动覆盖 */}
            {/* {v1.69} 决策 73-2：两地址 extra 重写为方向性指引（节点 → 中心；直连填中心 / 转发填转发侧 / 回传可推导），替换原「术语复读」文案 */}
            <Form.Item name="remote_write_url" label="Remote Write URL" extra="采集节点回传指标数据的地址，通常 = 中心接入地址 + /api/v1/write：留空由平台按中心接入地址自动推导；若数据面与管理面走不同代理 / 网闸映射，需手动填写。">
              <Input placeholder="留空则自动生成，例如 https://metriccenter.example.com/api/v2/ingest/<domain-id>/prometheus" />
            </Form.Item>
            {/* {v1.31} 中心接入地址：该网域视角的中心可达地址（网闸映射后地址），采集节点域纳管必填 */}
            <Form.Item
              name="center_endpoint"
              label="中心接入地址"
              rules={[{ required: true, message: '采集节点域纳管必填：填写该网域访问监控中心的地址' }]}
              extra="采集节点所在网络访问监控中心用的地址：机器能直连中心就填中心地址；需经 nginx / 网闸转发就填转发侧地址（如 https://10.8.0.5:8443），由转发方把流量送达中心。平台会用它合成配置包下载地址下发给采集节点。"
            >
              <Input placeholder="https://<center-address>:<port>" />
            </Form.Item>
          </FormSection>

          <FormSection title="纳管后" description="平台自动完成，无需手工操作">
            <Callout tone="success" icon={<InfoCircleFilled />} title="确认纳管后会发生什么">
              ① 平台签发该网域专属凭据；② 页面顶部「网域接入指引」自动展开并选中本网域，直接复制安装命令；
              ③ 采集节点在该网域机器上启动后自动上线，主机信息与心跳状态自动补全。
            </Callout>
          </FormSection>
        </Form>
      </Drawer>

      {/* {v1.53} 编辑抽屉：行政字段只读展示，仅维护监控参数（PRD 3.1 网域编辑）；字段较多按 §8 用 Drawer + 分组 */}
      <Drawer
        title="编辑网域（监控参数）"
        placement="right"
        width={720}
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        extra={
          <Space>
            <Button onClick={() => setIsEditOpen(false)}>取消</Button>
            <Button type="primary" onClick={() => form.submit()}>
              保存
            </Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 16 }}>
          网域名称 / 所属租户 / 接入方式为「网域管理」维护的字段，此处只读；本表单仅维护描述与监控参数。
        </Text>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <FormSection title="网域信息" description="来自「网域管理」，只读">
            <Form.Item label="网域名称">
              <Input value={editingDomain?.name} disabled />
            </Form.Item>
            <Form.Item label="所属租户">
              <Input value={editingDomain?.tenant_id} disabled />
            </Form.Item>
            <Form.Item label="网络分区">
              <Input value={editingDomain?.zone_type ? zoneTypeLabelOf(editingDomain.zone_type) : '未登记（可选）'} disabled />
            </Form.Item>
            <Form.Item label="接入方式">
              {editingDomain && (
                <Tooltip title={domainTypeTip[editingDomain.domain_type]}>
                  <Tag color={domainTypeColor[editingDomain.domain_type]}>{domainTypeLabel[editingDomain.domain_type]}</Tag>
                </Tooltip>
              )}
              <div style={{ fontSize: 12, color: '#86909C', lineHeight: '18px', marginTop: 4 }}>
                MVP 按网域固定（default = 中心直连域，其他 = 采集节点域），不可编辑；切换能力属 v0.4+ 演化场景。
              </div>
            </Form.Item>
          </FormSection>

          <FormSection title="监控参数">
            <Form.Item name="description" label="描述">
              <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征" />
            </Form.Item>
            {editingDomain?.channel === 'local' && (
              <Callout tone="info" icon={<InfoCircleFilled />} title="中心直连网域无可编辑的接入参数">
                该网域由中心直接采集，不签发凭据、无回传地址、无采集节点心跳。
              </Callout>
            )}
            {editingDomain && editingDomain.channel === 'agent_pull' && (
              <>
                {/* {v1.29} 编辑时可切换纳管状态，用于演示取消纳管 / 重新纳管 */}
                <Form.Item name="registration_status" label="纳管状态" extra="切换为「已创建未纳管」即取消纳管：清空凭据 / 回传地址 / 中心接入地址，网域退出监控上下文">
                  <Select
                    options={[
                      { value: 'created', label: '已创建未纳管' },
                      { value: 'monitored', label: '已纳管' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="agent_type" label="采集器类型" extra="MVP 阶段固定 VMAgent；Prometheus Agent 枚举保留、v0.2+ 开放">
                  <Select
                    options={[
                      { value: 'vmagent', label: 'VMAgent' },
                      { value: 'prometheus-agent', label: 'Prometheus Agent（v0.2+ 开放）' },
                    ]}
                  />
                </Form.Item>
                {/* {v1.69} 决策 73-2：编辑表单两地址与纳管表单同款方向性指引 */}
                <Form.Item name="remote_write_url" label="Remote Write URL" extra="采集节点回传指标数据的地址，通常可由中心接入地址自动推导；数据面与管理面走不同代理 / 网闸映射时需手动填写。">
                  <Input placeholder="留空则按中心接入地址自动推导（该网域视角的可达地址）" />
                </Form.Item>
                {/* {v1.31} 中心接入地址为监控纳管字段，纳管后可修改（网闸策略调整时） */}
                <Form.Item
                  name="center_endpoint"
                  label="中心接入地址"
                  extra="采集节点所在网络访问监控中心用的地址：直连填中心地址，经 nginx / 网闸转发填转发侧地址；用于合成配置包下载地址下发给采集节点。"
                >
                  <Input placeholder="https://<center-address>:<port>" />
                </Form.Item>
              </>
            )}
          </FormSection>
        </Form>
      </Drawer>
    </MainLayout>
  )
}

export default NetworkDomainsPage
