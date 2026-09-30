/**
 * 「派生预览」数据 Hook（告警配置页只读区块，B 路线 / 决策 74）。
 *
 * 数据来源：`notifyChannelsApi.list()`（登录态）→ 过滤 `enabled` → **顺序**拉取每渠道接收人片段
 * （`getReceiverSnippet`，admin）。据此展示「已启用渠道 → 派生 receiver 名 + 该 receiver 的 YAML 片段」。
 *
 * 权限降级：接收人片段接口需管理员权限，非管理员调用返回 403——此时不阻断整页，降级为「无权限」
 * 提示（渠道接收人仍由平台自动写入，不影响生效）。顺序取数避免并发过多请求。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { notifyChannelsApi } from '../../api/alertmanager'

/** 派生预览的一行：一个已启用渠道 → 平台将写入的 receiver */
export interface DerivedReceiverRow {
  /** 真实数字渠道 ID */
  channelId: string
  /** 渠道名（用户可见） */
  channelName: string
  /** 平台派生的 receiver 名（渠道名归一化；为空时回落 notify-<ID>） */
  receiverName: string
  /** 该 receiver 的 YAML 片段（写入 receivers 段） */
  snippet: string
  /** 桥令牌是否已配置；false 时该片段当前不可用 */
  tokenConfigured: boolean
}

export interface UseDerivedReceiversResult {
  rows: DerivedReceiverRow[]
  loading: boolean
  error: string | null
  /** 无权限查看接收人片段（403）；渠道接收人仍由平台自动写入 */
  permissionDenied: boolean
  reload: () => void
}

export function useDerivedReceivers(): UseDerivedReceiversResult {
  const [rows, setRows] = useState<DerivedReceiverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [refresh, setRefresh] = useState(0)

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await notifyChannelsApi.list()
        const enabled = (res.data?.items ?? []).filter((c) => c.enabled)
        const next: DerivedReceiverRow[] = []
        let denied = false
        // 顺序取数：渠道数量可控，避免并发拉取片段
        for (const channel of enabled) {
          try {
            const snippetRes = await notifyChannelsApi.getReceiverSnippet(channel.id)
            next.push({
              channelId: channel.id,
              channelName: channel.name,
              receiverName: snippetRes.data.receiver_name,
              snippet: snippetRes.data.snippet,
              tokenConfigured: snippetRes.data.token_configured,
            })
          } catch (e) {
            if (isApiError(e) && e.code === 403) {
              denied = true
              break
            }
            throw e
          }
        }
        if (cancelled) return
        setRows(next)
        setPermissionDenied(denied)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setRows([])
        if (isApiError(e) && e.code === 403) {
          setPermissionDenied(true)
          setError(null)
        } else {
          setPermissionDenied(false)
          setError(e instanceof Error ? e.message : '派生预览加载失败，请稍后重试')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refresh])

  return { rows, loading, error, permissionDenied, reload }
}