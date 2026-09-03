/**
 * 资源管理平台 API（/api/v2/platform/...）
 *
 * Module_07 §6 / T07-F1：五类资源 CRUD、Excel 模板下载 / 导入、资源标签、
 * 业务分组字典与导入记录。CRUD / 标签 / 字典走统一信封 `apiClient`；
 * 模板下载（二进制流）与 Excel 导入（multipart FormData）因请求 / 响应
 * 形态特殊走原生 fetch。
 */
import { apiClient, ApiError } from './client'
import type { ApiResponse, ApiStatus, Paginated } from '../types/api'
import type {
  BusinessDomain,
  ImportMode,
  ImportRecord,
  ImportResult,
  OSOption,
  Resource,
  ResourceCategory,
  ResourceCreateInput,
  ResourceLabelItem,
  ResourceUpdateInput,
} from '../types/resource'

/** 资源列表分页与筛选参数（Module_07 §6.1 / T07-05） */
export interface ResourceListParams extends Record<string, string | number | boolean | undefined> {
  resource_category?: ResourceCategory
  network_domain_id?: string
  keyword?: string
  /** 未监控筛选（字段由 M01 维护、M07 只读映射透传，§6.1 / 决策 31-M1） */
  is_monitored?: boolean
  page?: number
  page_size?: number
}

/** 资源标签列表响应（GET /resources/:resource_id/labels，§6.2/T07-11） */
export interface ResourceLabelsResponse {
  items: ResourceLabelItem[]
  total: number
}

/** 新增 user 来源标签输入（§6.2） */
export interface ResourceLabelCreateInput {
  key: string
  value: string
}

/** 编辑 user 来源标签输入（§6.2，仅更新 value） */
export interface ResourceLabelUpdateInput {
  value: string
}

/** 业务分组字典响应（GET /business-domains，非分页信封 {list,total}，T07-02） */
export interface BusinessDomainsResponse {
  list: BusinessDomain[]
  total: number
}

/** 导入记录列表分页与筛选参数（§6.4 / T07-10） */
export interface ImportListParams extends Record<string, string | number | boolean | undefined> {
  resource_category?: ResourceCategory
  status?: string
  page?: number
  page_size?: number
}

/**
 * 原生 fetch 的统一信封解析 + 错误抛出（与 client.request 语义一致）。
 * 供 multipart / 二进制等无法走 JSON 序列化的请求复用。
 */
async function parseEnvelope<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await res.json()
    const status: ApiStatus = json.status ?? (res.ok ? 'success' : 'error')
    return {
      status,
      data: json.data as T,
      error: json.error,
      errorType: json.errorType,
    }
  }
  const text = await res.text()
  const status: ApiStatus = res.ok ? 'success' : 'error'
  return {
    status,
    data: undefined as T,
    error: text || res.statusText,
  }
}

/** 将失败响应转换为 ApiError（模板下载等非信封接口的错误解析） */
async function toApiError(res: Response): Promise<ApiError> {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const json = await res.json()
      return new ApiError(json.error || json.message || res.statusText, res.status, json.errorType)
    } catch {
      // 非 JSON 错误体，回退 statusText
    }
  }
  return new ApiError(res.statusText, res.status)
}

/** multipart/form-data POST：浏览器自动携带 Content-Type 与 boundary，不做 JSON 序列化（§6.1/T07-10） */
async function requestMultipart<T>(url: string, formData: FormData): Promise<ApiResponse<T>> {
  const res = await fetch(url, { method: 'POST', body: formData })
  const data = await parseEnvelope<T>(res)
  if (!res.ok || data.status === 'error') {
    throw new ApiError(data.error || res.statusText, res.status, data.errorType)
  }
  return data
}

/** 下载二进制文件流（Excel 模板，§6.1/T07-08；响应不是统一 JSON 信封） */
async function downloadBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) {
    throw await toApiError(res)
  }
  return res.blob()
}

