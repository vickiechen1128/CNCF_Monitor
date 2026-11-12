/**
 * 资源管理平台 API（/api/v3/platform/...）
 *
 * Module_07 §6 / T07-F1：六类资源 CRUD、Excel 模板下载 / 导入、资源标签、
 * 业务 / 应用 / 平台字典与导入记录。CRUD / 标签 / 字典走统一信封 `apiClient`；
 * 模板下载（二进制流）与 Excel 导入（multipart FormData）因请求 / 响应
 * 形态特殊走 `rawRequest`（原生 fetch + 认证 Token + 401 统一处理）。
 *
 * v3 资源响应为「公共字段 + attributes」嵌套结构，本适配层负责与页面既有的
 * 平铺模型（ResourceListItem）双向映射，页面组件无需感知嵌套差异。
 */
import { apiClient, ApiError, rawRequest } from './client'
import type { ApiResponse, ApiStatus, Paginated } from '../types/api'
import type {
  AppPlatformRel,
  ApplicationDict,
  BusinessDomain,
  CloudDict,
  ImportMode,
  ImportRecord,
  ImportResult,
  OSOption,
  PlatformDict,
  ResourceCategory,
  ResourceCreateInput,
  ResourceLabelItem,
  ResourceLabelSource,
  ResourceListItem,
  ResourceUpdateInput,
} from '../types/resource'

/** 资源列表分页与筛选参数（Module_07 §6.1 / T07-05） */
export interface ResourceListParams extends Record<string, string | number | boolean | undefined> {
  resource_category?: ResourceCategory
  network_domain_id?: string
  keyword?: string
  /** 业务归属编码等值筛选（§6.1 / §11.1） */
  biz_code?: string
  /** 运行状态等值筛选（§6.1 / §11.1） */
  status?: string
  /** 平台归属编码等值筛选（决策 110；五类均支持） */
  platform_code?: string
  /** 应用归属编码等值筛选（决策 92；五类均支持） */
  app_code?: string
  /** 未监控筛选（字段由 M01 维护；v3 当前仅透传，后端暂未消费） */
  is_monitored?: boolean
  page?: number
  page_size?: number
}

/** v3 资源响应（公共字段 + attributes，见 M07 v3 契约 §2） */
export interface V3ResourceResponse {
  resource_id: string
  resource_category: ResourceCategory
  tenant_id?: string
  network_domain_id: string
  biz_code?: string
  app_code?: string
  platform_code?: string
  env?: string
  cluster?: string
  owner?: string
  status?: string
  source_type?: string
  scrape_port?: number
  attributes?: Record<string, unknown> | null
  created_at?: string
  updated_at?: string
}

/** 资源标签列表响应（GET /resources/:resource_id/labels，§6.2/T07-11） */
export interface ResourceLabelsResponse {
  items: ResourceLabelItem[]
  total: number
}

/** v3 标签对象（id 为 UUID 字符串） */
interface V3LabelResponse {
  id: string
  resource_id?: string
  key: string
  value: string
  source: ResourceLabelSource
}

/** 引用该资源的采集 Job 视图（GET /resources/:resource_id/referenced-by，B 方案知情确认，dev-feedback §15 F-21） */
export interface ResourceReferenceJob {
  job_name: string
  network_domain_id: string
  enabled: boolean
}

