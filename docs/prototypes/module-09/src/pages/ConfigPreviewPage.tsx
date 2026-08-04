import { useMemo, useState } from 'react'
import { Card, Select, Button, Space, Tag, Descriptions, Row, Col, message, Alert, Table, Typography, Tooltip } from 'antd'
import { CheckOutlined, DeleteOutlined, DiffOutlined, EyeOutlined, CopyOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  configDrafts,
  configVersions,
  networkDomains,
  currentTenant,
  type ConfigDraftStatus,
  type DraftValidationStatus,
  type ConfigDraft,
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

function renderPackageTree(domainId: string, draft: ConfigDraft) {
  const hasBlackbox = Boolean(draft.blackbox_yml)
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        background: '#F7F8FA',
        border: '1px solid #E5E6EB',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.8,
        fontFamily: "'SFMono-Regular', Consolas, Menlo, Courier, monospace",
      }}
    >
      {`edge-config-${domainId}.zip
├── prometheus.yml      # 本域 scrape_configs（已注入 external_labels.network_domain / tenant_id）
├── blackbox.yml        # 本域 blackbox 探测模块${hasBlackbox ? '' : '（当前无 job_type=blackbox 的 ScrapeJob，不打包）'}
├── rules.yml           # 本域告警规则（按 scope 生成，见下方说明）
└── metadata.json       # config_version、生成时间、agent_type、联合 checksum（供拉取后完整性校验）`}
    </pre>
  )
}

export function ConfigPreviewPage() {
  const multiSite = currentTenant.multi_site_enabled
  const defaultDomainId = networkDomains[0].id
  const [selectedDomain, setSelectedDomain] = useState<string>(defaultDomainId)
  const [selectedDraftId, setSelectedDraftId] = useState<string>()
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>('preview')

  const domainOptions = useMemo(
    () => networkDomains.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })),
    []
  )

  const activeDomainId = multiSite ? selectedDomain : defaultDomainId

  const drafts = useMemo(
    () => configDrafts.filter((d) => d.network_domain_id === activeDomainId),
    [activeDomainId]
  )

  const draft = useMemo(() => {
    return drafts.find((d) => d.id === selectedDraftId) ?? drafts[0]
  }, [drafts, selectedDraftId])

  const handleSelectDomain = (domainId: string) => {
    setSelectedDomain(domainId)
    setSelectedDraftId(undefined)
    setViewMode('preview')
  }

  const previousVersion = useMemo(
    () =>
      configVersions
        .filter((v) => v.network_domain_id === activeDomainId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[1],
    [activeDomainId]
  )

  const diffRows = useMemo(() => {
    if (!draft) return []
    const oldText = previousVersion?.prometheus_yml ?? ''
    return computeDiff(oldText, draft.prometheus_yml)
  }, [draft, previousVersion])

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
              <Text code>sha256(prometheus.yml + rules_yml + blackbox_yml)</Text>）与生效版本对比，
              一致则丢弃不产生草稿，不一致才进入下方确认列表。Module_01/07 不主动通知。
            </span>
          }
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />

        {drafts.length > 0 ? (
          <>
            <Card size="small" title={`草稿列表（${activeDomainId}）`} style={{ marginBottom: 16 }}>
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
                    message="下发前校验失败"
                    description={draft.validation_error}
                    type="error"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Card size="small" title="配置包结构" style={{ marginBottom: 16 }}>
                  {renderPackageTree(activeDomainId, draft)}
                  <Alert
                    message="rules.yml 按作用域生成（PRD 3.3）"
                    description="中心域（default）包含 scope=central/both 规则；边缘域仅当存在 scope=edge/both 规则时（v0.4+）随配置包下发，MVP 阶段由中心统一求值。blackbox.yml 在网域存在 job_type=blackbox 的 ScrapeJob 时必含，且必须随 prometheus.yml 一同下发。"
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

                {viewMode === 'preview' ? (
                  renderYamlPreview(draft.prometheus_yml)
                ) : (
                  <Row gutter={16}>
                    <Col span={12}>
                      <Card size="small" title={`旧版本${previousVersion ? ` (${previousVersion.id})` : ''}`}>
                        {previousVersion ? (
                          renderYamlPreview(previousVersion.prometheus_yml)
                        ) : (
                          <Alert message="无历史版本" type="info" showIcon />
                        )}
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small" title="新版本（当前草稿）">
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
                  message="下发前校验（PRD 3.5.1）"
                  description="配置包生成后、下发或允许拉取前，必须先通过校验：promtool check config 校验 prometheus.yml；配置包含 blackbox.yml 时调用 blackbox_exporter --config.check 校验。校验失败时草稿/版本保持原状态、不进入下发流程，并记录错误原因。"
                  type="info"
                  showIcon
                  style={{ marginTop: 16, marginBottom: 16 }}
                />

                <div style={{ textAlign: 'right' }}>
                  <Space>
                    <Button danger icon={<DeleteOutlined />} onClick={handleDiscard} disabled={draft.status === 'discarded'}>
                      废弃草稿
                    </Button>
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      onClick={handleConfirm}
                      disabled={draft.status === 'confirmed' || draft.status === 'discarded' || validationFailed}
                    >
                      确认下发
                    </Button>
                  </Space>
                </div>
              </>
            )}
          </>
        ) : (
          <Alert message="当前网域暂无配置草稿" type="info" showIcon />
        )}
      </Card>
    </MainLayout>
  )
}

export default ConfigPreviewPage
