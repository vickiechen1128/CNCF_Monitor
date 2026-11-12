import { apiClient, clearToken } from './client'

/** 登出接口（v3 认证契约：POST /api/v3/platform/auth/logout，幂等） */
export const LOGOUT_ENDPOINT = '/api/v3/platform/auth/logout'

/**
 * 登出：先尽力通知服务端销毁会话，再清除本地 Token / 用户缓存。
 * 服务端调用失败（会话已过期、网络异常等）不阻断本地登出——用户必须始终能退出；
 * 401 场景由 client 统一拦截并跳转登录页。
 */
export async function logout(): Promise<void> {
  try {
    await apiClient.post(LOGOUT_ENDPOINT)
  } catch {
    /* 会话已失效或网络异常：继续本地清理 */
  } finally {
    clearToken()
  }
}
