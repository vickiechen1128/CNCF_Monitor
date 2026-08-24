import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isApiError } from '../../../api/client'
import { deploymentApi, networkDomainMonitorApi } from '../../../api/configCenter'
import type { ConfigDeployment, NetworkDomain, PaginatedItems } from '../../../types/config-center'

export interface UseDeploymentsResult {
  data: PaginatedItems<ConfigDeployment>
  loading: boolean
  error: string | null
  permissionDenied: boolean
  page: number
  pageSize: number
  onPageSizeChange: (p: number, pz: number) => void
  reload: () => void
  /** 定位参数：?change_no 收窄到该变更单的发布记录（PRD §9.1 全链路关联） */
  locChangeNo?: string
  /** 定位参数：?network_domain 再收窄到该网域 */
  locDomain?: string
}

const EMPTY_PAGE: PaginatedItems<ConfigDeployment> = { items: [], total: 0 }

/**
 * 下发记录列表数据 Hook（Module_09，契约 §5 / §6.5.3）。
 * 消费 `GET /api/v2/platform/deployments`（信封 items；支持 change_no + network_domain_id 服务端筛选）。
 * 从配置变更确认页「查看发布记录」深链携带 change_no + network_domain（useSearchParams 读取）。
 * 覆盖：分页 / 加载 / 接口错误 / 权限不足 / 定位参数。
 */
export function useDeployments(): UseDeploymentsResult {
  const [searchParams] = useSearchParams()
  const locChangeNo = searchParams.get('change_no') ?? undefined
  const locDomain = searchParams.get('network_domain') ?? undefined

  const [data, setData] = useState<PaginatedItems<ConfigDeployment>>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await deploymentApi.list({
        network_domain_id: locDomain,
        change_no: locChangeNo,
        page,
        page_size: pageSize,
      } as Record<string, string | number | undefined>)
      setData(res.data)
    } catch (e) {
      if (isApiError(e) && e.code === 403) {
        setPermissionDenied(true)
      } else {
        setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [locDomain, locChangeNo, page, pageSize])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；加载态由 onPageSizeChange/reload 显式触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const onPageSizeChange = useCallback((p: number, pz: number) => {
    setPage(p)
    setPageSize(pz)
    setLoading(true)
  }, [])

  return {
    data,
    loading,
    error,
    permissionDenied,
    page,
    pageSize,
    onPageSizeChange,
    reload,
    locChangeNo,
    locDomain,
  }
}

/** 全部网域（id→name 映射，用于列表「网域」列展示；下发记录可能涉及未纳管历史域） */
export async function fetchAllDomains(): Promise<NetworkDomain[]> {
  const res = await networkDomainMonitorApi.list({ page: 1, page_size: 100 })
  // networkDomainMonitorApi.list 实际走 M06 `/api/v2/platform/network-domains`，信封为 { list, total }
  // （非 M09 的 { items, total }）。此处显式读取 list 信封，返回值语义保持 NetworkDomain[] 不变。
  return (res.data as unknown as { list: NetworkDomain[] }).list
}