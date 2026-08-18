import { Typography } from 'antd'
import type { ReactNode } from 'react'

interface EllipsisTextProps {
  children: ReactNode
  maxWidth?: number
  type?: 'secondary' | 'success' | 'warning' | 'danger'
  code?: boolean
}

/**
 * 长文本截断 + 悬浮全文（对应前端标准第 9 章「列表与长文本规范」）。
 * 禁止散点手写 style={{ maxWidth }}，统一用本组件。
 */
export function EllipsisText({ children, maxWidth = 200, type, code }: EllipsisTextProps) {
  return (
    <Typography.Text
      type={type}
      code={code}
      ellipsis={{ tooltip: children }}
      style={{ maxWidth }}
    >
      {children}
    </Typography.Text>
  )
}