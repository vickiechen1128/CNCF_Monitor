/**
 * 拨测模块 API —— v3 兼容层（/api/v3/platform/blackbox-modules）。
 */
import type { ApiResponse } from '../types/api'
import { probeModuleApiV3 } from './strategyV3'
import type { ProbeModuleV3 } from '../types/strategyV3'

export interface BlackboxModule {
  id: string
  name: string
  content: string
  enabled: boolean
  prober: string
  referenced_jobs: number
  created_at: string
  updated_at: string
}

interface BlackboxModuleListData {
  list: BlackboxModule[]
  total: number
  page: number
  page_size: number
}

export interface BlackboxModuleInput {
  content: string
  enabled: boolean
}

function toView(item: ProbeModuleV3): BlackboxModule {
  return {
    id: item.id,
    name: item.name,
    content: item.content,
    enabled: item.enabled,
    prober: '',
    referenced_jobs: item.referenced_job_count,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

export const blackboxModuleApi = {
  async list(): Promise<ApiResponse<BlackboxModuleListData>> {
    const res = await probeModuleApiV3.list({ page: 1, page_size: 100 })
    return {
      ...res,
      data: {
        list: (res.data?.list ?? []).map(toView),
        total: res.data?.total ?? 0,
        page: res.data?.page ?? 1,
        page_size: res.data?.page_size ?? 100,
      },
    }
  },
  async create(name: string, content: string): Promise<ApiResponse<BlackboxModule>> {
    const res = await probeModuleApiV3.create({ name, content })
    return { ...res, data: toView(res.data) }
  },
  async update(id: string | number, input: BlackboxModuleInput): Promise<ApiResponse<BlackboxModule>> {
    const current = await probeModuleApiV3.get(String(id))
    const res = await probeModuleApiV3.update(String(id), {
      name: current.data.name,
      content: input.content,
      enabled: input.enabled,
    })
    return { ...res, data: toView(res.data) }
  },
  async remove(id: string | number): Promise<ApiResponse<{ deleted: boolean }>> {
    await probeModuleApiV3.remove(String(id))
    return { status: 'success', data: { deleted: true } }
  },
}
