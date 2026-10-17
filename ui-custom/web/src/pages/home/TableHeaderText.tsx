/**
 * 表格表头文案（04 资源类型表 / 03 矩阵共用）。
 *
 * antd Table 表头默认 14px/600，**比表格正文（12–13px）还大**——表头抢戏、层级颠倒。
 * 大屏口径：表头是「列的说明」而非内容，统一 body 级 12/500 次色，让数字成为唯一
 * 视觉主体。各列 `title` 用它包一层即可，无需引入全局 CSS（避免与主题/图表样式互相覆盖）。
 *
 * 独立成文件（而非放在 homeTypography.ts）是 react-refresh 的要求：常量文件不要
 * 混导出组件，否则 HMR 会退化成整页刷新。
 */
import type { ReactNode } from 'react'
import { theme } from 'antd'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'

export function TableHeaderText({ children }: { children: ReactNode }) {
  const { token } = theme.useToken()
  return (
    <span
      style={{
        fontSize: HOME_FONT.body,
        fontWeight: HOME_WEIGHT.label,
        color: token.colorTextSecondary,
      }}
    >
      {children}
    </span>
  )
}

export default TableHeaderText
