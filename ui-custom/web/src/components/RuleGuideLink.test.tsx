/**
 * 跨模块「去写规则」引导组件测试（Module_08 PL-1，D-1 方案丙）。
 * 组件被告警状态页 / 历史告警页空态与告警配置页说明卡三处共用，此处校验统一落点与文案。
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../test/antdTestUtils'
import { RuleGuideEmpty, RuleGuideLink, RULES_PATH } from './RuleGuideLink'

describe('RuleGuideLink（M08 跨模块「去写规则」引导）', () => {
  setupAntdTest()

  it('RuleGuideLink：渲染指向 /rules 的链接，前置语可拼接', () => {
    render(
      <MemoryRouter>
        <RuleGuideLink prefix="还没有告警规则？" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '去写规则 →' })).toHaveAttribute('href', RULES_PATH)
    expect(screen.getByText(/还没有告警规则？/)).toBeInTheDocument()
  })

  it('RuleGuideEmpty：空态描述 + 统一引导链接同屏', () => {
    render(
      <MemoryRouter>
        <RuleGuideEmpty description="当前无触发中的告警" />
      </MemoryRouter>,
    )
    expect(screen.getByText('当前无触发中的告警')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '去写规则 →' })).toHaveAttribute('href', RULES_PATH)
    expect(screen.getByText(/还没有告警规则？/)).toBeInTheDocument()
  })
})