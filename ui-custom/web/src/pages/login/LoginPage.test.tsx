import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import LoginPage from './LoginPage'
import { setupAntdTest } from '../../test/antdTestUtils'
import { getToken } from '../../api/client'

// vitest jsdom 的 window.localStorage 不可靠，用内存 Map 替换以验证 token 持久化。
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

/** 路由位置探针，用于断言登录成功后回跳目标 */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function createJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fakeFetch(body: unknown, status = 200) {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(createJson(body, status))
}

function renderLogin(initial = '/login') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<LocationProbe />} />
        <Route path="/resources" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function submit(username: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText('用户名'), { target: { value: username } })
  fireEvent.change(screen.getByPlaceholderText('密码'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /登\s*录/ }))
}

const LOGIN_OK = {
  status: 'success',
  data: {
    token: 'tok-abc',
    expires_at: '2026-08-28T22:00:00+08:00',
    user: { id: 'u1', username: 'admin', display_name: '系统管理员', tenant_id: 'platform_admin' },
  },
}

describe('LoginPage', () => {
  setupAntdTest()

  beforeEach(() => {
    storageMap.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores token and redirects back to the original page on success', async () => {
    fakeFetch(LOGIN_OK)
    renderLogin('/login?redirect=/resources')

    await submit('admin', 'admin123')

    await waitFor(() => expect(getToken()).toBe('tok-abc'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/resources'))
  })

  it('redirects to home by default when no redirect provided', async () => {
    fakeFetch(LOGIN_OK)
    renderLogin('/login')

    await submit('admin', 'admin123')

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'))
  })

  it('shows unified error message on failure and stores no token', async () => {
    fakeFetch({ status: 'error', data: null, error: 'bad', errorType: 'unauthorized' }, 401)
    renderLogin('/login')

    await submit('admin', 'wrong-password')

    await waitFor(() => expect(screen.getByText('用户名或密码错误')).toBeInTheDocument())
    expect(getToken()).toBeNull()
    // 失败后仍停留在登录页
    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument()
  })
})