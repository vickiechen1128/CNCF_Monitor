/**
 * M06「存储与日志管理」类型（F-41）。
 * 对齐 platform/admin/storagelog/handler.go 的响应结构：
 * - GET  /api/v2/platform/storage-logs
 * - PUT  /api/v2/platform/storage-logs/retention
 */

/** TSDB 保留策略二元组（time/size 原始字符串形态）。 */
export interface RetentionValues {
  time: string
  size: string
}

/** 保留策略「期望值 vs 运行时值」比对状态。 */
export interface RetentionState {
  /** env 文件期望值；env 不存在且运行时也不可取时为 null。 */
  desired: RetentionValues | null
  /** Prometheus /api/v1/status/flags 运行时值（不可用时为 null）。 */
  runtime: RetentionValues | null
  /** env_file = 页面/env 文件为来源；runtime_default = 回落启动默认。 */
  source: 'env_file' | 'runtime_default'
  env_file: string
  env_file_exists: boolean
  runtime_available: boolean
  /** 仅在 env 文件存在 + 运行时可取 + 归一化比对不同时为 true。 */
  pending_restart: boolean
}

/** 单目录磁盘占用（只读展示）。 */
export interface DiskInfo {
  label: string
  path?: string
  total_bytes: number
  used_bytes: number
  free_bytes: number
  usage_percent: number
  /** 探测失败时的降级提示（如 Prometheus 未运行）。 */
  error?: string
}

/** 运行日志轮转策略展示（免重启信息，与 TSDB 保留策略分开展示）。 */
export interface LogRotationInfo {
  mechanism: 'logrotate' | 'journald' | 'none'
  /** 配置是否已实际安装生效。 */
  active: boolean
  config_path?: string
  content?: string
  summary: string
}

/** GET /storage-logs 响应体。 */
export interface StorageLogOverview {
  retention: RetentionState
  disks: DiskInfo[]
  log_rotation: LogRotationInfo
}

/** PUT /storage-logs/retention 请求体（两项均必填，整单保存）。 */
export interface RetentionInput {
  time: string
  size: string
}
