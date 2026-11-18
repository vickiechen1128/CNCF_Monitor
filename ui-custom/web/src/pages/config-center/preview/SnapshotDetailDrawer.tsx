import { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, Drawer, Empty, Space, Spin, Tabs, Tag, Typography, message } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { getStoredUser, isApiError } from '../../../api/client'
import { configArtifactApi } from '../../../api/configCenter'
import type {
  ConfigArtifact,
  ConfigArtifactPreview,
  ConfigArtifactType,
  ConfigSnapshotHistoryRow,
} from '../../../types/config-center'
import { triggerBlobDownload } from '../../../utils/triggerBlobDownload'
import { shortChecksum } from '../../../utils/shortChecksum'
import { formatLocalTime } from '../configCenterConstants'
import {
  ARTIFACT_TYPE_COLOR,
  ARTIFACT_TYPE_LABEL,
  SNAPSHOT_CAUSE_LABEL,
  SNAPSHOT_GENERATOR_LABEL,
  SNAPSHOT_STATUS_COLOR,
  SNAPSHOT_STATUS_LABEL,
  validationDetailsText,
} from './snapshotHelpers'

const { Text } = Typography

interface SnapshotDetailDrawerProps {
  open: boolean
  /** 列表行携带的产物元数据（打开后按 id 拉取详情与内容预览） */
  snapshot: ConfigSnapshotHistoryRow | null
  /** 展示名（网域名 / 中心规则 / 告警配置；缺省回退 network_domain_id） */
  domainName?: string
  onClose: () => void
}

type DetailRow = ConfigSnapshotHistoryRow & ConfigArtifact

const EXPORT_LABEL: Record<ConfigArtifactType, string> = {
  domain: '导出配置包（zip）',
  center: '导出 rules.yml',
  alertmanager: '导出 alertmanager.yml',
}

/**
 * 配置产物只读详情抽屉（SRS v1.5 FR-13 / FR-13.1 / FR-13.2）。
 * 展示元数据、校验明细、按文件 Tab 的内容预览；admin 可导出可直接落盘的文件，
 * 以及次级「原始载荷」。不含确认、重校、废弃、回滚等写操作。
 */
