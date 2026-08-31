import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, Select, Button, Space, Tag, Descriptions, Row, Col, message, Alert, Empty, Table, Typography, Tooltip, Tabs, Collapse, Drawer, Segmented, Popover, Modal, type TableColumnsType } from 'antd'
import { CheckOutlined, DeleteOutlined, DiffOutlined, EyeOutlined, CopyOutlined, InfoCircleOutlined, HistoryOutlined, ReloadOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { ReviewNote } from '../components/ReviewNote'
import { TABLE_SCROLL_X, TABLE_PAGINATION } from '../components/tablePresets'
import {
  configDrafts,
  configVersions,
  configDeployments,
  edgeAgents,
  networkDomains,
  targetsFilesToText,
  changeDetectionStatus,
  domainArtifactShape,
  validationLayeringNote,
  approvalTieringNote,
  changeStatusEnumDemo,
  gatewayConstraintNote,
  authTlsPassthroughNote,
  frozenDomainExclusionNote,
  defaultFallbackRemovalNote,
  jobDomainFanoutNote,
  filterRealTimeEvaluationNote,
  channelLabel,
  channelTip,
  type Channel,
  type ConfigSyncStatus,
  type ConfigDraftStatus,
  type DraftValidationStatus,
  type ValidationCause,
  type ConfigDraft,
  type ConfigChangeItem,
  type ConfigChangeTarget,
  type AffectedConfigFile,
  type ChangeDetectionOutcome,
} from '../mocks/module-09'

const { Text } = Typography

/** {v1.39 决策 39-1} 跨模块跳转链接：「前往修改」跳 Module_01 采集 Job / 规则编辑并预选网域（修复源数据后回来重新校验）；原型演示用相对路径 */
const MODULE_LINKS = {
  module01: '../module-01/dist/index.html',
} as const

/** {v1.39 决策 39-1/39-3} 校验失败归因分类 UI：user_config=用户配置问题（可修复，行内引导前往 M01）/ platform_fault=平台技术故障（自动重试，仅提示） */
const validationCauseLabel: Record<ValidationCause, string> = {
  user_config: '用户配置问题',
  platform_fault: '平台技术故障',
}

const validationCauseColor: Record<ValidationCause, string> = {
  user_config: 'orange',
  platform_fault: 'red',
}

/** 当前登录用户（决策 19：确认发布时记录确认人，历史变更可审计「谁确认了高风险变更」；MVP 阶段预置，用户管理接入后同步，决策 20） */
const CURRENT_USER = '张伟（运维）'

/** {v1.50 决策 31-M2} MVP 能力角标：橙色小 Tag，标注「deployed 回写为 MVP 必实现」——成功下发即回写 deployed（不再由 none 占位） */
function MVPTag() {
  return (
    <Tag
      color="orange"
      style={{
        marginInlineStart: 4,
        marginInlineEnd: 0,
        paddingInline: 4,
        lineHeight: '14px',
        fontSize: 10,
        borderRadius: 4,
      }}
    >
      MVP
    </Tag>
  )
}

const draftStatusColor: Record<ConfigDraftStatus, string> = {
  pending: 'warning',
  confirmed: 'success',
  discarded: 'default',
}

const draftStatusLabel: Record<ConfigDraftStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  discarded: '已废弃',
}

const validationColor: Record<DraftValidationStatus, string> = {
  passed: 'success',
  failed: 'error',
  pending: 'default',
}

const validationLabel: Record<DraftValidationStatus, string> = {
  passed: '校验通过',
  failed: '校验失败',
  pending: '待校验',
}

/** 变更检测结果（决策 20：引导性状态，不记历史；技术信息折叠） */
const detectionOutcomeColor: Record<ChangeDetectionOutcome, string> = {
  changes_found: 'processing',
  no_change: 'default',
  checksum_same: 'success',
  generation_failed: 'error',
}

const detectionOutcomeLabel: Record<ChangeDetectionOutcome, string> = {
  changes_found: '检测到变更，已生成待确认草稿',
  no_change: '无新变更，无需确认',
  checksum_same: '内容无变化，无需确认',
  // {v1.47 决策 42-4} 生成失败态：configgen 生成异常（非校验类），不产生草稿，提醒查看日志
  generation_failed: '变更生成失败（configgen 异常），本轮未生成草稿，请查看日志',
}

/** 变更清单（决策 18）：变更类型 / 风险等级的中文语义 */
const changeTypeLabel: Record<ConfigChangeItem['type'], string> = {
  add: '新增',
  modify: '修改',
  remove: '移除',
}

const changeTypeColor: Record<ConfigChangeItem['type'], string> = {
  add: 'green',
  modify: 'orange',
  remove: 'red',
}

const riskLabel: Record<ConfigChangeItem['risk'], string> = {
  low: '低风险',
  high: '高风险',
}

const riskColor: Record<ConfigChangeItem['risk'], string> = {
  low: 'default',
  high: 'error',
}

const riskTip: Record<ConfigChangeItem['risk'], string> = {
  low: '新增采集目标，一般无监控中断风险，可正常确认',
  high: '删除采集目标（监控断点）或告警规则变更（误报 / 漏报风险），请重点确认',
}

/** 变更对象 = 源数据对象（决策 22）：与 Module_01（采集 Job / 规则编辑）与 Module_07（资源 / 标签模板）功能对象对齐 */
const changeTargetLabel: Record<ConfigChangeTarget, string> = {
  scrape_job: '采集 Job',
  scrape_target: '采集目标',
  alert_rule: '告警规则',
  blackbox_target: '拨测目标',
  label_template: '标签模板',
}

const changeTargetTip: Record<ConfigChangeTarget, string> = {
  scrape_job: '采集 Job 骨架参数（抓取频率 / 路径 / relabel 等），在监控策略模块维护',
  scrape_target: '采集目标（实例增删 / 标签变化），来自监控对象资源或 Job 实例选择',
  alert_rule: '告警 / 记录规则，在监控策略模块规则编辑维护',
  blackbox_target: '拨测目标（URL / 域名 / IP:Port），内嵌于 blackbox 采集 Job',
  label_template: '标签模板，在监控对象模块维护',
}

/** 影响的配置文件（决策 22）：configgen 产物差异派生，帮助用户理解该行变更影响哪个配置文件 */
const affectedFileLabel: Record<AffectedConfigFile, string> = {
  'prometheus.yml': 'prometheus.yml',
  targets: 'targets/*.json',
  'rules.yml': 'rules.yml',
  'blackbox.yml': 'blackbox.yml',
}

const affectedFileColor: Record<AffectedConfigFile, string> = {
  'prometheus.yml': 'geekblue',
  targets: 'purple',
  'rules.yml': 'orange',
  'blackbox.yml': 'cyan',
}

/** 变更状态筛选（决策 21）：默认待确认，可选已确认 / 已废弃 / 全部，替代原「待确认 / 历史」二分切换 */
type DraftStatusFilter = ConfigDraftStatus | 'all'

const STATUS_FILTER_OPTIONS: { value: DraftStatusFilter; label: string }[] = [
  { value: 'pending', label: '待确认' },
  { value: 'confirmed', label: '已确认' },
  { value: 'discarded', label: '已废弃' },
  { value: 'all', label: '全部' },
]

/** 多文件预览 Tab（PRD 3.4）：prometheus.yml / targets / rules.yml / blackbox.yml / metadata.json */
type PreviewFileKey = 'prometheus.yml' | 'targets' | 'rules.yml' | 'blackbox.yml' | 'metadata.json'

const FILE_TABS: { key: PreviewFileKey; label: string }[] = [
  { key: 'prometheus.yml', label: 'prometheus.yml' },
  { key: 'targets', label: 'targets/*.json' },
  { key: 'rules.yml', label: 'rules.yml' },
  { key: 'blackbox.yml', label: 'blackbox.yml' },
  { key: 'metadata.json', label: 'metadata.json' },
]

// metadata.json 仅只读展示，不参与版本 diff（PRD 3.4：按文件 diff 仅针对可 diff 文件）
const DIFFABLE_FILES: PreviewFileKey[] = ['prometheus.yml', 'targets', 'rules.yml', 'blackbox.yml']

function shortChecksum(checksum: string) {
  return checksum.length > 16 ? `${checksum.slice(0, 12)}...${checksum.slice(-8)}` : checksum
}

function renderYamlPreview(yaml: string) {
  return (
    <pre className="yaml-preview" style={{ margin: 0, maxHeight: 480, overflow: 'auto' }}>
      {yaml}
    </pre>
  )
}

function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const maxLen = Math.max(oldLines.length, newLines.length)
  const rows: { line: number; oldLine: string | null; newLine: string | null; type: 'same' | 'added' | 'removed' | 'empty' }[] = []

  let o = 0
  let n = 0
  for (let i = 0; i < maxLen && i < 200; i++) {
    const oldLine = oldLines[o] ?? null
    const newLine = newLines[n] ?? null
    if (oldLine === null && newLine === null) break
    if (oldLine === newLine) {
      rows.push({ line: i + 1, oldLine, newLine, type: 'same' })
      o++
      n++
    } else if (oldLine !== null && !newLines.slice(n).includes(oldLine)) {
      rows.push({ line: i + 1, oldLine, newLine: null, type: 'removed' })
      o++
    } else {
      rows.push({ line: i + 1, oldLine: null, newLine, type: 'added' })
      n++
    }
  }
  return rows
}

