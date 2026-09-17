import { useReviewNotes } from '../contexts/ReviewNotesContext'
import { Collapse, Space, Typography } from 'antd'
import type { CSSProperties, ReactNode } from 'react'

interface ReviewNoteProps {
  title?: string
  style?: CSSProperties
  children: ReactNode
}

/**
 * 面向产品 / 技术评审的说明组件。
 * 默认折叠，由 MainLayout 右上角的「评审说明」开关统一控制显隐。
 * 用户可见文案中不得出现决策编号、PRD 引用、版本标记。
 */
export function ReviewNote({ title = '原型与实现说明（面向产品 / 技术评审）', style, children }: ReviewNoteProps) {
  const { enabled } = useReviewNotes()

  if (!enabled) {
    return null
  }

  return (
    <Collapse
      ghost
      style={{
        margin: '0 16px 16px',
        padding: 12,
        background: '#f5f5f5',
        border: '1px dashed #d9d9d9',
        borderRadius: 4,
        ...style,
      }}
      items={[
        {
          key: 'review',
          label: (
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {title}
              </Typography.Text>
            </Space>
          ),
          children: (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
              {children}
            </Typography.Paragraph>
          ),
        },
      ]}
    />
  )
}