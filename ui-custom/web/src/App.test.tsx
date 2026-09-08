import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import App, { RequireAuth } from './App'
import { setToken, clearToken } from './api/client'

// 用内存 Map 替换 jsdom 不可靠的 window.localStorage，验证守卫对 token 的判定。
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => storageMap.clear(),
  getItem: (key) => storageMap.get(key) ?? null,
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key) => storageMap.delete(key),
  setItem: (key, value) => storageMap.set(key, String(value)),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

function renderGuard(initialPath: string, withToken: boolean) {
  if (withToken) setToken('tok-guard')
  else clearToken()
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/resources" element={<div>protected:resources</div>} />
        </Route>
        <Route path="/login" element={<div>login-placeholder</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth 路由守卫', () => {
  beforeEach(() => storageMap.clear())
  afterEach(() => vi.restoreAllMocks())

  it('无 token 时重定向到 /login（暂未渲染受保护内容）', async () => {
    renderGuard('/resources', false)
    // 受保护页面不应渲染
    expect(screen.queryByText('protected:resources')).toBeNull()
    // 因 MemoryRouter 重定向到 /login 渲染登录占位
    await act(async () => {})
    expect(screen.getByText('login-placeholder')).toBeInTheDocument()
  })

  it('有 token 时渲染受保护页面', async () => {
    renderGuard('/resources', true)
    expect(screen.getByText('protected:resources')).toBeInTheDocument()
    expect(screen.queryByText('login-placeholder')).toBeNull()
  })

  it('App 整树：无 token 访问 / 跳登录页', async () => {
    storageMap.clear()
    render(<App />)
    await act(async () => {})
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument()
  })
})