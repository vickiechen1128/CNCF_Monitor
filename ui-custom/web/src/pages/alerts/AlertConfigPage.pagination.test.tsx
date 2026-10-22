/**
 * 回归测试：告警配置页「每页条数」切换（默认 20 → 10）。
 *
 * 根因（2026-10-09 修复）：分页对象展开 `TABLE_PAGINATION`（写死 `pageSize:20`）后，
 * 未把 hook 的 `pageSize` 回传，导致受控分页的 `pageSize` 恒为 20；用户选「10 条/页」
 * 被 antd 还原回 20（选择不生效），表现为「点 10 没反应、反复转圈（一直等待）」。
 *
 * 本用例使用**真实** `useAlertConfig` + 真实 antd `Table`（仅 mock 底层 API），
 * 断言选择真正生效：分页触发器显示「10 条/页」、请求带 `page_size=10`、且 loading 不卡死。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest } from '../../test/antdTestUtils'
import { AlertConfigPage } from './AlertConfigPage'

const getVersionsMock = vi.fn()
const getCurrentMock = vi.fn()

vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertmanagerConfigApi: {
      getVersion: vi.fn().mockResolvedValue({ data: { content: '' } }),
      getCurrent: (...a: unknown[]) => getCurrentMock(...a),
      getVersions: (...a: unknown[]) => getVersionsMock(...a),
      submit: vi.fn().mockResolvedValue({ status: 'success', data: { id: 'x' } }),
    },
  }
})

function renderPage() {
  return render(
    <MemoryRouter>
      <App>
        <AlertConfigPage />
      </App>
    </MemoryRouter>,
  )
}

describe('AlertConfigPage 分页：每页条数 20→10 应真正生效', () => {
  setupAntdTest()

  beforeEach(() => {
    getVersionsMock.mockReset()
    getCurrentMock.mockReset()
    getVersionsMock.mockImplementation((params: { page: number; page_size: number }) => {
      const per = params.page_size
      const total = 25
      const items = Array.from(
        { length: Math.max(0, Math.min(per, total - (params.page - 1) * per)) },
        (_, i) => ({
          id: `acv-${params.page}-${i}`,
          checksum: 'abc',
          applied_at: undefined,
          applied_by: undefined,
          status: 'applied',
          source_change_no: undefined,
          created_at: undefined,
        }),
      )
      return Promise.resolve({ data: { items, total } })
    })
    getCurrentMock.mockResolvedValue({ data: null })
  })

  it('选「10 条/页」后选择器显示 10、请求带 page_size=10、loading 不卡死', async () => {
    renderPage()
    // 首屏加载完成
    await waitFor(() => expect(screen.queryByText('加载中…')).not.toBeInTheDocument())

    // 初始为 20 条/页
    expect(screen.getByText('20 条/页')).toBeInTheDocument()

    // 打开每页条数选择器并选择 10
    fireEvent.mouseDown(screen.getByText('20 条/页'))
    const opt10 = await screen.findByText('10 条/页')
    fireEvent.click(opt10)

    // 选择生效：分页「每页条数」选择器的**触发器**应显示 10（不再回退成 20）。
    // 精确取 antd 分页 options 区的已选项（.ant-select-selection-item），避免与下拉项同名文本冲突。
    await waitFor(() => {
      const trigger = document.querySelector('.ant-pagination-options .ant-select-selection-item')
      expect(trigger?.textContent).toBe('10 条/页')
    })
    // 触发器不得仍是 20（这是修复前被还原的表现）
    const triggerText = document.querySelector('.ant-pagination-options .ant-select-selection-item')?.textContent
    expect(triggerText).not.toBe('20 条/页')

    // 请求确实以 page_size=10 发出（且不应死循环：仅首屏 + 本次变更两次）
    await waitFor(() => {
      const calls = getVersionsMock.mock.calls
      expect(calls[calls.length - 1]).toEqual([{ page: 1, page_size: 10 }])
    })
    expect(getVersionsMock.mock.calls.length).toBeLessThanOrEqual(3)

    // loading 最终清除，不卡在等待
    await waitFor(() => expect(screen.queryByText('加载中…')).not.toBeInTheDocument())
  })
})
