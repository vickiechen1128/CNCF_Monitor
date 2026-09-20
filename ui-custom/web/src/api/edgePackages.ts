/**
 * 边缘离线安装包 API（M11 契约 §2）。
 * 权威契约：docs/05-execution-records/module-11/api-contract-snapshot.md §2。
 *
 * 两个形态：
 * - 包清单（GET /edge-packages）走统一 JSON 信封 `apiClient`；
 * - 指定版本下载 zip（GET /edge-packages/{version}/download）为二进制流，
 *   走 `rawRequest`（原生 fetch + 认证 Token + 401 统一处理），参考 resources.ts 模板下载。
 */
import { apiClient, ApiError, rawRequest } from './client'
import type { ApiResponse } from '../types/api'
import type { EdgePackage } from '../types/config-center'

/** 将失败响应转换为 ApiError（离线包 zip 非信封接口的错误解析） */
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

/** 下载二进制 zip（M11 契约 §2；响应不是统一 JSON 信封） */
async function downloadBlob(url: string): Promise<Blob> {
  const res = await rawRequest(url, { method: 'GET' })
  if (!res.ok) {
    throw await toApiError(res)
  }
  return res.blob()
}

/** 边缘离线安装包（清单 + 指定版本 zip 下载） */
export const edgePackageApi = {
  /** 包清单（M11 契约 §2：response.data 为 PackageArtifact[] 数组，非 {packages}） */
  list(): Promise<ApiResponse<EdgePackage[]>> {
    return apiClient.get<EdgePackage[]>('/api/v2/platform/edge-packages')
  },
  /** 下载指定版本离线包 zip 为 Blob（文件名由触发方指定 `edge-agent-offline-<version>.zip`） */
  download(version: string): Promise<Blob> {
    return downloadBlob(`/api/v2/platform/edge-packages/${encodeURIComponent(version)}/download`)
  },
}