/**
 * 存储与日志管理 API（M06 F-41，/api/v2/platform/storage-logs*）：
 * - GET  /storage-logs           保留策略期望/运行时比对 + 磁盘占用 + 日志轮转（只读总览）
 * - PUT  /storage-logs/retention 校验并写 prom-retention.env（重启 Prometheus 生效，不越权重启）
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { RetentionInput, StorageLogOverview } from '../types/storage'

export const storageLogApi = {
  overview(): Promise<ApiResponse<StorageLogOverview>> {
    return apiClient.get<StorageLogOverview>('/api/v2/platform/storage-logs')
  },
  updateRetention(input: RetentionInput): Promise<ApiResponse<StorageLogOverview>> {
    return apiClient.put<StorageLogOverview>('/api/v2/platform/storage-logs/retention', { body: input })
  },
}
