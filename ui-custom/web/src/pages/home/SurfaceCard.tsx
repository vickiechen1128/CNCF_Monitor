/**
 * 首页卡片基座（Module_05 §3.1 决策 72-2 视觉 Token 收口）。
 *
 * 统一卡片规范：圆角 8px、默认阴影 `0 1px 2px rgba(0,0,0,.06)`、
 * 悬停阴影 `0 4px 12px rgba(0,0,0,.08)`、卡内边距 20px。
 * 供首页指标卡 / 告警治理态大卡片 / 快捷入口 / 最近下发表复用，
 * 避免各卡片散点手写内联样式（02_Frontend_Standard.md §9 共享件复用要求）。
 */
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Card } from 'antd'
import type { CardProps } from 'antd'

const CARD_SHADOW = '0 1px 2px rgba(0, 0, 0, 0.06)'
const CARD_SHADOW_HOVER = '0 4px 12px rgba(0, 0, 0, 0.08)'

interface SurfaceCardProps extends Omit<CardProps, 'children'> {
  children?: ReactNode
  /** 悬停时阴影加深（可点击 / 可悬停卡片开启） */
  hoverShadow?: boolean
}

export function SurfaceCard({
  hoverShadow = false,
  style,
  styles,
  onMouseEnter,
  onMouseLeave,
  children,
  ...rest
}: SurfaceCardProps) {
  const [hovered, setHovered] = useState(false)

  const handleMouseEnter = (event: MouseEvent<HTMLDivElement>) => {
    setHovered(true)
    onMouseEnter?.(event)
  }

  const handleMouseLeave = (event: MouseEvent<HTMLDivElement>) => {
    setHovered(false)
    onMouseLeave?.(event)
  }

  return (
    <Card
      {...rest}
      style={{
        borderRadius: 8,
        boxShadow: hoverShadow && hovered ? CARD_SHADOW_HOVER : CARD_SHADOW,
        transition: 'box-shadow 0.2s',
        ...style,
      }}
      styles={{ body: { padding: 20 }, ...styles }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </Card>
  )
}

export default SurfaceCard