/** 资源管理（五类资源 CRUD / Excel 模板与导入 / 资源标签） */
export const resourceApi = {
  list(params?: ResourceListParams): Promise<ApiResponse<Paginated<Resource>>> {
    return apiClient.get<Paginated<Resource>>('/api/v2/platform/resources', { params })
  },
  create(input: ResourceCreateInput): Promise<ApiResponse<Resource>> {
    return apiClient.post<Resource>('/api/v2/platform/resources', { body: input })
  },
  update(resourceId: string, input: ResourceUpdateInput): Promise<ApiResponse<Resource>> {
    return apiClient.put<Resource>(`/api/v2/platform/resources/${encodeURIComponent(resourceId)}`, { body: input })
  },
  remove(resourceId: string): Promise<ApiResponse<{ resource_id: string }>> {
    return apiClient.delete<{ resource_id: string }>(
      `/api/v2/platform/resources/${encodeURIComponent(resourceId)}`,
    )
  },
  /** 下载 xlsx 模板（含取值说明 sheet），返回 Blob 供前端触发下载 */
  template(type: ResourceCategory): Promise<Blob> {
    return downloadBlob(`/api/v2/platform/resources/${encodeURIComponent(type)}/template`)
  },
  /** Excel 导入（multipart：file + mode），返回统一信封解析的导入结果 */
  importExcel(type: ResourceCategory, file: File, mode: ImportMode): Promise<ApiResponse<ImportResult>> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)
    return requestMultipart<ImportResult>(`/api/v2/platform/resources/${encodeURIComponent(type)}/import`, formData)
  },
  labels(resourceId: string): Promise<ApiResponse<ResourceLabelsResponse>> {
    return apiClient.get<ResourceLabelsResponse>(
      `/api/v2/platform/resources/${encodeURIComponent(resourceId)}/labels`,
    )
  },
  createLabel(resourceId: string, input: ResourceLabelCreateInput): Promise<ApiResponse<ResourceLabelItem>> {
    return apiClient.post<ResourceLabelItem>(
      `/api/v2/platform/resources/${encodeURIComponent(resourceId)}/labels`,
      { body: input },
    )
  },
  updateLabel(
    resourceId: string,
    labelId: number,
    input: ResourceLabelUpdateInput,
  ): Promise<ApiResponse<ResourceLabelItem>> {
    return apiClient.put<ResourceLabelItem>(
      `/api/v2/platform/resources/${encodeURIComponent(resourceId)}/labels/${labelId}`,
      { body: input },
    )
  },
  removeLabel(resourceId: string, labelId: number): Promise<ApiResponse<{ label_id: number }>> {
    return apiClient.delete<{ label_id: number }>(
      `/api/v2/platform/resources/${encodeURIComponent(resourceId)}/labels/${labelId}`,
    )
  },
}

/** 业务分组字典登记输入（决策 48：code 创建后不可改，默认 enabled=true） */
export interface BusinessDomainCreateInput {
  code: string
  name: string
  description?: string
}

/** 业务分组字典受限编辑输入（决策 48：仅 name/description/enabled 可改，不接收 code） */
export interface BusinessDomainUpdateInput {
  name?: string
  description?: string
  enabled?: boolean
}

/** 业务分组字典（决策 48 起落 DB 可写，供资源录入 / Excel 校验下拉与业务管理页维护，§3.1/T07-02/§11.1） */
export const businessDomainApi = {
  list(): Promise<ApiResponse<BusinessDomainsResponse>> {
    return apiClient.get<BusinessDomainsResponse>('/api/v2/platform/business-domains')
  },
  /** 登记业务分组（POST，§6.1/T07、决策 48）：{code,name,description}，默认启用 */
  create(input: BusinessDomainCreateInput): Promise<ApiResponse<BusinessDomain>> {
    return apiClient.post<BusinessDomain>('/api/v2/platform/business-domains', { body: input })
  },
  /** 受限编辑业务分组（PUT :code，决策 48）：仅 name/description/enabled；无 DELETE（停用不删除） */
  update(code: string, input: BusinessDomainUpdateInput): Promise<ApiResponse<BusinessDomain>> {
    return apiClient.put<BusinessDomain>(`/api/v2/platform/business-domains/${encodeURIComponent(code)}`, { body: input })
  },
}

/** 操作系统内置字典（只读，供 host 表单「操作系统」下拉，os_dict.go） */
export const osOptionApi = {
  list(): Promise<ApiResponse<{ list: OSOption[] }>> {
    return apiClient.get<{ list: OSOption[] }>('/api/v2/platform/os-options')
  },
}

/** 导入记录（列表 / 详情，§6.4 / T07-10） */
export const importApi = {
  list(params?: ImportListParams): Promise<ApiResponse<Paginated<ImportRecord>>> {
    return apiClient.get<Paginated<ImportRecord>>('/api/v2/platform/imports', { params })
  },
  get(importId: number): Promise<ApiResponse<ImportRecord>> {
    return apiClient.get<ImportRecord>(`/api/v2/platform/imports/${importId}`)
  },
}
