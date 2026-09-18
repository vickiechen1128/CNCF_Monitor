/**
 * 侧边导航（Sider）折叠偏好的读写与尺寸常量（跨模块共享）。
 *
 * 独立成模块而非从 MainLayout.tsx 导出：组件文件只导出组件，
 * 避免 `react-refresh/only-export-components` 告警（仓库 eslint 为 max-warnings 0）。
 *
 * 折叠偏好持久化到 localStorage，语义是「用户在全站范围内的侧栏宽度偏好」：
 * 一次折叠后，切到其他一级模块、刷新页面都保持折叠，避免每模块各记一份状态。
 */

/** localStorage 键（改动即失效既存偏好，故集中在此常量） */
export const SIDER_COLLAPSED_KEY = 'metriccenter.sider.collapsed'

/** 展开态宽度（与既有实现一致，不改变其他模块的默认观感） */
export const SIDER_WIDTH = 200

/**
 * 折叠态宽度：56px 仅容一个 16px 图标 + 内边距 + 选中态背景，
 * 与顶部深色 Header 的 56px 左内边距形成视觉呼应（折叠后品牌区不再有额外留白）。
 */
export const SIDER_COLLAPSED_WIDTH = 56

/**
 * 读取折叠偏好。
 * 隐私模式 / 禁用存储等场景 localStorage 会抛异常，此时按展开处理（不阻断渲染）。
 */
export function readSiderCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDER_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** 写入折叠偏好；写入失败仅当次会话生效，不影响交互 */
export function writeSiderCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDER_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* 忽略：无法持久化时仍保留本次会话内的折叠行为 */
  }
}