export function SnapshotDetailDrawer({ open, snapshot, domainName, onClose }: SnapshotDetailDrawerProps) {
  const [detail, setDetail] = useState<DetailRow | null>(snapshot)
  const [preview, setPreview] = useState<ConfigArtifactPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [rawDownloading, setRawDownloading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const isAdmin = getStoredUser()?.role === 'admin'
  const artifactType: ConfigArtifactType = detail?.artifact_type ?? 'domain'

  useEffect(() => {
    if (!open || !snapshot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null)
      setPreview(null)
      setError(null)
      setPreviewError(null)
      return
    }
    let cancelled = false
    // 先用列表元数据即时渲染，再拉详情与预览
    setDetail({ ...snapshot, artifact_type: snapshot.artifact_type ?? 'domain' })
    setPreview(null)
    setLoading(true)
    setError(null)
    setPreviewError(null)
    configArtifactApi
      .get(snapshot.id)
      .then((res) => {
        if (cancelled) return
        setDetail({
          ...snapshot,
          ...res.data,
          artifact_type: res.data.artifact_type ?? snapshot.artifact_type ?? 'domain',
          network_domain_name: domainName ?? snapshot.network_domain_name,
        })
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '配置产物详情加载失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    if (isAdmin) {
      configArtifactApi
        .preview(snapshot.id)
        .then((res) => {
          if (!cancelled) setPreview(res.data)
        })
        .catch((e) => {
          if (cancelled) return
          setPreviewError(e instanceof Error ? e.message : '配置内容加载失败，请稍后重试')
        })
    }
    return () => {
      cancelled = true
    }
  }, [open, snapshot, isAdmin, domainName, reloadKey])

  const handleDownload = async (raw: boolean) => {
    if (!detail) return
    if (raw) setRawDownloading(true)
    else setDownloading(true)
    try {
      const { blob, filename } = await configArtifactApi.export(detail.id, raw)
      triggerBlobDownload(blob, filename)
      message.success(raw ? '原始载荷已开始下载' : '配置产物已开始下载')
    } catch (e) {
      if (isApiError(e) && e.code === 401) {
        message.error('登录已过期，请重新登录后再下载')
      } else if (isApiError(e) && (e.code === 403 || e.errorType === 'forbidden')) {
        message.error('当前账号无导出配置产物的权限，请联系管理员开通')
      } else {
        message.error(e instanceof Error ? e.message : '配置产物导出失败，请稍后重试')
      }
    } finally {
      if (raw) setRawDownloading(false)
      else setDownloading(false)
    }
  }

  const detailsText = detail ? validationDetailsText(detail.validation_details) : ''
  const tabs = preview?.files.map((file) => ({
    key: file.name,
    label: file.name,
    children: (
      <pre
        style={{
          margin: 0,
          maxHeight: 460,
          overflow: 'auto',
          background: 'rgba(0,0,0,0.03)',
          padding: 12,
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        {file.content}
      </pre>
    ),
  }))

  return (
    <Drawer
      title={detail ? `配置产物详情：${detail.version}` : '配置产物详情'}
      width={760}
      open={open}
      onClose={onClose}
      extra={
        isAdmin && detail ? (
          <Space>
            {artifactType !== 'alertmanager' && (
              <Button loading={rawDownloading} onClick={() => void handleDownload(true)}>
                下载原始载荷
              </Button>
            )}
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={downloading}
              onClick={() => void handleDownload(false)}
            >
              {EXPORT_LABEL[artifactType]}
            </Button>
          </Space>
        ) : null
      }
    >
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="配置产物详情加载失败"
          description={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => setReloadKey((k) => k + 1)}>
              重试
            </Button>
          }
        />
      )}
      {loading && !detail ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin /> <Text type="secondary">配置产物详情加载中…</Text>
        </div>
      ) : detail ? (
        <>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="类型">
              <Tag color={ARTIFACT_TYPE_COLOR[artifactType]}>{ARTIFACT_TYPE_LABEL[artifactType]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="网域 / 范围">
              {artifactType === 'domain'
                ? `${domainName ?? detail.network_domain_name ?? detail.network_domain_id}（${detail.network_domain_id}）`
                : artifactType === 'center'
                  ? '中心规则（平台级）'
                  : '告警配置（平台级）'}
            </Descriptions.Item>
            <Descriptions.Item label="版本">
              <Text code>{detail.version}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="校验状态">
              <Tag color={SNAPSHOT_STATUS_COLOR[detail.validation_status]}>
                {SNAPSHOT_STATUS_LABEL[detail.validation_status]}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="校验归因">
              {SNAPSHOT_CAUSE_LABEL[detail.validation_cause] ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="当前生效">
              {detail.is_current ? <Tag color="success">当前生效</Tag> : <Text type="secondary">否</Text>}
            </Descriptions.Item>
            <Descriptions.Item label="生成来源">
              {SNAPSHOT_GENERATOR_LABEL[detail.generated_by] ?? detail.generated_by ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="生成时间">{formatLocalTime(detail.created_at)}</Descriptions.Item>
            <Descriptions.Item label="校验值">
              <Space size={4} wrap>
                <Text code>{shortChecksum(detail.checksum)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {detail.checksum || '—'}
                </Text>
              </Space>
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 16 }}>
            <Text strong>校验明细</Text>
            {detailsText ? (
              <pre
                style={{
                  margin: '8px 0 0',
                  maxHeight: 240,
                  overflow: 'auto',
                  background: 'rgba(0,0,0,0.03)',
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              >
                {detailsText}
              </pre>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={detail.validation_status === 'passed' ? '校验通过，无明细' : '无校验明细'}
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          <div style={{ marginTop: 16 }}>
            <Text strong>配置内容</Text>
            {!isAdmin ? (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 8 }}
                message="配置内容含凭据明文，仅管理员可查看与导出。"
              />
            ) : detail.content_available === false ? (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 8 }}
                message="该版本内容不可用"
                description="历史内容未持久化或文件已被清理，元数据仍可查看。"
              />
            ) : previewError ? (
              <Alert
                type="error"
                showIcon
                style={{ marginTop: 8 }}
                message="配置内容加载失败"
                description={previewError}
                action={
                  <Button size="small" onClick={() => setReloadKey((k) => k + 1)}>
                    重试
                  </Button>
                }
              />
            ) : !preview ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin /> <Text type="secondary">配置内容加载中…</Text>
              </div>
            ) : preview.files.length === 0 ? (
              <Empty description="该版本没有可预览的文件" style={{ marginTop: 8 }} />
            ) : (
              <Tabs style={{ marginTop: 8 }} items={tabs} />
            )}
          </div>
        </>
      ) : null}
    </Drawer>
  )
}
