import type { ReactNode } from 'react'
import { Typography, theme } from 'antd'
import { useSkin } from '../skinContext'
import type { SkinTokens } from '../skins'

const { Text } = Typography

type CalloutTone = 'brand' | 'info' | 'warning' | 'success'

interface CalloutPalette {
  bg: string
  border: string
  color: string
}

/**
 * 提示条配色映射。
 *
 * **刻意写成函数而非模块级常量**：皮肤可在运行时切换，模块级常量等于把配色冻在
 * 模块加载那一刻（详见 `skins.ts` 的设计约束 3 —— 同款坑已在 alertmanagerConstants 踩过一次）。
 * 配色一律取自皮肤 token，本文件不再出现字面色值。
 */
function calloutPalette(tone: CalloutTone, tokens: SkinTokens): CalloutPalette {
  switch (tone) {
    case 'brand':
      return {
        bg: tokens.colorPrimaryBg,
        border: tokens.colorPrimaryBorder,
        color: tokens.colorPrimary,
      }
    case 'warning':
      return {
        bg: tokens.colorWarningBg,
        border: tokens.colorWarningBorder,
        color: tokens.colorWarning,
      }
    case 'success':
      return {
        bg: tokens.colorSuccessBg,
        border: tokens.colorSuccessBorder,
        color: tokens.colorSuccess,
      }
    case 'info':
    default:
      return {
        bg: tokens.colorInfoBg,
        border: tokens.colorInfoBorder,
        color: tokens.colorInfo,
      }
  }
}

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
  const { token } = theme.useToken()
  const { tokens: skinTokens } = useSkin()
  const t = calloutPalette(tone, skinTokens)

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
        <div
          style={{
            marginTop: 6,
            paddingLeft: 23,
            fontSize: 12.5,
            color: token.colorTextSecondary,
            lineHeight: 1.75,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export default Callout
