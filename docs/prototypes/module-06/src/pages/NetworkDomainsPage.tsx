import { Fragment, useMemo, useState, type ReactNode } from 'react'
import {
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  BookOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownOutlined,
  EditOutlined,
  InfoCircleFilled,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  StopOutlined,
  UpOutlined,
} from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { TABLE_SCROLL_X, TABLE_PAGINATION } from '../components/tablePresets'
import {
  mockNetworkDomains,
  mockTenants,
  ZONE_TYPE_OPTIONS,
  zoneTypeLabelOf,
  ZONE_TYPE_FIELD_HINT,
  IP_CIDR_HINT,
  ACCESS_STEP_LABELS,
  accessStepOf,
  type NetworkDomain,
  type AccessStep,
} from '../mocks/module-06'

const { Title, Text } = Typography
const { Option } = Select

/** 页首「什么是网域」引导条收起状态（PRD §11.2：可关闭并记住，决策 79 / v2.14 收起式） */
const GUIDE_COLLAPSED_KEY = 'm06-network-domain-guide-collapsed'

/** 接入进度四态的语义色（点阵 + 文字，颜色不作唯一语义承载） */
const ACCESS_STEP_COLORS: Record<AccessStep, string> = {
  1: '#86909C',
  2: '#1481FD',
  3: '#FA8C16',
  4: '#00B578',
}

/** 接入进度四态的下一步动作（仅用于悬浮说明；行内按钮文案见 ACTION_LABEL） */
const ACCESS_STEP_HINT: Record<AccessStep, string> = {
  1: '下一步：去纳管获取接入凭据',
  2: '下一步：在该网域一台常开机器上安装采集节点',
  3: '下一步：为该网域资源配置采集任务',
  4: '已接入：该网域已有生效的采集目标',
}

/** v2.14：接入进度与行内主操作一一对应——主操作不再是旁注灰字，而是唯一主按钮 */
const ACTION_LABEL: Record<AccessStep, string> = {
  1: '去纳管',
  2: '安装采集节点',
  3: '去配置采集',
  4: '查看采集任务',
}

interface CalloutToneStyle {
  bg: string
  border: string
  color: string
}

/** 统一提示条配色（身份说明 / 硬劝阻 / 视觉语言一致，避免 Alert + Collapse 样式拼盘） */
const CALLOUT_TONES: Record<'brand' | 'info' | 'warning' | 'success', CalloutToneStyle> = {
  brand: { bg: '#F0FBFD', border: '#BFF4FB', color: '#0ECDEB' },
  info: { bg: '#F2F7FF', border: '#BEDAFF', color: '#1481FD' },
  warning: { bg: '#FFF8EE', border: '#FFD8A8', color: '#FA8C16' },
  success: { bg: '#F0FBF7', border: '#A8E6CE', color: '#00B578' },
}

type CalloutTone = keyof typeof CALLOUT_TONES

/**
 * v2.14：统一提示容器（替代散落的 Alert / Collapse 组合）。
 * 结构固定为「图标 + 标题 + 可选操作 + 正文」，全页同款圆角 / 边框 / 内边距。
 */
function Callout({
  tone = 'info',
  icon,
  title,
  extra,
  children,
}: {
  tone?: CalloutTone
  icon?: ReactNode
  title: ReactNode
  extra?: ReactNode
  children?: ReactNode
}) {
  const t = CALLOUT_TONES[tone]
  return (
    <div
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: t.color, fontSize: 15, display: 'inline-flex' }}>{icon}</span>
        <Text strong style={{ fontSize: 13, flex: 1 }}>
          {title}
        </Text>
        {extra}
      </div>
      {children && (
        <div style={{ marginTop: 6, paddingLeft: 23, fontSize: 12.5, color: '#4E5969', lineHeight: 1.75 }}>
          {children}
        </div>
      )}
    </div>
  )
}

/** 表单分组标题（左侧品牌色竖条 + 标题 + 说明），保证抽屉内长表单的层次一致 */
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
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 14px' }}>
        <span
          style={{ width: 3, height: 13, background: '#0ECDEB', borderRadius: 2, transform: 'translateY(1px)' }}
        />
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

/** 「什么是网域」详解（抽屉内展开阅读；页首引导条以双路由卡承载同一信息） */
function DomainConceptDetail() {
  return (
    <div style={{ paddingLeft: 23, marginTop: 8 }}>
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #E5E6EB',
          borderRadius: 6,
          padding: '10px 12px',
          fontFamily: 'SFMono-Regular, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.9,
          color: '#4E5969',
        }}
      >
        <div>中心直连域（default） ◀──直连采集── 平台中心 ──▶ 指标直达</div>
        <div>采集节点域 ◀──采集── 采集节点 ──单向出站 HTTPS──▶ 平台中心</div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12.5, color: '#86909C', lineHeight: 1.75 }}>
        登记网域本身不采集数据——它只声明两件事：这批机器由<b>哪个采集节点</b>去采；采回的数据打上
        <b>来源区域标签</b>，便于按区域筛选与定位故障。
      </div>
    </div>
  )
}

/**
 * {v2.14} 页首引导条：单块扁平容器（替代 v2.13 的 Alert + Collapse 三段嵌套）。
 * 一句话定义 + 两条路由卡（能直连 / 够不到）+ 接入四步，信息一次给全、无需层层点开；
 * 「收起」后收敛为一行，状态记 localStorage（PRD §11.2 可关闭并记住）。
 */
