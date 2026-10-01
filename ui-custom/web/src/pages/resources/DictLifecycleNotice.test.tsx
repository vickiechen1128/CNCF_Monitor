import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { DictLifecycleNotice, DICT_LIFECYCLE_NOTICE } from './DictLifecycleNotice'

/**
 * F7 定位说明（§5.24 / 决策 112）：字典「停用不删除」的用户侧解释。
 * 纯说明性组件——不提供任何写操作、不提供删除入口。
 */
describe('DictLifecycleNotice', () => {
  setupAntdTest()

  it('文案为四字典页统一口径（字典 ≠ 可删除对象，生命周期启用 ↔ 停用）', () => {
    render(<DictLifecycleNotice />)

    const notice = screen.getByText(DICT_LIFECYCLE_NOTICE)
    expect(notice).toBeInTheDocument()
    for (const segment of ['字典', '编码即监控标签取值', '删除会断历史时序', '启用 ↔ 停用', '不提供删除', '资源管理']) {
      expect(DICT_LIFECYCLE_NOTICE).toContain(segment)
    }
  })

  it('用户语言不含技术术语（label / platform_code）', () => {
    expect(DICT_LIFECYCLE_NOTICE).not.toMatch(/label/i)
    expect(DICT_LIFECYCLE_NOTICE).not.toContain('platform_code')
  })

  it('可关闭，且组件内无任何写操作入口', () => {
    const { container } = render(<DictLifecycleNotice />)

    // 可关闭 Alert：仅一个关闭图标按钮，无删除 / 新增 / 保存类写操作入口
    const closeBtn = screen.getByRole('button')
    expect(closeBtn).toHaveClass('ant-alert-close-icon')
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /删除|新增|保存/ })).toBeNull()
  })
})
