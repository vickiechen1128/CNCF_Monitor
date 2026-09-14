import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tooltip,
  message,
  Alert,
  Radio,
  Steps,
  Collapse,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  StopOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  CloudUploadOutlined,
  BookOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
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

/** 概念卡 + 接入指引合并面板的折叠/关闭状态存 localStorage 的 key（PRD §11.2：可关闭并记住，决策 79） */
const CONCEPT_PANEL_DISMISSED_KEY = 'm06-network-domain-guide-panel-dismissed'

/** 接入进度四态列的 Tag 颜色（仅视觉分层，语义由文字承载） */
const ACCESS_STEP_COLORS: Record<AccessStep, string> = {
  1: 'default',
  2: 'processing',
  3: 'warning',
  4: 'success',
}

/** 接入进度四态的下一步动作提示 */
const ACCESS_STEP_NEXT: Record<AccessStep, string> = {
  1: '下一步：去纳管获取接入凭据',
  2: '下一步：安装采集节点',
  3: '下一步：配置采集任务',
  4: '接入完成',
}

/**
 * {v2.13} 决策 79：「什么是网域」详解内容——外层概念面板与登记抽屉折叠入口共用。
 * 两种域的区别 + 判断规则 + 三行拓扑 + 「登记不采集数据」说明。
 */
