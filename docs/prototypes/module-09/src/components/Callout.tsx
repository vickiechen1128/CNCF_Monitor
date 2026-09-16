import type { ReactNode } from 'react'
import { Button, Typography } from 'antd'
import { CALLOUT_TONES, type CalloutTone } from './calloutTones'

const { Text } = Typography

/**
 * 统一提示容器（对齐《前端标准》§8 交互选型表 / 决策 80 视觉语言）。
 *
 * 背景：原型此前在「接入指引 / 空态 / 组件关系说明」处混用 Alert，
 * 并出现「Alert 包 Steps」式的多层容器嵌套。本组件统一为单块扁平容器：
 * 结构固定为「图标 + 标题 + 可选右侧操作 + 正文」，全页同款圆角 / 边框 / 内边距，
 * 信息一次给全，不再逐层点开。
 *
 * tone 取品牌四色：brand（引导）/ info（说明）/ warning（警示）/ success（确认）。
 */
export function Callout({
  tone = 'info',
  icon,
  title,
  extra,
  children,
  onClose,
  closeText = '不再提示',
  style,
}: {
  tone?: CalloutTone
  icon?: ReactNode
  title: ReactNode
  extra?: ReactNode
  children?: ReactNode
  /** 传入则渲染右上角关闭入口（如「不再提示」），由调用方决定关闭语义 */
  onClose?: () => void
  closeText?: string
  style?: React.CSSProperties
}) {
  const t = CALLOUT_TONES[tone]
  return (
    <div
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        padding: '12px 16px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: t.color, fontSize: 15, display: 'inline-flex' }}>{icon}</span>
        <Text strong style={{ fontSize: 13, flex: 1 }}>
          {title}
        </Text>
        {extra}
        {onClose && (
          <Button type="text" size="small" onClick={onClose} style={{ color: '#86909C' }}>
            {closeText}
          </Button>
        )}
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
