/**
 * 首页卡片基座（Module_05 §3.1 决策 72-2 视觉 Token 收口）。
 *
 * 统一卡片规范：圆角 8px、默认阴影 `0 1px 2px rgba(0,0,0,.06)`、
 * 悬停阴影 `0 4px 12px rgba(0,0,0,.08)`、卡内边距 20px。
 * 供首页指标卡 / 告警治理态大卡片 / 快捷入口 / 最近下发表复用，
 * 避免各卡片散点手写内联样式（02_Frontend_Standard.md §9 共享件复用要求）。
 *
 * **窄屏卡头堆叠（2026-10-17 手机走查修复）**：antd Card 的 `title` 与 `extra` 恒在同一
 * flex 行且 `title` 带 ellipsis。手机竖屏（≤767px）下 extra 一长（如「按主机所属网域派生的
 * 云分组 · 本期仅主机」），标题会被压成「按…」「平…」，甚至整块消失（拨测卡的「拨测态势」
 * 在 390px 下完全不可见）——面板没有标题，领导无从判断这一块讲什么。
 * 修法：窄屏时**不交给 antd 卡头**，改由本组件自渲染「标题独占一行 + 说明次行」的堆叠头；
 * 宽屏仍走 antd 原生卡头（版式与既有测试逐字不变；jsdom 无 matchMedia → 恒走宽屏分支）。
 */
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Card } from 'antd'
import type { CardProps } from 'antd'
import { useNarrowLayout } from './homeResponsive'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'

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
  title,
  extra,
  children,
  ...rest
}: SurfaceCardProps) {
  const [hovered, setHovered] = useState(false)
  const narrow = useNarrowLayout()
  const stackHeader = narrow && Boolean(title || extra)

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
      title={stackHeader ? undefined : title}
      extra={stackHeader ? undefined : extra}
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
      {stackHeader && (
        <div
          data-testid="surface-card-header-stacked"
          style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12, minWidth: 0 }}
        >
          {title && (
            <div
              style={{
                fontSize: HOME_FONT.title,
                fontWeight: HOME_WEIGHT.title,
                lineHeight: '24px',
                minWidth: 0,
              }}
            >
              {title}
            </div>
          )}
          {extra && (
            <div style={{ fontSize: HOME_FONT.body, lineHeight: '20px', minWidth: 0 }}>{extra}</div>
          )}
        </div>
      )}
      {children}
    </Card>
  )
}

export default SurfaceCard
