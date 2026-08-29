/**
 * 平台管理领域类型（对齐 module-06-tenant-user-auth 契约快照 §2 用户 / §2 登录日志 / §3 租户）。
 * 参考 docs/05-execution-records/module-06-tenant-user-auth/api-contract-snapshot.md。
 */
import type { Tenant } from './domain'

/** 用户生命周期状态 */
export type UserStatus = 'active' | 'disabled'

/** 用户（任何接口字段不含 password_hash，契约 §2） */
export interface UserItem {
  id: string
  username: string
  display_name: string
  /** 角色：admin / user（决策 44 两级角色；后端恒返回，标记可选兼容旧 mock） */
  role?: string
  status: UserStatus
  last_login_at: string
  created_at: string
}

/** 登录日志（按时间倒序返回，契约 §2） */
export interface LoginLogItem {
  id: string
  username: string
  success: boolean
  ip: string
  created_at: string
}

/** POST /users 创建用户输入 */
export interface UserCreateInput {
  username: string
  display_name: string
  password: string
  role: string
}

/** PUT /users/:id 编辑用户输入（username 创建后不可变；role 可选变更） */
export interface UserUpdateInput {
  display_name: string
  role?: string
}

/** PUT /users/:id/password 管理员重置密码输入 */
export interface ResetPasswordInput {
  new_password: string
}

/** PUT /tenants/:id 编辑租户输入（仅展示名与行政字段） */
export interface TenantEditInput {
  name: string
  multi_site_enabled: boolean
}

/** 契约 §2/§3 的 {items, total} 分页信封（区别于 Paginated 的 {list,page,page_size} 旧信封） */
export interface ItemsResult<T> {
  items: T[]
  total: number
}

/** 类型重导出：租户编辑页复用既有 Tenant 定义 */
export type { Tenant }