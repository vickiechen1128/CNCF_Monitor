import { useMemo, useState } from 'react'
import { Card, Select, Button, Space, Tag, Descriptions, Row, Col, message, Alert, Table, Typography, Tooltip, Tabs, Switch } from 'antd'
import { CheckOutlined, DeleteOutlined, DiffOutlined, EyeOutlined, CopyOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  configDrafts,
  configVersions,
  networkDomains,
  currentTenant,
  targetsFilesToText,
  changeDetectionStatus,
  domainArtifactShape,
  validationLayeringNote,
  type ConfigDraftStatus,
  type DraftValidationStatus,
  type ConfigDraft,
  type ChangeDetectionOutcome,
  type DomainType,
} from '../mocks/module-09'

const { Text } = Typography

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

/** 变更检测结果（PRD 3.3.3「检测状态可观测」P1） */
const detectionOutcomeColor: Record<ChangeDetectionOutcome, string> = {
  changes_found: 'processing',
  no_change: 'default',
  checksum_same: 'success',
}

const detectionOutcomeLabel: Record<ChangeDetectionOutcome, string> = {
  changes_found: '检测到变更，已生成草稿',
  no_change: '本轮无变更，跳过重算',
  checksum_same: '内容无变化，自动丢弃',
}

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
  const multiSite = currentTenant.multi_site_enabled
  const defaultDomainId = networkDomains[0].id
  const [selectedDomain, setSelectedDomain] = useState<string>(defaultDomainId)
  const [selectedDraftId, setSelectedDraftId] = useState<string>()
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>('preview')
  const [activeFile, setActiveFile] = useState<PreviewFileKey>('prometheus.yml')
  const [activeTargetJob, setActiveTargetJob] = useState<string>()
  /** 草稿列表默认仅展示待确认（pending）草稿；true 时切换为查看历史草稿（confirmed / discarded，PRD 3.4） */
  const [showHistory, setShowHistory] = useState(false)

  const domainOptions = useMemo(
    () => networkDomains.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })),
    []
  )

  /** 所属网域列：network_domain_id → 网域名称（与下发记录页展示一致） */
  const domainMap = useMemo(() => Object.fromEntries(networkDomains.map((d) => [d.id, d.name])), [])

  const activeDomainId = multiSite ? selectedDomain : defaultDomainId

  /** 当前选中网域与其类型（决策 6 配置产物形态分层：management=本地文件集，edge=zip 配置包） */
  const activeDomain = networkDomains.find((d) => d.id === activeDomainId)
  const isEdgeDomain = activeDomain?.domain_type === 'edge'

  /** 该网域全部草稿（含历史草稿） */
  const domainDrafts = useMemo(
    () => configDrafts.filter((d) => d.network_domain_id === activeDomainId),
    [activeDomainId]
  )

  /** 当前视图草稿：默认仅展示待确认（pending）；查看历史时展示 confirmed / discarded（PRD 3.4） */
  const drafts = useMemo(
    () => domainDrafts.filter((d) => (showHistory ? d.status !== 'pending' : d.status === 'pending')),
    [domainDrafts, showHistory]
  )

  /** 变更检测状态（PRD 3.3.3「检测状态可观测」P1）：上次检测时间 / 源数据版本 / 检测结果 */
  const detectionStatus = changeDetectionStatus.find((s) => s.network_domain_id === activeDomainId)

  const draft = useMemo(() => {
    return drafts.find((d) => d.id === selectedDraftId) ?? drafts[0]
  }, [drafts, selectedDraftId])

  const handleSelectDomain = (domainId: string) => {
    setSelectedDomain(domainId)
    setSelectedDraftId(undefined)
    setShowHistory(false)
    setViewMode('preview')
    setActiveFile('prometheus.yml')
    setActiveTargetJob(undefined)
  }

  const handleToggleHistory = (checked: boolean) => {
    setShowHistory(checked)
    setSelectedDraftId(undefined)
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

  const effectiveTargetJob = useMemo(() => {
    if (activeTargetJob && targetJobs.includes(activeTargetJob)) return activeTargetJob
    return targetJobs[0]
  }, [activeTargetJob, targetJobs])

  /** diff 跟随当前 Tab：与上一 ConfigVersion 的同一文件对比（PRD 3.4 按文件 diff） */
  const diffRows = useMemo(() => {
    if (!draft || !DIFFABLE_FILES.includes(activeFile)) return []
    let oldText: string
    let newText: string
    if (activeFile === 'targets') {
      oldText = prevTargetsText[effectiveTargetJob] ?? ''
      newText = draftTargetsText[effectiveTargetJob] ?? ''
    } else {
      const field = activeFile === 'prometheus.yml' ? 'prometheus_yml' : activeFile === 'rules.yml' ? 'rules_yml' : 'blackbox_yml'
      oldText = previousVersion?.[field] ?? ''
      newText = draft[field]
    }
    return computeDiff(oldText, newText)
  }, [draft, previousVersion, activeFile, effectiveTargetJob, prevTargetsText, draftTargetsText])

  const activeFileText = useMemo(() => {
    if (!draft) return ''
    if (activeFile === 'targets') return draftTargetsText[effectiveTargetJob] ?? ''
    if (activeFile === 'metadata.json') return ''
    const field = activeFile === 'prometheus.yml' ? 'prometheus_yml' : activeFile === 'rules.yml' ? 'rules_yml' : 'blackbox_yml'
    return draft[field]
  }, [draft, activeFile, effectiveTargetJob, draftTargetsText])

  const previousFileText = useMemo(() => {
    if (!previousVersion) return ''
    if (activeFile === 'targets') return prevTargetsText[effectiveTargetJob] ?? ''
    if (activeFile === 'metadata.json') return ''
    const field = activeFile === 'prometheus.yml' ? 'prometheus_yml' : activeFile === 'rules.yml' ? 'rules_yml' : 'blackbox_yml'
    return previousVersion[field] ?? ''
  }, [previousVersion, activeFile, effectiveTargetJob, prevTargetsText])

  const handleCopyChecksum = (checksum: string) => {
    navigator.clipboard.writeText(checksum).then(() => message.success('联合 checksum 已复制'))
  }

  const handleConfirm = () => {
    if (draft?.validation_status === 'failed') {
      message.error('下发前校验未通过，禁止下发')
      return
    }
    message.success('配置已确认并触发下发流程（原型演示）')
  }

  const handleDiscard = () => {
    message.info('配置草稿已废弃（原型演示）')
  }

  const validationFailed = draft?.validation_status === 'failed'
  const activeTabError = tabValidationError(draft, activeFile)

  /** 待确认 / 历史草稿切换（PRD 3.4：默认仅展示 pending，历史草稿 confirmed/discarded 可切换查看） */
  const historyToggle = (
    <Space size={8}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {showHistory ? '查看历史草稿（confirmed / discarded）' : '默认仅展示待确认草稿（pending）'}
      </Text>
      <Switch
        checked={showHistory}
        onChange={handleToggleHistory}
        checkedChildren="历史草稿"
        unCheckedChildren="待确认"
      />
    </Space>
  )

  return (
    <MainLayout>
      <Card
        title="配置生成与预览"
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
            description="当前租户未开启多网域能力，配置生成中心直接面向中心 Prometheus，不展示网域选择器。"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Alert
          message="变更检测（pull 模式，PRD 3.3.3 / 5.2）"
          description={
            <span>
              Module_09 异步轮询（默认 30s）检测 Module_01/07 各源表（ScrapeJob / MonitoringRule /
              CITypeExporterMapping / Resource / LabelTemplate / ExporterInstallationConfirmation）的{' '}
              <Text code>updated_at</Text> 变化，聚合为「源数据版本」（<Text code>source_data_version</Text>），
              仅当版本变化时触发重算；生成后计算联合 checksum（
              <Text code>sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)</Text>）与生效版本对比，
              一致则丢弃不产生草稿，不一致才进入下方确认列表。Module_01/07 不主动通知。
            </span>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Card size="small" title="变更检测状态" style={{ marginBottom: 16 }}>
          {detectionStatus ? (
            <>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 12 }}>
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
                message="本轮检测结果"
                type={detectionStatus.outcome === 'checksum_same' ? 'success' : 'info'}
                showIcon
                description={
                  <span>
                    {detectionStatus.summary}
                    {detectionStatus.outcome === 'changes_found' && detectionStatus.generated_drafts.length > 0 && (
                      <span>
                        {' '}
                        生成草稿：
                        {detectionStatus.generated_drafts.map((g) => (
                          <Tag key={g.id} color="processing" style={{ marginLeft: 4 }}>
                            {g.id}
                          </Tag>
                        ))}
                      </span>
                    )}
                  </span>
                }
              />
              <Alert
                message="checksum 裁决语义（PRD 3.3.3）"
                description="源数据版本变化但重算后内容联合 checksum 与生效版本一致 → 草稿自动丢弃（标记 discarded），不进入人工确认列表；仅内容存在实际差异时才生成 pending 草稿等待人工确认。"
                type="info"
                showIcon
                style={{ marginTop: 12 }}
              />
            </>
          ) : (
            <Alert message="暂无检测状态数据" type="info" showIcon />
          )}
        </Card>

        {drafts.length > 0 ? (
          <>
            <Card size="small" title="配置草稿" extra={historyToggle} style={{ marginBottom: 16 }}>
              <Table<ConfigDraft>
                dataSource={drafts}
                rowKey="id"
                size="small"
                pagination={false}
                rowClassName={(record) =>
                  record.id === draft?.id ? 'bg-brand-light' : ''
                }
                onRow={(record) => ({
                  onClick: () => setSelectedDraftId(record.id),
                  style: { cursor: 'pointer' },
                })}
                columns={[
                  { title: '草稿 ID', dataIndex: 'id', key: 'id' },
                  {
                    title: '所属网域',
                    dataIndex: 'network_domain_id',
                    key: 'network_domain_id',
                    width: 150,
                    render: (id: string) => <Text>{domainMap[id] ?? id}</Text>,
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
                    title: '下发前校验',
                    dataIndex: 'validation_status',
                    key: 'validation_status',
                    width: 110,
                    render: (status: DraftValidationStatus, record) => (
                      <Tooltip title={status === 'failed' ? record.validation_error : 'PRD 3.5.1 下发前校验'}>
                        <Tag color={validationColor[status]}>{validationLabel[status]}</Tag>
                      </Tooltip>
                    ),
                  },
                  { title: '生成时间', dataIndex: 'created_at', key: 'created_at', width: 150 },
                  {
                    title: '源数据版本',
                    dataIndex: ['metadata', 'source_data_version'],
                    key: 'source_data_version',
                    render: (v: string) => <Text code>{v}</Text>,
                  },
                  {
                    title: '触发摘要',
                    dataIndex: ['metadata', 'trigger_summary'],
                    key: 'trigger_summary',
                    ellipsis: true,
                    render: (v: string) => (
                      <Tooltip title={v}>
                        <Text>{v}</Text>
                      </Tooltip>
                    ),
                  },
                  {
                    title: '联合 checksum',
                    dataIndex: ['metadata', 'checksum'],
                    key: 'checksum',
                    render: (v: string) => (
                      <Space size={4}>
                        <Text code style={{ fontSize: 12 }}>
                          {shortChecksum(v)}
                        </Text>
                        <Tooltip title="复制完整 checksum">
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCopyChecksum(v)
                            }}
                          />
                        </Tooltip>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>

            {draft && (
              <>
                <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="草稿 ID">{draft.id}</Descriptions.Item>
                  <Descriptions.Item label="状态">
                    <Tag color={draftStatusColor[draft.status]}>{draftStatusLabel[draft.status]}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="下发前校验">
                    <Tooltip title={draft.validation_status === 'failed' ? draft.validation_error : ''}>
                      <Tag color={validationColor[draft.validation_status]}>{validationLabel[draft.validation_status]}</Tag>
                    </Tooltip>
                  </Descriptions.Item>
                  <Descriptions.Item label="生成时间">{draft.created_at}</Descriptions.Item>
                  <Descriptions.Item label="生成器版本">{draft.metadata.generator_version}</Descriptions.Item>
                  <Descriptions.Item label="变更原因">{draft.metadata.reason}</Descriptions.Item>
                  <Descriptions.Item label="源数据版本" span={1}>
                    <Text code>{draft.metadata.source_data_version}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="触发摘要" span={2}>
                    {draft.metadata.trigger_summary}
                  </Descriptions.Item>
                  <Descriptions.Item label="来源摘要">{draft.metadata.source_summary}</Descriptions.Item>
                  <Descriptions.Item label="联合 checksum" span={2}>
                    <Space size={4}>
                      <Text code style={{ fontSize: 12 }}>
                        {draft.metadata.checksum}
                      </Text>
                      <Tooltip title="复制完整 checksum">
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

                {validationFailed && (
                  <Alert
                    message="下发前校验失败（中心内容校验，PRD 6.4）"
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
                    message="配置产物形态分层 + rules.yml 按作用域生成 + targets 数据驱动（决策 6 / 7 / 8，PRD 3.3 / 3.5）"
                    description="配置产物形态按域类型分层（决策 6）：中心管理域（default）=本地文件集（prometheus.yml + targets/*.json + rules.yml + blackbox.yml），确认后 SIGHUP / -/reload，无 zip、无 metadata.json 下载校验（版本一致性由 ConfigVersion 记录保证）；边缘域=zip 配置包（含 metadata.json，Agent 拉取后 checksum 校验）；分层依据是域类型而非单/多网域开关。rules.yml 按作用域生成：中心域（default）包含 scope=central/both 规则；边缘域仅当存在 scope=edge/both 规则时（v0.4+）随配置包下发，MVP 阶段由中心统一求值（决策 8）。targets 由 configgen 按 job 名自动生成，前端动态遍历 targets_files 渲染子 Tab，新增 job 无需改前端（决策 7）。targets 变化仅原子重写对应 targets/*.json（临时文件 + rename），不触发采集器 reload——file_sd 由磁盘监听/轮询自动感知；仅 prometheus.yml 结构变化才触发 reload（reload 策略分离）。blackbox.yml 在网域存在 job_type=blackbox 的 ScrapeJob 时必含，且必须随 prometheus.yml 一同下发。"
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
                </Space>

                <Tabs
                  size="small"
                  activeKey={activeFile}
                  onChange={(key) => setActiveFile(key as PreviewFileKey)}
                  items={FILE_TABS.map((t) => ({ key: t.key, label: t.label }))}
                  style={{ marginBottom: 12 }}
                />

                {activeFile === 'targets' && targetJobs.length > 0 && (
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
                    message={`下发前校验失败（中心内容校验，PRD 6.4：${activeFile === 'targets' ? `targets/${effectiveTargetJob}.json` : activeFile}）`}
                    description={activeTabError}
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                  />
                )}

                {viewMode === 'preview' ? (
                  activeFile === 'metadata.json' ? (
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
                        <Descriptions.Item label="联合 checksum">
                          <Space size={4}>
                            <Text code style={{ fontSize: 12 }}>
                              {draft.metadata.checksum}
                            </Text>
                            <Tooltip title="复制完整 checksum">
                              <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => handleCopyChecksum(draft.metadata.checksum)}
                              />
                            </Tooltip>
                          </Space>
                        </Descriptions.Item>
                        <Descriptions.Item label="checksum 算法" span={2}>
                          <Text type="secondary">
                            sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)（PRD 3.3.3 / 6.2），供边缘 Agent 拉取后完整性校验
                          </Text>
                        </Descriptions.Item>
                      </Descriptions>
                    ) : (
                      <Alert
                        message="中心管理域（default）为本地文件集"
                        description="配置产物不打包、无 metadata.json（决策 6：无 zip 下载校验，版本一致性由 ConfigVersion 记录保证）；联合 checksum 仅用于中心侧差异检测（PRD 3.3.3 checksum 裁决）。"
                        type="info"
                        showIcon
                      />
                    )
                  ) : activeFile === 'targets' && targetJobs.length === 0 ? (
                    <Alert message="当前草稿无 targets 文件" type="info" showIcon />
                  ) : (
                    renderYamlPreview(activeFileText)
                  )
                ) : activeFile === 'metadata.json' ? (
                  isEdgeDomain ? (
                    <Alert
                      message="metadata.json 仅只读展示"
                      description="metadata.json 为配置包元数据（config_version / 生成时间 / agent_type / 联合 checksum），不参与版本 diff。"
                      type="info"
                      showIcon
                    />
                  ) : (
                    <Alert
                      message="中心管理域（default）为本地文件集"
                      description="配置产物不打包、无 metadata.json（决策 6），无需参与版本 diff；联合 checksum 由 ConfigVersion 记录并在中心侧用于差异检测（PRD 3.3.3）。"
                      type="info"
                      showIcon
                    />
                  )
                ) : activeFile === 'targets' && targetJobs.length === 0 ? (
                  <Alert message="当前草稿无 targets 文件" type="info" showIcon />
                ) : (
                  <Row gutter={16}>
                    <Col span={12}>
                      <Card
                        size="small"
                        title={`旧版本${previousVersion ? ` (${previousVersion.id})` : ''}${activeFile === 'targets' ? `：targets/${effectiveTargetJob}.json` : ''}`}
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
                        title={`新版本（当前草稿${activeFile === 'targets' ? `：targets/${effectiveTargetJob}.json` : ''}）`}
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
                  message="下发前校验（PRD 3.5.1，中心①内容校验）"
                  description="配置包生成后、下发或允许拉取前，必须先通过中心内容校验：promtool check config 校验 prometheus.yml（对 file_sd 仅检查文件存在性，不校验 SD 内容）；配置包含 blackbox.yml 时调用 blackbox_exporter --config.check 校验；targets JSON 由 configgen 侧 schema 校验（结构 / host:port / labels 合法性，弥补 promtool 缺口）。校验失败时草稿/版本保持原状态、不进入下发流程，并记录错误原因；与边缘侧传输校验的分层关系与衔接见下方「校验分层（PRD 6.4）」说明。"
                  type="info"
                  showIcon
                  style={{ marginTop: 16 }}
                />

                <Alert
                  message="校验分层（PRD 6.4 中心/边缘校验分层与衔接）"
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
                  style={{ marginBottom: 16 }}
                />

                <div style={{ textAlign: 'right' }}>
                  <Space>
                    <Tooltip title={showHistory ? '历史草稿仅只读，不可废弃（PRD 3.4）' : ''}>
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        onClick={handleDiscard}
                        disabled={showHistory || draft.status !== 'pending'}
                      >
                        废弃草稿
                      </Button>
                    </Tooltip>
                    <Tooltip title={showHistory ? '历史草稿仅只读，不可确认（PRD 3.4）' : ''}>
                      <Button
                        type="primary"
                        icon={<CheckOutlined />}
                        onClick={handleConfirm}
                        disabled={showHistory || draft.status !== 'pending' || validationFailed}
                      >
                        确认下发
                      </Button>
                    </Tooltip>
                  </Space>
                </div>
              </>
            )}
          </>
        ) : (
          <Card size="small" title="配置草稿" extra={historyToggle} style={{ marginBottom: 16 }}>
            {showHistory ? (
              <Alert message="当前网域暂无历史草稿" type="info" showIcon />
            ) : domainDrafts.length > 0 ? (
              <Alert
                message="当前无待确认草稿"
                description="所有变更已同步或内容无变化（checksum 一致自动丢弃），无待确认项；可通过右上角「查看历史草稿」查看已确认 / 已废弃草稿。"
                type="success"
                showIcon
              />
            ) : (
              <Alert message="当前网域暂无配置草稿" type="info" showIcon />
            )}
          </Card>
        )}
      </Card>
    </MainLayout>
  )
}

export default ConfigPreviewPage
