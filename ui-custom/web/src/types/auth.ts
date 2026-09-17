/**
 * 认证 / 用户相关类型（对齐 module-06 契约快照 §1 认证）。
 * 参考 docs/05-execution-records/module-06/track-b-increment-decision-44/api-contract-snapshot.md。
 */

/** 当前登录用户信息（GET /api/v2/platform/auth/me；login.data.user 复用） */
export interface AuthUser {
  id: string
  username: string
  display_name: string
  tenant_id: string
  /** 角色：MVP 二值 admin / user（sec-01 加固的 RequireAdmin 授权门数据源） */
  role?: string
  /** /me 特有；登录返回的 user 可能不含该字段，设为可选 */
  last_login_at?: string
}

/** POST /api/v2/platform/auth/login 成功返回的 data */
export interface LoginResult {
  /** 不透明随机串，随请求作为 Authorization: Bearer <token> 携带 */
  token: string
  expires_at: string
  user: AuthUser
}