/**
 * {v1.39 决策 39-1 / v1.50 决策 45-1} 校验失败详情行内 Popover（失败文件 + 行号 + 错误信息 + 归因分类 + 对应引导）：
 * 用户配置问题 →「前往修改」跳 M01 对应采集 Job / 规则修复源数据；
 * 平台技术故障 → 校验层已自动重试（指数退避，用户无感），同时提供手动「重新校验」自愈出口（决策 45-1，pending/failed 均提供「重新校验 + 废弃」）
 */
function renderValidationFailPopover(record: ConfigDraft, onRevalidate?: (target: ConfigDraft) => void) {
  const cause = record.validation_cause ?? 'user_config'
  const details = record.validation_details ?? []
  return (
    <div style={{ maxWidth: 380 }}>
      <Tag color={validationCauseColor[cause]} style={{ marginBottom: 8 }}>
        归因：{validationCauseLabel[cause]}
      </Tag>
      {details.length > 0 ? (
        details.map((d, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <Text code style={{ fontSize: 12 }}>
              {d.file}
              {d.line ? `:${d.line}` : ''}
            </Text>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', marginTop: 2 }}>{d.message}</div>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', marginBottom: 8 }}>{record.validation_error}</div>
      )}
      {cause === 'user_config' ? (
        <Space align="start" size={8} wrap>
          <Button
            size="small"
            type="primary"
            onClick={() =>
              window.open(`${MODULE_LINKS.module01}?view=jobs&network_domain=${record.network_domain_id}`, '_blank')
            }
          >
            前往修改
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            跳转至采集 Job / 规则编辑页修复源数据，修复后回来点「重新校验」（重新生成产物再校验）
          </Text>
        </Space>
      ) : (
        <>
          <Text type="secondary" style={{ fontSize: 12 }}>
            平台技术故障：校验层已自动重试（30s / 2min / 5min 指数退避，用户无感）；持续失败可点击「重新校验」手动自愈
          </Text>
          {onRevalidate && (
            <div style={{ marginTop: 8 }}>
              <Button size="small" type="primary" ghost onClick={() => onRevalidate(record)}>
                重新校验
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * {v1.50 决策 43} 废弃回写分类判定（原型模拟后端 discard-impact）：
 * 废弃不是「数据不动只废单」——full-render 模型下不处理源数据必然导致鬼影复现（下一轮轮询因「源版本 > 基线」重新生成内容相同的变更单）。
 * 废弃前先计算影响分类，前端弹窗「分类知情告知」后再确认（new_reverted / modified_kept / deleted_restored / missing）。
 */
type DiscardImpactCategory = 'new_reverted' | 'modified_kept' | 'deleted_restored' | 'missing'

const DISCARD_IMPACT_META: Record<DiscardImpactCategory, { label: string; color: string; description: string }> = {
  new_reverted: {
    label: '新建未生效',
    color: 'gold',
    description: '新建未生效 Job 随单回退 draft（撤回「提交生效」，等待下次提交）',
  },
  modified_kept: {
    label: '已生效修改',
    color: 'blue',
    description: '已生效 Job 的修改将不生效，将随复现变更单再次进入确认（deployed_snapshot + 随单回滚登记至 v0.3）',
  },
  deleted_restored: {
    label: '删除停用',
    color: 'purple',
    description: '删除 / 停用型将自动恢复（删除恢复启用 / 停用恢复启用）',
  },
  missing: {
    label: '未命中',
    color: 'default',
    description: '部分源对象未命中分类，保持当前生效配置不变',
  },
}

/** 由变更清单项派生废弃影响分类（原型模拟后端 discard-impact，真实场景由 discard 接口返回） */
function computeDiscardImpact(draft: ConfigDraft): { category: DiscardImpactCategory; count: number }[] {
  const items = draft?.change_items ?? []
  if (items.length === 0) return [{ category: 'missing', count: 0 }]
  const byType: Record<DiscardImpactCategory, number> = { new_reverted: 0, modified_kept: 0, deleted_restored: 0, missing: 0 }
  items.forEach((i) => {
    if (i.type === 'add') byType.new_reverted++
    else if (i.type === 'modify') byType.modified_kept++
    else if (i.type === 'remove') byType.deleted_restored++
    else byType.missing++
  })
  return (Object.keys(byType) as DiscardImpactCategory[])
    .filter((c) => byType[c] > 0)
    .map((c) => ({ category: c, count: byType[c] }))
}

/** 配置产物形态分层（决策 6 / 决策 32）：channel=local（如 default）=本地文件集（无 zip/metadata.json），channel=agent_pull=zip 配置包（含 metadata.json） */
function renderPackageTree(channel: Channel | undefined, domainId: string, draft: ConfigDraft) {
  const isZip = domainArtifactShape({ channel: channel ?? 'local' }) === 'zip_package'
  const hasBlackbox = Boolean(draft.blackbox_yml)
  const targetJobs = Object.keys(targetsFilesToText(draft.targets_files))
  const targetsLines = targetJobs
    .map((job, i) => `${i === targetJobs.length - 1 ? '│   └──' : '│   ├──'} ${job}.json`)
    .join('\n')
  const preStyle = {
    margin: 0,
    padding: 12,
    background: '#F7F8FA',
    border: '1px solid #E5E6EB',
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.8,
    fontFamily: "'SFMono-Regular', Consolas, Menlo, Courier, monospace",
  }
  // local 通道（如 default）：本地文件集，直接写中心 Prometheus 配置目录，无 zip / metadata.json（决策 6 / 决策 32）
  if (!isZip) {
    return (
      <pre style={preStyle}>
        {`本地文件集（直接写入中心 Prometheus 配置目录）
├── prometheus.yml
├── targets/
${targetsLines}
├── rules.yml
└── blackbox.yml${hasBlackbox ? '' : '（当前无 blackbox Job，不生成）'}

# alertmanager.yml 由告警通知模块管理，不属于本模块配置产物`}
      </pre>
    )
  }
  // agent_pull 通道：zip 配置包（含 metadata.json 供 Agent 拉取后 checksum 校验）
  return (
    <pre style={preStyle}>
      {`edge-config-${domainId}.zip
├── prometheus.yml
├── targets/
${targetsLines}
├── blackbox.yml${hasBlackbox ? '' : '（当前无 blackbox Job，不打包）'}
├── rules.yml
└── metadata.json

# alertmanager.yml 由告警通知模块管理，不进入本配置包`}
    </pre>
  )
}

export function ConfigPreviewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  /** 抽屉中打开的变更（决策 20：列表点击 → 右侧抽屉查看变更详情），null=未打开 */
  const [detailDraft, setDetailDraft] = useState<ConfigDraft | null>(null)
  /** {v1.38} 变更单列表数据（决策 38-2：校验失败「重新校验」后更新行状态；初始化自 mock） */
  const [draftList, setDraftList] = useState<ConfigDraft[]>(() => [...configDrafts])
  /** {v1.39 决策 39-1} 正在重新校验中的变更单 ID 集合（按钮原地转 loading） */
  const [revalidatingIds, setRevalidatingIds] = useState<Set<string>>(new Set())
  /** {v1.50 决策 43} 废弃分类知情告知 Modal 的待废弃草稿（null=未打开）：废弃前先算影响分类、弹窗告知再确认 */
  const [discardTarget, setDiscardTarget] = useState<ConfigDraft | null>(null)
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>('preview')
  const [activeFile, setActiveFile] = useState<PreviewFileKey>('prometheus.yml')
  /** 用户是否手动选择过预览文件 Tab（决策 19）：未手动选择时默认聚焦第一个受影响文件；用户选择后跟随用户 */
  const [activeFileTouched, setActiveFileTouched] = useState(false)
  const [activeTargetJob, setActiveTargetJob] = useState<string>()
  /** 变更状态筛选（决策 21）：默认仅展示待确认（pending）；已确认 / 已废弃 / 全部 可切换（替代原「待确认 / 历史」Switch） */
  const [statusFilter, setStatusFilter] = useState<DraftStatusFilter>('pending')

  // {v1.29} 配置变更确认页仅展示已纳管网域；未纳管网域不会生成 ConfigDraft
  const domainOptions = useMemo(
    () => networkDomains.filter((d) => d.registration_status === 'monitored').map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })),
    []
  )
  // {v1.37} 默认选中规则（断点修复）：优先 URL 预选网域（「前往配置确认」跳转带参）→ 显式优先 default → 首个已纳管网域
  const defaultDomainId =
    (searchParams.get('network_domain') &&
    domainOptions.some((o) => o.value === searchParams.get('network_domain'))
      ? searchParams.get('network_domain')
      : null) ??
    domainOptions.find((o) => o.value === 'default')?.value ??
    domainOptions[0]?.value ??
    networkDomains[0].id
  const [selectedDomain, setSelectedDomain] = useState<string>(defaultDomainId)

  /** 所属网域列：network_domain_id → 网域名称（与下发记录页展示一致） */
  const domainMap = useMemo(() => Object.fromEntries(networkDomains.map((d) => [d.id, d.name])), [])

  /** {v1.33} 网域 → 下发通道映射（决策 31/32/33）：发布通道 / 产物形态 / 生效提示均按下发通道区分 */
  const channelByDomainId = useMemo(() => {
    return Object.fromEntries(networkDomains.map((d) => [d.id, d.channel])) as Record<string, Channel>
  }, [])

  /** 全链路关联（决策 22）：change_no → 配置版本号（cv-xxx），已确认变更展示其发布版本，定位回滚目标 */
  const versionByChangeNo = useMemo(
    () => Object.fromEntries(configVersions.map((v) => [v.change_no, v.id])),
    []
  )

  // 决策 31：按网域组织视图（网域切换器列出所有已纳管网域），不依赖单/多网域运行时开关
  const activeDomainId = selectedDomain

  /** {v1.37} 单域/单通道收敛（断点修复）：所有已纳管网域均同一通道时，「下发通道」列信息量为零，隐藏该列 */
  const showChannelColumn = new Set(domainOptions.map((o) => channelByDomainId[o.value])).size > 1

  /** 当前选中网域与其下发通道（决策 32：配置产物形态按下发通道分层，local=本地文件集，agent_pull=zip 配置包） */
  const activeDomain = networkDomains.find((d) => d.id === activeDomainId)
  const isAgentPullDomain = activeDomain?.channel === 'agent_pull'

  /** {v1.37} 网域级配置同步状态（决策 37-1）：local 通道由最近一次 ConfigDeployment 派生
   *  （success→已同步 / failed→未同步 / 无 success 下发→未下发配置）；agent_pull 由 EdgeAgent 心跳回执派生 */
  const domainSyncStatus = useMemo<ConfigSyncStatus>(() => {
    const domainDeployments = configDeployments.filter((d) => d.network_domain_id === activeDomainId)
    const latest = [...domainDeployments].sort((a, b) => b.triggered_at.localeCompare(a.triggered_at))[0]
    if (!latest) {
      const agent = edgeAgents.find((a) => a.network_domain_id === activeDomainId)
      if (agent) return agent.config_sync_status
      return 'no_version'
    }
    if (latest.status === 'success' || latest.status === 'rolled_back') return 'in_sync'
    if (latest.status === 'failed') return 'out_of_sync'
    return 'unknown'
  }, [activeDomainId])

  /** {v1.37} 网域级配置同步状态四档 UI 映射（决策 37-1）：未下发配置 / 未同步 / 已同步 / 人工覆盖 */
  const domainSyncStatusUI: Record<ConfigSyncStatus, { color: string; label: string }> = {
    no_version: { color: 'default', label: '未下发配置' },
    out_of_sync: { color: 'warning', label: '未同步' },
    in_sync: { color: 'success', label: '已同步' },
    manual_override: { color: 'error', label: '人工覆盖' },
    unknown: { color: 'default', label: '未知' },
  }

  /** 该网域全部草稿（含历史草稿） */
  const domainDrafts = useMemo(
    () => draftList.filter((d) => d.network_domain_id === activeDomainId),
    [activeDomainId, draftList]
  )

  /** 当前视图草稿：按状态筛选（决策 21，默认待确认） */
  const drafts = useMemo(
    () => domainDrafts.filter((d) => (statusFilter === 'all' ? true : d.status === statusFilter)),
    [domainDrafts, statusFilter]
  )

  /** 该网域待确认变更数（决策 20：引导性检测状态联动） */
  const pendingCount = useMemo(
    () => domainDrafts.filter((d) => d.status === 'pending').length,
    [domainDrafts]
  )

  /** 变更检测状态（决策 20：引导性状态条，不记历史；技术信息折叠） */
  const detectionStatus = changeDetectionStatus.find((s) => s.network_domain_id === activeDomainId)

  /** 当前抽屉中的变更 = detailDraft；draft 相关派生数据均以抽屉变更为主体 */
  const draft = detailDraft

  const handleSelectDomain = (domainId: string) => {
    setSelectedDomain(domainId)
    setDetailDraft(null)
    setStatusFilter('pending')
    setViewMode('preview')
    setActiveFile('prometheus.yml')
    setActiveFileTouched(false)
    setActiveTargetJob(undefined)
  }

  /** 变更状态筛选（决策 21）：切换状态时关闭抽屉，避免详情与列表不一致 */
  const handleStatusFilterChange = (value: DraftStatusFilter) => {
    setStatusFilter(value)
    setDetailDraft(null)
  }

  const previousVersion = useMemo(
    () =>
      configVersions
        .filter((v) => v.network_domain_id === activeDomainId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[1],
    [activeDomainId]
  )

  const draftTargetsText = useMemo(() => targetsFilesToText(draft?.targets_files), [draft])
  const targetJobs = useMemo(() => Object.keys(draftTargetsText), [draftTargetsText])
  const prevTargetsText = useMemo(() => targetsFilesToText(previousVersion?.targets_files), [previousVersion])

  /**
   * 受影响配置文件集（决策 19）：draft 与上一生效 ConfigVersion 各文件内容对比，
   * 标记本次变更受影响的配置文件 Tab（YAML 预览高亮）；targets 任一 job 文件内容变化即视为受影响；metadata.json 为元数据不算配置变更。
   */
  const affectedFiles = useMemo(() => {
    const affected = new Set<PreviewFileKey>()
    if (!draft) return affected
    const prev = previousVersion
    const prevText = (field: 'prometheus_yml' | 'rules_yml' | 'blackbox_yml') => (prev ? prev[field] : '')
    if (draft.prometheus_yml !== prevText('prometheus_yml')) affected.add('prometheus.yml')
    if (draft.rules_yml !== prevText('rules_yml')) affected.add('rules.yml')
    if (draft.blackbox_yml !== prevText('blackbox_yml')) affected.add('blackbox.yml')
    const prevTargets = prev ? targetsFilesToText(prev.targets_files) : {}
    const targetsChanged = Object.keys({ ...prevTargets, ...draftTargetsText }).some(
      (job) => (prevTargets[job] ?? '') !== (draftTargetsText[job] ?? '')
    )
    if (targetsChanged) affected.add('targets')
    return affected
  }, [draft, previousVersion, draftTargetsText])

  /**
   * 决策 19：默认聚焦第一个受影响文件（YAML 预览 Tab），让用户优先看到实际变更内容；
   * 用户手动选择过 Tab 后（activeFileTouched）跟随用户选择，不强制跳转。
   */
  const effectiveActiveFile = useMemo<PreviewFileKey>(() => {
    if (!activeFileTouched && draft && affectedFiles.size > 0) {
      const first = FILE_TABS.find((t) => affectedFiles.has(t.key))
      if (first) return first.key
    }
    return activeFile
  }, [activeFile, activeFileTouched, draft, affectedFiles])

  const handleTabChange = (key: string) => {
    setActiveFile(key as PreviewFileKey)
    setActiveFileTouched(true)
  }

  const effectiveTargetJob = useMemo(() => {
    if (activeTargetJob && targetJobs.includes(activeTargetJob)) return activeTargetJob
    return targetJobs[0]
  }, [activeTargetJob, targetJobs])

  /** diff 跟随当前 Tab：与上一 ConfigVersion 的同一文件对比（PRD 3.4 按文件 diff） */
  const diffRows = useMemo(() => {
    if (!draft || !DIFFABLE_FILES.includes(effectiveActiveFile)) return []
    let oldText: string
    let newText: string
    if (effectiveActiveFile === 'targets') {
      oldText = prevTargetsText[effectiveTargetJob] ?? ''
      newText = draftTargetsText[effectiveTargetJob] ?? ''
    } else {
      const field =
        effectiveActiveFile === 'prometheus.yml'
          ? 'prometheus_yml'
          : effectiveActiveFile === 'rules.yml'
          ? 'rules_yml'
          : 'blackbox_yml'
      oldText = previousVersion?.[field] ?? ''
      newText = draft[field]
    }
    return computeDiff(oldText, newText)
  }, [draft, previousVersion, effectiveActiveFile, effectiveTargetJob, prevTargetsText, draftTargetsText])

  const activeFileText = useMemo(() => {
    if (!draft) return ''
    if (effectiveActiveFile === 'targets') return draftTargetsText[effectiveTargetJob] ?? ''
    if (effectiveActiveFile === 'metadata.json') return ''
    const field =
      effectiveActiveFile === 'prometheus.yml'
        ? 'prometheus_yml'
        : effectiveActiveFile === 'rules.yml'
        ? 'rules_yml'
        : 'blackbox_yml'
    return draft[field]
  }, [draft, effectiveActiveFile, effectiveTargetJob, draftTargetsText])

  const previousFileText = useMemo(() => {
    if (!previousVersion) return ''
    if (effectiveActiveFile === 'targets') return prevTargetsText[effectiveTargetJob] ?? ''
    if (effectiveActiveFile === 'metadata.json') return ''
    const field =
      effectiveActiveFile === 'prometheus.yml'
        ? 'prometheus_yml'
        : effectiveActiveFile === 'rules.yml'
        ? 'rules_yml'
        : 'blackbox_yml'
    return previousVersion[field] ?? ''
  }, [previousVersion, effectiveActiveFile, effectiveTargetJob, prevTargetsText])

  const handleCopyChecksum = (checksum: string) => {
    navigator.clipboard.writeText(checksum).then(() => message.success('联合 checksum 已复制'))
  }

  const handleConfirm = () => {
    if (draft?.validation_status === 'failed') {
      message.error('下发前校验未通过，禁止下发')
      return
    }
    // 决策 19：确认动作记录确认人（当前登录用户），历史变更可审计「谁确认了高风险变更」；MVP 预置，用户管理接入后同步（决策 20）
    // {v1.33} 发布通道按下发通道提示：local 通道确认后立即 reload 生效；agent_pull 通道发布为配置包，待 Edge Sync Agent 下次心跳拉取生效
    // {v1.40 决策 40-3} agent_pull 确认后动线引导：正常路径无需任何点击（心跳自动拉取，out_of_sync → in_sync 自动流转），仅成因 C（本地环境变化）才需要「立即同步」；补充「采集节点状态」页入口
    const isAgentPull = activeDomain?.channel === 'agent_pull'
    message.success(
      isAgentPull
        ? `变更单 ${draft?.change_no} 已确认，已发布配置包，待 Edge Sync Agent 下次心跳拉取生效（准实时 30s）。可在「采集节点状态」页查看配置同步状态并确认生效进度（确认人：${CURRENT_USER}）`
        : `变更单 ${draft?.change_no} 已确认并发布到监控（确认人：${CURRENT_USER}）`
    )
    setDetailDraft(null)
  }

  const handleDiscard = () => {
    // {v1.50 决策 43} 废弃前先弹「分类知情告知」Modal（由后端 discard-impact 计算影响分类），确认后才执行源数据分类回写
    if (!draft) return
    setDiscardTarget(draft)
  }

  /** {v1.50 决策 43} 确认废弃：变更单置 discarded + 源数据分类回写（原型模拟；真实场景由 discard 接口按分类回写源数据，
   *  new_reverted 回退 draft / modified_kept 保留并随复现变更单再次确认 / deleted_restored 自动恢复；change_status 清理、不残留 pending） */
  const confirmDiscard = () => {
    if (!discardTarget) return
    const impacts = computeDiscardImpact(discardTarget)
    const modifiedKept = impacts.some((i) => i.category === 'modified_kept')
    setDraftList((prev) => prev.map((d) => (d.id === discardTarget.id ? { ...d, status: 'discarded' as const } : d)))
    setDetailDraft(null)
    setDiscardTarget(null)
    message.info(
      `变更单 ${discardTarget.change_no} 已废弃：${impacts
        .map((i) => `${DISCARD_IMPACT_META[i.category].label}×${i.count}`)
        .join('、')}，源数据已按分类回写，保持当前生效配置不变`
    )
    if (modifiedKept) {
      message.warning('已生效 Job 的修改不生效，将随复现变更单再次进入确认（deployed_snapshot + 随单回滚登记至 v0.3）', 4)
    }
  }

  /** {v1.39 决策 39-1} 校验失败行内「重新校验」——点击后什么都不弹，按钮原地转 loading，行内「校验」列原地刷新结果；
   *  用户配置问题应先到 M01 修正源数据，再回来点重新校验（重新生成产物再校验，不是对旧产物重跑）；
   *  技术故障自动重试（用户不可见），持续失败标记「平台故障」仅提示（本按钮仅用户配置问题展示） */
  const handleRevalidate = (target: ConfigDraft) => {
    setRevalidatingIds((prev) => new Set(prev).add(target.id))
    // 模拟重新校验延迟（真实场景：重新生成产物→重新校验）
    setTimeout(() => {
      setDraftList((prev) =>
        prev.map((d) =>
          d.id === target.id
            ? { ...d, validation_status: 'passed' as const, validation_error: '', validation_cause: undefined, validation_details: undefined }
            : d
        )
      )
      setDetailDraft((prev) =>
        prev && prev.id === target.id
          ? { ...prev, validation_status: 'passed' as const, validation_error: '', validation_cause: undefined, validation_details: undefined }
          : prev
      )
      setRevalidatingIds((prev) => {
        const next = new Set(prev)
        next.delete(target.id)
        return next
      })
      message.success(`变更单 ${target.change_no} 已重新校验：校验通过，可确认发布（若为配置问题，请先在 M01 修正源数据）`)
    }, 1500)
  }

  const validationFailed = draft?.validation_status === 'failed'

  /** 变更状态筛选（决策 21）：Segmented 替代原「待确认 / 历史」Switch，状态维度清晰且可扩展 */
  const statusFilterBar = (
    <Segmented
      size="small"
      options={STATUS_FILTER_OPTIONS}
      value={statusFilter}
      onChange={(v) => handleStatusFilterChange(v as DraftStatusFilter)}
    />
  )

  const openDetail = (record: ConfigDraft) => {
    setDetailDraft(record)
    setViewMode('preview')
    setActiveFile('prometheus.yml')
    setActiveFileTouched(false)
    setActiveTargetJob(undefined)
  }

  return (
    <MainLayout>
      <Card
        title="配置变更确认"
        extra={
          // [DECISION D31] 按网域组织视图，网域切换器列出所有已纳管网域（不依赖单/多网域运行时开关）
          // [DECISION D37-1] 网域切换器旁展示网域级配置同步状态（单域 MVP 下 local 通道同步状态唯一落点）
          <Space>
            <span className="text-secondary">选择网域：</span>
            <Select
              value={selectedDomain}
              onChange={handleSelectDomain}
              options={domainOptions}
              style={{ width: 240 }}
            />
            <span className="text-secondary">配置同步：</span>
            <Tooltip
              title={
                activeDomain?.channel === 'local'
                  ? 'local 通道网域级配置同步状态由最近一次下发记录派生（success→已同步 / failed→未同步，可重试 / 无 success 下发→未下发配置）'
                  : 'agent_pull 通道网域级配置同步状态由 Edge Sync Agent 心跳回执派生（详情见「采集节点状态」页）'
              }
            >
              <Tag color={domainSyncStatusUI[domainSyncStatus].color}>
                {domainSyncStatusUI[domainSyncStatus].label}
              </Tag>
            </Tooltip>
          </Space>
        }
      >
        {/* [DECISION D31/D32/D33] 当前选中网域的发布通道标注：local / agent_pull 及对应生效提示（一行短说明，非告警） */}
        {activeDomain && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            发布通道：{channelLabel[activeDomain.channel]}（{activeDomain.name}）；
            {activeDomain.channel === 'agent_pull'
              ? '确认后发布为配置包，待 Edge Agent 下次心跳拉取生效（准实时 30s）'
              : '确认后由中心写盘并 reload 立即生效'}
          </Text>
        )}

        {/* 原「本页确认什么 / 审批分级 / 审批信息与技术排查分工」三个说明 Alert 合并为评审说明（决策编号与 PRD 引用仅保留于此） */}
        <ReviewNote title="本页设计说明">
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              本页确认什么（决策 18/20）：监控对象（Module_07）、采集策略与告警规则（Module_01）变更后配置自动生成
              （平台保证生成内容与策略一致）；本页汇总待发布变更，确认对象是「要不要上线」，而非「配置怎么生成」。
            </li>
            <li>
              审批分级（{'{v1.32}'} 决策 32）：
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>{approvalTieringNote.manual}</li>
                <li>{approvalTieringNote.auto}</li>
                <li>{approvalTieringNote.mixed}</li>
                <li>{approvalTieringNote.reason}</li>
              </ul>
            </li>
            <li>
              审批信息与技术排查的分工（{'{v1.28}'} ITIL 边界声明）：审批决策依据 = 人话变更摘要 + 变更清单 + 风险等级（本页主区）；
              配置预览 / Diff（YAML）为技术排查工具，不构成审批上下文——将来对接外部审批平台（ITSM）时，
              审批单仅含人话摘要 / 影响范围 / 风险等级，配置产物与技术细节不传出平台。
            </li>
            <li>
              change_status 全链路回写 M01（{'{v1.43}'}，联动 M01 草稿，M01 侧 v3.22 演示）：
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>{changeStatusEnumDemo.pending}</li>
                <li>{changeStatusEnumDemo.confirmed}</li>
                <li>
                  {changeStatusEnumDemo.deployed}
                  <MVPTag />
                </li>
                <li>{changeStatusEnumDemo.none}</li>
              </ul>
            </li>
            <li>
              采集认证 / TLS 透传映射（{'{v1.50 决策 31}'}，MVP 必实现）：{authTlsPassthroughNote}——下方配置预览 scrape_configs 中，
              gov-cloud-a 域 node-exporter job 演示 basic_auth + tls_config 透传、blackbox-http job 演示 tls_config 透传（HTTPS 拨测）。
            </li>
            <li>
              冻结（禁用）网域不生成新变更单（{'{v1.50 决策 30}'}）：{frozenDomainExclusionNote}——冻结域的变更不再进入本页待确认列表。
            </li>
            <li>
              配置生成按域拆分扇出（{'{v1.51 决策 54}'}，v0.2 起）：{jobDomainFanoutNote}——下方待确认列表天然按网域分组、
              每域独立的变更单，多域绑定的逻辑 Job 无需在本页手工克隆。
            </li>
            <li>
              filter 模式实时求值（{'{v1.51 决策 53}'}，由 v0.3+ 提前到 v0.2）：{filterRealTimeEvaluationNote}——
              条件式采集策略的变更单其 targets 由条件实时展开，本页「变更摘要 / 变更清单」会标注「自动纳入 / 自动移出」。
            </li>
          </ul>
        </ReviewNote>

        <ReviewNote title="配置产物结构说明（面向产品 / 开发评审）" style={{ marginBottom: 16 }}>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              local 通道：产物为本地文件集，确认后 SIGHUP / POST /-/reload 生效，无 zip / metadata.json；版本一致性由 ConfigVersion 记录保证。
            </li>
            <li>
              agent_pull 通道：产物为 zip 配置包，含 metadata.json（config_version、生成时间、agent_type、联合 checksum sha256），供 Edge Agent 拉取后完整性校验。
            </li>
            <li>
              rules.yml（{'{v1.48 决策 38-1 规则文件挂载}'}）：MVP 由 Module_01 规则编辑页「文件挂载」的 `MonitoringRule.rule_content`（content_mode=yaml_passthrough，整份 rules.yml）**原样透传并入**，group 随文件自带、不按字段派生；保存 / 启停 / 删除规则后进入变更检测 → 变更单人工确认 → 下发，`change_status` 全链路回写 M01（不绕过配置中心）。v0.3 字段级编辑（structured）后改为按字段派生分组。external_labels 仅注入部署级元数据 network_domain_id / zone_type / replica（tenant / biz 由标签模板以 target 级注入）；alertmanager.yml 由告警通知模块管理，不进入本模块产物。
            </li>
            <li>
              targets/*.json 中每个 target 的 labels 由 LabelTemplate 静态展开（含 business_domain→biz、tenant_id→tenant 等映射）——biz / tenant 等 target 级标签不经 external_labels 注入；业务与网域正交，一个网域可承载多个业务的资源。
            </li>
            <li>
              targets/*.json 固定文件名覆盖写、原子写，不触发采集器 reload；仅 prometheus.yml 结构变化才触发 reload。
            </li>
            <li>
              `offline` 排除（MVP 必实现，{'{v1.49 决策 29}'}，跨模块契约，对齐 Module_07 8.1 / Module_01 3.1）：生成 `targets/*.json` 时按 `Resource.status=offline` **过滤已下线实例**——`offline` 不进入 `targets/*.json`，`offline` 后下一配置生成周期即从 targets 移除。`maintenance` 排除口径与 Module_07 8.1 一并对齐（MVP 不保证）。
            </li>
            <li>
              删除「未指定网域资源自动归 default」兜底（{'{v1.50 决策 31-M3}'}）：{defaultFallbackRemovalNote}——不再存在「未归类资源 = default 域」的隐式映射，配置生成仅覆盖已明确归属到网域的采集对象。
            </li>
          </ul>
        </ReviewNote>

        <Card size="small" title="变更检测状态" style={{ marginBottom: 16 }}>
          {pendingCount > 0 ? (
            <Text type="warning" style={{ display: 'block' }}>
              检测到 {pendingCount} 个待确认变更：监控对象 / 策略 / 规则已有新变化，请前往下方「待确认」列表逐项确认后发布
              （含 {domainDrafts.filter((d) => d.status === 'pending' && d.change_items.some((i) => i.risk === 'high')).length} 个高风险变更）。
            </Text>
          ) : (
            <Text type="success" style={{ display: 'block' }}>
              当前无待确认变更：监控对象 / 策略 / 规则变更后，配置会自动生成并在此汇总；无实际影响的变更（内容无变化）已自动过滤，无需确认。
            </Text>
          )}
          {/* {v1.47 决策 42-4} 生成失败态横幅：configgen 生成异常 → 与「无变更」区分，避免变更静默丢失 */}
          {detectionStatus?.outcome === 'generation_failed' && (
            <Text type="danger" style={{ display: 'block', marginTop: 4 }}>
              变更检测失败：configgen 生成异常（{detectionStatus.summary}）。本轮不推进源数据版本，下一轮轮询自动重试；持续失败请查看平台日志。
            </Text>
          )}
          {/* {v1.43} 草稿对象不生成配置变更（联动 M01 草稿，PRD 3.3）：解释为什么编辑中的 Job 不出现在变更单里 */}
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            草稿对象（draft）不生成配置变更：仅「已提交」的 Job / 规则提交生效后才进入变更检测——编辑中的 Job 不会出现在变更单里。
          </Text>
          {/* {v1.51 决策 54/53} 按域扇出 + filter 实时纳入的用户语说明：解释多域 Job 如何自动拆分、条件式纳入为何无需编辑策略 */}
          <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
            {jobDomainFanoutNote} {filterRealTimeEvaluationNote}（本批下拉列表中的条件式采集变更单即按此自动纳入演示）。
          </Text>
          {detectionStatus && (
            <Collapse
              ghost
              size="small"
              style={{ marginTop: 8 }}
              items={[
                {
                  key: 'tech',
                  label: (
                    <Space size={4}>
                      <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      检测技术信息（上次检测时间 / 检测结果 / 校验值裁决）
                    </Space>
                  ),
                  children: (
                    <>
                      <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }}>
                        <Descriptions.Item label="上次检测时间">{detectionStatus.last_checked_at}</Descriptions.Item>
                        <Descriptions.Item label="当前源数据版本">
                          <Text code>{detectionStatus.source_data_version}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="检测结果">
                          <Tag color={detectionOutcomeColor[detectionStatus.outcome]}>
                            {detectionOutcomeLabel[detectionStatus.outcome]}
                          </Tag>
                        </Descriptions.Item>
                      </Descriptions>
                      <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
                        校验值裁决说明：策略或资源变更后，若重算校验值与当前生效版本一致，则自动丢弃草稿；仅存在实际差异的变更才需确认。
                      </Text>
                    </>
                  ),
                },
              ]}
            />
          )}
        </Card>

        <Card size="small" title="变更列表" extra={statusFilterBar}>
          {drafts.length > 0 ? (
            <Table<ConfigDraft>
              dataSource={drafts}
              rowKey="id"
              size="small"
              scroll={TABLE_SCROLL_X}
              pagination={TABLE_PAGINATION}
              rowClassName={(record) => (record.id === draft?.id ? 'bg-brand-light' : '')}
              onRow={(record) => ({
                onClick: () => openDetail(record),
                style: { cursor: 'pointer' },
              })}
              columns={([
                {
                  // 决策 20：变更单号 = 用户可读唯一标识（列表主列），用于沟通与审计追溯
                  title: '变更单号',
                  dataIndex: 'change_no',
                  key: 'change_no',
                  width: 160,
                  render: (changeNo: string) => <Text code>{changeNo}</Text>,
                },
                {
                  // 决策 18：变更摘要（人话）回答「为什么变更」；详情（变更清单）在抽屉中查看（决策 20）
                  // {v1.51 决策 54/53} 变更摘要标记：filter 条件式采集标「条件式」、多域扇出标来源逻辑 Job（无需手工克隆）
                  title: '变更摘要',
                  key: 'summary',
                  render: (_: unknown, record: ConfigDraft) => (
                    <Space size={6} wrap={false} style={{ maxWidth: 420 }}>
                      {record.selection_mode === 'filter' && (
                        <Tooltip title={`条件式采集（instance_selection_mode=filter）：targets 由条件实时求值，条件：${record.filter_condition ?? '-'}`}>
                          <Tag color="gold" style={{ marginInlineEnd: 0 }}>条件式</Tag>
                        </Tooltip>
                      )}
                      {record.source_logical_job && (
                        <Tooltip title={`多域扇出：由逻辑采集 Job ${record.source_logical_job} 按网域自动拆分，每域独立变更单`}>
                          <Tag color="purple" style={{ marginInlineEnd: 0 }}>{record.source_logical_job}</Tag>
                        </Tooltip>
                      )}
                      <Text ellipsis style={{ maxWidth: 300 }}>{record.summary}</Text>
                    </Space>
                  ),
                },
                {
                  // {v1.33} 行内保留下发通道标记（PRD 3.4）：local / agent_pull（与对应 NetworkDomain.channel 一致，决策 32）
                  title: (
                    <Tooltip title="该变更所属网域的下发通道：local（中心直接 reload）/ agent_pull（Edge Sync Agent 心跳拉取配置包）；决定确认后生效方式">
                      <Space size={4}>
                        下发通道
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'channel',
                  width: 130,
                  render: (_: unknown, record: ConfigDraft) => {
                    const channel = channelByDomainId[record.network_domain_id] ?? 'agent_pull'
                    return (
                      <Tooltip title={channelTip[channel]}>
                        <Tag color={channel === 'local' ? 'default' : 'blue'}>{channelLabel[channel]}</Tag>
                      </Tooltip>
                    )
                  },
                },
                {
                  // [DECISION D39-1] 下发前校验列置于「状态」列之前：校验状态先于变更状态，便于一眼定位需处理的失败单
                  title: (
                    <Tooltip title="中心内容校验结果：通过 / 未通过（点击红色「失败」Tag 查看行内失败原因与引导）">
                      <Space size={4}>
                        下发前校验
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  dataIndex: 'validation_status',
                  key: 'validation_status',
                  width: 200,
                  render: (status: DraftValidationStatus, record) => (
                    <Space size={4}>
                      {status === 'failed' ? (
                        <Popover
                          content={renderValidationFailPopover(record, (target) => handleRevalidate(target))}
                          title="校验失败原因"
                          trigger="click"
                          placement="right"
                        >
                          {/* stopPropagation：点击失败 Tag 只弹 Popover，不触发行点击打开抽屉 */}
                          <Tag
                            color={validationColor[status]}
                            style={{ cursor: 'pointer' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {validationLabel[status]}
                          </Tag>
                        </Popover>
                      ) : (
                        <Tooltip title="下发前校验（配置内容合法性与目标格式检查）">
                          <Tag color={validationColor[status]}>{validationLabel[status]}</Tag>
                        </Tooltip>
                      )}
                      {/* {v1.39 决策 39-1 / v1.50 决策 45-1} 校验失败「重新校验」行内出口：用户配置问题先到 M01 修正源数据再回来重校；
                          平台技术故障亦提供手动「重新校验」自愈（决策 45-1，pending/failed 均提供「重新校验 + 废弃」两出口，仅 passed 可确认） */}
                      {status === 'failed' && (
                        <Button
                          size="small"
                          type="link"
                          icon={<ReloadOutlined />}
                          loading={revalidatingIds.has(record.id)}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRevalidate(record)
                          }}
                        >
                          重新校验
                        </Button>
                      )}
                    </Space>
                  ),
                },
                {
                  // {v1.39} 状态列与操作入口区分开：状态 Tag 仅为状态标记（非按钮，点击不触发任何操作），操作统一走「操作」列按钮
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 120,
                  render: (status: ConfigDraftStatus, record: ConfigDraft) => (
                    <Tooltip title="状态标记（非按钮）：点击该行或「操作」列「详情」按钮打开详情处理">
                      <Space size={4}>
                        <Tag color={draftStatusColor[status]}>{draftStatusLabel[status]}</Tag>
                        {/* {v1.47 决策 42-1} 被同域更晚 pending 取代：标「已取代」并指向新单号，帮助运维识别被自动弃用的旧待确认单 */}
                        {record.metadata.superseded_by_change_no && (
                          <Tooltip title={`此变更单已被同域更晚的变更单 ${record.metadata.superseded_by_change_no} 取代（superseded），无需确认，保持当前生效配置不变`}>
                            <Tag color="purple">已取代</Tag>
                          </Tooltip>
                        )}
                      </Space>
                    </Tooltip>
                  ),
                },
                {
                  // 决策 19：风险等级列（取该变更最高风险），历史变更复盘 / 待确认决策均可见
                  title: (
                    <Tooltip title="该变更最高风险等级：低风险=新增目标；高风险=删除目标（监控断点）/ 告警规则变更（误报漏报）">
                      <Space size={4}>
                        风险等级
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'risk',
                  width: 100,
                  render: (_: unknown, record: ConfigDraft) => {
                    if (record.change_items.length === 0) return <Text type="secondary">-</Text>
                    const hasHigh = record.change_items.some((i) => i.risk === 'high')
                    return <Tag color={hasHigh ? riskColor.high : riskColor.low}>{hasHigh ? riskLabel.high : riskLabel.low}</Tag>
                  },
                },
                {
                  // 决策 19：确认人列（变更管理审计：谁在何时确认发布）；pending 未确认、discarded 已废弃
                  title: '确认人',
                  key: 'confirmed_by',
                  width: 130,
                  render: (_: unknown, record: ConfigDraft) =>
                    record.status === 'confirmed' && record.confirmed_by ? (
                      <Tooltip title={`确认时间：${record.confirmed_at ?? '-'}`}>
                        <Text>{record.confirmed_by}</Text>
                      </Tooltip>
                    ) : record.status === 'discarded' ? (
                      <Text type="secondary">已废弃</Text>
                    ) : (
                      <Text type="secondary">-</Text>
                    ),
                },
                {
                  // [DECISION D22] 已发布版本（cv-xxx）与发布记录入口下沉至抽屉（Descriptions「已发布配置版本」+「查看发布记录」按钮），列表不再占列
                  // [DECISION D19] 生成时间列下沉至抽屉 Descriptions「生成时间」，列表不再占列
                  // {v1.39} 独立「操作」列：状态 Tag 与操作按钮在视觉上区分开，用户无需猜测——操作入口统一在此列（详情=打开抽屉处理确认/废弃）
                  title: '操作',
                  key: 'actions',
                  width: 80,
                  fixed: 'right',
                  render: (_: unknown, record: ConfigDraft) => (
                    <Button
                      size="small"
                      type="link"
                      icon={<EyeOutlined />}
                      onClick={(e) => {
                        e.stopPropagation()
                        openDetail(record)
                      }}
                    >
                      详情
                    </Button>
                  ),
                },
                ] as TableColumnsType<ConfigDraft>
              ).filter((col) => showChannelColumn || (col as { key?: string }).key !== 'channel')}
            />
          ) : statusFilter === 'pending' ? (
            <Empty description="当前无待确认变更：策略或资源变更后配置自动生成；内容无实际影响的变更已自动过滤，此处仅展示需要人工确认的变更。可切换状态筛选查看已确认 / 已废弃变更。" />
          ) : statusFilter === 'all' ? (
            <Empty description="当前网域暂无配置变更" />
          ) : (
            <Empty description={`暂无${STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? ''}变更`} />
          )}
        </Card>

        {/* 决策 20：变更详情改为抽屉式——列表点击打开右侧抽屉，变更清单为核心详情，配置预览 / 技术信息 / 确认动作均收纳于抽屉 */}
        <Drawer
          title={
            draft ? (
              <Space direction="vertical" size={2}>
                <Space size={8}>
                  <Text strong style={{ fontSize: 15 }}>{draft.change_no}</Text>
                  <Tag color={draftStatusColor[draft.status]}>{draftStatusLabel[draft.status]}</Tag>
                  {draft.change_items.some((i) => i.risk === 'high') ? (
                    <Tag color={riskColor.high}>{riskLabel.high}</Tag>
                  ) : (
                    <Tag color={riskColor.low}>{riskLabel.low}</Tag>
                  )}
                  <Tag color={validationColor[draft.validation_status]}>{validationLabel[draft.validation_status]}</Tag>
                </Space>
                <Text type="secondary" style={{ fontSize: 13 }}>{draft.summary}</Text>
              </Space>
            ) : (
              '变更详情'
            )
          }
          width={920}
          open={draft !== null}
          onClose={() => setDetailDraft(null)}
          extra={
            draft && (
              <Space size={8}>
                <Text type="secondary">{domainMap[draft.network_domain_id] ?? draft.network_domain_id}</Text>
                {draft.status === 'pending' ? (
                  <>
                    <Button danger icon={<DeleteOutlined />} onClick={handleDiscard}>
                      废弃变更
                    </Button>
                    <Tooltip
                      title={
                        validationFailed
                          ? '下发前校验未通过，禁止下发'
                          : activeDomain?.channel === 'agent_pull'
                          ? '确认后发布为配置包，待 Edge Sync Agent 下次心跳拉取生效'
                          : '确认后立即 reload 生效'
                      }
                    >
                      <Button type="primary" icon={<CheckOutlined />} onClick={handleConfirm} disabled={validationFailed}>
                        确认发布
                      </Button>
                    </Tooltip>
                  </>
                ) : (
                  <Space size={8}>
                    {versionByChangeNo[draft.change_no] && (
                      <Tooltip title="前往发布记录页查看该变更的下发与回滚记录（按变更单定位）">
                        <Button
                          icon={<HistoryOutlined />}
                          onClick={() =>
                            navigate(`/deployments?change_no=${draft.change_no}&network_domain=${draft.network_domain_id}`)
                          }
                        >
                          查看发布记录
                        </Button>
                      </Tooltip>
                    )}
                    <Tag color="default">历史变更仅只读</Tag>
                  </Space>
                )}
              </Space>
            )
          }
        >
          {draft && (
            <>
              {/* 决策 18/20：变更清单 = 变更详情核心（抽屉内），回答「这次变更会带来什么影响」 */}
              <Card size="small" title="变更清单（本次变更的影响）" style={{ marginBottom: 16 }}>
                {draft.change_items.length > 0 ? (
                  <Table<ConfigChangeItem>
                    dataSource={draft.change_items}
                    rowKey={(item, idx) => `${item.target}-${idx}`}
                    size="small"
                    pagination={false}
                    columns={[
                      {
                        title: '变更类型',
                        key: 'type',
                        width: 90,
                        render: (_: unknown, item: ConfigChangeItem) => (
                          <Tag color={changeTypeColor[item.type]}>{changeTypeLabel[item.type]}</Tag>
                        ),
                      },
                      {
                        title: (
                          <Tooltip title="变更对象 = 你在监控策略 / 监控对象模块里修改的对象；新增实例与修改抓取频率源头都在「采集 Job」，但影响的配置文件不同（见右侧列）">
                            <Space size={4}>
                              变更对象
                              <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                            </Space>
                          </Tooltip>
                        ),
                        key: 'target',
                        width: 130,
                        render: (_: unknown, item: ConfigChangeItem) => (
                          <Tooltip title={changeTargetTip[item.target]}>
                            <Tag color="blue">{changeTargetLabel[item.target]}</Tag>
                          </Tooltip>
                        ),
                      },
                      { title: '变更说明', key: 'description', dataIndex: 'description' },
                      {
                        title: (
                          <Tooltip title="影响的配置文件：configgen 对比当前生效版本与草稿的产物差异派生，帮助理解该行变更的影响范围">
                            <Space size={4}>
                              影响的配置文件
                              <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                            </Space>
                          </Tooltip>
                        ),
                        key: 'affected-files',
                        width: 190,
                        render: (_: unknown, item: ConfigChangeItem) => (
                          <Space size={4} wrap>
                            {item.affected_files.map((f) => (
                              <Tag key={f} color={affectedFileColor[f]} style={{ marginInlineEnd: 0 }}>
                                {affectedFileLabel[f]}
                              </Tag>
                            ))}
                          </Space>
                        ),
                      },
                      {
                        title: '风险等级',
                        key: 'risk',
                        width: 110,
                        render: (_: unknown, item: ConfigChangeItem) => (
                          <Tooltip title={riskTip[item.risk]}>
                            <Tag color={riskColor[item.risk]}>{riskLabel[item.risk]}</Tag>
                          </Tooltip>
                        ),
                      },
                    ]}
                  />
                ) : (
                  <Empty description="无实际内容变化（已自动丢弃），无需确认" />
                )}
              </Card>

              <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 16 }}>
                <Descriptions.Item label="变更单号">
                  <Text code>{draft.change_no}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={draftStatusColor[draft.status]}>{draftStatusLabel[draft.status]}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="生成时间">{draft.created_at}</Descriptions.Item>
                {draft.status === 'confirmed' && versionByChangeNo[draft.change_no] && (
                  <Descriptions.Item label="已发布配置版本">
                    <Text code>{versionByChangeNo[draft.change_no]}</Text>
                  </Descriptions.Item>
                )}
              </Descriptions>

              {/* 决策 18：技术字段下沉折叠，仅供追溯排障 */}
              <Collapse
                ghost
                size="small"
                style={{ marginBottom: 16 }}
                items={[
                  {
                    key: 'tech',
                    label: (
                      <Space size={4}>
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                        技术信息（源数据版本 / 生成器版本 / 校验值 / 触发摘要）
                      </Space>
                    ),
                    children: (
                      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                        <Descriptions.Item label="生成器版本">{draft.metadata.generator_version}</Descriptions.Item>
                        <Descriptions.Item label="变更原因">{draft.metadata.reason}</Descriptions.Item>
                        <Descriptions.Item label="源数据版本">
                          <Text code>{draft.metadata.source_data_version}</Text>
                        </Descriptions.Item>
                        <Descriptions.Item label="触发摘要">{draft.metadata.trigger_summary}</Descriptions.Item>
                        <Descriptions.Item label="来源摘要">{draft.metadata.source_summary}</Descriptions.Item>
                        <Descriptions.Item label="联合校验值">
                          <Space size={4}>
                            <Text code style={{ fontSize: 12 }}>
                              {shortChecksum(draft.metadata.checksum)}
                            </Text>
                            <Tooltip title="复制完整校验值">
                              <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => handleCopyChecksum(draft.metadata.checksum)}
                              />
                            </Tooltip>
                          </Space>
                        </Descriptions.Item>
                      </Descriptions>
                    ),
                  },
                ]}
              />

              {/* {v1.50 决策 42-1 / 44-2} 被同域更晚 pending 取代的旧单详情：提示「已被新变更单取代」——无需确认，保持当前生效配置不变
                  （列表状态列已标「已取代」Tag；PRD §3.4 语义用轻量 banner 承载，遵守「用户主区 Alert ≤ 2」的结构约束） */}
              {draft?.metadata.superseded_by_change_no && (
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    padding: '8px 12px',
                    marginBottom: 16,
                    background: 'rgba(22,119,255,0.06)',
                    border: '1px solid rgba(22,119,255,0.35)',
                    borderRadius: 8,
                  }}
                >
                  <InfoCircleOutlined style={{ color: '#1677ff', marginTop: 3 }} />
                  <div style={{ fontSize: 13 }}>
                    <Text strong>{`此变更单已被同域更晚的变更单 ${draft.metadata.superseded_by_change_no} 取代（superseded）`}</Text>
                    <div style={{ marginTop: 2, color: 'rgba(0,0,0,0.65)' }}>无需确认，保持当前生效配置不变；请到列表中处理新变更单。</div>
                  </div>
                </div>
              )}

              {/* {v1.39} 决策 39-1：抽屉只承载变更清单 / Diff / 确认/废弃操作——校验失败时最多留一行 Alert 摘要，
                  详细校验信息（失败文件 + 行号 + 归因 + 引导）一律在列表「下发前校验」列行内查看，不进抽屉 */}
              {validationFailed && draft && (
                <Alert
                  message={`校验未通过（${validationCauseLabel[draft.validation_cause ?? 'user_config']}），请先在列表查看失败原因并处理`}
                  type="error"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
              )}

              <Card
                size="small"
                title={`配置产物结构${isAgentPullDomain ? '（zip 配置包，含 metadata.json）' : '（本地文件集，无 zip / metadata.json）'}`}
                style={{ marginBottom: 16 }}
              >
                {renderPackageTree(activeDomain?.channel, activeDomainId, draft)}
                {/* [DECISION D32] 配置产物形态按下发通道分层（卡片标题已含通道差异）：local=本地文件集（prometheus.yml + targets/*.json + rules.yml + blackbox.yml），
                    确认后 SIGHUP / -/reload，无 zip / metadata.json 下载校验（版本一致性由 ConfigVersion 记录保证）；agent_pull=zip 配置包（含 metadata.json，Agent 拉取后校验值校验）。
                    [DECISION D32/{v1.32}] rules.yml 分组由配置中心自动派生（见 rulesGroupDerivationNote）；external_labels 仅注入部署级元数据 network_domain_id / zone_type / replica（{v1.45} / PRD 3.3.1，不注入 tenant_id / 业务标签）；
                    [DECISION D32/{v1.44}/{v1.45}] targets/*.json 中每个 target 的 labels 为 LabelTemplate 静态展开的资源标签（含 business_domain→biz、tenant_id→tenant 等映射，
                    即 static_configs[].labels 注入）——biz / tenant 等 target 级标签不经过 external_labels，见「本抽屉设计说明」；
                    审批分级（{v1.32}）：alertmanager.yml 由 Module_08 直接管理并触发 Alertmanager reload，不进入本模块变更确认流程，产物中均不包含；
                    targets 变化仅原子重写 targets/*.json（临时文件 + rename），不触发采集器 reload；仅 prometheus.yml 结构变化才触发 reload（reload 策略分离）；
                    blackbox.yml 在网域存在 job_type=blackbox 的 ScrapeJob 时必含，且必须随 prometheus.yml 一同下发。 */}
              </Card>

              <Space style={{ marginBottom: 16 }}>
                <Button type={viewMode === 'preview' ? 'primary' : 'default'} icon={<EyeOutlined />} onClick={() => setViewMode('preview')}>
                  YAML 预览
                </Button>
                <Button type={viewMode === 'diff' ? 'primary' : 'default'} icon={<DiffOutlined />} onClick={() => setViewMode('diff')}>
                  版本 Diff
                </Button>
                {affectedFiles.size > 0 && (
                  <Tag color="error">
                    本次变更影响 {affectedFiles.size}/{DIFFABLE_FILES.length + 1} 个配置文件（已标记「变更」）
                  </Tag>
                )}
              </Space>

              <Tabs
                size="small"
                activeKey={effectiveActiveFile}
                onChange={handleTabChange}
                items={FILE_TABS.map((t) => ({
                  key: t.key,
                  // 决策 19：受影响的配置文件 Tab 高亮标记（「变更」Tag），未受影响文件正常展示
                  label: affectedFiles.has(t.key) ? (
                    <Space size={4}>
                      {t.label}
                      <Tag color="error" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', marginInlineEnd: 0 }}>
                        变更
                      </Tag>
                    </Space>
                  ) : (
                    t.label
                  ),
                }))}
                style={{ marginBottom: 12 }}
              />

              {effectiveActiveFile === 'targets' && targetJobs.length > 0 && (
                <Tabs
                  size="small"
                  activeKey={effectiveTargetJob}
                  onChange={setActiveTargetJob}
                  items={targetJobs.map((job) => ({ key: job, label: `${job}.json` }))}
                  style={{ marginBottom: 8 }}
                />
              )}

              {viewMode === 'preview' ? (
                effectiveActiveFile === 'metadata.json' ? (
                  isAgentPullDomain ? (
                    <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                      <Descriptions.Item label="config_version">
                        <Text code>{draft.id}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="agent_type">
                        {networkDomains.find((d) => d.id === draft.network_domain_id)?.agent_type ?? 'vmagent'}
                      </Descriptions.Item>
                      <Descriptions.Item label="generated_at">{draft.created_at}</Descriptions.Item>
                      <Descriptions.Item label="generator_version">{draft.metadata.generator_version}</Descriptions.Item>
                      <Descriptions.Item label="source_data_version">
                        <Text code>{draft.metadata.source_data_version}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="联合校验值">
                        <Space size={4}>
                          <Text code style={{ fontSize: 12 }}>
                            {draft.metadata.checksum}
                          </Text>
                          <Tooltip title="复制完整校验值">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => handleCopyChecksum(draft.metadata.checksum)}
                            />
                          </Tooltip>
                        </Space>
                      </Descriptions.Item>
                      <Descriptions.Item label="校验值算法" span={2}>
                        <Text type="secondary">
                          sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)，供边缘 Agent 拉取后完整性校验
                        </Text>
                      </Descriptions.Item>
                    </Descriptions>
                  ) : (
                    <Empty description="当前网域为本地文件集，配置产物不打包、无 metadata.json；联合校验值仅用于中心侧差异检测与裁决。" />
                  )
                ) : effectiveActiveFile === 'targets' && targetJobs.length === 0 ? (
                  <Empty description="当前变更无 targets 文件" />
                ) : (
                  renderYamlPreview(activeFileText)
                )
              ) : effectiveActiveFile === 'metadata.json' ? (
                isAgentPullDomain ? (
                  <Empty description="metadata.json 为配置包元数据，仅只读展示，不参与版本 diff。" />
                ) : (
                  <Empty description="当前网域为本地文件集，配置产物不打包、无 metadata.json，无需参与版本 diff。" />
                )
              ) : effectiveActiveFile === 'targets' && targetJobs.length === 0 ? (
                <Empty description="当前变更无 targets 文件" />
              ) : (
                <Row gutter={16}>
                  <Col span={12}>
                    <Card
                      size="small"
                      title={`旧版本${previousVersion ? ` (${previousVersion.id})` : ''}${effectiveActiveFile === 'targets' ? `：targets/${effectiveTargetJob}.json` : ''}`}
                    >
                      {previousVersion ? (
                        renderYamlPreview(previousFileText)
                      ) : (
                        <Empty description="无历史版本" />
                      )}
                    </Card>
                  </Col>
                  <Col span={12}>
                    <Card
                      size="small"
                      title={`新版本（当前变更${effectiveActiveFile === 'targets' ? `：targets/${effectiveTargetJob}.json` : ''}）`}
                    >
                      <div style={{ maxHeight: 480, overflow: 'auto', fontFamily: 'monospace', fontSize: 13 }}>
                        {diffRows.map((row, idx) => (
                          <div
                            key={idx}
                            style={{
                              background:
                                row.type === 'added'
                                  ? '#E6F9F2'
                                  : row.type === 'removed'
                                  ? '#FFEBE9'
                                  : 'transparent',
                              color: row.type === 'added' ? '#00B578' : row.type === 'removed' ? '#FF4C3A' : '#E8E9EA',
                              padding: '2px 8px',
                              whiteSpace: 'pre',
                            }}
                          >
                            {row.type === 'added'
                              ? `+ ${row.newLine ?? ''}`
                              : row.type === 'removed'
                              ? `- ${row.oldLine ?? ''}`
                              : `  ${row.oldLine ?? ''}`}
                          </div>
                        ))}
                      </div>
                    </Card>
                  </Col>
                </Row>
              )}

              {/* 原抽屉内「网闸约束 / 下发前校验说明 / 校验分层说明」三个说明 Alert 合并为评审说明（决策编号与 PRD 引用仅保留于此） */}
              <ReviewNote title="本抽屉设计说明（校验与网闸约束）" style={{ margin: '16px 0 0' }}>
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {/* {v1.37} 网闸约束仅 agent_pull 通道展示（决策 37 断点修复）：local 通道（如 default）无网闸拓扑、与用户无关 */}
                  {isAgentPullDomain && <li>{gatewayConstraintNote}（{'{v1.31}'}，强制，PRD §6）</li>}
                  <li>
                    {/* {v1.44}/{v1.45} 标签注入链路 + 业务-网域正交性（2026-08-19 决策 19/23）：
                        biz（business_domain→biz）与 tenant（tenant_id→tenant）均由 Module_07 LabelTemplate 注入
                        targets/*.json 的 static_configs[].labels，不由 external_labels 注入（external_labels 仅注入
                        network_domain_id / zone_type / replica 部署级元数据）；网域与业务正交——一个网域承载多个业务
                        （如 gov-cloud-a 同时承载 data-api + risk），biz + network_domain 组合过滤 */}
                    标签注入链路（PRD 3.3）：实例级业务标签 biz 由 Module_07 标签模板的 business_domain→biz 映射、
                    租户标签 tenant 由 tenant_id→tenant 映射，在生成 targets/*.json 时作为 static_configs[].labels 注入——
                    不经过本模块 external_labels（external_labels 仅注入部署级元数据 network_domain_id / zone_type / replica）；
                    业务与网域正交（多业务共用 1 网域），biz 只承载不可变业务编码，业务展示名不进标签；业务归属变更只原子
                    重写 targets/*.json，不触发采集器 reload。
                  </li>
                  <li>
                    下发前校验（决策 39-1）：配置生成后、发布或允许拉取前，必须先通过中心内容校验：promtool check config 校验
                    prometheus.yml（对 file_sd 仅检查文件存在性，不校验 SD 内容）；配置包含 blackbox.yml 时调用
                    blackbox_exporter --config.check 校验；targets JSON 由 configgen 侧 schema 校验（结构 / host:port / labels
                    合法性，弥补 promtool 缺口）。校验失败时草稿/版本保持原状态、不进入发布流程，并记录错误原因。
                  </li>
                  <li>
                    校验分层：
                    <ul style={{ paddingLeft: 18, margin: 0 }}>
                      <li>{validationLayeringNote.center}</li>
                      <li>{validationLayeringNote.edge}</li>
                      <li>{validationLayeringNote.agentDumbCheck}</li>
                      <li>{validationLayeringNote.checksumDualUse}</li>
                    </ul>
                  </li>
                </ul>
              </ReviewNote>

              {/* {v1.40 决策 40-3} agent_pull 确认后动线引导（确认抽屉底部入口）：已发布配置包 → 待 Edge Sync Agent 下次心跳拉取生效（准实时 30s）；
                  正常路径无需任何点击（心跳自动 out_of_sync → in_sync 流转），仅成因 C（本地环境变化）才需要「立即同步」；提供「前往采集节点状态」入口查看生效进度 */}
              {isAgentPullDomain && (
                <Alert
                  message="agent_pull 确认后动线：已发布配置包，待 Edge Sync Agent 下次心跳拉取生效（准实时 30s）"
                  description="确认后可在「采集节点状态」页查看配置同步状态（config_sync_status）确认生效进度——正常路径无需任何点击（out_of_sync → in_sync 随心跳自动流转），仅本地环境/地址变化（成因 C）才需要在该页点击「立即同步」强制重新拉包。"
                  type="success"
                  showIcon
                  action={
                    <Button
                      size="small"
                      onClick={() => navigate(`/node-status?network_domain=${draft.network_domain_id}`)}
                    >
                      前往采集节点状态
                    </Button>
                  }
                  style={{ marginTop: 16 }}
                />
              )}
            </>
          )}
        </Drawer>
      </Card>

      {/* {v1.50 决策 43} 废弃变更单「分类知情告知」Modal：废弃前由后端 discard-impact 计算影响分类并弹窗告知，
          确认后才执行源数据分类回写（new_reverted 回退 draft / modified_kept 保留并随复现变更单再次确认 / deleted_restored 自动恢复），
          change_status 统一回写、不残留 pending；废弃后下一轮轮询因「源版本=基线」不再复现内容相同的变更单 */}
      <Modal
        title="废弃变更单（源数据分类回写告知）"
        open={discardTarget !== null}
        onCancel={() => setDiscardTarget(null)}
        onOk={confirmDiscard}
        okText="确认废弃"
        okButtonProps={{ danger: true, icon: <DeleteOutlined /> }}
        cancelText="取消"
        width={560}
      >
        {discardTarget && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Text strong>{`变更单 ${discardTarget.change_no} 将被废弃，本次变更将保持当前生效配置不变`}</Text>
              <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(0,0,0,0.65)' }}>
                废弃不是「只废单不动数据」——为避免下一轮检测重新生成内容相同的变更单（鬼影复现），源数据将按以下分类自动回写：
              </div>
            </div>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {computeDiscardImpact(discardTarget).map(({ category, count }) => (
                <div key={category} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Tag color={DISCARD_IMPACT_META[category].color} style={{ flex: 'none', marginTop: 2 }}>
                    {DISCARD_IMPACT_META[category].label} ×{count}
                  </Tag>
                  <Text style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)' }}>{DISCARD_IMPACT_META[category].description}</Text>
                </div>
              ))}
            </Space>
            <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
              废弃后相关源对象 change_status 统一回写清除（不残留 pending）；废弃审计历史由本变更单承载。确认后将执行分类回写，且不可撤销。
            </div>
          </div>
        )}
      </Modal>
    </MainLayout>
  )
}

export default ConfigPreviewPage
