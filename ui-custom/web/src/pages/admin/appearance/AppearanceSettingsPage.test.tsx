/**
 * 外观设置页测试（用户 2026-09-18 补充决策：皮肤 + 产品名称落在「系统与平台管理」）。
 *
 * 覆盖两条关键语义差异：
 * - **产品名称**：输入时只更新页内预览，点「保存」后才全站生效（避免打字过程中
 *   浏览器标签页标题逐字跳动）；
 * - **皮肤**：点击即时生效并落盘。
 * 另覆盖空白值回落默认名、恢复默认清除持久化偏好。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { SkinProvider } from '../../../SkinProvider'
import { SKIN_STORAGE_KEY } from '../../../skinPreference'
import { DEFAULT_PRODUCT_NAME, PRODUCT_NAME_STORAGE_KEY } from '../../../productNamePreference'
import { AppearanceSettingsPage } from './AppearanceSettingsPage'

/** 顶栏品牌位文案（MainLayout 内 .app-title），用于验证「保存后才全站生效」 */
const brandTitle = () => document.querySelector('.app-title')?.textContent ?? null

const renderPage = () =>
  render(
    <SkinProvider>
      <MemoryRouter initialEntries={['/admin/appearance']}>
        <AppearanceSettingsPage />
      </MemoryRouter>
    </SkinProvider>,
  )

describe('AppearanceSettingsPage', () => {
  setupAntdTest()

  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-skin')
  })

  it('previews the typed product name but only applies it after saving', async () => {
    renderPage()

    const input = screen.getByTestId('product-name-input')
    const save = screen.getByTestId('product-name-save')

    // 初始：草稿与已生效值一致 → 保存按钮不可用（避免无意义写入）
    expect(input).toHaveValue(DEFAULT_PRODUCT_NAME)
    expect(brandTitle()).toBe(DEFAULT_PRODUCT_NAME)
    expect(save).toBeDisabled()

    fireEvent.change(input, { target: { value: '仪电监控中心' } })

    // 输入期间只更新页内预览，顶栏与标签页标题保持旧值
    expect(save).toBeEnabled()
    expect(screen.getByTestId('product-name-preview').textContent).toContain('仪电监控中心')
    expect(brandTitle()).toBe(DEFAULT_PRODUCT_NAME)
    expect(document.title).not.toBe('仪电监控中心')

    fireEvent.click(save)

    await waitFor(() => {
      expect(brandTitle()).toBe('仪电监控中心')
    })
    expect(document.title).toBe('仪电监控中心')
    expect(window.localStorage.getItem(PRODUCT_NAME_STORAGE_KEY)).toBe('仪电监控中心')
    // 保存后草稿回填为规范化值，按钮回到不可用
    expect(input).toHaveValue('仪电监控中心')
    expect(save).toBeDisabled()
  })

  it('treats a blank draft as the default name instead of an empty brand', async () => {
    renderPage()

    fireEvent.change(screen.getByTestId('product-name-input'), { target: { value: '   ' } })

    // 预览即回落默认名（品牌位永不出现空字符串）
    expect(screen.getByTestId('product-name-preview').textContent).toContain(DEFAULT_PRODUCT_NAME)
    fireEvent.click(screen.getByTestId('product-name-save'))

    await waitFor(() => {
      expect(brandTitle()).toBe(DEFAULT_PRODUCT_NAME)
    })
    // 与默认名等价的取值不落盘（保持「未自定义」状态）
    expect(window.localStorage.getItem(PRODUCT_NAME_STORAGE_KEY)).toBeNull()
  })

  it('restores the default product name and clears the stored preference', async () => {
    window.localStorage.setItem(PRODUCT_NAME_STORAGE_KEY, '自建监控平台')

    renderPage()

    expect(brandTitle()).toBe('自建监控平台')

    fireEvent.click(screen.getByTestId('product-name-reset'))

    await waitFor(() => {
      expect(brandTitle()).toBe(DEFAULT_PRODUCT_NAME)
    })
    expect(window.localStorage.getItem(PRODUCT_NAME_STORAGE_KEY)).toBeNull()
    expect(document.title).toBe(DEFAULT_PRODUCT_NAME)
  })

  it('applies the skin immediately and persists it（语义红随皮肤切换）', async () => {
    renderPage()

    const volcengine = screen.getByTestId('skin-option-volcengine')
    const inesa = screen.getByTestId('skin-option-inesa')

    // 默认皮肤为火山青（零回归基线），仪电蓝为可切换项
    expect(volcengine).toHaveAttribute('aria-pressed', 'true')
    expect(inesa).toHaveAttribute('aria-pressed', 'false')
    expect(within(volcengine).getByText('使用中')).toBeInTheDocument()

    fireEvent.click(inesa)

    await waitFor(() => {
      expect(inesa).toHaveAttribute('aria-pressed', 'true')
    })
    expect(volcengine).toHaveAttribute('aria-pressed', 'false')
    expect(within(inesa).getByText('使用中')).toBeInTheDocument()

    // 即时生效 + 持久化 + html[data-skin] 同步（App.css 的 CSS 变量走同一套 token）
    expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe('inesa')
    expect(document.documentElement.dataset.skin).toBe('inesa')

    // 切回默认皮肤同样落盘
    fireEvent.click(volcengine)
    await waitFor(() => {
      expect(window.localStorage.getItem(SKIN_STORAGE_KEY)).toBe('volcengine')
    })
    expect(document.documentElement.dataset.skin).toBe('volcengine')
  })
})
