/**
 * 产品名称（品牌名）偏好的读写与规范化。
 *
 * 背景（用户 2026-09-18 补充）：平台名不再写死为 MetricCenter——部署方可能希望
 * 用自己的产品名。名称出现在**顶部栏品牌位、登录页标题、浏览器标签页标题**三处，
 * 因此必须是运行时可变值，不能只改 `index.html` 的静态 `<title>`。
 *
 * 与 `skinPreference.ts` / `layouts/siderPreference.ts` 同一套范式：
 * localStorage 持久化；存储不可用（隐私模式 / 禁用存储）时静默降级为默认名，不抛错。
 * 规范化后与默认名相同的值不落盘（等价于「未自定义」），便于日后调整默认名时自动跟随。
 */

/** localStorage 键（改动即失效既存偏好，故集中在此常量） */
export const PRODUCT_NAME_STORAGE_KEY = 'metriccenter.product.name'

/**
 * 默认产品名。
 * 与 `index.html` 的静态 `<title>` 保持一致：JS 未执行时（首屏 / 无 JS）也不会看到空白品牌位。
 */
export const DEFAULT_PRODUCT_NAME = 'MetricCenter'

/** 名称长度上限：顶栏品牌位与模块 tab 同排，过长会把一级导航挤到换行 */
export const PRODUCT_NAME_MAX_LENGTH = 24

/**
 * 规范化产品名称。
 * - 非字符串（含 null，即「从未设置过」）→ 默认名；
 * - 首尾空白与连续空白折叠（避免品牌位出现「  」或被拉宽）；
 * - 空白串 → 默认名（品牌位永不出现空字符串）；
 * - 超长截断（防御 localStorage 被手工改写的脏值；输入侧另有 maxLength 拦截）。
 */
export function normalizeProductName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PRODUCT_NAME
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) return DEFAULT_PRODUCT_NAME
  return trimmed.slice(0, PRODUCT_NAME_MAX_LENGTH)
}

/** 读取产品名称偏好；未设置 / 值非法 / 存储不可用一律回落默认名 */
export function readProductName(): string {
  try {
    return normalizeProductName(window.localStorage.getItem(PRODUCT_NAME_STORAGE_KEY))
  } catch {
    return DEFAULT_PRODUCT_NAME
  }
}

/**
 * 写入产品名称偏好，返回**规范化后的实际生效值**。
 * 调用方应以此返回值为准更新内存态，避免「界面显示草稿、状态里存着未规范化值」的错位。
 */
export function writeProductName(name: string): string {
  const normalized = normalizeProductName(name)
  try {
    if (normalized === DEFAULT_PRODUCT_NAME) {
      // 等价于默认值：不落盘，回到「未自定义」状态
      window.localStorage.removeItem(PRODUCT_NAME_STORAGE_KEY)
    } else {
      window.localStorage.setItem(PRODUCT_NAME_STORAGE_KEY, normalized)
    }
  } catch {
    /* 忽略：无法持久化时仍保留本次会话内的改名效果 */
  }
  return normalized
}

/** 清除产品名称偏好（恢复默认名）；写入失败仅当次会话生效 */
export function clearProductName(): void {
  try {
    window.localStorage.removeItem(PRODUCT_NAME_STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}
