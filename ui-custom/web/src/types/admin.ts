/**
 * 平台管理领域类型（对齐 M06 v3 契约：用户 / 登录日志 / 租户）。
 * 字段以 platform/modules/m06/dto/{user,login_log,tenant}.go 为准。
 * 列表统一使用 v3 分页信封 `{list, total, page, page_size}`（见 types/api 的 Paginated）。
 */
import type { Tenant } from './domain'

/** 用户生命周期状态 */
export type UserStatus = 'active' | 'disabled'

/** 用户（任何接口字段不含 password_hash，契约 §2） */
export interface UserItem {
  id: string
  /** 所属租户（v3 UserResponse 恒返回） */
  tenant_id: string
  username: string
  display_name: string
  /** 角色：admin / user（决策 44 两级角色；v3 恒返回） */
  role: string
  status: UserStatus
  /** 最近登录时间；从未登录时后端返回 null */
  last_login_at: string | null
  created_at: string
}

/** 登录日志（按时间倒序返回，契约 §2） */
export interface LoginLogItem {
  id: string
  username: string
  success: boolean
  /** 来源 IP（v3 `ip,omitempty`：可能缺省，渲染时按空值处理） */
  ip?: string
  created_at: string
}

/** POST /users 创建用户输入 */
export interface UserCreateInput {
  username: string
  display_name: string
  password: string
  role: string
}

/**
 * PUT /users/:id 编辑用户输入。
 * v3 严格解码只接受 display_name / role；username、tenant_id、status、id 等不可变字段禁止夹带。
 */
export interface UserUpdateInput {
  display_name: string
  role?: string
}

/** PUT /users/:id/password 管理员重置密码输入 */
export interface ResetPasswordInput {
  new_password: string
}

/**
 * PUT /tenants/:id 编辑租户输入（仅展示名与行政字段）。
 * v3 严格解码只接受 name / multi_site_enabled；id、status、is_platform_admin 等禁止夹带。
 */
export interface TenantEditInput {
  name: string
  multi_site_enabled: boolean
}

/** 类型重导出：租户编辑页复用既有 Tenant 定义（字段与 M06 v3 TenantResponse 对齐） */
export type { Tenant }
