import type { ReactNode } from 'react'
import { Typography } from 'antd'

const { Text } = Typography

/** 统一提示条配色（身份说明 / 硬劝阻 / 视觉语言一致，避免 Alert + Collapse 样式拼盘） */
const CALLOUT_TONES: Record<'brand' | 'info' | 'warning' | 'success', { bg: string; border: string; color: string }> = {
  brand: { bg: '#F0FBFD', border: '#BFF4FB', color: '#0ECDEB' },
  info: { bg: '#F2F7FF', border: '#BEDAFF', color: '#1481FD' },
  warning: { bg: '#FFF8EE', border: '#FFD8A8', color: '#FA8C16' },
  success: { bg: '#F0FBF7', border: '#A8E6CE', color: '#00B578' },
}

type CalloutTone = keyof typeof CALLOUT_TONES

/**
 * 统一提示容器（替代散落的 Alert / Collapse 组合）。
 * 结构固定为「图标 + 标题 + 可选操作 + 正文」，全页同款圆角 / 边框 / 内边距。
 */
export function Callout({
  tone = 'info',
  icon,
  title,
  extra,
  children,
}: {
  tone?: CalloutTone
  icon?: ReactNode
  title: ReactNode
  extra?: ReactNode
  children?: ReactNode
}) {
  const t = CALLOUT_TONES[tone]
  return (
    <div
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: t.color, fontSize: 15, display: 'inline-flex' }}>{icon}</span>
        <Text strong style={{ fontSize: 13, flex: 1 }}>
          {title}
        </Text>
        {extra}
      </div>
      {children && (
        <div style={{ marginTop: 6, paddingLeft: 23, fontSize: 12.5, color: '#4E5969', lineHeight: 1.75 }}>
          {children}
        </div>
      )}
    </div>
  )
}

export default Callout