function DomainConceptContent() {
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        网域 = 一组<b>网络互通</b>的机器的集合（网络可达性区域）。平台中心<b>能不能直接访问</b>这些机器，决定要不要建网域：
      </div>
      <div style={{ marginBottom: 4 }}>
        <CheckCircleOutlined style={{ color: '#00B578', marginRight: 6 }} />
        <Text>
          <b>能直接访问</b> → 不用建网域：机器统一放在「中心直连域」（default），由中心直接采集
        </Text>
      </div>
      <div style={{ marginBottom: 8 }}>
        <StopOutlined style={{ color: '#FF8800', marginRight: 6 }} />
        <Text>
          <b>访问不到</b>（专网 / 隔离 DMZ / 另一个 VPC / K8s 集群）→ 登记一个网域（采集节点域），并在该网络内挑一台常开机器安装「采集节点」，由它把数据带回中心
        </Text>
      </div>
      <div
        style={{
          background: '#F7F8FA',
          border: '1px solid #E5E6EB',
          borderRadius: 4,
          padding: '8px 12px',
          fontFamily: 'SFMono-Regular, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.9,
          marginBottom: 8,
        }}
      >
        <div>平台中心 ──直连──▶ 中心直连域（default）的机器 ──▶ 指标直达中心</div>
        <div>平台中心 ──✕ 直达不通──▶ 采集节点域的机器 ◀──采集── 采集节点</div>
        <div>采集节点 ──单向出站 HTTPS──▶ 平台中心（数据回传）</div>
      </div>
      <Text type="secondary">
        登记网域本身不采集数据——它告诉平台两件事：这批机器由<b>哪个采集节点</b>去采；采回的数据打上<b>来源区域标签</b>，便于按区域筛选与定位故障。
      </Text>
    </div>
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
 * - 空网域（未纳管、无资源引用）可删除（软删），非空网域/中心直连域不可删除。
 * {v2.11} 决策 73~77 落版：
 * - 页首概念卡（一句话定义 + 二选一判断规则 + 三行拓扑示意，可关闭记住）；
 * - 空态改提问式引导；新建表单第一问「中心能否直连」前置判断；
 * - 登记成功改结果行动卡（3 步预告 + 直达纳管）；
 * - 列表「监控纳管」二态列 →「接入进度」四态列（已登记→已纳管→采集节点已上线→已出数据；行内主操作=下一步动作）；
 * - 术语降噪：管理域→中心直连域、边缘域→隔离区（采集节点接入）、Edge Sync Agent→采集节点、domain_type→接入方式、zone_type→网络分区（可选）。
 * {v2.13} 决策 79 落版（chenrt 走查 v2.11 返工）：
 * - 前置判断选「能」改硬劝阻终点（表单不展开、确认按钮禁用、无继续填写路径；删除「独立授权管理」放行出口——授权诉求走「授权租户」字段）；
 * - 术语再修订：中心直连域→中心直连域、隔离区（采集节点接入）→采集节点域（枚举不变）；
 * - 引导信息归位：页首概念卡 + 可折叠「怎么接入」四步生命周期合并为一个可折叠面板两区块；登记抽屉移除 3 步 Alert+Steps，改为身份说明「你正在登记一个采集节点域」+「什么是网域？」折叠详解；成功行动卡措辞与四步对齐。
 */
export function NetworkDomainsPage() {
  const [domains, setDomains] = useState<NetworkDomain[]>(mockNetworkDomains)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  const [form] = Form.useForm()
  // {v2.11} 登记成功行动卡（决策 75）：新建成功后展示，替代一次性 toast
  const [successDomain, setSuccessDomain] = useState<NetworkDomain | null>(null)
  // {v2.11} 列表筛选（PRD §11.1：网域管理支持按登记归属/网络分区/状态/授权租户筛选）
  const [filterOwner, setFilterOwner] = useState('all')
  const [filterZoneType, setFilterZoneType] = useState('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'disabled'>('all')
  const [filterAuthorizedTenant, setFilterAuthorizedTenant] = useState('all')
  // {v2.11} 页首概念卡显隐（可关闭并记住 localStorage）
  const [conceptCardHidden, setConceptCardHidden] = useState(
    () => localStorage.getItem(CONCEPT_PANEL_DISMISSED_KEY) === '1'
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
  // {v2.11} 新建表单第一问（决策 75）：中心能否直连——能 → 提示通常无需建域；不能 → 展开登记字段
  const watchedCenterDirect = Form.useWatch('center_direct', form) as 'yes' | 'no' | undefined

  /** PRD：network_domain_id 全局唯一，按 <deploy_code>-<domain_code> 自动生成（deploy_code 默认 mc）；default 中心直连域为历史预置、无前缀 */
  const suggestedId = (() => {
    if (editingDomain) return editingDomain.id
    const nameSlug = (watchedName ?? '').trim().toLowerCase().replace(/\s+/g, '-')
    if (!nameSlug) return ''
    return `mc-${nameSlug}`
  })()

  const dismissConceptCard = () => {
    setConceptCardHidden(true)
    localStorage.setItem(CONCEPT_PANEL_DISMISSED_KEY, '1')
  }

  const showAdd = () => {
    setEditingDomain(null)
    form.resetFields()
    // {v2.0} 登记归属为部署级登记方（MVP 固定 platform_admin），新建时默认填充
    // {v2.2} 授权租户可选，缺省 = 登记归属租户（默认回填 platform_admin）
    form.setFieldsValue({ tenant_id: 't-platform', authorized_tenant_ids: ['t-platform'] })
    setIsModalOpen(true)
  }

  const showEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    // {v2.2} 登记归属创建后不可变更，编辑表单不含 tenant_id
    const { tenant_id, ...editableFields } = record
    void tenant_id
    form.setFieldsValue(editableFields)
    setIsModalOpen(true)
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
      setIsModalOpen(false)
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
      setIsModalOpen(false)
      setSuccessDomain(newDomain)
    }
  }

  const toggleStatus = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('系统预置的中心直连域（default）禁止禁用')
      return
    }
    const nextStatus = record.status === 'active' ? 'disabled' : 'active'
    // {v2.2} 禁用 = 冻结：二次确认展示后端返回的影响范围（资源引用数 / 已纳管采集节点数）
    const impactText =
      record.registration_status === 'monitored'
        ? `影响范围：M07 资源引用 N 条、已纳管采集节点 1 个。禁用后该网域不再接受新资源登记与新纳管，存量资源与采集配置不受影响、继续采集（停止采集由 Module_09 退纳管决定）。同时联动 Module_01（该网域禁止新建监控任务）与 Module_09（该网域不再生成新的变更单，存量下发与回滚不受影响）。`
        : `影响范围：M07 资源引用 0 条、已纳管采集节点 0 个（空网域，可直接删除）。禁用后该网域不可被租户使用、不再接受新资源登记与新纳管。禁用语义同时联动 Module_01 与 Module_09（禁止新建监控任务、不再生成新变更单）。`
    Modal.confirm({
      title: nextStatus === 'disabled' ? '禁用网域' : '启用网域',
      content:
        nextStatus === 'disabled'
          ? `确定禁用网域 "${record.name}" 吗？\n${impactText}`
          : `确定重新启用网域 "${record.name}" 吗？`,
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

  /** {v2.2} 删除网域：仅空网域可删（无资源引用且未纳管），软删；中心直连域禁止删除 */
  const handleDelete = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('系统预置的中心直连域（default）禁止删除')
      return
    }
    if (record.registration_status === 'monitored') {
      message.error(`网域 "${record.name}" 已纳管监控（存在资源引用/已纳管采集节点），不可删除，请改用「禁用」`)
      return
    }
    Modal.confirm({
      title: '删除网域',
      content: `确定删除空网域 "${record.name}" 吗？删除为软删，仅对未纳管、无资源引用的空网域生效；中心直连域（default）不可删除。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setDomains((prev) => prev.filter((item) => item.id !== record.id))
        message.success(`网域 "${record.name}" 已删除`)
      },
    })
  }

  /** {v2.11} 接入进度列（决策 75，v0.2）：四态 + 下一步动作提示 */
  const renderAccessProgress = (record: NetworkDomain) => {
    const step = accessStepOf(record)
    return (
      <Space size={4}>
        <Tag color={ACCESS_STEP_COLORS[step]}>{ACCESS_STEP_LABELS[step]}</Tag>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {ACCESS_STEP_NEXT[step]}
        </Text>
      </Space>
    )
  }

  const columns = [
    { title: '网域 ID', dataIndex: 'id', key: 'id' },
    { title: '网域名称', dataIndex: 'name', key: 'name' },
    {
      title: '登记归属',
      dataIndex: 'tenant_id',
      key: 'tenant_id',
      render: (tenantId: string) => (
        <Tooltip title={`部署级登记方（登记 ≠ 独占，网域可授权多个租户共享）`}>{tenantNameOf(tenantId)}</Tooltip>
      ),
    },
    {
      title: '授权租户',
      dataIndex: 'authorized_tenant_ids',
      key: 'authorized_tenant_ids',
      render: (ids: string[] = []) => (
        <Space size={[0, 4]} wrap>
          {ids.length === 0 ? (
            <Text type="secondary">未授权</Text>
          ) : (
            ids.map((id) => (
              <Tag key={id} color="geekblue">
                {tenantNameOf(id)}
              </Tag>
            ))
          )}
        </Space>
      ),
    },
    {
      // {v2.11/13} 决策 74/79：domain_type 用户侧呈现为「接入方式」（自动推导、不可选择），叫法为中心直连域/采集节点域
      title: '接入方式',
      dataIndex: 'domain_type',
      key: 'domain_type',
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
      // {v2.11} 决策 76：zone_type UI 展示名「网络分区（可选）」——纯分类标签，不影响行为
      title: '网络分区（可选）',
      dataIndex: 'zone_type',
      key: 'zone_type',
      render: (value: string) =>
        value ? <Tag>{zoneTypeLabelOf(value)}</Tag> : <Text type="secondary">未设置</Text>,
    },
    {
      // {v2.11} 决策 75（v0.2）：「监控纳管」二态列升级为「接入进度」四态列，数据由列表接口聚合
      title: '接入进度',
      key: 'access_progress',
      render: (_: unknown, record: NetworkDomain) => renderAccessProgress(record),
    },
    {
      // {v2.5} 网段（CIDR）（决策 52）：仅供 M07 资源导入时按 IP 推导网域归属；可留空
      title: '网段（CIDR）',
      dataIndex: 'ip_cidrs',
      key: 'ip_cidrs',
      render: (cidrs: string[] = []) =>
        cidrs.length === 0 ? (
          <Text type="secondary">未配置</Text>
        ) : (
          <Space size={[0, 4]} wrap>
            {cidrs.map((cidr, idx) => (
              <Tag key={idx} color="purple">
                {cidr}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: NetworkDomain['status']) =>
        status === 'active' ? <Tag color="#00B578">启用</Tag> : <Tag color="#86909C">禁用</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      width: 280,
      render: (_: unknown, record: NetworkDomain) => {
        // {v2.11} 决策 75：行内主操作 = 接入进度的下一步动作
        const step = accessStepOf(record)
        return (
          <Space size="small">
            {record.status === 'active' && step === 1 && (
              <Button
                type="link"
                size="small"
                icon={<CloudUploadOutlined />}
                onClick={() => jumpToOnboarding(record)}
              >
                去纳管
              </Button>
            )}
            {record.status === 'active' && step === 2 && (
              <Button
                type="link"
                size="small"
                icon={<BookOutlined />}
                onClick={() => jumpToInstallGuide(record)}
              >
                查看安装指引
              </Button>
            )}
            {record.status === 'active' && (step === 3 || step === 4) && (
              <Button
                type="link"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => jumpToScrapeJobs(record)}
              >
                去配置采集
              </Button>
            )}
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(record)}>
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              danger={record.status === 'active'}
              icon={record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />}
              onClick={() => toggleStatus(record)}
            >
              {record.status === 'active' ? '禁用' : '启用'}
            </Button>
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
            >
              删除
            </Button>
          </Space>
        )
      },
    },
  ]

  /** {v2.3} R4：跳转 Module_09 网域纳管并预选当前网域（跨模块跳转，相对路径与部署结构对齐） */
  const jumpToOnboarding = (record: NetworkDomain) => {
    window.open(`../../module-09/dist/index.html#/domain-onboarding?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  /** {v2.11} 决策 75：已纳管未上线 → 深链 Module_09 采集节点状态页（安装指引常驻页顶） */
  const jumpToInstallGuide = (record: NetworkDomain) => {
    window.open(`../../module-09/dist/index.html#/node-status?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  /** {v2.11} 决策 75：采集节点已上线 → 跳 Module_01 采集任务页并预选该网域 */
  const jumpToScrapeJobs = (record: NetworkDomain) => {
    window.open(`../../module-01/dist/index.html#/scrape-jobs?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  return (
    <MainLayout
      reviewNotes={
        <>
          M06 为网域的行政 Owner：本页只维护行政信息（名称 / 登记归属 / 授权租户 / 状态 / 网络分区），监控纳管（令牌、Remote Write、采集节点）由 Module_09 执行。
          网域为部署级资源、可跨租户共享（决策 18~20 落版）：登记归属固定平台运营部（platform_admin），登记 ≠ 独占，通过「授权租户」授权多个租户共享使用（授权 ≠ 拥有）；登记归属创建后不可变更（决策 23）。
          网域定义为全平台唯一入口，下游模块（导入 / 纳管 / CMDB 同步）只引用 network_domain_id；ID 按 `&lt;deploy_code&gt;-&lt;domain_code&gt;` 自动生成且全局唯一（deploy_code 默认 `mc`；default 中心直连域为历史预置、无前缀）。
          网段（CIDR，决策 52）：网域可选择登记其覆盖的 IP 段（可留空），供 M07 资源导入 / CMDB 同步时按 IP 自动推导网域归属（归属解析链第③级，最长前缀优先、同前缀跨网域判歧义）；纯平台侧数据，不回写 CMDB、不要求 CMDB 加字段，也可由 M07「待分配队列」规则化动作按未分配 IP 汇总一键生成候选网段。
          网域心智原则（决策 52）：网域是部署拓扑属性，不是资产属性——「接入可见、消费隐藏」：接入侧（M07 导入 / 录入 / CMDB 同步）可见并可推导归属，消费侧（M02 查询 / M05 看板 / M08 告警路由 / M01 采集）默认不感知网域（权限注入 + 可选下钻），网域不做 CMDB 写回。
          <b>本轮新增（决策 73~77）：</b>
          决策 73（网域用户侧定义）：网域 = 网络可达性区域——「中心能否直连」二选一判断规则落为页首概念卡与新建表单第一问；登记网域本身不采集数据，只完成「划片」（哪个采集节点去采 + 数据打来源区域标签）。
          决策 74（术语降噪，v2.13 决策 79 再修订）：UI 展示名——管理域→「中心直连域」、边缘域→「采集节点域」、Edge Sync Agent→「采集节点」、domain_type 呈现为只读「接入方式」、zone_type→「网络分区（可选）」；后端模型枚举不变。
          决策 75（引导四件套）：页首概念卡 + 提问式空态 / 新建前置判断问题（MVP）／登记成功行动卡（MVP）／接入进度四态列（v0.2，替代「监控纳管」二态列；进度数据由 M06 列表接口聚合 M09 纳管状态、Agent 心跳、生效配置得出，原型以 mock 模拟聚合结果）；M09 侧配套一键复制安装命令。
          决策 76（zone_type 语义）：纯分类标签、不影响采集、可留空；政务云 = 安全分区，公有云 = region；不做死枚举、不赋予行为语义。
          决策 77（K8s 集群）：不设第六资源类型，四归属——网络边界归 NetworkDomain（overlay 独立建域）、分组筛选归 cluster 标签、动态实例发现归 M04 服务发现源、集群自身监控归 generic_target。
        </>
      }
    >
      <div className="page-header">
        <Title level={4}>网域管理</Title>
      </div>
      {!conceptCardHidden && (
        <Alert
          /* {v2.13} 决策 79：概念卡 + 可折叠「网域接入指引」合并为一个可折叠面板两区块——
             「什么是网域」+「怎么接入」（四步生命周期，同时解释列表「接入进度」四态列含义）；可关闭并记住 */
          type="info"
          showIcon
          closable
          onClose={dismissConceptCard}
          style={{ marginBottom: 16 }}
          message="网域概念与接入指引"
          description={
            <Collapse
              size="small"
              defaultActiveKey={['what']}
              items={[
                {
                  key: 'what',
                  label: '什么是网域？—— 一组网络互通的机器的集合',
                  children: <DomainConceptContent />,
                },
                {
                  key: 'how',
                  label: '怎么接入？—— 四步生命周期（对应列表「接入进度」四态列）',
                  children: (
                    <div>
                      <Steps
                        size="small"
                        direction="vertical"
                        current={-1}
                        items={[
                          { title: '① 登记网域（本页行政登记）—— 对应「已登记」' },
                          { title: '② 去纳管获取接入凭据（配置中心-网域纳管）—— 对应「已纳管」' },
                          { title: '③ 在该网域一台常开机器上安装采集节点（M09 安装指引）—— 对应「采集节点已上线」' },
                          { title: '④ 为该网域资源配置采集 Job，产出数据（M01 采集任务）—— 对应「已出数据」' },
                        ]}
                      />
                      <Text type="secondary">
                        列表「接入进度」列展示的四个状态与上面四步一一对应；行内主操作始终指向当前这一步。
                      </Text>
                    </div>
                  ),
                },
              ]}
            />
          }
        />
      )}
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增网域（行政登记）
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
              <div style={{ padding: '32px 0', textAlign: 'center' }}>
                <QuestionCircleOutlined style={{ fontSize: 32, color: '#86909C', marginBottom: 12 }} />
                <div style={{ fontSize: 15, marginBottom: 8 }}>
                  <b>你的所有机器，都能被平台中心直接访问吗？</b>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <Text type="secondary">
                    能 → 无需新建网域（中心直连域 default 已覆盖）；不能 → 登记一个网域，用采集节点把数据带回中心
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
      <Modal
        title={editingDomain ? '编辑网域（行政信息）' : '新增网域（行政登记）'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        width={640}
        destroyOnClose
        /* {v2.13} 决策 79：前置判断未通过（选「能」或未答）时不提供提交路径——硬劝阻终点 */
        okButtonProps={editingDomain ? undefined : { disabled: watchedCenterDirect !== 'no' }}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          {!editingDomain && (
            /* {v2.11} 决策 75：新建表单第一问——前置判断，把「无缘无故建域」挡在源头 */
            <Form.Item
              label="这个区域的机器，平台中心能直接访问吗？"
              name="center_direct"
              rules={[{ required: true, message: '请先回答上面的问题' }]}
              style={{ marginBottom: 12 }}
            >
              <Radio.Group>
                <Radio value="yes">能直接访问</Radio>
                <Radio value="no">访问不到（专网 / 隔离 DMZ / 另一个 VPC / K8s 集群）</Radio>
              </Radio.Group>
            </Form.Item>
          )}
          {!editingDomain && watchedCenterDirect === 'yes' && (
            /* {v2.13} 决策 79：硬劝阻终点——表单不展开、确认按钮禁用、无继续填写路径。
               删除 v2.11 的「仅当确有行政登记需要（如独立授权管理）时再继续填写」出口：
               管理域全系统唯一不可登记 / 非 default 强制 agent_pull 与用户声明矛盾 / 能直连与建域语义互斥；
               独立授权诉求走「授权租户」字段（决策 18~20）。 */
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="无需新建网域"
              description="能被中心直接访问的机器统一放在「中心直连域」（default），由中心直接采集。请关闭本窗口。"
            />
          )}
          {!editingDomain && watchedCenterDirect === 'no' && (
            <>
              {/* {v2.13} 决策 79：身份说明前置——用户一眼知道登记的是什么 */}
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 8 }}
                message="你正在登记一个采集节点域"
                description="中心访问不到这个网络：登记后需在其中一台常开机器上安装采集节点，由它把数据带回中心。"
              />
              {/* {v2.13} 决策 79：「什么是网域？」详解折叠入口——解释在疑问现场可得，不强制阅读 */}
              <Collapse
                size="small"
                style={{ marginBottom: 16 }}
                items={[
                  {
                    key: 'what',
                    label: '什么是网域？（点开查看详细解释）',
                    children: <DomainConceptContent />,
                  },
                ]}
              />
            </>
          )}
          {(editingDomain || watchedCenterDirect === 'no') && (
            <>
              <Form.Item
                label="网域名称"
                name="name"
                rules={[{ required: true, message: '请输入网域名称' }]}
              >
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
                    : '由第一问自动得出：中心访问不到的域通过采集节点接入（安装在该网域一台常开机器上，回传数据）；中心直连域（default）为系统预置，无需登记'
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
              <Form.Item
                label="授权租户"
                name="authorized_tenant_ids"
                extra="可选，缺省 = 登记归属租户（platform_admin）；网域为部署级资源，可授权多个租户共享使用（授权 ≠ 拥有）；被授权租户未开启多网域能力时仅可被授权单个网域"
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
              <Form.Item label="网段（CIDR）" extra={IP_CIDR_HINT}>
                <Input.TextArea
                  rows={3}
                  placeholder={"每行一个网段，如 10.20.0.0/16；可留空（留空时由平台在资源导入时按 IP 自动推导归属）"}
                  value={(form.getFieldValue('ip_cidrs') as string[] | undefined)?.join('\n') ?? ''}
                  onChange={(e) =>
                    form.setFieldValue(
                      'ip_cidrs',
                      e.target.value.split('\n').filter((s) => s.trim())
                    )
                  }
                />
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
              <Form.Item>
                <Text type="secondary" style={{ display: 'block' }}>
                  本表单仅维护行政信息（ID / 名称 / 登记归属 / 授权租户 / 状态 / 网络分区）；监控参数由「配置中心-网域纳管」填写。
                </Text>
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      <Modal
        /* {v2.11} 决策 75：登记成功行动卡——替代一次性 toast，预告后续 3 步并直达纳管 */
        open={successDomain !== null}
        onCancel={() => setSuccessDomain(null)}
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              ✅ 网域「{successDomain.name}」已登记
            </div>
            <div style={{ marginBottom: 12 }}>
              行政登记只完成「划片」，还需 3 步才能产出监控数据：
            </div>
            <Steps
              size="small"
              direction="vertical"
              current={-1}
              items={[
                { title: '① 去纳管获取接入凭据（配置中心-网域纳管）' },
                { title: '② 安装采集节点（在该网域一台常开机器上）' },
                { title: '③ 配置采集 Job，产出数据（M01 采集任务）' },
              ]}
            />
          </div>
        )}
      </Modal>
    </MainLayout>
  )
}
