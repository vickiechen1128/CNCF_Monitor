import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Select, Button, Space, Tag, Descriptions, Row, Col, message, Alert, Table, Typography, Tooltip, Tabs, Collapse, Drawer, Segmented } from 'antd'
import { CheckOutlined, DeleteOutlined, DiffOutlined, EyeOutlined, CopyOutlined, InfoCircleOutlined, HistoryOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  configDrafts,
  configVersions,
  configDeployments,
  networkDomains,
  currentTenant,
  targetsFilesToText,
  changeDetectionStatus,
  domainArtifactShape,
  validationLayeringNote,
  type ConfigDraftStatus,
  type DraftValidationStatus,
  type ConfigDraft,
  type ConfigChangeItem,
  type ConfigChangeTarget,
  type AffectedConfigFile,
  type ChangeDetectionOutcome,
  type DomainType,
} from '../mocks/module-09'

const { Text } = Typography

/** 当前登录用户（决策 19：确认发布时记录确认人，历史变更可审计「谁确认了高风险变更」；MVP 阶段预置，用户管理接入后同步，决策 20） */
const CURRENT_USER = '张伟（运维）'

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
}

const detectionOutcomeLabel: Record<ChangeDetectionOutcome, string> = {
  changes_found: '检测到变更，已生成待确认草稿',
  no_change: '无新变更，无需确认',
  checksum_same: '内容无变化，无需确认',
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

/** 校验失败场景定位到对应文件 Tab（PRD 3.5.1）：promtool→prometheus.yml、configgen schema→targets、blackbox→blackbox.yml */
function tabValidationError(draft: ConfigDraft | undefined, file: PreviewFileKey): string {
  if (!draft || draft.validation_status !== 'failed') return ''
  const err = draft.validation_error
  if (file === 'prometheus.yml' && /promtool/i.test(err)) return err
  if (file === 'targets' && /targets|schema|configgen/i.test(err)) return err
  if (file === 'blackbox.yml' && /blackbox/i.test(err)) return err
  return ''
}

/** 配置产物形态分层（决策 6）：management=本地文件集（无 zip/metadata.json），edge=zip 配置包（含 metadata.json） */
function renderPackageTree(domainType: DomainType | undefined, domainId: string, draft: ConfigDraft) {
  const isEdge = domainArtifactShape({ domain_type: domainType ?? 'management' }) === 'zip_package'
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
  // 中心管理域（default）：本地文件集，直接写中心 Prometheus 配置目录，无 zip / metadata.json（决策 6）
  if (!isEdge) {
    return (
      <pre style={preStyle}>
        {`本地文件集（直接写入中心 Prometheus 配置目录，无 zip / metadata.json）
├── prometheus.yml      # 中心 Prometheus 主配置（job 骨架 + external_labels；确认后 SIGHUP / POST /-/reload）
├── targets/            # file_sd 目标文件（按 job 分文件，固定文件名覆盖写，原子写不触发采集器 reload）
${targetsLines}
├── rules.yml           # 中心统一求值规则（scope=central/both，MVP~v0.3 固定 central）
└── blackbox.yml        # 本域 blackbox 探测模块${hasBlackbox ? '' : '（当前无 job_type=blackbox 的 ScrapeJob，不生成）'}`}
      </pre>
    )
  }
  // 边缘域：zip 配置包（含 metadata.json 供 Agent 拉取后 checksum 校验）
  return (
    <pre style={preStyle}>
      {`edge-config-${domainId}.zip
├── prometheus.yml      # 本域 scrape_configs（仅 job 骨架，file_sd_configs 引用 targets/*.json，已注入 external_labels.network_domain / tenant_id）
├── targets/            # file_sd 目标文件（按 job 分文件，固定文件名覆盖写，原子写不触发采集器 reload）
${targetsLines}
├── blackbox.yml        # 本域 blackbox 探测模块${hasBlackbox ? '' : '（当前无 job_type=blackbox 的 ScrapeJob，不打包）'}
├── rules.yml           # 本域告警规则（scope=edge/both，v0.4+，见下方说明）
└── metadata.json       # config_version、生成时间、agent_type、联合 checksum（sha256(prometheus.yml+rules_yml+blackbox_yml+targets 内容)，供 Agent 拉取后完整性校验）`}
    </pre>
  )
}

export function ConfigPreviewPage() {
  const navigate = useNavigate()
  const multiSite = currentTenant.multi_site_enabled
  /** 抽屉中打开的变更（决策 20：列表点击 → 右侧抽屉查看变更详情），null=未打开 */
  const [detailDraft, setDetailDraft] = useState<ConfigDraft | null>(null)
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
  const defaultDomainId = domainOptions[0]?.value ?? networkDomains[0].id
  const [selectedDomain, setSelectedDomain] = useState<string>(defaultDomainId)

  /** 所属网域列：network_domain_id → 网域名称（与下发记录页展示一致） */
  const domainMap = useMemo(() => Object.fromEntries(networkDomains.map((d) => [d.id, d.name])), [])

  /** 全链路关联（决策 22）：change_no → 配置版本号（cv-xxx），已确认变更展示其发布版本，定位回滚目标 */
  const versionByChangeNo = useMemo(
    () => Object.fromEntries(configVersions.map((v) => [v.change_no, v.id])),
    []
  )

  /** 全链路关联（决策 22）：change_no → 已发布的下发记录数，提示「查看发布记录」入口 */
  const deploymentCountByChangeNo = useMemo(() => {
    const counter: Record<string, number> = {}
    configDeployments.forEach((d) => {
      counter[d.source_change_no] = (counter[d.source_change_no] ?? 0) + 1
    })
    return counter
  }, [])

  const activeDomainId = multiSite ? selectedDomain : defaultDomainId

  /** 当前选中网域与其类型（决策 6 配置产物形态分层：management=本地文件集，edge=zip 配置包） */
  const activeDomain = networkDomains.find((d) => d.id === activeDomainId)
  const isEdgeDomain = activeDomain?.domain_type === 'edge'

  /** 该网域全部草稿（含历史草稿） */
  const domainDrafts = useMemo(
    () => configDrafts.filter((d) => d.network_domain_id === activeDomainId),
    [activeDomainId]
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
    // {v1.20} 发布通道按域类型提示：管理域确认后立即 reload 生效；边缘域发布为配置包，待 Agent 下次心跳拉取生效
    const isEdge = activeDomain?.domain_type === 'edge'
    message.success(
      isEdge
        ? `变更单 ${draft?.change_no} 已确认，已发布为配置包，待边缘 Agent 下次心跳拉取生效（确认人：${CURRENT_USER}）`
        : `变更单 ${draft?.change_no} 已确认并发布到监控（确认人：${CURRENT_USER}）`
    )
    setDetailDraft(null)
  }

  const handleDiscard = () => {
    message.info(`变更单 ${draft?.change_no} 已废弃，保持当前生效配置不变`)
    setDetailDraft(null)
  }

  const validationFailed = draft?.validation_status === 'failed'
  const activeTabError = tabValidationError(draft ?? undefined, effectiveActiveFile)

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
          multiSite ? (
            <Space>
              <span className="text-secondary">选择网域：</span>
              <Select
                value={selectedDomain}
                onChange={handleSelectDomain}
                options={domainOptions}
                style={{ width: 240 }}
              />
            </Space>
          ) : (
            <Tag color="blue">单网域模式：仅面向 default 管理域</Tag>
          )
        }
      >
        {!multiSite && (
          <Alert
            message="单网域模式说明"
            description="当前租户未开启多网域能力，配置变更确认直接面向中心 Prometheus。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {/* 决策 18：人话说明「自动生成 + 人工审批」的职责边界；决策 20：检测状态为引导性状态条，与下方待确认列表联动 */}
        <Alert
          message="本页确认什么？"
          description={
            <span>
              监控对象（Module_07）、采集策略与告警规则（Module_01）变更后，配置会{' '}
              <Text strong>自动生成</Text>（平台保证生成内容与策略一致）。本页汇总待发布的配置变更，
              请确认<Text strong>变更内容</Text>与<Text strong>影响</Text>后，决定是否发布到监控——
              确认的对象是「要不要上线」，而不是「配置怎么生成」。
            </span>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {/* {v1.28} 技术确认 vs 审批上下文（ITIL 边界声明）：YAML 预览/Diff 为运维排查工具，不构成审批上下文；审批信息（人话摘要/变更清单/风险）为主区 */}
        <Alert
          message="审批信息与技术排查的分工"
          description={
            <span>
              审批决策依据 = 人话变更摘要 + 变更清单 + 风险等级（本页主区）；下方的配置预览 / Diff（YAML）
              是<Text strong>技术排查工具</Text>（供深入排查的运维核对配置生成是否正确），
              <Text strong>不构成审批上下文</Text>——将来对接外部审批平台（ITSM）时，
              审批单仅含人话摘要 / 影响范围 / 风险等级，配置产物与技术细节不传出平台。
            </span>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Card size="small" title="变更检测状态" style={{ marginBottom: 16 }}>
          {pendingCount > 0 ? (
            <Alert
              message={`检测到 ${pendingCount} 个待确认变更`}
              description={`监控对象 / 策略 / 规则已有新变化，请前往下方「待确认」列表逐项确认后发布（含 ${domainDrafts.filter((d) => d.status === 'pending' && d.change_items.some((i) => i.risk === 'high')).length} 个高风险变更）。`}
              type="warning"
              showIcon
            />
          ) : (
            <Alert
              message="当前无待确认变更"
              description="监控对象 / 策略 / 规则变更后，配置会自动生成并在此汇总；无实际影响的变更（内容无变化）已自动过滤，无需确认。"
              type="success"
              showIcon
            />
          )}
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
                      <Alert
                        message="校验值裁决说明（技术信息）"
                        description="策略或资源有变化但重算后内容校验值与当前生效版本一致时，说明没有实际影响，草稿自动丢弃、不进入确认列表；仅内容存在实际差异的变更才等待人工确认。检测状态为实时说明，不保留历史。"
                        type="info"
                        showIcon
                        style={{ marginTop: 12 }}
                      />
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
              pagination={false}
              rowClassName={(record) => (record.id === draft?.id ? 'bg-brand-light' : '')}
              onRow={(record) => ({
                onClick: () => openDetail(record),
                style: { cursor: 'pointer' },
              })}
              columns={[
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
                  title: '变更摘要',
                  key: 'summary',
                  render: (_: unknown, record: ConfigDraft) => (
                    <Text ellipsis style={{ maxWidth: 380 }}>{record.summary}</Text>
                  ),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 90,
                  render: (status: ConfigDraftStatus) => (
                    <Tag color={draftStatusColor[status]}>{draftStatusLabel[status]}</Tag>
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
                  // 决策 22：已发布版本列——确认后生成的配置版本号（cv-xxx）+ 发布记录入口，业务出问题时从变更单直达回滚目标
                  title: (
                    <Tooltip title="确认后生成的配置版本号（cv-xxx）；「记录」直达该变更的发布与回滚记录页">
                      <Space size={4}>
                        已发布版本
                        <InfoCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'published_version',
                  width: 150,
                  render: (_: unknown, record: ConfigDraft) => {
                    const version = record.status === 'confirmed' ? versionByChangeNo[record.change_no] : undefined
                    const deployCount = deploymentCountByChangeNo[record.change_no] ?? 0
                    return version ? (
                      <Space size={4}>
                        <Text code>{version}</Text>
                        {deployCount > 0 && (
                          <Tooltip title={`该变更已产生 ${deployCount} 条发布记录，点击前往查看 / 回滚`}>
                            <Button size="small" type="link" icon={<HistoryOutlined />} onClick={() => navigate('/deployments')}>
                              记录
                            </Button>
                          </Tooltip>
                        )}
                      </Space>
                    ) : (
                      <Text type="secondary">-</Text>
                    )
                  },
                },
                {
                  title: '下发前校验',
                  dataIndex: 'validation_status',
                  key: 'validation_status',
                  width: 110,
                  render: (status: DraftValidationStatus, record) => (
                    <Tooltip title={status === 'failed' ? record.validation_error : '下发前校验（配置内容合法性与目标格式检查）'}>
                      <Tag color={validationColor[status]}>{validationLabel[status]}</Tag>
                    </Tooltip>
                  ),
                },
                { title: '生成时间', dataIndex: 'created_at', key: 'created_at', width: 150 },
              ]}
            />
          ) : statusFilter === 'pending' ? (
            <Alert
              message="当前无待确认变更"
              description="策略或资源变更后配置自动生成；内容无实际影响的变更已自动过滤，此处仅展示需要人工确认的变更。可切换状态筛选查看已确认 / 已废弃变更。"
              type="success"
              showIcon
            />
          ) : statusFilter === 'all' ? (
            <Alert message="当前网域暂无配置变更" type="info" showIcon />
          ) : (
            <Alert message={`暂无${STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? ''}变更`} type="info" showIcon />
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
                          : activeDomain?.domain_type === 'edge'
                          ? '确认后发布为配置包，待边缘 Agent 下次心跳拉取生效'
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
                      <Tooltip title="前往发布记录页查看该变更的下发与回滚记录">
                        <Button icon={<HistoryOutlined />} onClick={() => navigate('/deployments')}>
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
                  <Alert message="无实际内容变化（已自动丢弃），无需确认" type="info" showIcon />
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

              {validationFailed && (
                <Alert
                  message="下发前校验失败（中心内容校验）"
                  description={draft.validation_error}
                  type="error"
                  showIcon
                  style={{ marginBottom: 16 }}
                />
              )}

              <Card
                size="small"
                title={`配置产物结构${isEdgeDomain ? '（zip 配置包，含 metadata.json）' : '（本地文件集，无 zip / metadata.json）'}`}
                style={{ marginBottom: 16 }}
              >
                {renderPackageTree(activeDomain?.domain_type, activeDomainId, draft)}
                <Alert
                  message="配置产物形态分层与生成说明"
                  description="配置产物形态按域类型分层：中心管理域（default）=本地文件集（prometheus.yml + targets/*.json + rules.yml + blackbox.yml），确认后 SIGHUP / -/reload，无 zip、无 metadata.json 下载校验（版本一致性由 ConfigVersion 记录保证）；边缘域=zip 配置包（含 metadata.json，Agent 拉取后校验值校验）；分层依据是域类型而非单/多网域开关。rules.yml 按作用域生成：中心域（default）包含 scope=central/both 规则；边缘域仅当存在 scope=edge/both 规则时（v0.4+）随配置包下发，MVP 阶段由中心统一求值。targets 由 configgen 按 job 名自动生成，前端动态遍历 targets_files 渲染子 Tab，新增 job 无需改前端。targets 变化仅原子重写对应 targets/*.json（临时文件 + rename），不触发采集器 reload——file_sd 由磁盘监听/轮询自动感知；仅 prometheus.yml 结构变化才触发 reload（reload 策略分离）。blackbox.yml 在网域存在 job_type=blackbox 的 ScrapeJob 时必含，且必须随 prometheus.yml 一同下发。"
                  type="info"
                  showIcon
                  style={{ marginTop: 12 }}
                />
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

              {activeTabError && (
                <Alert
                  message={`下发前校验失败（中心内容校验：${effectiveActiveFile === 'targets' ? `targets/${effectiveTargetJob}.json` : effectiveActiveFile}）`}
                  description={activeTabError}
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                />
              )}

              {viewMode === 'preview' ? (
                effectiveActiveFile === 'metadata.json' ? (
                  isEdgeDomain ? (
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
                    <Alert
                      message="中心管理域（default）为本地文件集"
                      description="配置产物不打包、无 metadata.json（无 zip 下载校验，版本一致性由配置版本记录保证）；联合校验值仅用于中心侧差异检测与裁决。"
                      type="info"
                      showIcon
                    />
                  )
                ) : effectiveActiveFile === 'targets' && targetJobs.length === 0 ? (
                  <Alert message="当前变更无 targets 文件" type="info" showIcon />
                ) : (
                  renderYamlPreview(activeFileText)
                )
              ) : effectiveActiveFile === 'metadata.json' ? (
                isEdgeDomain ? (
                  <Alert
                    message="metadata.json 仅只读展示"
                    description="metadata.json 为配置包元数据（config_version / 生成时间 / agent_type / 联合校验值），不参与版本 diff。"
                    type="info"
                    showIcon
                  />
                ) : (
                  <Alert
                    message="中心管理域（default）为本地文件集"
                    description="配置产物不打包、无 metadata.json，无需参与版本 diff；联合校验值由配置版本记录并在中心侧用于差异检测。"
                    type="info"
                    showIcon
                  />
                )
              ) : effectiveActiveFile === 'targets' && targetJobs.length === 0 ? (
                <Alert message="当前变更无 targets 文件" type="info" showIcon />
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
                        <Alert message="无历史版本" type="info" showIcon />
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

              <Alert
                message="下发前校验说明"
                description="配置生成后、发布或允许拉取前，必须先通过中心内容校验：promtool check config 校验 prometheus.yml（对 file_sd 仅检查文件存在性，不校验 SD 内容）；配置包含 blackbox.yml 时调用 blackbox_exporter --config.check 校验；targets JSON 由 configgen 侧 schema 校验（结构 / host:port / labels 合法性，弥补 promtool 缺口）。校验失败时草稿/版本保持原状态、不进入发布流程，并记录错误原因；与边缘侧传输校验的分层关系与衔接见下方「校验分层说明」。"
                type="info"
                showIcon
                style={{ marginTop: 16 }}
              />

              <Alert
                message="校验分层说明"
                description={
                  <ul style={{ paddingLeft: 18, margin: 0 }}>
                    <li>{validationLayeringNote.center}</li>
                    <li>{validationLayeringNote.edge}</li>
                    <li>{validationLayeringNote.agentDumbCheck}</li>
                    <li>{validationLayeringNote.checksumDualUse}</li>
                  </ul>
                }
                type="info"
                showIcon
              />
            </>
          )}
        </Drawer>
      </Card>
    </MainLayout>
  )
}

export default ConfigPreviewPage
