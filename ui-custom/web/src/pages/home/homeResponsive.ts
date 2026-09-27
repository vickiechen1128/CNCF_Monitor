/**
 * 首页窄屏（手机）断点判定 —— Module_05 §3.1 移动适配增量。
 *
 * 背景：首页版式（决策 93）原按「不同电脑尺寸 / 分辨率」定版，未覆盖手机竖屏宽度
 * （L0 五卡一行、L1 五卡一行、L4/L5 同排 1.6:1 在 ≤767px 下会被压到不可读）。
 * 本模块提供唯一的窄屏判定入口，供 L0（HomePage）/ L1（ResourceTypeGrid）/
 * 告警卡四格统计条（AlertStatusCard）三处栅格降列共用，避免各处各写一份断点。
 *
 * 为什么不用 antd `Grid.useBreakpoint`：其订阅在 layout effect 中建立，**首帧返回空对象**，
 * 桌面端会先闪一帧手机版式再跳回；这里用同步 `matchMedia` 初值 + `change` 订阅，
 * 首帧即为正确版式（jsdom 中 matchMedia 的 matches 恒 false → 测试走桌面分支，
 * 与既有断言一致；窄屏分支由 HomePage.test.tsx 显式覆盖）。
 *
 * 断点取值 767px：与 antd `md`（≥768 桌面 / 平板横屏）对齐，一处改、全线改。
 * 放在非组件模块而非组件文件内：避免 `react-refresh/only-export-components` 告警
 * （仓库 eslint 为 max-warnings 0），与 homeLayout.ts 同一处理方式。
 */
import { useEffect, useState } from 'react'

/** 窄屏媒体查询：≤767px 视为手机竖屏 / 小屏（对应「华为 / 苹果手机」竖屏宽度区间） */
export const NARROW_LAYOUT_QUERY = '(max-width: 767px)'

/** 读取当前是否窄屏；无 matchMedia 的环境（SSR / 旧测试环境）按宽屏处理 */
function matchesNarrowLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(NARROW_LAYOUT_QUERY).matches
}

/**
 * 窄屏布局判定（响应窗口宽度变化）。
 *
 * 返回 true 时各区域按手机版式渲染：L0 两卡一行、L1 单卡一行、L4/L5 纵向堆叠。
 */
export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(matchesNarrowLayout)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(NARROW_LAYOUT_QUERY)
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    mql.addEventListener('change', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
    }
  }, [])

  return narrow
}
