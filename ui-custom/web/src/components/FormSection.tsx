import type { ReactNode } from 'react'
import { Typography } from 'antd'

const { Text } = Typography

/**
 * 表单分组标题（左侧品牌色竖条 + 标题 + 可选说明）。
 * 参照原型 M06 v2.14 FormSection，保证抽屉内长表单的层次一致。
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
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '4px 0 14px' }}>
        <span
          style={{ width: 3, height: 13, background: '#0ECDEB', borderRadius: 2, transform: 'translateY(1px)' }}
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