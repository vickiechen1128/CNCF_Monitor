import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { DictLifecycleNotice, DICT_LIFECYCLE_NOTICE } from './DictLifecycleNotice'
import { DICT_LIFECYCLE_RULES } from './dictionaryLifecycle'

/**
 * F7 定位说明（§5.24 / 决策 112）：字典「停用不删除」的用户侧解释。
 * 首屏只展示一行摘要，完整规则在「查看规则」抽屉中；纯说明性组件，不提供任何写操作。
 */
describe('DictLifecycleNotice', () => {
  setupAntdTest()

  it('首屏摘要为字典页统一口径（引用后不可删除、零引用可撤销、有引用只能停用或合并）', () => {
    render(<DictLifecycleNotice />)

    const notice = screen.getByText(DICT_LIFECYCLE_NOTICE)
    expect(notice).toBeInTheDocument()
    for (const segment of ['字典', '编码就是监控标签取值', '不可删除', '不可复用', '可撤销', '停用或合并']) {
      expect(DICT_LIFECYCLE_NOTICE).toContain(segment)
    }
    // 不再出现「删除资源即可删除字典」的误导表述。
    expect(DICT_LIFECYCLE_NOTICE).not.toContain('需要删除请到')
  })

  it('用户语言不含技术术语（label / platform_code）', () => {
    expect(DICT_LIFECYCLE_NOTICE).not.toMatch(/label/i)
    expect(DICT_LIFECYCLE_NOTICE).not.toContain('platform_code')
  })

  it('点击「查看规则」展开完整规则，平台页可注入补充说明', async () => {
    render(<DictLifecycleNotice extraRules={['平台是应用归属的权威标识']} />)

    fireEvent.click(screen.getByText('查看规则'))
    expect(await screen.findByText('字典生命周期规则')).toBeInTheDocument()
    for (const rule of DICT_LIFECYCLE_RULES) {
      expect(screen.getByText(rule)).toBeInTheDocument()
    }
    expect(screen.getByText('平台补充说明')).toBeInTheDocument()
    expect(screen.getByText('平台是应用归属的权威标识')).toBeInTheDocument()
  })

  it('可关闭且无删除 / 新增 / 保存类写操作入口', () => {
    const { container } = render(<DictLifecycleNotice />)

    // 可关闭 Alert：仅一个关闭图标按钮；「查看规则」是链接，不是写操作
    const closeBtn = screen.getByRole('button')
    expect(closeBtn).toHaveClass('ant-alert-close-icon')
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /删除|新增|保存/ })).toBeNull()
  })
})
