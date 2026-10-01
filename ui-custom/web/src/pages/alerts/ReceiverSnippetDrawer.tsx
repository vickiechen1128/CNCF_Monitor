/**
 * 接收人配置片段抽屉（T08-F14；Module_08 告警收敛与通知管理，B 路线 2026-09-28）。
 *
 * 用途：平台按渠道生成可参考的 receiver YAML 片段（内嵌真实数字渠道 ID 与桥令牌）。
 * B 路线：已启用渠道的接收人由平台在生成配置时**自动写入** alertmanager.yml 的 receivers
 * （配置即生效），无需手工复制片段；本抽屉仅在用户**手写自定义 receiver** 时作参考。
 * 令牌由服务端拼进片段（走 `http_config.authorization` 请求头，不写进 URL query），前端不拆分单列。
 *
 * 状态矩阵：加载 / 加载失败（可重试）/ 权限不足（403，仅管理员可获取含令牌片段）/
 * 令牌未配置（`token_configured=false`，显式告警片段不可直接使用）。
 * 展示类抽屉（无 Form、无表单回显竞态）按任务卡要求仍固定 `forceRender`（禁用 `destroyOnHidden`），
 * 避免「关闭→打开」时的惰性挂载差异；父级以 `key` 每次打开重挂，保证上一条渠道的片段不残留。
 *
 * 信息架构（dev-feedback #27，2026-09-30）：一个抽屉最多一块 `Alert`——只有「拿不到数据」
 * （403 / 取数失败）才算阻断态，才用 `Alert`；常驻提示降级为「抽屉副标题 → 单行状态条 → 行内 tag」，
 * 不占 `Alert` 整块视觉位（色点 + 文本表达非阻断状态，不用整块黄底读成"出事了"）。
 *
 * 归属边界（dev-feedback #26 / #28 L3，2026-09-30）：平台只物化 `receivers` 定义，
 * 通知真正生效还须用户在 `route`/`routes` 里把 `receiver` 指向它；该说明贴在 receiver 片段块附近，
 * 不做成整页级警告（提示贴在它保护的对象上）。
 */
import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Descriptions, Drawer, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { isApiError } from '../../api/client'
import { notifyChannelsApi } from '../../api/alertmanager'
import type { NotifyChannel, ReceiverSnippetData } from '../../types/alertmanager'
import { useSkin } from '../../skinContext'
import { ALERT_CONFIG_PATH } from './alertmanagerConstants'

const { Text } = Typography

export interface ReceiverSnippetDrawerProps {
  open: boolean
  /** 目标渠道；null 时不加载（防御性，父级仅在选中行后打开） */
  channel: NotifyChannel | null
  onClose: () => void
}

export function ReceiverSnippetDrawer({ open, channel, onClose }: ReceiverSnippetDrawerProps) {
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
      () => message.success('接收人配置片段已复制'),
      () => message.error('复制失败，请手动选择片段文本复制'),
    )
  }

  // 抽屉副标题（#27：原 info Alert 降级为顶部副标题文本，不占 Alert 视觉位）。说明片段用在哪、并给出「告警配置」入口。
  const drawerDescription = (
    <span>
      已启用渠道的接收人由平台在下发配置时自动生成，通常无需手工粘贴。仅当你需要
      <Link to={ALERT_CONFIG_PATH}>「告警配置」</Link>
      中的自定义接收人时，可参考下方片段；请勿手写与渠道自动生成的接收人同名的 receiver。
    </span>
  )

  return (
    <Drawer
      title={channel ? `接收人配置（${channel.name}）` : '接收人配置'}
      open={open}
      onClose={onClose}
      width={680}
      forceRender
      extra={
        <Space size={8}>
          <Button onClick={onClose}>关闭</Button>
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={handleCopy}
            disabled={loading || permissionDenied || !data?.snippet}
          >
            复制配置片段
          </Button>
        </Space>
      }
    >
      {/* 副标题文本（#27：原 info Alert 降级，不占 Alert 视觉位） */}
      <div style={{ marginBottom: 12, color: 'rgba(0,0,0,0.45)' }}>{drawerDescription}</div>

      {/* 阻断态才用 Alert：权限不足（403）与取数失败互斥，最多一块同时出现 */}
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
          {/* 非阻断提示降级为单行状态条（#27）：色点 + 文本，不用整块 Alert 黄底 */}
          {!data.token_configured && (
            <Space
              size={8}
              style={{
                marginBottom: 12,
                padding: '6px 10px',
                width: '100%',
                background: tokens.colorBgBase,
                borderRadius: 6,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: tokens.colorWarning,
                  flexShrink: 0,
                }}
              />
              <Text strong>通知暂不可用</Text>
              <Text type="secondary">
                ：平台尚未配置通知桥令牌，该片段当前不可用，请联系管理员配置令牌后重新获取。
              </Text>
            </Space>
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

          {/* L3（#26 / #28.5，T08-F9）：口径升级——平台自动写入 receivers 定义；具体分流 route.routes[]
              由用户写；默认兜底接收人（route.receiver）在用户选定默认接收人后由平台接管（决策 113 口径 C）。
              非整页级警告，用左色条小注承接「保护对象」的语义；不新增 Alert 块（延续 dev-feedback #27）。 */}
          <Text
            type="secondary"
            style={{
              display: 'block',
              marginBottom: 12,
              paddingLeft: 10,
              borderLeft: `3px solid ${tokens.colorInfo}`,
              lineHeight: 1.6,
            }}
          >
            平台自动写入的是 <Text code>receivers</Text> 定义（名为 <Text code>notify-&lt;id&gt;</Text> 或你的渠道名）；
            具体分流 <Text code>route.routes[]</Text> 由你写；默认兜底接收人（<Text code>route.receiver</Text>）在你选定默认接收人后由平台接管。
          </Text>

          <Space size={8} style={{ marginBottom: 8 }} align="center">
            <Text strong>配置片段（手写自定义接收人时参考）</Text>
            {/* 风险提示（#27）降级为行内 tag，贴在被保护对象（片段标题）右侧，Tooltip 展开说明 */}
            <Tooltip title="该片段含平台内网凭据，请勿外发：片段里的令牌是平台内部通知桥凭据（随 authorization 请求头下发），仅用于本平台的自定义接收人参考，请勿转发到聊天群、工单或文档。">
              <Tag color="warning">含内网凭据</Tag>
            </Tooltip>
          </Space>
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
    </Drawer>
  )
}
