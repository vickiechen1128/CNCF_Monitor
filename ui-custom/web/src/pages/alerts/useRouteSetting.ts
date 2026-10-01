/**
 * 「默认接收人（根兜底）」数据 Hook（T08-F8，决策 113 口径 C 骨架布缆开关）。
 *
 * 数据来源：`routeSettingApi.get()`（设定 + 派生生效态） + `notifyChannelsApi.list()`（渠道下拉源）。
 * 下拉选项 = 已启用渠道（展示平台派生接收人名）+ 首项「不接管」。
 *
 * 接收人名**必须由服务端派生**（决策 74：禁止前端复制 `sanitizeReceiverName` 造成两处漂移），
 * 故经 `getReceiverSnippet` 取 `receiver_name`；该片段接口需管理员权限，非管理员 / 取数失败时
 * **降级为只展示渠道名**（不阻断设定读取与选择本身）。
 *
 * 归属边界（决策 113）：选定默认接收人 = 授权平台在生成配置时只替换根 `route.receiver` 单键；
 * 本 Hook 不解析、不生成 YAML（前端零 yaml 依赖），产物由后端生成器承担。
 */
import { useCallback, useEffect, useState } from 'react'
import { notifyChannelsApi, routeSettingApi } from '../../api/alertmanager'
import type { RouteSetting } from '../../types/alertmanager'

/** 「不接管」选项哨兵值（渠道 ID 恒为正，−1 不会与真实 ID 冲突；向 antd Select 传 number 避免空值告警） */
export const NONE_RECEIVER_VALUE = -1

/** 下拉选项：`value=NONE_RECEIVER_VALUE` 即「不接管」；`receiverName` 取不到时标签只展示渠道名 */
export interface RouteSettingOption {
  value: number
  label: string
  /** 平台派生接收人名（片段接口可得时展示） */
  receiverName?: string
}

export interface UseRouteSettingResult {
  /** 当前设定 + 派生生效态；加载失败为 null */
  setting: RouteSetting | null
  /** 下拉选项（首项恒为「不接管」） */
  options: RouteSettingOption[]
  loading: boolean
  error: string | null
  /** 保存中（Select 禁用防重复提交） */
  saving: boolean
  reload: () => void
  /** 保存默认接收人；`null` = 关闭接管（护栏③）。失败抛出（由调用方提示） */
  save: (channelId: number | null) => Promise<RouteSetting>
}

/** 首项文案：不接管 = 保留用户手写的兜底配置（value=NONE_RECEIVER_VALUE） */
export const ROUTE_SETTING_NONE_LABEL = '不接管（保留我手写的兜底配置）'

export function useRouteSetting(): UseRouteSettingResult {
  const [setting, setSetting] = useState<RouteSetting | null>(null)
  const [options, setOptions] = useState<RouteSettingOption[]>([{ value: NONE_RECEIVER_VALUE, label: ROUTE_SETTING_NONE_LABEL }])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refresh, setRefresh] = useState(0)

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const [settingRes, channelsRes] = await Promise.all([routeSettingApi.get(), notifyChannelsApi.list()])
        const enabled = (channelsRes.data?.items ?? []).filter((c) => c.enabled)
        const next: RouteSettingOption[] = [{ value: NONE_RECEIVER_VALUE, label: ROUTE_SETTING_NONE_LABEL }]
        // 顺序取数（渠道数量可控），与「派生预览」同一降级口径
        for (const channel of enabled) {
          let receiverName: string | undefined
          try {
            const snippetRes = await notifyChannelsApi.getReceiverSnippet(channel.id)
            receiverName = snippetRes.data.receiver_name
          } catch {
            // 片段接口需管理员：无权限 / 失败时降级为只展示渠道名，不影响设定读写
            receiverName = undefined
          }
          next.push({
            value: Number(channel.id),
            label: receiverName ? `${channel.name}（接收人 ${receiverName}）` : channel.name,
            receiverName,
          })
        }
        if (cancelled) return
        setSetting(settingRes.data)
        setOptions(next)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setSetting(null)
        setError(e instanceof Error ? e.message : '加载默认接收人设定失败，请稍后重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const save = useCallback(async (channelId: number | null): Promise<RouteSetting> => {
    setSaving(true)
    try {
      const res = await routeSettingApi.update({ default_receiver_channel_id: channelId })
      setSetting(res.data)
      return res.data
    } finally {
      setSaving(false)
    }
  }, [])

  return { setting, options, loading, error, saving, reload, save }
}