function DomainGuidePanel({ onCollapse }: { onCollapse: () => void }) {
  return (
    <div
      style={{
        background: CALLOUT_TONES.brand.bg,
        border: `1px solid ${CALLOUT_TONES.brand.border}`,
        borderRadius: 8,
        padding: '14px 16px',
        marginBottom: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <InfoCircleFilled style={{ color: '#0ECDEB', fontSize: 16, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 13 }}>
            什么是网域？
          </Text>
          <div style={{ marginTop: 5, fontSize: 13, color: '#4E5969', lineHeight: 1.7 }}>
            网域 = 一组<b>网络互通</b>的机器的集合。平台中心<b>能不能直接访问</b>它们，决定要不要建网域：
          </div>
        </div>
        <Button type="text" size="small" icon={<UpOutlined />} onClick={onCollapse}>
          收起
        </Button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 12,
          marginTop: 14,
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E6EB',
            borderLeft: `3px solid ${CALLOUT_TONES.success.color}`,
            borderRadius: 6,
            padding: '10px 12px',
          }}
        >
          <Space size={6}>
            <CheckCircleOutlined style={{ color: CALLOUT_TONES.success.color }} />
            <Text strong style={{ fontSize: 13 }}>
              中心能直接访问
            </Text>
            <Tag color={CALLOUT_TONES.success.color} style={{ marginInlineStart: 2 }}>
              无需建网域
            </Tag>
          </Space>
          <div style={{ marginTop: 6, fontSize: 12, color: '#4E5969', lineHeight: 1.7 }}>
            机器统一纳入「中心直连域（default）」，由中心直接采集，无需登记。
          </div>
        </div>
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E5E6EB',
            borderLeft: `3px solid ${CALLOUT_TONES.warning.color}`,
            borderRadius: 6,
            padding: '10px 12px',
          }}
        >
          <Space size={6}>
            <DisconnectOutlined style={{ color: CALLOUT_TONES.warning.color }} />
            <Text strong style={{ fontSize: 13 }}>
              中心访问不到
            </Text>
            <Tag color={CALLOUT_TONES.warning.color} style={{ marginInlineStart: 2 }}>
              登记网域 + 装采集节点
            </Tag>
          </Space>
          <div style={{ marginTop: 6, fontSize: 12, color: '#4E5969', lineHeight: 1.7 }}>
            在该网域一台常开机器上装采集节点回传数据。
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${CALLOUT_TONES.brand.border}` }}>
        <Space size={6} wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>
            接入四步
          </Text>
          {['① 登记网域', '② 纳管取凭据', '③ 安装采集节点', '④ 配置采集出数据'].map((label, idx) => (
            <Fragment key={label}>
              {idx > 0 && <RightOutlined style={{ fontSize: 10, color: '#C9CDD4' }} />}
              <Tag style={{ background: '#FFFFFF', marginInlineEnd: 0 }}>{label}</Tag>
            </Fragment>
          ))}
        </Space>
        <div style={{ marginTop: 8, fontSize: 12, color: '#86909C' }}>
          列表「接入进度」列的四态与上面四步一一对应；行内主操作始终指向当前这一步。登记网域本身不采集数据。
        </div>
      </div>
    </div>
  )
}

/**
 * {v2.14} 前置判断选择卡（替代裸 Radio）：
 * 场景说明直接写在卡片里，避免把「专网 / DMZ / VPC」这类术语塞进单选项标签；
 * 卡片下方统一给出判断口径（含「VPC 已打通 → 属能直连」的澄清）。
 */
function CenterDirectChoice({
  value,
  onChange,
}: {
  value?: 'yes' | 'no'
  onChange?: (v: 'yes' | 'no') => void
}) {
  const options: Array<{
    v: 'yes' | 'no'
    title: string
    desc: string
    tone: 'success' | 'warning'
    icon: ReactNode
  }> = [
    {
      v: 'yes',
      title: '中心能直接访问',
      desc: '机器由平台中心直接采集，统一纳入中心直连域（default）。',
      tone: 'success',
      icon: <CheckCircleOutlined />,
    },
    {
      v: 'no',
      title: '中心访问不到',
      desc: '中心无法直接连通该网络，需在其中一台常开机器上安装采集节点回传数据。',
      tone: 'warning',
      icon: <DisconnectOutlined />,
    },
  ]

  return (
    <div
      role="radiogroup"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}
    >
      {options.map((o) => {
        const t = CALLOUT_TONES[o.tone]
        const active = value === o.v
        return (
          <div
            key={o.v}
            role="radio"
            aria-checked={active}
            tabIndex={0}
            onClick={() => onChange?.(o.v)}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                onChange?.(o.v)
              }
            }}
            style={{
              cursor: 'pointer',
              borderRadius: 6,
              padding: '12px 14px',
              border: `1px solid ${active ? t.color : '#E5E6EB'}`,
              background: active ? t.bg : '#FFFFFF',
              boxShadow: active ? `0 0 0 2px ${t.border}` : 'none',
              transition: 'all 0.2s',
            }}
          >
            <Space size={8}>
              <span style={{ color: active ? t.color : '#86909C', fontSize: 16, display: 'inline-flex' }}>
                {o.icon}
              </span>
              <Text strong style={{ fontSize: 13 }}>
                {o.title}
              </Text>
              {active && (
                <Tag color={t.color} style={{ marginInlineStart: 2 }}>
                  已选择
                </Tag>
              )}
            </Space>
            <div style={{ marginTop: 6, fontSize: 12, color: '#4E5969', lineHeight: 1.7 }}>{o.desc}</div>
          </div>
        )
      })}
    </div>
  )
}

/** 前置判断口径说明（专业口径：区分「中心可达性」与「人工运维可达性」，并澄清已打通的云网络） */
function CenterDirectRationale() {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '9px 12px',
        background: '#F7F8FA',
        borderRadius: 6,
        fontSize: 12,
        color: '#86909C',
        lineHeight: 1.8,
      }}
    >
      <div>
        <b style={{ color: '#4E5969' }}>判断口径</b>：以「平台中心能否直接连通目标机器」为准，与你本人能否登录运维无关。
      </div>
      <div>
        云上 VPC 若已通过 <b>VPC 对等连接 / 云企业网（CEN）/ 专线或 VPN</b> 与中心网络打通，中心可直连 →
        属于「能直接访问」，无需登记网域。
      </div>
      <div>
        典型需要登记：独立 K8s overlay 集群（Pod 网络不可直连）、物理或逻辑隔离网段、第三方托管但未向中心开放入站的网络。
      </div>
    </div>
  )
}

/** 接入进度：四态点阵 + 当前态文字（悬浮展开四步明细），替代「Tag + 灰字下一步」双行堆叠 */
function AccessProgress({ record }: { record: NetworkDomain }) {
  const step = accessStepOf(record)
  const color = ACCESS_STEP_COLORS[step]
  return (
    <Tooltip
      title={
        <div style={{ lineHeight: 1.9 }}>
          {Object.keys(ACCESS_STEP_LABELS).map((k) => {
            const i = Number(k) as AccessStep
            return (
              <div key={k}>
                {i === step ? '▶ ' : '　'}
                {ACCESS_STEP_LABELS[i]}
                {i === step && <span style={{ opacity: 0.75 }}>（当前）</span>}
              </div>
            )
          })}
          <div style={{ marginTop: 4, opacity: 0.75 }}>{ACCESS_STEP_HINT[step]}</div>
        </div>
      }
    >
      <Space size={8} style={{ cursor: 'default' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {([1, 2, 3, 4] as AccessStep[]).map((i) => (
            <Fragment key={i}>
              {i > 1 && (
                <span
                  style={{
                    width: 12,
                    height: 1,
                    background: i <= step ? color : '#E5E6EB',
                    display: 'inline-block',
                  }}
                />
              )}
              <span
                style={{
                  width: i === step ? 9 : 7,
                  height: i === step ? 9 : 7,
                  borderRadius: '50%',
                  background: i <= step ? color : '#FFFFFF',
                  border: `1px solid ${i <= step ? color : '#C9CDD4'}`,
                  boxShadow: i === step ? `0 0 0 3px ${color}22` : 'none',
                  display: 'inline-block',
                }}
              />
            </Fragment>
          ))}
        </span>
        <Text style={{ fontSize: 12.5, color, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {ACCESS_STEP_LABELS[step]}
        </Text>
      </Space>
    </Tooltip>
  )
}

/**
 * {v2.0} M06 为 NetworkDomain 的行政 Owner（PRD v2.0，决策 18~20）：
 * 网域为部署级资源、可跨租户共享：登记归属（tenant_id）固定 platform_admin（登记 ≠ 独占），
 * 通过授权租户（authorized_tenant_ids）授权多个租户共享使用（授权 ≠ 拥有）。
 * 表单只维护行政信息（名称 / 登记归属 / 授权租户 / 状态 / 网络分区），不维护监控参数；
 * 监控纳管（Token / Remote Write / 采集节点）由 Module_09 执行。
 * {v1.4} 新增 zone_type（网络分区，部署级字典下拉）；网域定义为全平台唯一入口（下游只引用 network_domain_id）。
 * {v2.0} ID 按部署级前缀自动生成（nd-<名称>）；新建校验：被授权租户未开启多网域能力（multi_site_enabled=false）时仅可被授权单个网域。
 * {v2.2} PRD v2.2（决策 23）补漏：
 * - 登记归属（tenant_id）创建后不可变更（编辑表单不含该字段）；授权租户可选，缺省 = 登记归属租户（新建默认回填 platform_admin）；
 * - 禁用 = 冻结：禁用二次确认展示影响范围（资源引用数 / 已纳管采集节点数），禁用后拒绝新登记与新纳管、存量不受影响；
 * - 空网域（未纳管、无资源引用）可删除（软删）、中心直连域不可删除（**删除条件已被 v2.15 决策 82-1 修正，见下**）。
 * {v2.11} 决策 73~77 落版：页首概念卡 + 空态提问式引导 + 新建前置判断 + 登记成功行动卡 + 接入进度四态列 + 术语降噪。
 * {v2.13} 决策 79 落版：前置判断「能」改硬劝阻终点；术语再修订（中心直连域 / 采集节点域）；引导信息按时机归位。
 * {v2.14} 前端设计优化（chenrt 走查 v2.13 原型后返工，对齐《前端标准》§8/§9）：
 * - 页首「Alert + Collapse」三段嵌套 → 单块扁平引导条（双路由卡 + 接入四步；收起记 localStorage）；
 * - 登记/编辑表单 Modal → Drawer（字段 >6 须用抽屉，§8 交互选型表）；分组标题统一为 FormSection；
 * - 前置判断裸 Radio → 双选择卡（场景说明入卡内），并补「判断口径」澄清（VPC 对等连接 / 云企业网打通后属可直连）；
 * - 抽屉内身份说明与「什么是网域？」统一为同一 Callout 容器（消除两种样式拼盘）；
 * - 列表列数 11 → 8（§9 列数治理），网域 ID / 授权租户明细 / 网段 / 描述 / 创建更新时间下沉详情 Drawer；
 * - 接入进度列移除「下一步」灰字旁注，四态由点阵承载；下一步动作与操作列主按钮合并（一一对应、唯一主按钮）；
 * - 状态列改 Badge；启用/禁用与删除收进「更多」菜单（系统预置 / 已纳管场景给出禁用原因文案）。
 * {v2.15} 决策 82 落版（网域生命周期闭环——回收路径修正 + 禁用/纳管联动具象化）：
 * - 删除约束修正（82-1）：硬拒绝条件收敛为「存在 Module_07 资源引用」单一条件；已纳管网域删除入口**保持可用**，
 *   二次确认展示级联影响清单（1 个采集节点将断连 / 凭据将废止 / 节点侧无需线下操作、心跳鉴权失败后自动离线），
 *   确认后 M06 软删 + M09 级联清退纳管状态；空网域走常规二次确认；管理域不提供删除；
 * - 禁用弹窗补强（82-2）：已纳管且存在在线 Agent 时追加固定提示（行政冻结 ≠ 停采 + 引导改用「删除」/ v0.2+「退纳管」）；
 * - 「更多」菜单不可操作原因修正：已纳管不再是拒绝理由，仅剩「系统预置网域」与「存在资源引用（N 条）」；
 * - 三动作语义边界（82-4）：禁用 = 行政冻结 / 退纳管 = 停止监控（v0.2+）/ 删除 = 退场回收，三者正交不可互替。
 */
export function NetworkDomainsPage() {
  const [domains, setDomains] = useState<NetworkDomain[]>(mockNetworkDomains)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  const [form] = Form.useForm()
  // {v2.11} 登记成功行动卡（决策 75）：新建成功后展示，替代一次性 toast
  const [successDomain, setSuccessDomain] = useState<NetworkDomain | null>(null)
  // {v2.14} 详情抽屉（§9 列数治理：下沉字段放此处）
  const [detailDomain, setDetailDomain] = useState<NetworkDomain | null>(null)
  // {v2.14} 抽屉内「什么是网域」详解展开态
  const [showConceptInDrawer, setShowConceptInDrawer] = useState(false)
  // {v2.11} 列表筛选（PRD §11.1：网域管理支持按登记归属/网络分区/状态/授权租户筛选）
  const [filterOwner, setFilterOwner] = useState('all')
  const [filterZoneType, setFilterZoneType] = useState('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'disabled'>('all')
  const [filterAuthorizedTenant, setFilterAuthorizedTenant] = useState('all')
  // {v2.11/v2.14} 页首引导条收起（可关闭并记住 localStorage）
  const [guideCollapsed, setGuideCollapsed] = useState(
    () => localStorage.getItem(GUIDE_COLLAPSED_KEY) === '1'
  )

  const filteredDomains = useMemo(() => {
    return domains.filter((d) => {
      if (filterOwner !== 'all' && d.tenant_id !== filterOwner) return false
      if (filterZoneType !== 'all' && d.zone_type !== filterZoneType) return false
      if (filterStatus !== 'all' && d.status !== filterStatus) return false
      if (filterAuthorizedTenant !== 'all' && !(d.authorized_tenant_ids ?? []).includes(filterAuthorizedTenant))
        return false
      return true
    })
  }, [domains, filterOwner, filterZoneType, filterStatus, filterAuthorizedTenant])

  const tenantNameOf = (tenantId: string) =>
    mockTenants.find((t) => t.id === tenantId)?.name ?? tenantId

  const watchedName = Form.useWatch('name', form) as string | undefined
  // {v2.11} 新建表单第一问（决策 75）：中心能否直连——能 → 硬劝阻；不能 → 展开登记字段
  const watchedCenterDirect = Form.useWatch('center_direct', form) as 'yes' | 'no' | undefined

  /** PRD：network_domain_id 全局唯一，按 <deploy_code>-<domain_code> 自动生成（deploy_code 默认 mc）；default 中心直连域为历史预置、无前缀 */
  const suggestedId = (() => {
    if (editingDomain) return editingDomain.id
    const nameSlug = (watchedName ?? '').trim().toLowerCase().replace(/\s+/g, '-')
    if (!nameSlug) return ''
    return `mc-${nameSlug}`
  })()

  /** {v2.13} 决策 79：新建时未选择「访问不到」不提供提交路径——硬劝阻终点 */
  const canSubmit = editingDomain ? true : watchedCenterDirect === 'no'

  const collapseGuide = () => {
    setGuideCollapsed(true)
    localStorage.setItem(GUIDE_COLLAPSED_KEY, '1')
  }

  const expandGuide = () => {
    setGuideCollapsed(false)
    localStorage.removeItem(GUIDE_COLLAPSED_KEY)
  }

  const closeForm = () => setIsFormOpen(false)

  const showAdd = () => {
    setEditingDomain(null)
    setShowConceptInDrawer(false)
    form.resetFields()
    // {v2.0} 登记归属为部署级登记方（MVP 固定 platform_admin），新建时默认填充
    // {v2.2} 授权租户可选，缺省 = 登记归属租户（默认回填 platform_admin）
    form.setFieldsValue({ tenant_id: 't-platform', authorized_tenant_ids: ['t-platform'], status: 'active' })
    setIsFormOpen(true)
  }

  const showEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    setShowConceptInDrawer(false)
    // {v2.2} 登记归属创建后不可变更，编辑表单不含 tenant_id
    form.resetFields()
    const { tenant_id, ...editableFields } = record
    void tenant_id
    form.setFieldsValue(editableFields)
    setIsFormOpen(true)
  }

  const handleSave = (values: Partial<NetworkDomain>) => {
    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    // {v2.2} 授权租户可选，缺省 = 登记归属租户（platform_admin）
    const selectedTenantIds = (values.authorized_tenant_ids ?? []).length
      ? (values.authorized_tenant_ids as string[])
      : ['t-platform']
    const violatedTenant = mockTenants.find((t) => {
      if (!selectedTenantIds.includes(t.id) || t.multi_site_enabled) return false
      const otherAuthorizedCount = domains.filter(
        (d) => d.id !== editingDomain?.id && (d.authorized_tenant_ids ?? []).includes(t.id)
      ).length
      return otherAuthorizedCount >= 1
    })
    if (violatedTenant) {
      message.error(
        `租户「${violatedTenant.name}」未开启多网域能力，仅可被授权单个网域（通常为 default）`
      )
      return
    }
    if (editingDomain) {
      setDomains((prev) =>
        prev.map((item) =>
          item.id === editingDomain.id
            ? {
                ...item,
                ...values,
                // 登记归属（id / 登记方）创建后不可变更；授权租户可编辑
                id: item.id,
                tenant_id: item.tenant_id,
                updated_at: now,
              }
            : item
        )
      )
      message.success('网域行政信息已更新')
      setIsFormOpen(false)
    } else {
      const id = suggestedId || `mc-${Date.now()}`
      if (domains.some((d) => d.id === id)) {
        message.error(`网域 ID「${id}」已存在：network_domain_id 必须全局唯一`)
        return
      }
      const newDomain: NetworkDomain = {
        id,
        name: values.name || '',
        description: values.description || '',
        domain_type: 'edge',
        tenant_id: values.tenant_id || 't-platform',
        authorized_tenant_ids: selectedTenantIds,
        status: values.status || 'active',
        zone_type: values.zone_type || '',
        // {v2.5} 网段（CIDR）可留空；非空时用于 M07 资源导入/同步按 IP 推导网域归属（归属解析链第③级）
        ip_cidrs: values.ip_cidrs ?? [],
        // 新建网域仅完成行政登记，监控纳管由 Module_09 执行
        registration_status: 'created',
        created_at: now,
        updated_at: now,
      }
      setDomains((prev) => [...prev, newDomain])
      // {v2.11} 决策 75：创建成功由 toast 升级为结果行动卡（3 步预告 + 直达纳管）
      setIsFormOpen(false)
      setSuccessDomain(newDomain)
    }
  }

  const toggleStatus = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('系统预置的中心直连域（default）禁止禁用')
      return
    }
    const nextStatus = record.status === 'active' ? 'disabled' : 'active'
    const refCount = record.resource_ref_count ?? 0
    const isMonitored = record.registration_status === 'monitored'
    // {v2.15} 决策 82-2 弹窗补强：已纳管且存在在线 Agent 时追加固定提示（行政冻结 ≠ 停采）
    const showFreezeNote = isMonitored && !!record.agent_online
    // {v2.2/v2.15} 禁用 = 冻结：二次确认展示影响范围（资源引用数 / 已纳管采集节点数），结构化排版便于扫读
    Modal.confirm({
      title: nextStatus === 'disabled' ? '禁用网域' : '启用网域',
      width: 560,
      content:
        nextStatus === 'disabled' ? (
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            <div style={{ marginBottom: 8 }}>
              影响范围：M07 资源引用 <Text strong>{refCount}</Text> 条、已纳管采集节点{' '}
              <Text strong>{isMonitored ? 1 : 0}</Text> 个{isMonitored ? '' : '（空网域，可直接删除）'}。
            </div>
            <div style={{ marginBottom: showFreezeNote ? 10 : 12 }}>
              禁用后该网域不再接受新资源登记与新纳管；
              <Text strong>存量资源与采集配置不受影响、继续采集</Text>
              （停止采集由 Module_09 退纳管决定）。同时联动 Module_01（该网域禁止新建监控任务）与 Module_09
              （不再生成新变更单，存量下发与回滚不受影响）。
            </div>
            {showFreezeNote && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '8px 12px',
                  background: CALLOUT_TONES.warning.bg,
                  border: `1px solid ${CALLOUT_TONES.warning.border}`,
                  borderRadius: 8,
                }}
              >
                <Text strong style={{ color: CALLOUT_TONES.warning.color }}>
                  【重要】禁用为行政冻结
                </Text>
                ：新资源登记与新纳管将被阻止，但
                <Text strong>已接入的采集节点不会自动停止采集</Text>
                。如需停止采集并回收网域，请使用「删除」（级联清退）；如需保留网域、仅停止采集，v0.2+ 提供「退纳管」。
              </div>
            )}
            <div>
              确定禁用网域 "<Text strong>{record.name}</Text>" 吗？
            </div>
          </div>
        ) : (
          `确定重新启用网域 "${record.name}" 吗？`
        ),
      okText: nextStatus === 'disabled' ? '确认禁用' : '确认启用',
      okType: nextStatus === 'disabled' ? 'danger' : 'primary',
      cancelText: '取消',
      onOk: () => {
        setDomains((prev) =>
          prev.map((item) =>
            item.id === record.id
              ? { ...item, status: nextStatus, updated_at: new Date().toLocaleString('zh-CN', { hour12: false }) }
              : item
          )
        )
        message.success(nextStatus === 'disabled' ? '网域已禁用（冻结）' : '网域已启用')
      },
    })
  }

  /**
   * {v2.15} 决策 82-1：删除 = 退场回收（软删）。
   * 硬拒绝条件收敛为「存在 M07 资源引用」单一条件（资源是有主数据，须先在 M07 迁移或删除）；
   * 已纳管网域**可删除**——二次确认展示级联影响清单，确认后 M09 纳管状态被级联清退
   * （废止 Token / 停止配置下发 / 采集节点心跳鉴权失败后自动转离线）；
   * 空网域（未纳管、无引用）走常规二次确认；管理域（default）不提供删除。
   */
  const handleDelete = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('系统预置的中心直连域（default）禁止删除')
      return
    }
    const refCount = record.resource_ref_count ?? 0
    // 唯一硬拒绝条件：存在 M07 资源引用
    if (refCount > 0) {
      message.error(
        `网域 "${record.name}" 存在 ${refCount} 条 Module_07 资源引用，不可删除；请先在 Module_07 迁移或删除这些资源`
      )
      return
    }
    const isMonitored = record.registration_status === 'monitored'
    Modal.confirm({
      title: isMonitored ? '删除网域（退场回收）' : '删除网域',
      width: 580,
      content: isMonitored ? (
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          <div style={{ marginBottom: 8 }}>
            确定删除网域 <Text strong>{record.name}</Text>（<Text code>{record.id}</Text>）吗？
            该网域<Text strong>已纳管监控</Text>，删除将<Text strong>级联清退</Text>其在 Module_09 的纳管状态：
          </div>
          <ul style={{ margin: '0 0 8px', paddingInlineStart: 20 }}>
            <li>
              <Text strong>1 个采集节点将断连</Text>：接入凭据废止、停止配置下发
            </li>
            <li>
              采集节点侧<Text type="secondary">无需线下操作</Text>，心跳鉴权失败后自动转离线
            </li>
            <li>
              网域将从网域纳管页与采集节点状态页的<Text strong>可选范围中移除</Text>
              ，既有采集节点历史记录保留供审计
            </li>
          </ul>
          <Text type="secondary" style={{ fontSize: 12 }}>
            删除为软删（与平台软删除体系一致），不可自助恢复。若需保留网域、仅停止采集，v0.2+ 提供「退纳管」。
          </Text>
        </div>
      ) : (
        `确定删除空网域 "${record.name}" 吗？该网域未纳管监控、无 Module_07 资源引用，删除为软删、不可自助恢复；中心直连域（default）不可删除。`
      ),
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setDomains((prev) => prev.filter((item) => item.id !== record.id))
        message.success(
          isMonitored
            ? `网域 "${record.name}" 已删除，Module_09 纳管状态已级联清退（凭据废止、采集节点将转离线）`
            : `网域 "${record.name}" 已删除`
        )
      },
    })
  }

  /** {v2.3} R4：跳转 Module_09 网域纳管并预选当前网域（跨模块跳转，相对路径与部署结构对齐） */
  const jumpToOnboarding = (record: NetworkDomain) => {
    window.open(`../../module-09/dist/index.html#/domain-onboarding?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  /** {v2.11} 决策 75：已纳管未上线 → 深链 Module_09 采集节点状态页（node-status）。
   *  注意：安装指引本体在 M09「网域纳管」页顶部常驻提示区，不在 node-status；
   *  本落点动线为——node-status 按该网域预筛，空态给「去复制安装命令」引导、
   *  链到网域纳管页顶部安装指引（M09 决策 72-3 / 74-3 深链与空态三支）。 */
  const jumpToInstallGuide = (record: NetworkDomain) => {
    window.open(`../../module-09/dist/index.html#/node-status?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  /** {v2.11} 决策 75：采集节点已上线 → 跳 Module_01 采集任务页并预选该网域 */
  const jumpToScrapeJobs = (record: NetworkDomain) => {
    window.open(`../../module-01/dist/index.html#/scrape-jobs?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  /** {v2.14} 行内主操作 = 接入进度的下一步动作（唯一主按钮，与四态一一对应） */
  const runPrimaryAction = (record: NetworkDomain) => {
    const step = accessStepOf(record)
    if (step === 1) jumpToOnboarding(record)
    else if (step === 2) jumpToInstallGuide(record)
    else jumpToScrapeJobs(record)
  }

  const primaryIcon = (step: AccessStep) =>
    step === 1 ? <CloudUploadOutlined /> : step === 2 ? <BookOutlined /> : <PlayCircleOutlined />

  /** {v2.14} 状态列：Badge 语义色 + 文字（禁用补充「冻结」语义说明） */
  const renderStatus = (record: NetworkDomain) => {
    if (record.status === 'active') {
      return <Badge status="success" text="启用" />
    }
    return (
      <Tooltip title="已冻结：不再接受新登记与新纳管，存量资源与采集配置继续运行">
        <span style={{ cursor: 'default' }}>
          <Badge status="default" text="禁用" />
        </span>
      </Tooltip>
    )
  }

  /** {v2.15} 次要操作收进「更多」：不可操作原因仅在真实不可操作时给出
   *  （系统预置网域 / 存在 M07 资源引用）；已纳管网域的删除入口保持可用（决策 82-1）。 */
  const buildMoreMenu = (record: NetworkDomain): MenuProps['items'] => {
    const isSystem = record.domain_type === 'management'
    const refCount = record.resource_ref_count ?? 0
    if (isSystem) {
      return [
        { key: 'detail', label: '查看详情', icon: <ProfileOutlined /> },
        { type: 'divider' },
        {
          key: 'system-hint',
          disabled: true,
          label: (
            <Text type="secondary" style={{ fontSize: 12 }}>
              系统预置网域：不可禁用 / 删除
            </Text>
          ),
        },
      ]
    }
    const items: MenuProps['items'] = [
      { key: 'detail', label: '查看详情', icon: <ProfileOutlined /> },
      { type: 'divider' },
      {
        key: 'toggle',
        label: record.status === 'active' ? '禁用网域' : '启用网域',
        icon: record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />,
        danger: record.status === 'active',
      },
    ]
    items.push(
      refCount > 0
        ? {
            key: 'delete-hint',
            disabled: true,
            label: (
              <Text type="secondary" style={{ fontSize: 12 }}>
                存在资源引用（{refCount} 条），请先迁移或删除资源
              </Text>
            ),
          }
        : { key: 'delete', label: '删除网域', icon: <DeleteOutlined />, danger: true }
    )
    return items
  }

  const columns = [
    {
      // {v2.14} 主标识列 fixed left；网域 ID 下沉详情抽屉（§9 列数治理）
      title: '网域名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      fixed: 'left' as const,
      render: (_: unknown, record: NetworkDomain) => (
        <Tooltip title={`网域 ID：${record.id}`}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontWeight: 600, height: 'auto' }}
            onClick={() => setDetailDomain(record)}
          >
            {record.name}
          </Button>
        </Tooltip>
      ),
    },
    {
      // {v2.11/13} 决策 74/79：domain_type 用户侧呈现为「接入方式」（自动推导、不可选择）
      title: '接入方式',
      dataIndex: 'domain_type',
      key: 'domain_type',
      width: 130,
      render: (type: NetworkDomain['domain_type']) =>
        type === 'management' ? (
          <Tooltip title="中心自己所在的域（default），机器可被平台中心直接访问、由中心直接采集">
            <Tag color="blue">中心直连域</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="中心无法直连的域：由安装在该网域内的采集节点回传数据">
            <Tag color="cyan">采集节点域</Tag>
          </Tooltip>
        ),
    },
    {
      // {v2.11} 决策 75（v0.2）：「接入进度」四态列（数据由列表接口聚合）；{v2.14} 点阵呈现、去掉灰字旁注
      title: '接入进度',
      key: 'access_progress',
      width: 190,
      render: (_: unknown, record: NetworkDomain) => <AccessProgress record={record} />,
    },
    {
      // {v2.14} 状态语义用 Badge + 文字（§8），不与操作列按钮重复表达
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (_: unknown, record: NetworkDomain) => renderStatus(record),
    },
    {
      title: '登记归属',
      dataIndex: 'tenant_id',
      key: 'tenant_id',
      width: 130,
      render: (tenantId: string) => (
        <Tooltip title="部署级登记方（登记 ≠ 独占，网域可授权多个租户共享）">{tenantNameOf(tenantId)}</Tooltip>
      ),
    },
    {
      // {v2.14} 行内最多 2 个租户标签 + 「+N」折叠（§9 行内 Tag 上限），全量明细进悬浮与详情抽屉
      title: '授权租户',
      dataIndex: 'authorized_tenant_ids',
      key: 'authorized_tenant_ids',
      width: 180,
      render: (ids: string[] = []) => {
        if (ids.length === 0) return <Text type="secondary">未授权</Text>
        const shown = ids.slice(0, 2)
        return (
          <Space size={4} wrap={false}>
            {shown.map((id) => (
              <Tag key={id} color="geekblue" style={{ marginInlineEnd: 0 }}>
                {tenantNameOf(id)}
              </Tag>
            ))}
            {ids.length > 2 && (
              <Tooltip title={ids.map((id) => tenantNameOf(id)).join('、')}>
                <Tag style={{ marginInlineEnd: 0 }}>+{ids.length - 2}</Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
    {
      // {v2.11} 决策 76：zone_type UI 展示名「网络分区（可选）」——纯分类标签，不影响行为
      title: '网络分区（可选）',
      dataIndex: 'zone_type',
      key: 'zone_type',
      width: 160,
      render: (value: string) =>
        value ? <Tag>{zoneTypeLabelOf(value)}</Tag> : <Text type="secondary">未设置</Text>,
    },
    {
      // {v2.14} 操作列三重层次：主操作（接入下一步，唯一主按钮）+ 编辑 + 更多（禁用/启用、删除）
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      width: 230,
      render: (_: unknown, record: NetworkDomain) => {
        const step = accessStepOf(record)
        const isFlowDone = step === 4
        return (
          <Space size={0}>
            {/* 禁用行不提供接入动作，也不重复状态文字——状态由「状态」列 Badge 承载 */}
            {record.status === 'active' && (
              <Button
                type="link"
                size="small"
                icon={primaryIcon(step)}
                style={{ paddingLeft: 0, fontWeight: isFlowDone ? 400 : 600 }}
                onClick={() => runPrimaryAction(record)}
              >
                {ACTION_LABEL[step]}
              </Button>
            )}
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => showEdit(record)}
              style={{ color: '#4E5969' }}
            >
              编辑
            </Button>
            <Dropdown menu={{ items: buildMoreMenu(record), onClick: ({ key }) => {
              if (key === 'detail') setDetailDomain(record)
              else if (key === 'toggle') toggleStatus(record)
              else if (key === 'delete') handleDelete(record)
            } }}>
              <Button type="text" size="small" icon={<MoreOutlined />} aria-label="更多操作" style={{ color: '#4E5969' }} />
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  return (
    <MainLayout
      reviewNotes={
        <>
          M06 为网域的行政 Owner：本页只维护行政信息（名称 / 登记归属 / 授权租户 / 状态 / 网络分区），监控纳管（令牌、Remote Write、采集节点）由 Module_09 执行。
          网域为部署级资源、可跨租户共享（决策 18~20 落版）：登记归属固定平台运营部（platform_admin），登记 ≠ 独占，通过「授权租户」授权多个租户共享使用（授权 ≠ 拥有）；登记归属创建后不可变更（决策 23）。
          网域定义为全平台唯一入口，下游模块（导入 / 纳管 / CMDB 同步）只引用 network_domain_id；ID 按 `&lt;deploy_code&gt;-&lt;domain_code&gt;` 自动生成且全局唯一（deploy_code 默认 `mc`；default 中心直连域为历史预置、无前缀）。
          网段（CIDR，决策 52）：网域可选择登记其覆盖的 IP 段（可留空），供 M07 资源导入 / CMDB 同步时按 IP 自动推导网域归属（归属解析链第③级，最长前缀优先、同前缀跨网域判歧义）；纯平台侧数据，不回写 CMDB、不要求 CMDB 加字段，也可由 M07「待分配队列」规则化动作按未分配 IP 汇总一键生成候选网段。
          网域心智原则（决策 52）：网域是部署拓扑属性，不是资产属性——「接入可见、消费隐藏」：接入侧（M07 导入 / 录入 / CMDB 同步）可见并可推导归属，消费侧（M02 查询 / M05 看板 / M08 告警路由 / M01 采集）默认不感知网域（权限注入 + 可选下钻），网域不做 CMDB 写回。
          <b>网域概念用户化与接入引导（决策 73~77 / 79）：</b>
          决策 73（网域用户侧定义）：网域 = 网络可达性区域——「中心能否直连」二选一判断规则落为页首引导条与登记前置判断；登记网域本身不采集数据，只完成「划片」（哪个采集节点去采 + 数据打来源区域标签）。
          决策 74（术语降噪，v2.13 决策 79 再修订）：UI 展示名——管理域→「中心直连域」、边缘域→「采集节点域」、Edge Sync Agent→「采集节点」、domain_type 呈现为只读「接入方式」、zone_type→「网络分区（可选）」；后端模型枚举不变。
          决策 75（引导四件套）：页首引导条 + 提问式空态 / 登记前置判断（MVP）／登记成功行动卡（MVP）／接入进度四态列（v0.2，替代「监控纳管」二态列；进度数据由 M06 列表接口聚合 M09 纳管状态、Agent 心跳、生效配置得出，原型以 mock 模拟聚合结果）；M09 侧配套一键复制安装命令。
          决策 76（zone_type 语义）：纯分类标签、不影响采集、可留空；政务云 = 安全分区，公有云 = region；不做死枚举、不赋予行为语义。
          决策 77（K8s 集群）：不设第六资源类型，四归属——网络边界归 NetworkDomain（overlay 独立建域）、分组筛选归 cluster 标签、动态实例发现归 M04 服务发现源、集群自身监控归 generic_target。
          <b>v2.14 前端设计优化（对齐《前端标准》§8 交互选型表 / §9 列表与长文本规范）：</b>
          ①页首由「Alert + Collapse 三段嵌套」改为单块扁平引导条：一句话定义 + 双路由卡（能直连 / 够不到）+ 接入四步常显；原「三行 ASCII 拓扑示意」改为双路由卡 + 四步链条（可视化等价，拓扑原图保留在登记抽屉的概念详解内），收起状态记 localStorage。
          ②登记 / 编辑表单由 Modal 改为 Drawer（字段 9 项 &gt; 6，§8 规定「&gt;6 字段或需分组 → Drawer 内表单」）；抽屉内按「是否需要登记 / 行政信息 / 授权与分区 / 网络与描述」四组分区（FormSection 统一小标题）。
          ③前置判断由裸 Radio 改为双选择卡，场景说明入卡内；并补「判断口径」澄清块——以中心可达性为准（非人工运维可达性），云上 VPC 经 VPC 对等连接 / 云企业网（CEN）/ 专线或 VPN 与中心打通后属「能直接访问」无需登记，典型需登记场景改为独立 K8s overlay / 物理或逻辑隔离网段 / 未向中心开放入站的托管网络（原「专网 / 隔离 DMZ / 另一个 VPC」表述不准确：DMZ 通常可直连，VPC 可对等打通）。
          ④抽屉内「你正在登记采集节点域」身份说明与「什么是网域？」详解统一为同一 Callout 容器（消除两种样式拼盘），详解在同一容器内就地展开。
          ⑤列表列数 11 → 8（§9 列数治理：默认只展示扫读必需列，其余下沉详情 Drawer）：保留 网域名称 / 接入方式 / 接入进度 / 状态 / 登记归属 / 授权租户 / 网络分区 / 操作；网域 ID、授权租户全量、网段（CIDR）、描述、创建与更新时间下沉详情抽屉；授权租户行内最多 2 个标签 + 「+N」折叠。
          ⑥接入进度列：移除「下一步：…」灰字旁注（占位且与操作列重复），四态改点阵 + 当前态文字，四步明细与下一步说明入悬浮；进度与操作列主按钮一一对应（已登记→去纳管 / 已纳管→安装采集节点 / 节点已上线→去配置采集 / 已出数据→查看采集任务），全行仅一个主按钮。
          ⑦状态列由 Tag 改 Badge + 文字（§8 状态语义），禁用补「冻结」语义说明；启用 / 禁用 / 删除收进「更多」菜单，系统预置场景在菜单内直接给出不可操作原因（不再以点击报错代替提示），主行仅保留 主操作 + 编辑 + 更多 三项。（「已纳管网域不可删除」已于 v2.15 决策 82-1 撤销，见下）
          <b>v2.15 网域生命周期闭环（决策 82，回收路径修正 + 禁用/纳管联动具象化）：</b>
          ①<b>删除约束修正（82-1）</b>：硬拒绝条件收敛为「存在 Module_07 资源引用」<b>单一条件</b>（该场景删除项在「更多」菜单内直给「存在资源引用（N 条），请先迁移或删除资源」，不以点击报错代替）；<b>已纳管网域的删除入口保持可用</b>，点击进入「退场回收」二次确认——弹窗展示<b>级联影响清单</b>（1 个采集节点将断连 / 接入凭据将废止 / 采集节点侧无需线下操作、心跳鉴权失败后自动离线 / 网域退出 M09 与采集节点状态页的可选范围、既有历史记录保留供审计），确认后 M06 软删 + M09 级联清退纳管状态；空网域（未纳管、无引用）走常规二次确认；管理域（default）不提供删除。
          ②<b>禁用弹窗补强（82-2）</b>：已纳管且存在在线 Agent 时，除影响范围外追加固定提示——「禁用为行政冻结：新资源登记与新纳管将被阻止，但已接入的采集节点不会自动停止采集。如需停止采集并回收网域，请使用『删除』；如需保留网域、仅停止采集，v0.2+ 提供『退纳管』」。
          ③<b>三动作语义边界（82-4）</b>：禁用 = 行政冻结（管准入）/ 退纳管 = 停止监控（管运行，v0.2+）/ 删除 = 退场回收（管存在性），三者<b>正交不可互替</b>，覆盖「不再使用某网域」的三种强度。
        </>
      }
    >
      <div className="page-header">
        <Title level={4} style={{ margin: 0 }}>
          网域管理
        </Title>
      </div>

      {guideCollapsed ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: CALLOUT_TONES.brand.bg,
            border: `1px solid ${CALLOUT_TONES.brand.border}`,
            borderRadius: 8,
            padding: '8px 16px',
            marginBottom: 16,
          }}
        >
          <InfoCircleFilled style={{ color: '#0ECDEB' }} />
          <Text style={{ fontSize: 13, color: '#4E5969' }}>
            网域 = 一组网络互通机器的集合，按「中心能否直连」划片；够不到的网络登记为采集节点域。
          </Text>
          <Button
            type="text"
            size="small"
            icon={<DownOutlined />}
            onClick={expandGuide}
            style={{ marginLeft: 'auto', color: '#1481FD' }}
          >
            展开引导
          </Button>
        </div>
      ) : (
        <DomainGuidePanel onCollapse={collapseGuide} />
      )}

      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            登记网域
          </Button>
        }
      >
        <FilterBar>
          <FilterItem label="登记归属">
            <Select
              placeholder="全部登记归属"
              allowClear
              showSearch
              optionFilterProp="children"
              value={filterOwner === 'all' ? undefined : filterOwner}
              onChange={(v) => setFilterOwner(v ?? 'all')}
              style={{ width: 180 }}
            >
              {mockTenants.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="网络分区">
            <Select
              placeholder="全部分区"
              allowClear
              showSearch
              optionFilterProp="children"
              value={filterZoneType === 'all' ? undefined : filterZoneType}
              onChange={(v) => setFilterZoneType(v ?? 'all')}
              style={{ width: 200 }}
            >
              {ZONE_TYPE_OPTIONS.map((z) => (
                <Option key={z.value} value={z.value}>
                  {z.label}
                </Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="状态">
            <Select
              placeholder="全部状态"
              allowClear
              value={filterStatus === 'all' ? undefined : filterStatus}
              onChange={(v) => setFilterStatus((v ?? 'all') as 'all' | 'active' | 'disabled')}
              style={{ width: 140 }}
            >
              <Option value="active">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </FilterItem>
          <FilterItem label="授权租户">
            <Select
              placeholder="全部授权租户"
              allowClear
              showSearch
              optionFilterProp="children"
              value={filterAuthorizedTenant === 'all' ? undefined : filterAuthorizedTenant}
              onChange={(v) => setFilterAuthorizedTenant(v ?? 'all')}
              style={{ width: 180 }}
            >
              {mockTenants.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Select>
          </FilterItem>
        </FilterBar>
        <Table
          rowKey="id"
          dataSource={filteredDomains}
          columns={columns}
          scroll={TABLE_SCROLL_X}
          pagination={TABLE_PAGINATION}
          locale={{
            /* {v2.11} 决策 75：空态改提问式引导 */
            emptyText: (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: CALLOUT_TONES.brand.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 12px',
                  }}
                >
                  <QuestionCircleOutlined style={{ fontSize: 22, color: '#0ECDEB' }} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                  你的所有机器，都能被平台中心直接访问吗？
                </div>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12.5 }}>
                    能 → 无需登记网域（中心直连域 default 已覆盖）；不能 → 登记一个采集节点域，用采集节点把数据带回中心
                  </Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
                  登记网域
                </Button>
              </div>
            ),
          }}
        />
      </Card>

      {/* {v2.14} 登记 / 编辑抽屉（§8：>6 字段用 Drawer 内表单） */}
      <Drawer
        width={720}
        open={isFormOpen}
        onClose={closeForm}
        title={
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {editingDomain ? '编辑网域' : '登记网域'}
            </div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
              仅登记行政信息；接入凭据与采集节点安装由「配置中心 - 网域纳管」完成
            </Text>
          </div>
        }
        footer={
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={closeForm}>取消</Button>
              <Button
                type="primary"
                disabled={!canSubmit}
                onClick={() => form.submit()}
                /* {v2.13} 决策 79：前置判断未通过（选「能」或未答）时不提供提交路径——硬劝阻终点 */
              >
                {editingDomain ? '保存' : '确认登记'}
              </Button>
            </Space>
          </div>
        }
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          {!editingDomain && (
            /* {v2.11} 决策 75：登记前判断——把「无缘无故建域」挡在源头 */
            <FormSection title="这个区域的机器，平台中心能直接访问吗？" description="登记前的自检，决定是否需要建网域">
              <Form.Item
                name="center_direct"
                rules={[{ required: true, message: '请先选择一项' }]}
                style={{ marginBottom: 0 }}
              >
                <CenterDirectChoice />
              </Form.Item>
              <CenterDirectRationale />
              {watchedCenterDirect === 'yes' && (
                /* {v2.13} 决策 79：硬劝阻终点——表单不展开、确认按钮禁用、无继续填写路径。
                   删除 v2.11 的「仅当确有行政登记需要（如独立授权管理）时再继续填写」出口：
                   管理域全系统唯一不可登记 / 非 default 强制 agent_pull 与用户声明矛盾 / 能直连与建域语义互斥；
                   独立授权诉求走「授权租户」字段（决策 18~20）。 */
                <div style={{ marginTop: 12 }}>
                  <Callout
                    tone="warning"
                    icon={<StopOutlined />}
                    title="无需登记网域，请关闭本窗口"
                    extra={
                      <Button type="text" size="small" onClick={closeForm} style={{ color: '#1481FD' }}>
                        关闭
                      </Button>
                    }
                  >
                    能被平台中心直接访问的机器统一放在「中心直连域（default）」，由中心直接采集。
                    如需把网域共享给其他租户使用，请改用「授权租户」字段，不必另建网域。
                  </Callout>
                </div>
              )}
              {watchedCenterDirect === 'no' && (
                <div style={{ marginTop: 12 }}>
                  {/* {v2.13} 决策 79：身份说明前置 + 概念详解就地展开（v2.14 统一为同一 Callout 容器） */}
                  <Callout
                    tone="brand"
                    icon={<InfoCircleFilled />}
                    title="你正在登记一个「采集节点域」"
                    extra={
                      <Button
                        type="text"
                        size="small"
                        onClick={() => setShowConceptInDrawer((v) => !v)}
                        style={{ color: '#1481FD' }}
                      >
                        {showConceptInDrawer ? '收起说明' : '什么是网域？'}
                      </Button>
                    }
                  >
                    平台中心访问不到这个网络：登记后需在其中一台常开机器上安装采集节点，由它把数据单向回传中心。
                    {showConceptInDrawer && <DomainConceptDetail />}
                  </Callout>
                </div>
              )}
            </FormSection>
          )}

          {(editingDomain || watchedCenterDirect === 'no') && (
            <>
              <FormSection title="行政信息">
                <Form.Item label="网域名称" name="name" rules={[{ required: true, message: '请输入网域名称' }]}>
                  <Input placeholder="例如：政务网 A 区" disabled={editingDomain?.id === 'default'} />
                </Form.Item>
                {editingDomain ? (
                  <Form.Item
                    label="登记归属"
                    extra="创建后不可变更；如确需调整登记归属，请联系平台管理员走归属转移流程"
                  >
                    <Text>
                      {tenantNameOf(editingDomain.tenant_id)}（{editingDomain.tenant_id}）
                    </Text>
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="登记归属"
                    name="tenant_id"
                    rules={[{ required: true, message: '请选择登记归属' }]}
                    extra="部署级登记方，MVP 固定平台运营部（platform_admin）；登记 ≠ 独占，网域可授权多个租户共享；创建后不可变更"
                  >
                    <Select placeholder="请选择登记归属" disabled showSearch optionFilterProp="children">
                      {mockTenants
                        .filter((t) => t.status === 'active')
                        .map((t) => (
                          <Option key={t.id} value={t.id}>
                            {t.name}
                          </Option>
                        ))}
                    </Select>
                  </Form.Item>
                )}
                <Form.Item
                  /* {v2.11/13} 决策 74/79：domain_type 用户侧呈现为只读「接入方式」，由第一问自动得出 */
                  label="接入方式"
                  extra={
                    editingDomain
                      ? '由「中心能否直连」自动得出，不可选择；中心直连域（default）为系统预置，由平台管理员维护'
                      : '由上一问自动得出：中心访问不到的域通过采集节点接入（安装在该网域一台常开机器上，回传数据）'
                  }
                >
                  <Select
                    value={editingDomain?.domain_type === 'management' ? 'management' : 'edge'}
                    disabled
                    options={[
                      { value: 'edge', label: '采集节点域' },
                      { value: 'management', label: '中心直连域（系统预置）' },
                    ]}
                  />
                </Form.Item>
              </FormSection>

              <FormSection title="授权与分区" description="网域为部署级资源，可授权多个租户共享使用">
                <Form.Item
                  label="授权租户"
                  name="authorized_tenant_ids"
                  extra="可选，缺省 = 登记归属租户（platform_admin）；授权 ≠ 拥有；被授权租户未开启多网域能力时仅可被授权单个网域"
                >
                  <Select
                    mode="multiple"
                    placeholder="请选择被授权使用该网域的租户"
                    showSearch
                    optionFilterProp="children"
                  >
                    {mockTenants
                      .filter((t) => t.status === 'active')
                      .map((t) => (
                        <Option key={t.id} value={t.id}>
                          {t.name}
                        </Option>
                      ))}
                  </Select>
                </Form.Item>
                <Form.Item
                  /* {v2.11} 决策 76：UI 展示名「网络分区（可选）」，纯分类标签语义 */
                  label="网络分区（可选）"
                  name="zone_type"
                  extra={ZONE_TYPE_FIELD_HINT}
                >
                  <Select
                    placeholder="请选择网络分区（可留空表示未设置）"
                    allowClear
                    showSearch
                    optionFilterProp="children"
                  >
                    {ZONE_TYPE_OPTIONS.map((z) => (
                      <Option key={z.value} value={z.value}>
                        {z.label}
                        <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                          {z.description}
                        </Text>
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </FormSection>

              <FormSection title="网络与描述" description="网段用于资源导入时按 IP 自动推导网域归属，可留空">
                <Form.Item label="网段（CIDR）" extra={IP_CIDR_HINT}>
                  <Input.TextArea
                    rows={3}
                    placeholder={'每行一个网段，如 10.20.0.0/16；可留空（留空时由平台在资源导入时按 IP 自动推导归属）'}
                    value={(form.getFieldValue('ip_cidrs') as string[] | undefined)?.join('\n') ?? ''}
                    onChange={(e) =>
                      form.setFieldValue(
                        'ip_cidrs',
                        e.target.value.split('\n').filter((s) => s.trim())
                      )
                    }
                  />
                </Form.Item>
                <Form.Item label="描述" name="description">
                  <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征（行政描述，非监控参数）" />
                </Form.Item>
                <Form.Item
                  label="状态"
                  name="status"
                  initialValue="active"
                  rules={[{ required: true, message: '请选择状态' }]}
                  extra="禁用后网域不可被租户使用；系统预置的中心直连域不可禁用"
                >
                  <Select placeholder="请选择" disabled={editingDomain?.domain_type === 'management'}>
                    <Option value="active">启用</Option>
                    <Option value="disabled">禁用</Option>
                  </Select>
                </Form.Item>
                <Form.Item
                  label="网域 ID（自动生成）"
                  extra="按部署级前缀自动生成（&lt;deploy_code&gt;-&lt;domain_code&gt;，deploy_code 默认 mc；default 中心直连域无前缀），全局唯一、创建后不可修改"
                >
                  <Input
                    value={suggestedId || '自动生成（请先填写名称）'}
                    disabled
                    placeholder="mc-xxx"
                  />
                </Form.Item>
              </FormSection>
            </>
          )}
        </Form>
      </Drawer>

      {/* {v2.14} 详情抽屉（§9 列数治理：列表未展示的字段在此渐进式披露） */}
      <Drawer
        width={720}
        open={detailDomain !== null}
        onClose={() => setDetailDomain(null)}
        title={
          detailDomain && (
            <div>
              <Space size={8}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{detailDomain.name}</span>
                {detailDomain.domain_type === 'management' ? (
                  <Tag color="blue">中心直连域</Tag>
                ) : (
                  <Tag color="cyan">采集节点域</Tag>
                )}
                {renderStatus(detailDomain)}
              </Space>
              <div>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                  行政信息由本模块维护；接入凭据、采集节点与运行状态由「配置中心 - 网域纳管」维护
                </Text>
              </div>
            </div>
          )
        }
        footer={
          detailDomain && (
            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setDetailDomain(null)}>关闭</Button>
                <Button
                  type="primary"
                  icon={<EditOutlined />}
                  onClick={() => {
                    const target = detailDomain
                    setDetailDomain(null)
                    showEdit(target)
                  }}
                >
                  编辑行政信息
                </Button>
              </Space>
            </div>
          )
        }
      >
        {detailDomain && (
          <>
            <Descriptions
              column={2}
              size="small"
              bordered
              styles={{ label: { width: 120, color: '#86909C' }, content: { color: '#1D2129' } }}
              items={[
                { key: 'id', label: '网域 ID', children: <Text code>{detailDomain.id}</Text> },
                { key: 'type', label: '接入方式', children: detailDomain.domain_type === 'management' ? '中心直连域' : '采集节点域' },
                { key: 'owner', label: '登记归属', children: `${tenantNameOf(detailDomain.tenant_id)}` },
                {
                  key: 'auth',
                  label: '授权租户',
                  children:
                    (detailDomain.authorized_tenant_ids ?? []).length === 0
                      ? '未授权'
                      : detailDomain.authorized_tenant_ids!.map((id) => tenantNameOf(id)).join('、'),
                },
                {
                  key: 'zone',
                  label: '网络分区',
                  children: detailDomain.zone_type ? zoneTypeLabelOf(detailDomain.zone_type) : '未设置',
                },
                { key: 'status', label: '状态', children: detailDomain.status === 'active' ? '启用' : '禁用（冻结）' },
                {
                  key: 'progress',
                  label: '接入进度',
                  children: (
                    <Space size={8}>
                      <AccessProgress record={detailDomain} />
                    </Space>
                  ),
                },
                {
                  key: 'cidr',
                  label: '网段（CIDR）',
                  children: (detailDomain.ip_cidrs ?? []).length
                    ? detailDomain.ip_cidrs!.join('、')
                    : '未配置',
                },
                { key: 'created', label: '创建时间', children: detailDomain.created_at },
                { key: 'updated', label: '更新时间', children: detailDomain.updated_at },
                {
                  key: 'desc',
                  label: '描述',
                  span: 2,
                  children: detailDomain.description || '—',
                },
              ]}
            />
            <div style={{ marginTop: 16 }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {ACCESS_STEP_HINT[accessStepOf(detailDomain)]}；接入凭据与采集节点安装由「配置中心 - 网域纳管」完成。
              </Text>
            </div>
          </>
        )}
      </Drawer>

      <Modal
        /* {v2.11} 决策 75：登记成功行动卡——替代一次性 toast，预告后续 3 步并直达纳管 */
        open={successDomain !== null}
        onCancel={() => setSuccessDomain(null)}
        width={520}
        centered
        title={null}
        footer={[
          <Button key="later" onClick={() => setSuccessDomain(null)}>
            稍后处理
          </Button>,
          <Button
            key="go"
            type="primary"
            icon={<CloudUploadOutlined />}
            onClick={() => {
              if (successDomain) jumpToOnboarding(successDomain)
              setSuccessDomain(null)
            }}
          >
            前往纳管（配置中心）
          </Button>,
        ]}
      >
        {successDomain && (
          <div>
            <div style={{ textAlign: 'center', padding: '4px 0 16px' }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: CALLOUT_TONES.success.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <CheckCircleFilled style={{ fontSize: 26, color: CALLOUT_TONES.success.color }} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                网域「{successDomain.name}」已登记
              </div>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                行政登记只完成「划片」，还需 3 步才能产出监控数据
              </Text>
            </div>
            <div
              style={{
                background: '#F7F8FA',
                borderRadius: 6,
                padding: '4px 14px',
              }}
            >
              {[
                { title: '去纳管获取接入凭据', hint: '配置中心 - 网域纳管' },
                { title: '安装采集节点', hint: '在该网域一台常开机器上' },
                { title: '配置采集任务，产出数据', hint: '采集任务 - 选中该网域' },
              ].map((s, idx) => (
                <div
                  key={s.title}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: idx < 2 ? '1px solid #E5E6EB' : 'none',
                  }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: CALLOUT_TONES.brand.bg,
                      color: '#0ABBD7',
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flex: '0 0 auto',
                    }}
                  >
                    {idx + 1}
                  </span>
                  <Text style={{ fontSize: 13, flex: 1 }}>{s.title}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {s.hint}
                  </Text>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </MainLayout>
  )
}
