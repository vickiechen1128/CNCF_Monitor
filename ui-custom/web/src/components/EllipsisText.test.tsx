import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { EllipsisText } from './EllipsisText'

describe('EllipsisText', () => {
  it('默认为固定 200px（既有列表口径）', () => {
    const { container } = render(<EllipsisText>很长很长的实例名</EllipsisText>)
    const el = container.querySelector('.ant-typography') as HTMLElement
    expect(el.style.maxWidth).toBe('200px')
  })

  it('maxWidth="100%" 时跟随单元格宽度（可拖拽列宽列表）', () => {
    const { container } = render(<EllipsisText maxWidth="100%">很长很长的实例名</EllipsisText>)
    const el = container.querySelector('.ant-typography') as HTMLElement
    expect(el.style.maxWidth).toBe('100%')
  })
})
