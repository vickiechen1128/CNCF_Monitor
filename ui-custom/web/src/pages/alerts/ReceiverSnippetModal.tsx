/**
 * 接收人配置片段 Modal（T08-F13；Module_08 告警收敛与通知管理，A 路线 2026-09-28）。
 *
 * 用途：平台按渠道生成可直接粘贴的 receiver YAML 片段（内嵌真实数字渠道 ID 与桥令牌），
 * 用户把它粘到「告警配置」页 `alertmanager.yml` 的 `receivers:` 段，该渠道才真正接到告警路由。
 * A 路线：平台暂不代生成 receivers，由用户复制片段填入（令牌由服务端拼进片段，前端不拆分单列）。
 *
 * 状态矩阵：加载 / 加载失败（可重试）/ 权限不足（403，仅管理员可获取含令牌片段）/
 * 令牌未配置（`token_configured=false`，显式告警片段不可用）。
 * 展示类弹窗（无 Form、无回显竞态）→ 按 Step 3.7 例外条款可用 `destroyOnHidden`。
 */
import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Descriptions, Modal, Spin, Typography } from 'antd'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { isApiError } from '../../api/client'
import { notifyChannelsApi } from '../../api/alertmanager'
import type { NotifyChannel, ReceiverSnippetData } from '../../types/alertmanager'
import { useSkin } from '../../skinContext'
import { ALERT_CONFIG_PATH } from './alertmanagerConstants'

const { Text } = Typography

export interface ReceiverSnippetModalProps {
  open: boolean
  /** 目标渠道；null 时不加载（防御性，父级仅在选中行后打开） */
  channel: NotifyChannel | null
  onClose: () => void
}

export function ReceiverSnippetModal({ open, channel, onClose }: ReceiverSnippetModalProps) {
  const { message } = App.useApp()
  const { tokens } = useSkin()
  const [data, setData] = useState<ReceiverSnippetData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)

  const load = useCallback(async () => {
    if (!channel) return
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    try {
      const res = await notifyChannelsApi.getReceiverSnippet(channel.id)
      setData(res.data)
    } catch (e) {
      setData(null)
      if (isApiError(e) && e.code === 403) {
        setPermissionDenied(true)
      } else {
        setError(e instanceof Error ? e.message : '获取接收人配置失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [channel])

  useEffect(() => {
    if (!open || !channel) return
    // 请求回调内异步完成后才 setState；初始/刷新加载态由 state 触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [open, channel, load])

  const handleCopy = () => {
    const snippet = data?.snippet ?? ''
    if (!snippet) return
    navigator.clipboard?.writeText(snippet).then(
      () => message.success('接收人配置片段已复制，请粘贴到「告警配置」页的配置内容中'),
      () => message.error('复制失败，请手动选择片段文本复制'),
    )
  }

  return (
    <Modal
      title={channel ? `接收人配置（${channel.name}）` : '接收人配置'}
      open={open}
      onCancel={onClose}
      width={680}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="copy"
          type="primary"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          disabled={loading || permissionDenied || !data?.snippet}
        >
          复制配置片段
        </Button>,
      ]}
      destroyOnHidden
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="这段配置要用在哪"
        description={
          <>
            把下方片段粘贴到<Link to={ALERT_CONFIG_PATH}>「告警配置」</Link>页 alertmanager.yml 的 receivers: 段，
            该渠道才会真正接到告警通知。
          </>
        }
      />

      {permissionDenied && (
        <Alert
          type="warning"
          showIcon
          message="权限不足"
          description="当前账号无法获取接收人配置（该片段含平台内部凭据，仅管理员可获取）。请联系管理员获取片段，或用管理员账号登录后重试。"
        />
      )}

      {!permissionDenied && error && (
        <Alert
          type="error"
          showIcon
          message="接收人配置获取失败"
          description={error}
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
              重试
            </Button>
          }
        />
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <Spin />
          <div style={{ marginTop: 8 }}>
            <Text type="secondary">加载中…</Text>
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {!data.token_configured && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="通知暂不可用"
              description="平台尚未配置通知桥令牌，直接使用该片段的通知将无法发出，请联系管理员配置后重新获取。"
            />
          )}
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="接收人名">
              <Text code>{data.receiver_name}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="桥接地址">
              <Text code style={{ wordBreak: 'break-all' }}>
                {data.url}
              </Text>
            </Descriptions.Item>
          </Descriptions>
          <Text strong>配置片段（粘贴到 receivers: 段）</Text>
          <pre
            style={{
              margin: '8px 0 0 0',
              maxHeight: 260,
              overflow: 'auto',
              background: tokens.colorBgBase,
              padding: 12,
              borderRadius: 8,
              fontSize: 12.5,
              lineHeight: 1.6,
            }}
          >
            {data.snippet}
          </pre>
        </>
      )}
    </Modal>
  )
}
