/**
 * 首页「资源管理」展示组（02「不同云的主机数量」+ 03「平台与应用的主机分布」）
 * 隐藏偏好的读写（2026-10-17 第六轮走查，产品负责人裁定）。
 *
 * 背景：02 / 03 同属**资源管理**展示面（主机在归属维度上的分布），与运行态信息
 * （告警 / 采集健康 / 拨测）关注面不同。产品负责人要求**整组一个开关**：关注
 * 运行态时把资源管理整体收起，且**隐藏后不露出面板标题**（home-resource-row
 * 整体不渲染，藏得干净）；恢复入口在页头行的「显示资源分布」按钮。
 *
 * 语义与侧栏折叠偏好（siderPreference.ts）一致：**跨会话持久**——隐藏一次，
 * 切模块、刷新页面都保持，避免每次进首页都要重新收。隐私模式 / 存储满时
 * localStorage 抛异常，按「显示」处理且不阻断渲染（隐藏是增益不是必需）。
 *
 * 独立成模块而非写在 HomePage.tsx：组件文件只导出组件，避免
 * `react-refresh/only-export-components` 告警（仓库 eslint 为 max-warnings 0，
 * 同 siderPreference 的拆分理由）。
 */

/** localStorage 键（改动即失效既存偏好，故集中在此常量；命名沿用 sider 偏好的小圆点风格） */
export const RESOURCE_PANELS_COLLAPSED_KEY = 'metriccenter.home.resource-panels.collapsed'

/**
 * 读取隐藏偏好；存储不可用（隐私模式 / 禁用存储）时按显示处理。
 * 值只认 '1'（隐藏），其余（含脏值）一律显示——偏好丢失的代价小于误隐藏。
 */
export function readResourcePanelsCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RESOURCE_PANELS_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** 写入隐藏偏好；存储不可用时静默降级（仅当次会话生效，刷新后回到显示态） */
export function writeResourcePanelsCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(RESOURCE_PANELS_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* 隐私模式 / 存储满：不阻断渲染，仅不持久 */
  }
}
