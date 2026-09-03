/**
 * Module_08 静默管理页数据 Hook（决策 59 静默 API 直调，即时生效）。
 * 权威契约：docs/05-execution-records/module-08/api-contract-snapshot.md（§4）。
 * 消费 GET /silences、POST /silences、DELETE /silences；覆盖：加载 / 空态 / 接口错误 / 权限不足。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { alertmanagerSilenceApi } from '../../api/alertmanager'
import type { CreateSilencePayload, PaginatedItems, Silence } from '../../types/alertmanager'

export interface UseSilencesResult {
  silences: Silence[]
  total: number
  loading: boolean
  error: string | null
  permissionDenied: boolean
  reload: () => void
  /** 创建静默：越权 matcher 被拒时抛出，由调用方展示错误（决策 56） */
  create: (payload: CreateSilencePayload) => Promise<Silence>
  /** 删除静默：不存在抛出 not_found */
  remove: (id: string) => Promise<void>
}

/** 静默列表服务端查询参数（契约 §1.4/§4：page/page_size；active=true 过滤活跃静默） */
export interface SilenceQuery {
  page?: number
  page_size?: number
  /** 契约 §4：`active=true` 过滤活跃静默（其余状态由服务端返回全量） */
  active?: boolean
}

const EMPTY_PAGE: PaginatedItems<Silence> = { items: [], total: 0 }

export function useSilences(query: SilenceQuery = {}): UseSilencesResult {
  const { page = 1, page_size = 20, active } = query
  const [data, setData] = useState<PaginatedItems<Silence>>(EMPTY_PAGE)
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

  const load = useCallback(async () => {
    try {
      const res = await alertmanagerSilenceApi.getSilences({
        page,
        page_size,
        ...(active ? { active: 'true' } : {}),
      })
      setData(res.data)
      setError(null)
      setPermissionDenied(false)
    } catch (e) {
      if (isApiError(e) && e.code === 403) {
        setPermissionDenied(true)
      } else {
        setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [page, page_size, active])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；初始/刷新/翻页/筛选加载态由 query 变化触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const create = useCallback(async (payload: CreateSilencePayload): Promise<Silence> => {
    const res = await alertmanagerSilenceApi.createSilence(payload)
    setRefresh((r) => r + 1)
    return res.data
  }, [])

  const remove = useCallback(async (id: string): Promise<void> => {
    await alertmanagerSilenceApi.deleteSilence(id)
    setRefresh((r) => r + 1)
  }, [])

  return {
    silences: data.items,
    total: data.total,
    loading,
    error,
    permissionDenied,
    reload,
    create,
    remove,
  }
}