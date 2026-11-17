import { useEffect, useState } from 'react'
import { Alert, Button, Descriptions, Drawer, Empty, Space, Spin, Tag, Typography, message } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { getStoredUser, isApiError } from '../../../api/client'
import { configSnapshotApi } from '../../../api/configCenter'
import type { ConfigSnapshot } from '../../../types/config-center'
import { triggerBlobDownload } from '../../../utils/triggerBlobDownload'
import { shortChecksum } from '../../../utils/shortChecksum'
import { formatLocalTime } from '../configCenterConstants'
import {
  SNAPSHOT_CAUSE_LABEL,
  SNAPSHOT_GENERATOR_LABEL,
  SNAPSHOT_STATUS_COLOR,
  SNAPSHOT_STATUS_LABEL,
  validationDetailsText,
} from './snapshotHelpers'

const { Text } = Typography

interface SnapshotDetailDrawerProps {
  open: boolean
  /** 列表行携带的快照元数据（打开后按 id 拉取详情，补齐 validation_details） */
  snapshot: ConfigSnapshot | null
  /** 网域名（历史页跨网域展示；缺省回退 network_domain_id） */
  domainName?: string
  onClose: () => void
}

/**
 * 配置快照只读详情抽屉（v3 契约 §4.2）。
 * 展示校验状态 / 归因 / 校验明细（JSON 美化）；admin 可下载快照内容。
 * 不含确认、重校、废弃、回滚等写操作。
 */
export function SnapshotDetailDrawer({ open, snapshot, domainName, onClose }: SnapshotDetailDrawerProps) {
  const [detail, setDetail] = useState<ConfigSnapshot | null>(snapshot)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const isAdmin = getStoredUser()?.role === 'admin'

  useEffect(() => {
    if (!open || !snapshot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null)
      setError(null)
      return
    }
    let cancelled = false
    // 先用列表元数据即时渲染，再拉详情补齐 validation_details
    setDetail(snapshot)
    setLoading(true)
    setError(null)
    configSnapshotApi
      .get(snapshot.network_domain_id, snapshot.id)
      .then((res) => {
        if (!cancelled) setDetail(res.data)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '快照详情加载失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, snapshot, reloadKey])

  const handleDownload = async () => {
    if (!detail) return
    setDownloading(true)
    try {
      const text = await configSnapshotApi.content(detail.network_domain_id, detail.id)
      triggerBlobDownload(new Blob([text], { type: 'application/json;charset=utf-8' }), `${detail.version}.json`)
      message.success('配置内容已开始下载')
    } catch (e) {
      if (isApiError(e) && e.code === 401) {
        message.error('登录已过期，请重新登录后再下载')
      } else if (isApiError(e) && (e.code === 403 || e.errorType === 'forbidden')) {
        message.error('当前账号无下载配置内容的权限，请联系管理员开通')
      } else {
        message.error(e instanceof Error ? e.message : '配置内容下载失败，请稍后重试')
      }
    } finally {
      setDownloading(false)
    }
  }

  const detailsText = detail ? validationDetailsText(detail.validation_details) : ''

  return (
    <Drawer
      title={detail ? `快照详情：${detail.version}` : '快照详情'}
      width={680}
      open={open}
      onClose={onClose}
      extra={
        isAdmin && detail ? (
          <Button icon={<DownloadOutlined />} loading={downloading} onClick={handleDownload}>
            下载配置内容
          </Button>
        ) : null
      }
    >
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="快照详情加载失败"
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
          <Spin /> <Text type="secondary">快照详情加载中…</Text>
        </div>
      ) : detail ? (
        <>
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="网域">
              {domainName ?? detail.network_domain_id}（{detail.network_domain_id}）
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
                  maxHeight: 360,
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
        </>
      ) : null}
    </Drawer>
  )
}
