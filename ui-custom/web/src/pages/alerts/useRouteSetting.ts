/**
 * 「默认接收人（根兜底）」数据 Hook（T08-F8，决策 113 口径 C 骨架布缆开关）。
 *
 * 数据来源：`routeSettingApi.get()`（设定 + 派生生效态） + `notifyChannelsApi.list()`（渠道下拉源）。
 * 下拉选项 = 已启用渠道（**只展示渠道名**）+ 首项「不接管」。
 *
 * 归属边界（决策 113）：选定默认接收人 = 授权平台在生成配置时只替换根 `route.receiver` 单键；
 * 本 Hook 不解析、不生成 YAML（前端零 yaml 依赖），产物由后端生成器承担。
 *
 * 2026-10-08：选项标签去掉「（接收人 notify-1）」后缀。receiver 名是平台内部标识，
 * 对"我选了哪个渠道"无帮助，却让选项像技术串；用户实测正是因此看不出下拉框与
 * 「兜底策略」是同一个东西。随之移除逐渠道的 admin-only `getReceiverSnippet`（N+1）。
 */
import { useCallback, useEffect, useState } from 'react'
import { notifyChannelsApi, routeSettingApi } from '../../api/alertmanager'
import type { RouteMode, RouteSetting, UpdateRouteSettingPayload } from '../../types/alertmanager'

/** 「不接管」选项哨兵值（渠道 ID 恒为正，−1 不会与真实 ID 冲突；向 antd Select 传 number 避免空值告警） */
export const NONE_RECEIVER_VALUE = -1

/**
 * 下拉选项：`value=NONE_RECEIVER_VALUE` 即「不接管」。
 *
 * ⚠️ 2026-10-08 移除 `receiverName` 字段：选项标签已改为**只展示渠道名**（receiver 名是
 * 平台内部标识，如 `notify-1`，对"我选了哪个渠道"无帮助）。该字段移除后，
 * 逐渠道调用 **admin-only** 的 `getReceiverSnippet`（N+1，非管理员还必然失败降级）
 * 已无任何消费方，故一并摘除——渠道名本来就含在 `notifyChannelsApi.list()` 的
 * `name` 字段里。
 */
export interface RouteSettingOption {
  value: number
  label: string
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
  /**
   * 保存兜底渠道与（可选）路由模式——**单次 PUT 同时携带两项**。
   *
   * `channelId`：`null` = 不接管（护栏③：停止替换、不删最后写入的值）。
   * `mode`：仅在显式传入时写入（只改兜底时不带 mode，保持后端原值）。
   *
   * ⚠ 决策三（提案 alert-config-policy-split-migration.md §3.3）：切到「我来编辑」时
   * 自动把兜底置为「不接管」，这属于**伴随声明**，必须合并进同一次 `PUT route-setting`
   * （调用方传 `save(null, 'handwritten')`）。若拆成两次请求，会产生用户未主动发起的
   * 独立变更单，违反决策 42-1（抑制空变更单）与「每条变更项须自解释」。
   * 失败抛出（由调用方提示）。
   */
  save: (channelId: number | null, mode?: RouteMode) => Promise<RouteSetting>
}

/**
 * 首项文案：不接管 = 保留配置文件里已写的兜底值。
 *
 * 2026-10-08 修订：原为「不接管（保留我手写的兜底配置）」。问题有三——
 *   1. **「我手写」是歧义根源**（与模式选项同病）：它承诺"我来写"，而实际含义是
 *      "我不改配置文件里已有的值"，用户易误以为要去某个编辑器里写；
 *   2. **「兜底」是实现视角术语**（提案 §7.5 要求用户视图一律不用）；
 *   3. 说了"我手写"却不说"在哪写"，等于没给可执行信息。
 * 改后只说客观事实：平台不接管，配置文件里已有的值原样保留。
 */
export const ROUTE_SETTING_NONE_LABEL = '不接管（保留配置文件里已有的值）'

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
        // 选项只展示**渠道名**（用户认知里的东西）。
        // 2026-10-08：原为 `${channel.name}（接收人 ${receiverName}）` 且逐渠道调
        // admin-only 的 getReceiverSnippet 取名——但 receiver 名是平台内部标识
        // （如 `notify-1`），对"我选了哪个渠道"毫无帮助。去掉展示后那次 N+1 取数
        // 也失去唯一消费方，一并摘除（渠道名本就在 list() 的 name 字段里）。
        const next: RouteSettingOption[] = [
          { value: NONE_RECEIVER_VALUE, label: ROUTE_SETTING_NONE_LABEL },
          ...enabled.map((channel) => ({ value: Number(channel.id), label: channel.name })),
        ]
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

  const save = useCallback(async (channelId: number | null, mode?: RouteMode): Promise<RouteSetting> => {
    setSaving(true)
    try {
      // 单次 PUT 同时持久化兜底渠道与 route 段作者模式（T08-F12；决策三要求合并提交）。
      // mode 仅在显式传入时写入（切换模式时传；仅改兜底渠道时不改模式，保持后端原值）。
      const payload: UpdateRouteSettingPayload = { default_receiver_channel_id: channelId }
      if (mode) payload.mode = mode
      const res = await routeSettingApi.update(payload)
      setSetting(res.data)
      return res.data
    } finally {
      setSaving(false)
    }
  }, [])

  return { setting, options, loading, error, saving, reload, save }
}