/** 资源被采集 Job 引用查询响应（GET /resources/:resource_id/referenced-by，§6.6.1） */
export interface ResourceReferenceResponse {
  jobs: ResourceReferenceJob[]
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

function attrString(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function attrNumber(attributes: Record<string, unknown>, key: string): number | undefined {
  const value = attributes[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** v3 资源响应 → 页面平铺模型；host 的 instance_name 唯一来源为 attributes.hostname。 */
export function v3ResourceToListItem(resource: V3ResourceResponse): ResourceListItem {
  const attributes = (resource.attributes ?? {}) as Record<string, unknown>
  const item: ResourceListItem = {
    resource_id: resource.resource_id,
    resource_category: resource.resource_category,
    tenant_id: resource.tenant_id,
    network_domain_id: resource.network_domain_id,
    biz_code: resource.biz_code || undefined,
    app_code: resource.app_code || undefined,
    platform_code: resource.platform_code || undefined,
    env: resource.env || undefined,
    cluster: resource.cluster || undefined,
    owner: resource.owner || undefined,
    status: resource.status ?? '',
    source_type: resource.source_type ?? 'manual',
    scrape_port: resource.scrape_port || undefined,
    created_at: resource.created_at,
    updated_at: resource.updated_at,
  }
  switch (resource.resource_category) {
    case 'host':
      item.instance_name = attrString(attributes, 'hostname')
      item.instance_ip = attrString(attributes, 'instance_ip')
      item.os_type = attrString(attributes, 'os_type')
      item.os_version = attrString(attributes, 'os_version')
      item.activated_at = attrString(attributes, 'activated_at')
      break
    case 'database':
      item.database_type = attrString(attributes, 'database_type')
      item.instance_ip = attrString(attributes, 'instance_ip')
      item.port = attrNumber(attributes, 'port')
      item.version = attrString(attributes, 'version')
      break
    case 'middleware':
      item.middleware_type = attrString(attributes, 'middleware_type')
      item.instance_ip = attrString(attributes, 'instance_ip')
      item.port = attrNumber(attributes, 'port')
      item.version = attrString(attributes, 'version')
      break
    case 'application':
      item.service_name = attrString(attributes, 'service_name')
      item.health_check_url = attrString(attributes, 'health_check_url')
      item.protocol = attrString(attributes, 'protocol')
      item.endpoint = attrString(attributes, 'endpoint')
      item.port = attrNumber(attributes, 'port')
      item.owner1 = attrString(attributes, 'owner1')
      item.owner1_contact = attrString(attributes, 'owner1_contact')
      item.owner2 = attrString(attributes, 'owner2')
      item.owner2_contact = attrString(attributes, 'owner2_contact')
      item.ops_person = attrString(attributes, 'ops_person')
      item.ops_person_contact = attrString(attributes, 'ops_person_contact')
      item.go_live_at = attrString(attributes, 'go_live_at')
      break
    case 'generic_target':
      item.target_name = attrString(attributes, 'target_name')
      item.instance_ip = attrString(attributes, 'instance_ip')
      item.port = attrNumber(attributes, 'port')
      item.metrics_path = attrString(attributes, 'metrics_path')
      item.scheme = attrString(attributes, 'scheme')
      item.exporter_type = attrString(attributes, 'exporter_type')
      break
    case 'interface_service':
      item.api_name = attrString(attributes, 'api_name')
      item.api_url = attrString(attributes, 'api_url')
      break
  }
  return item
}

/** 页面平铺字段 → v3 attributes（按类别裁剪，未填写的键不进入请求体）。 */
export function buildV3Attributes(input: ResourceCreateInput | ResourceUpdateInput): Record<string, unknown> {
  const value = input as unknown as Record<string, unknown>
  switch (input.resource_category) {
    case 'host':
      return {
        hostname: value.instance_name,
        instance_ip: value.instance_ip,
        os_type: value.os_type,
        activated_at: value.activated_at,
      }
    case 'database':
      return {
        database_type: value.database_type,
        instance_ip: value.instance_ip,
        port: value.port,
        version: value.version,
      }
    case 'middleware':
      return {
        middleware_type: value.middleware_type,
        instance_ip: value.instance_ip,
        port: value.port,
        version: value.version,
      }
    case 'application':
      return {
        service_name: value.service_name,
        health_check_url: value.health_check_url,
        protocol: value.protocol,
        endpoint: value.endpoint,
        port: value.port,
        owner1: value.owner1,
        owner1_contact: value.owner1_contact,
        owner2: value.owner2,
        owner2_contact: value.owner2_contact,
        ops_person: value.ops_person,
        ops_person_contact: value.ops_person_contact,
        go_live_at: value.go_live_at,
      }
    case 'generic_target':
      return {
        target_name: value.target_name,
        instance_ip: value.instance_ip,
        port: value.port,
        metrics_path: value.metrics_path,
        scheme: value.scheme,
        exporter_type: value.exporter_type,
      }
    case 'interface_service':
      return {
        api_name: value.api_name,
        api_url: value.api_url,
      }
  }
}

/** v3 写请求体（公共字段 + attributes 嵌套）。 */
export interface V3ResourceWritePayload {
  resource_category: ResourceCategory
  network_domain_id?: string
  biz_code?: string | null
  app_code?: string | null
  platform_code?: string | null
  env?: string
  cluster?: string | null
  owner?: string | null
  status?: string
  scrape_port?: number
  attributes: Record<string, unknown>
}

export function toV3ResourcePayload(input: ResourceCreateInput | ResourceUpdateInput): V3ResourceWritePayload {
  const value = input as unknown as Record<string, unknown>
  return {
    resource_category: input.resource_category,
    network_domain_id: value.network_domain_id as string | undefined,
    biz_code: (value.biz_code as string | null | undefined) ?? undefined,
    app_code: (value.app_code as string | null | undefined) ?? undefined,
    platform_code: value.platform_code === null ? null : (value.platform_code as string | undefined),
    env: value.env as string | undefined,
    cluster: (value.cluster as string | null | undefined) ?? undefined,
    owner: (value.owner as string | null | undefined) ?? undefined,
    status: value.status as string | undefined,
    scrape_port: value.scrape_port as number | undefined,
    attributes: buildV3Attributes(input),
  }
}

function labelToItem(label: V3LabelResponse): ResourceLabelItem {
  return { id: label.id, key: label.key, value: label.value, source: label.source }
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
  const res = await rawRequest(url, { method: 'POST', body: formData })
  const data = await parseEnvelope<T>(res)
  if (!res.ok || data.status === 'error') {
    throw new ApiError(data.error || res.statusText, res.status, data.errorType)
  }
  return data
}

/** 下载二进制文件流（Excel 模板，§6.1/T07-08；响应不是统一 JSON 信封） */
async function downloadBlob(url: string): Promise<Blob> {
  const res = await rawRequest(url, { method: 'GET' })
  if (!res.ok) {
    throw await toApiError(res)
  }
  return res.blob()
}

/** 资源管理（六类资源 CRUD / Excel 模板与导入 / 资源标签） */
export const resourceApi = {
  async list(params?: ResourceListParams): Promise<ApiResponse<Paginated<ResourceListItem>>> {
    const res = await apiClient.get<Paginated<V3ResourceResponse>>('/api/v3/platform/resources', { params })
    const raw = res.data ?? ({ list: [], total: 0, page: 1, page_size: 20 } as Paginated<V3ResourceResponse>)
    return {
      ...res,
      data: {
        list: (raw.list ?? []).map(v3ResourceToListItem),
        total: raw.total ?? 0,
        page: raw.page ?? params?.page ?? 1,
        page_size: raw.page_size ?? params?.page_size ?? 20,
      },
    }
  },
  async create(input: ResourceCreateInput): Promise<ApiResponse<ResourceListItem>> {
    const res = await apiClient.post<V3ResourceResponse>('/api/v3/platform/resources', {
      body: toV3ResourcePayload(input),
    })
    return { ...res, data: v3ResourceToListItem(res.data) }
  },
  async update(resourceId: string, input: ResourceUpdateInput): Promise<ApiResponse<ResourceListItem>> {
    const res = await apiClient.put<V3ResourceResponse>(
      `/api/v3/platform/resources/${encodeURIComponent(resourceId)}`,
      { body: toV3ResourcePayload(input) },
    )
    return { ...res, data: v3ResourceToListItem(res.data) }
  },
  remove(resourceId: string): Promise<ApiResponse<{ resource_id: string }>> {
    return apiClient.delete<{ resource_id: string }>(
      `/api/v3/platform/resources/${encodeURIComponent(resourceId)}`,
    )
  },
  /** 查询引用该资源的采集 Job 名单（GET /resources/:resource_id/referenced-by，§6.6.1 引用名单口径；
   *  B 方案知情确认：删除二次确认弹窗据此回显引用数 + 「查看引用 Job」跳转，dev-feedback §15 F-21） */
  referencedBy(resourceId: string): Promise<ApiResponse<ResourceReferenceResponse>> {
    return apiClient.get<ResourceReferenceResponse>(
      `/api/v3/platform/resources/${encodeURIComponent(resourceId)}/referenced-by`,
    )
  },
  /** 下载 xlsx 模板（固定列头，可直接导入），返回 Blob 供前端触发下载 */
  template(type: ResourceCategory): Promise<Blob> {
    return downloadBlob(
      `/api/v3/platform/import-templates/${encodeURIComponent(type)}?format=xlsx`,
    )
  },
  /** Excel 导入（multipart：file + resource_category + mode），返回统一信封解析的导入结果 */
  importExcel(type: ResourceCategory, file: File, mode: ImportMode): Promise<ApiResponse<ImportResult>> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('resource_category', type)
    formData.append('mode', mode)
    return requestMultipart<ImportResult>('/api/v3/platform/imports', formData)
  },
  async labels(resourceId: string): Promise<ApiResponse<ResourceLabelsResponse>> {
    const res = await apiClient.get<{ list: V3LabelResponse[]; total: number }>(
      `/api/v3/platform/resources/${encodeURIComponent(resourceId)}/labels`,
    )
    return {
      ...res,
      data: {
        items: (res.data?.list ?? []).map(labelToItem),
        total: res.data?.total ?? 0,
      },
    }
  },
  async createLabel(
    resourceId: string,
    input: ResourceLabelCreateInput,
  ): Promise<ApiResponse<ResourceLabelItem>> {
    const res = await apiClient.post<V3LabelResponse>(
      `/api/v3/platform/resources/${encodeURIComponent(resourceId)}/labels`,
      { body: input },
    )
    return { ...res, data: labelToItem(res.data) }
  },
  async updateLabel(
    resourceId: string,
    labelId: string,
    input: ResourceLabelUpdateInput,
  ): Promise<ApiResponse<ResourceLabelItem>> {
    const res = await apiClient.put<V3LabelResponse>(
      `/api/v3/platform/resources/${encodeURIComponent(resourceId)}/labels/${encodeURIComponent(labelId)}`,
      { body: input },
    )
    return { ...res, data: labelToItem(res.data) }
  },
  removeLabel(resourceId: string, labelId: string): Promise<ApiResponse<{ label_id: string }>> {
    return apiClient.delete<{ label_id: string }>(
      `/api/v3/platform/resources/${encodeURIComponent(resourceId)}/labels/${encodeURIComponent(labelId)}`,
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
    return apiClient.get<BusinessDomainsResponse>('/api/v3/platform/business-domains')
  },
  /** 登记业务分组（POST，§6.1/T07、决策 48）：{code,name,description}，默认启用 */
  create(input: BusinessDomainCreateInput): Promise<ApiResponse<BusinessDomain>> {
    return apiClient.post<BusinessDomain>('/api/v3/platform/business-domains', { body: input })
  },
  /** 受限编辑业务分组（PUT :code，决策 48）：仅 name/description/enabled；无 DELETE（停用不删除） */
  update(code: string, input: BusinessDomainUpdateInput): Promise<ApiResponse<BusinessDomain>> {
    return apiClient.put<BusinessDomain>(
      `/api/v3/platform/business-domains/${encodeURIComponent(code)}`,
      { body: input },
    )
  },
}

/** 应用字典响应（GET /application-dict，非分页信封 {list,total}，§5.19 / 决策 92） */
export interface ApplicationDictsResponse {
  list: ApplicationDict[]
  total: number
}

/**
 * 应用字典登记输入（§5.19 / 决策 92）：app_code 不可变、app_name 必填。
 *
 * {v2026-10-03 决策 118-3} **不含 `platform_code`**——应用↔平台已改 M:N（决策 111），
 * 后端写链路忽略该字段，保留声明即误导源。平台关系一律走 `appPlatformRelApi`。
 */
export interface ApplicationDictCreateInput {
  app_code: string
  app_name: string
  description?: string
}

/**
 * 应用字典受限编辑输入（§5.19 红线：仅 app_name/description/status 可改，不接收 app_code）。
 *
 * {v2026-10-03 决策 118-3} **不含 `platform_code`**（原 `string | null` 声明已移除）：
 * 后端 `Update` 只接受 app_name / description / status，M:N 关系经 `appPlatformRelApi` 维护。
 */
export interface ApplicationDictUpdateInput {
  app_name?: string
  description?: string
  status?: 'enabled' | 'disabled'
}

/** 应用字典（§5.19 决策 92，落 DB；app label 取 app_code，展示取 app_name） */
export const applicationDictApi = {
  list(): Promise<ApiResponse<ApplicationDictsResponse>> {
    return apiClient.get<ApplicationDictsResponse>('/api/v3/platform/application-dict')
  },
  /** 登记应用（POST，§5.19）：{app_code,app_name,description}，默认 enabled */
  create(input: ApplicationDictCreateInput): Promise<ApiResponse<ApplicationDict>> {
    return apiClient.post<ApplicationDict>('/api/v3/platform/application-dict', { body: input })
  },
  /** 受限编辑应用（PUT :app_code，§5.19）：仅 app_name/description/status；无 DELETE（停用不删除） */
  update(appCode: string, input: ApplicationDictUpdateInput): Promise<ApiResponse<ApplicationDict>> {
    return apiClient.put<ApplicationDict>(
      `/api/v3/platform/application-dict/${encodeURIComponent(appCode)}`,
      { body: input },
    )
  },
}

/** 平台字典响应（GET /platform-dict，非分页信封 {list,total}，§5.21 / 契约快照 §5C） */
export interface PlatformDictsResponse {
  list: PlatformDict[]
  total: number
}

/** 平台字典登记输入（契约快照 §5C）：platform_code 不可变、platform_name 必填 */
export interface PlatformDictCreateInput {
  platform_code: string
  platform_name: string
  description?: string
}

/** 平台字典受限编辑输入（契约快照 §5C）：仅 platform_name/description/enabled，不接收 platform_code */
export interface PlatformDictUpdateInput {
  platform_name?: string
  description?: string
  enabled?: boolean
}

/**
 * 平台字典（§5.21 / 决策 104，落 DB；`platform` label 取 `platform_code`，展示取 `platform_name`）。
 * 无 DELETE（停用不删除）：应用侧「所属平台」下拉只读消费本字典且仅列启用项。
 */
export const platformDictApi = {
  list(): Promise<ApiResponse<PlatformDictsResponse>> {
    return apiClient.get<PlatformDictsResponse>('/api/v3/platform/platform-dict')
  },
  /** 登记平台（POST，契约快照 §5C）：{platform_code,platform_name,description}，默认 enabled */
  create(input: PlatformDictCreateInput): Promise<ApiResponse<PlatformDict>> {
    return apiClient.post<PlatformDict>('/api/v3/platform/platform-dict', { body: input })
  },
  /** 受限编辑平台（PUT :platform_code，契约快照 §5C）：仅 platform_name/description/enabled */
  update(platformCode: string, input: PlatformDictUpdateInput): Promise<ApiResponse<PlatformDict>> {
    return apiClient.put<PlatformDict>(
      `/api/v3/platform/platform-dict/${encodeURIComponent(platformCode)}`,
      { body: input },
    )
  },
}

/** 应用↔平台关联列表查询参数（GET /app-platform-rel，§6.1 / 决策 111） */
export interface AppPlatformRelListParams extends Record<string, string | number | boolean | undefined> {
  app_code?: string
  platform_code?: string
}

/** 应用↔平台关联列表响应（§6.1 / 决策 111）：非分页信封 **{list,total}**（与 items 型分页接口区分） */
export interface AppPlatformRelsResponse {
  list: AppPlatformRel[]
  total: number
}

/** 新增应用↔平台关联输入（POST /app-platform-rel，§6.1 / 决策 111）：is_primary 默认 false */
export interface AppPlatformRelCreateInput {
  app_code: string
  platform_code: string
  is_primary?: boolean
}

/** 编辑应用↔平台关联输入（PUT /app-platform-rel/:rel_id，§6.1 / 决策 111）：仅切换 is_primary */
export interface AppPlatformRelUpdateInput {
  is_primary: boolean
}

/**
 * 应用↔平台关联（`app_platform_rel`，§5.24 / 决策 111）
 *
 * 应用↔平台由「应用单值可选父级」改为 **M:N**（一套软件可同时在多个平台部署），
 * 关联权威迁至本表；应用字典 `ApplicationDict.platform_code` 随之废弃（仅存量读取兼容）。
 * `is_primary` 主平台标记同时承担资源 `platform_code` 未显式填写时的**兜底**取值（决策 110）。
 */
export const appPlatformRelApi = {
  list(params?: AppPlatformRelListParams): Promise<ApiResponse<AppPlatformRelsResponse>> {
    return apiClient.get<AppPlatformRelsResponse>('/api/v3/platform/app-platform-rel', { params })
  },
  /** 新增关联（POST）：同一 app_code 重复 is_primary=true 由服务端校验拒绝 */
  create(input: AppPlatformRelCreateInput): Promise<ApiResponse<AppPlatformRel>> {
    return apiClient.post<AppPlatformRel>('/api/v3/platform/app-platform-rel', { body: input })
  },
  /** 编辑关联（PUT :rel_id）：切换主平台；同一 app_code 主平台唯一由服务端校验 */
  update(relId: string, input: AppPlatformRelUpdateInput): Promise<ApiResponse<AppPlatformRel>> {
    return apiClient.put<AppPlatformRel>(
      `/api/v3/platform/app-platform-rel/${encodeURIComponent(relId)}`,
      { body: input },
    )
  },
  /** 解除关联（DELETE :rel_id）：存量资源 platform_code 悬空时仅提示、不强制改写 */
  remove(relId: string): Promise<ApiResponse<{ rel_id: string }>> {
    return apiClient.delete<{ rel_id: string }>(
      `/api/v3/platform/app-platform-rel/${encodeURIComponent(relId)}`,
    )
  },
}

/** 云字典响应（GET /cloud-dict，非分页信封 {list,total}，§5.20 / 决策 98 / 102） */
export interface CloudDictsResponse {
  list: CloudDict[]
  total: number
}

/**
 * 云字典（§5.20 / 决策 102-③）：`cloud_code → cloud` label 的取值权威，随部署预置、
 * **全局只读**——仅暴露 `list`，**不提供 create / update / remove**（后端无写接口，
 * 前端亦不提供任何登记 / 编辑 / 删除入口，增删改随版本发版）。
 */
export const cloudDictApi = {
  list(): Promise<ApiResponse<CloudDictsResponse>> {
    return apiClient.get<CloudDictsResponse>('/api/v3/platform/cloud-dict')
  },
}

/** 操作系统内置字典（只读，供 host 表单「操作系统」下拉，os_dict.go） */
export const osOptionApi = {
  list(): Promise<ApiResponse<{ list: OSOption[] }>> {
    return apiClient.get<{ list: OSOption[] }>('/api/v3/platform/os-options')
  },
}

/** 导入记录（列表 / 详情，§6.4 / T07-10） */
export const importApi = {
  list(params?: ImportListParams): Promise<ApiResponse<Paginated<ImportRecord>>> {
    return apiClient.get<Paginated<ImportRecord>>('/api/v3/platform/imports', { params })
  },
  get(importId: string): Promise<ApiResponse<ImportRecord>> {
    return apiClient.get<ImportRecord>(`/api/v3/platform/imports/${encodeURIComponent(importId)}`)
  },
}
