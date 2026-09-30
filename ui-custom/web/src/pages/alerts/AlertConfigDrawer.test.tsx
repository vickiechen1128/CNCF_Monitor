/**
 * 告警配置挂载抽屉测试（Module_08 PL-2，2026-09-28）。
 * 覆盖「插入骨架示例」：一键填入三块必写齐全的最小可运行骨架，插入后可完成基础检查并提交。
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertConfigDrawer } from './AlertConfigDrawer'
import { ALERTMANAGER_MIN_SKELETON } from './alertmanagerConstants'

describe('AlertConfigDrawer（告警配置挂载抽屉 · PL-2 骨架示例）', () => {
  setupAntdTest()

  it('「插入骨架示例」一键填入最小可运行骨架（接收人 / 路由 / 收敛三块齐全）', () => {
    render(<AlertConfigDrawer open onClose={vi.fn()} onSubmit={vi.fn()} />)

    const textarea = screen.getByPlaceholderText(
      /# 在此粘贴 alertmanager\.yml 完整内容/,
    ) as HTMLTextAreaElement
    expect(textarea.value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: /插入骨架示例/ }))

    expect(textarea.value).toBe(ALERTMANAGER_MIN_SKELETON)
    expect(textarea.value).toContain('receivers:')
    expect(textarea.value).toContain('route:')
    expect(textarea.value).toContain('inhibit_rules:')
  })

  it('插入骨架后基础检查通过、提交可用，并把骨架内容交给 onSubmit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<AlertConfigDrawer open onClose={onClose} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByRole('button', { name: /插入骨架示例/ }))
    fireEvent.click(screen.getByRole('button', { name: /本地大小检查/ }))

    expect(await screen.findByText('基础检查通过')).toBeInTheDocument()

    const submitButton = screen.getByRole('button', { name: /提交并进入变更确认/ })
    expect(submitButton).toBeEnabled()
    fireEvent.click(submitButton)

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(ALERTMANAGER_MIN_SKELETON))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})