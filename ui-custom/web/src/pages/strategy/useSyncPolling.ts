import { useCallback, useEffect, useRef, useState } from 'react'

export interface SyncPollingOptions {
  /** 总轮询时长，默认 10s（覆盖一次即时触发 + 一次 watcher 兜底） */
  durationMs?: number
  /** 轮询间隔，默认 1s */
  intervalMs?: number
}

/**
 * 保存 M01/M07 源数据后短暂轮询列表，让「待同步 → 已同步/失败」无需用户手动刷新。
 *
 * 立即触发是 best-effort；即使触发失败，30s watcher 仍会在下一轮更新。
 * 轮询只刷新当前页数据，不改变筛选与分页。
 */
export function useSyncPolling(refresh: () => void, options: SyncPollingOptions = {}) {
  const durationMs = options.durationMs ?? 10_000
  const intervalMs = options.intervalMs ?? 1_000
  const refreshRef = useRef(refresh)
  const [seq, setSeq] = useState(0)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const start = useCallback(() => setSeq((value) => value + 1), [])

  useEffect(() => {
    if (seq === 0) return
    const end = Date.now() + durationMs
    const timer = window.setInterval(() => {
      refreshRef.current()
      if (Date.now() >= end) window.clearInterval(timer)
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [seq, durationMs, intervalMs])

  return start
}
