import { useCallback, useEffect, useState } from 'react'
import { userApi } from '../../../api/admin'
import type { ItemsResult, UserItem } from '../../../types/admin'

/** 默认空分页（避免未加载完成时空指针） */
const EMPTY: ItemsResult<UserItem> = { items: [], total: 0 }

export interface UseUsersResult {
  data: ItemsResult<UserItem>
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * 用户列表数据 Hook：加载 / 错误 / 重载。
 * 异步请求回调内完成 setState，不在 effect 内同步 setState。
 */
export function useUsers(): UseUsersResult {
  const [data, setData] = useState<ItemsResult<UserItem>>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await userApi.list()
      setData(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 初版沿用本模块既有抓取 effect 模式：异步回调内 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  return { data, loading, error, reload }
}