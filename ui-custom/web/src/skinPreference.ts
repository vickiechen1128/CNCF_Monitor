/**
 * 皮肤（skin）偏好的读写。
 *
 * 独立成模块而非从 SkinProvider.tsx 导出：组件文件只导出组件，
 * 避免 `react-refresh/only-export-components` 告警（仓库 eslint 为 max-warnings 0）。
 *
 * 持久化语义是「用户在全站范围内的皮肤偏好」：切换后刷新页面、切到其他一级模块都保持，
 * 与 `layouts/siderPreference.ts`（侧栏折叠偏好）同一套范式、同一套降级策略。
 */
import { DEFAULT_SKIN, isSkinKey } from './skins'
import type { SkinKey } from './skins'

/** localStorage 键（改动即失效既存偏好，故集中在此常量） */
export const SKIN_STORAGE_KEY = 'metriccenter.skin'

/**
 * 读取皮肤偏好。
 * 未设置、值非法、或存储不可用（隐私模式 / 禁用存储抛异常）时一律回落默认皮肤（火山青），
 * 不阻断渲染、也不抛错——皮肤只影响观感，不该让页面打不开。
 */
export function readSkin(): SkinKey {
  try {
    const raw = window.localStorage.getItem(SKIN_STORAGE_KEY)
    return isSkinKey(raw) ? raw : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

/** 写入皮肤偏好；写入失败仅当次会话生效，不影响换肤交互本身 */
export function writeSkin(key: SkinKey): void {
  if (!isSkinKey(key)) return
  try {
    window.localStorage.setItem(SKIN_STORAGE_KEY, key)
  } catch {
    /* 忽略：无法持久化时仍保留本次会话内的换肤效果 */
  }
}
