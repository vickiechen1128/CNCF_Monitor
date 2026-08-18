import { Col, Row, Space, Typography } from 'antd'
import type { ReactNode } from 'react'

interface FilterBarProps {
  children: ReactNode
}

/**
 * 筛选区栅格布局（对应前端标准第 9 章）。
 * 超过 4 组筛选条件时按栅格整齐换行，禁止 <Space wrap> 简单堆叠。
 */
export function FilterBar({ children }: FilterBarProps) {
  return (
    <Row gutter={[16, 12]} style={{ marginBottom: 16 }}>
      {children}
    </Row>
  )
}

interface FilterItemProps {
  label: string
  width?: number
  children: ReactNode
}

export function FilterItem({ label, width = 220, children }: FilterItemProps) {
  return (
    <Col flex={`${width}px`}>
      <Space size={6}>
        <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
          {label}
        </Typography.Text>
        {children}
      </Space>
    </Col>
  )
}
