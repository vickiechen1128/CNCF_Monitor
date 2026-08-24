import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { PlainTokenModal } from './PlainTokenModal'

describe('PlainTokenModal（一次性明文 Token 展示，MEDIUM-1/LOW-1 统一交互）', () => {
  setupAntdTest()

  beforeEach(() => {
    // jsdom 无剪贴板，注入 stub
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  it('展示明文 token、脱敏表示与一次性引导文案，并提供「复制明文」', async () => {
    render(<PlainTokenModal open token="plain-token" tokenMasked="••••••••" domainName="医保网" onClose={vi.fn()} />)
    expect(await screen.findByText('plain-token')).toBeInTheDocument()
    expect(screen.getByText(/网域：医保网/)).toBeInTheDocument()
    expect(screen.getByText(/仅本次展示，关闭后不再可见/)).toBeInTheDocument()
    expect(screen.getByText(/脱敏表示：••••••••/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复制明文/ })).toBeInTheDocument()
  })

  it('「复制明文」写入剪贴板', async () => {
    render(<PlainTokenModal open token="secret-x" onClose={vi.fn()} />)
    const btn = await screen.findByRole('button', { name: /复制明文/ })
    fireEvent.click(btn)
    const write = navigator.clipboard.writeText as ReturnType<typeof vi.fn>
    await waitFor(() => expect(write).toHaveBeenCalledWith('secret-x'))
  })

  it('onClose 触发（「我已保存」关闭）', async () => {
    const onClose = vi.fn()
    render(<PlainTokenModal open token="t" onClose={onClose} />)
    fireEvent.click(await screen.findByRole('button', { name: /我已保存/ }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})