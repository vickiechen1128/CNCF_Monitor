import { useMemo, useState } from 'react'
import { Card, Select, Button, Space, Tag, Descriptions, Row, Col, message, Alert } from 'antd'
import { CheckOutlined, DeleteOutlined, DiffOutlined, EyeOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { configDrafts, configVersions, networkDomains, type ConfigDraftStatus } from '../mocks/module-09'

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

export function ConfigPreviewPage() {
  const [selectedDomain, setSelectedDomain] = useState<string>(networkDomains[0].id)
  const [viewMode, setViewMode] = useState<'preview' | 'diff'>('preview')

  const domainOptions = useMemo(
    () => networkDomains.map((d) => ({ value: d.id, label: `${d.name} (${d.id})` })),
    []
  )

  const draft = useMemo(
    () => configDrafts.find((d) => d.network_domain_id === selectedDomain),
    [selectedDomain]
  )

  const previousVersion = useMemo(
    () =>
      configVersions
        .filter((v) => v.network_domain_id === selectedDomain)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[1],
    [selectedDomain]
  )

  const diffRows = useMemo(() => {
    if (!draft) return []
    const oldText = previousVersion?.prometheus_yml ?? ''
    return computeDiff(oldText, draft.prometheus_yml)
  }, [draft, previousVersion])

  const handleConfirm = () => {
    message.success('配置已确认并触发下发流程（原型演示）')
  }

  const handleDiscard = () => {
    message.info('配置草稿已废弃（原型演示）')
  }

  return (
    <MainLayout>
      <Card
        title="配置生成与预览"
        extra={
          <Space>
            <span className="text-secondary">选择网域：</span>
            <Select
              value={selectedDomain}
              onChange={setSelectedDomain}
              options={domainOptions}
              style={{ width: 240 }}
            />
          </Space>
        }
      >
        {draft ? (
          <>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="草稿 ID">{draft.id}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={draftStatusColor[draft.status]}>{draftStatusLabel[draft.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="生成时间">{draft.created_at}</Descriptions.Item>
              <Descriptions.Item label="生成来源">
                {String(draft.metadata.generated_by ?? '-')}
              </Descriptions.Item>
              <Descriptions.Item label="变更原因">
                {String(draft.metadata.reason ?? '-')}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">{draft.updated_at}</Descriptions.Item>
            </Descriptions>

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

            <div style={{ marginTop: 24, textAlign: 'right' }}>
              <Space>
                <Button danger icon={<DeleteOutlined />} onClick={handleDiscard} disabled={draft.status === 'discarded'}>
                  废弃草稿
                </Button>
                <Button type="primary" icon={<CheckOutlined />} onClick={handleConfirm} disabled={draft.status === 'confirmed'}>
                  确认下发
                </Button>
              </Space>
            </div>
          </>
        ) : (
          <Alert message="当前网域暂无配置草稿" type="info" showIcon />
        )}
      </Card>
    </MainLayout>
  )
}

export default ConfigPreviewPage
