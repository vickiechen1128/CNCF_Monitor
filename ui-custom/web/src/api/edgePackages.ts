/**
 * 边缘离线安装包 API（M09 v3 契约 §5）。
 * 权威契约：docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md §5。
 *
 * 两个形态：
 * - 包清单（GET /edge-packages）走统一 JSON 信封 `apiClient`，data 为 `{list,total}`；
 * - 指定产物下载 tar.gz（GET /edge-packages/{file}）为二进制流，走 `rawRequest`
 *   （原生 fetch + 认证 Token + 401 统一处理），参考 resources.ts 模板下载。
 */
import { apiClient, ApiError, rawRequest } from './client'
import type { ApiResponse } from '../types/api'
import type { EdgePackage } from '../types/config-center'

const PACKAGES_PATH = '/api/v3/platform/edge-packages'

/** v3 包清单单条（契约 §5.1） */
interface PackageResponse {
  version: string
  file: string
  sha256: string
  size_bytes: number
  released_at?: string | null
  components?: { name: string; version: string }[]
}

/** v3 包清单信封（契约 §1.2 分页约定，但离线包仅返回 list/total） */
interface PackageListResponse {
  list?: PackageResponse[]
  total?: number
}

/**
 * 将 v3 响应映射为页面既有的 EdgePackage 视图：
 * id 复用 version（v3 不再单独下发包标识），download_url 指向 v3 产物下载路径。
 */
function toEdgePackage(item: PackageResponse): EdgePackage {
  const file = item.file || item.version
  return {
    id: item.version,
    version: item.version,
    sha256: item.sha256,
    size_bytes: item.size_bytes,
    components: item.components ?? [],
    download_url: `${PACKAGES_PATH}/${encodeURIComponent(file)}`,
    file,
  }
}

/** 将失败响应转换为 ApiError（离线包 tar.gz 非信封接口的错误解析） */
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

/** 下载二进制 tar.gz（v3 契约 §5；响应不是统一 JSON 信封） */
async function downloadBlob(url: string): Promise<Blob> {
  const res = await rawRequest(url, { method: 'GET' })
  if (!res.ok) {
    throw await toApiError(res)
  }
  return res.blob()
}

/** 边缘离线安装包（清单 + 指定产物 tar.gz 下载） */
export const edgePackageApi = {
  /** 包清单：把 v3 `{list,total}` 归一化为页面使用的 EdgePackage[] */
  async list(): Promise<ApiResponse<EdgePackage[]>> {
    const res = await apiClient.get<PackageListResponse>(PACKAGES_PATH)
    return { ...res, data: (res.data?.list ?? []).map(toEdgePackage) }
  },
  /**
   * 下载指定产物 tar.gz 为 Blob（文件名取清单 `file` 字段，见契约 §5）。
   * 入参为产物文件名而非版本号——v3 下载路径 `/edge-packages/:file`。
   */
  download(file: string): Promise<Blob> {
    return downloadBlob(`${PACKAGES_PATH}/${encodeURIComponent(file)}`)
  },
}
