import type { ReactNode } from 'react'
import { Typography } from 'antd'
import { useSkin } from '../skinContext'

const { Text } = Typography

/**
 * 表单分组标题（左侧品牌色竖条 + 标题 + 可选说明）。
 * 参照原型 M06 v2.14 FormSection，保证抽屉内长表单的层次一致。
 *
 * 竖条颜色取**皮肤 token**（`useSkin()`）而非 antd 的 `theme.useToken()`：
 * 品牌/语义色以 `skins.ts` 为单一来源（见该文件设计约束），
 * 且 useSkin 在脱离 Provider 时仍回落火山青，组件在单测里也能取到真值。
 */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  const { tokens } = useSkin()

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 14px' }}>
        <span
          style={{
            width: 3,
            height: 13,
            background: tokens.colorPrimary,
            borderRadius: 2,
            transform: 'translateY(1px)',
          }}
        />
        <Text strong style={{ fontSize: 13 }}>
          {title}
        </Text>
        {description && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {description}
          </Text>
        )}
      </div>
      {children}
    </div>
  )
}

export default FormSection