import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryPage } from './QueryPage'
import { ApiError } from '../../api/client'
import { setupAntdTest } from '../../test/antdTestUtils'

const mockGet = vi.fn()

// 仅替换网络入口，保留真实 ApiError：client.ts 对 status === 'error' 是抛 ApiError，
// 生产走 catch 分支，测试须覆盖真实路径（而非已 resolve 的错误信封）。
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>()
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => mockGet(...args),
    },
  }
})

// MainLayout 依赖路由上下文（useNavigate / useLocation），用 MemoryRouter 包裹 + 轻量壳替换。
vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="main-layout">{children}</div>
  ),
}))

const QUERY_PATH = '/api/v1/query'

const VECTOR_OK = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [
      {
        metric: { __name__: 'up', instance: '10.0.0.1:9100', job: 'node' },
        value: [1757800000, '1'],
      },
    ],
  },
}

const MATRIX_OK = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [
      { metric: { __name__: 'up', job: 'node' }, values: [[1757800000, '1']] },
      { metric: { __name__: 'up', job: 'mysql' }, values: [[1757800000, '0']] },
    ],
  },
}

const SCALAR_OK = {
  status: 'success',
  data: { resultType: 'scalar', result: [1757800000, '42'] },
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryPage />
    </MemoryRouter>,
  )
}

const promqlInput = () => screen.getByLabelText('PromQL 表达式')

describe('QueryPage', () => {
  setupAntdTest()

  beforeEach(() => {
    mockGet.mockReset()
  })

  it('初始为未查询空态，且不发起请求', () => {
    renderPage()

    expect(screen.getByText('指标查询')).toBeInTheDocument()
    expect(promqlInput()).toHaveValue('')
    expect(screen.getByRole('button', { name: /执行查询/ })).toBeInTheDocument()
    expect(screen.getByText('输入 PromQL 表达式并执行查询，结果将显示在这里')).toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('自包 MainLayout 布局外壳（/query 深链不丢 Header / Sider）', () => {
    renderPage()

    // 页面顶层必须渲染 MainLayout，否则 /query 深链进来后无全站导航、无法回到其它页面
    expect(screen.getByTestId('main-layout')).toBeInTheDocument()
    expect(screen.getByText('指标查询')).toBeInTheDocument()
  })

  it('执行查询调用 /api/v1/query 并以表格渲染 vector 结果', async () => {
    mockGet.mockResolvedValue(VECTOR_OK)

    renderPage()

    await userEvent.type(promqlInput(), 'up')
    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(QUERY_PATH, { params: { query: 'up' } })
    })

    // 结果条数提示 + 表格列（列头为用户语言，非内部字段名）
    expect(await screen.findByText('共 1 条结果')).toBeInTheDocument()
    // antd 表头与表体分表渲染（scroll 场景），列头用 getAllBy 断言存在
    for (const header of ['指标名', '实例', '采集 Job', '其它标签', '值', '查询时间']) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0)
    }
    // 指标名单元格（用 selector 排除输入框内的同名文本）
    expect(screen.getByText('up', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1:9100')).toBeInTheDocument()
    expect(screen.getByText('node')).toBeInTheDocument()
    expect(screen.getAllByTestId('prom-sample-value').map((el) => el.textContent)).toEqual(['1'])
  })

  it('支持 Ctrl+Enter 快捷执行', async () => {
    mockGet.mockResolvedValue(VECTOR_OK)

    renderPage()

    await userEvent.type(promqlInput(), 'up')
    fireEvent.keyDown(promqlInput(), { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(QUERY_PATH, { params: { query: 'up' } })
    })
    expect(await screen.findByText('共 1 条结果')).toBeInTheDocument()
  })

  it('空表达式不发起请求并给出提示', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    expect(await screen.findByText('请输入 PromQL 表达式后再执行查询')).toBeInTheDocument()
    expect(screen.getByText('查询失败')).toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('网络异常时展示错误态', async () => {
    mockGet.mockRejectedValue(new Error('network failure'))

    renderPage()

    await userEvent.type(promqlInput(), 'up')
    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    expect(await screen.findByText('查询失败')).toBeInTheDocument()
    expect(screen.getByText('network failure')).toBeInTheDocument()
  })

  it('Prometheus 错误信封显式展示 error 文案', async () => {
    mockGet.mockResolvedValue({
      status: 'error',
      data: undefined,
      error: 'parse error at char 1: unexpected end of input',
      errorType: 'bad_data',
    })

    renderPage()

    // `{` 是 userEvent.type 的转义字符，用 fireEvent.change 直接置值
    fireEvent.change(promqlInput(), { target: { value: 'up{' } })
    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    expect(
      await screen.findByText('parse error at char 1: unexpected end of input'),
    ).toBeInTheDocument()
    // 错误态不展示空态引导（不把失败伪装成无数据）
    expect(screen.queryByText('输入 PromQL 表达式并执行查询，结果将显示在这里')).not.toBeInTheDocument()
  })

  it('client 抛 ApiError 时展示 error 文案（status=error 的真实生产路径）', async () => {
    // client.ts 对 Prometheus `{status:'error'}` 信封是 throw ApiError（HTTP 400/422），
    // 页面走 catch 分支，与上一条「已 resolve 错误信封」的防御分支区分。
    mockGet.mockRejectedValue(
      new ApiError('parse error at char 4: no expression found in input', 400, 'bad_data'),
    )

    renderPage()

    fireEvent.change(promqlInput(), { target: { value: 'up{' } })
    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    expect(
      await screen.findByText('parse error at char 4: no expression found in input'),
    ).toBeInTheDocument()
    expect(screen.getByText('查询失败')).toBeInTheDocument()
    expect(screen.queryByText('输入 PromQL 表达式并执行查询，结果将显示在这里')).not.toBeInTheDocument()
  })

  it('matrix 结果以 JSON 折叠区兜底', async () => {
    mockGet.mockResolvedValue(MATRIX_OK)

    renderPage()

    await userEvent.type(promqlInput(), 'up[5m]')
    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    expect(await screen.findByText('共 2 条结果')).toBeInTheDocument()
    expect(screen.getByText(/区间数据/)).toBeInTheDocument()
    expect(screen.getByText('原始返回数据')).toBeInTheDocument()
  })

  it('契约外结果形态（result 非数组）回落 JSON 折叠区，不白屏', async () => {
    mockGet.mockResolvedValue({
      status: 'success',
      data: { resultType: 'vector', result: { unexpected: 'object' } },
    })

    renderPage()

    await userEvent.type(promqlInput(), 'up')
    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    // 不把对象当 React child 渲染：直接走 JSON 折叠区兜底
    expect(await screen.findByText('原始返回数据')).toBeInTheDocument()
    // 展开折叠区可见完整原始对象（antd Collapse 折叠时懒渲染，需先展开）
    fireEvent.click(screen.getByText('原始返回数据'))
    expect(await screen.findByText(/"unexpected": "object"/)).toBeInTheDocument()
  })

  it('请求进行中再次触发执行被忽略（不产生并发请求，避免旧响应覆盖新结果）', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    mockGet.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )

    renderPage()

    await userEvent.type(promqlInput(), 'up')
    fireEvent.click(screen.getByRole('button', { name: /执行查询/ }))
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1))

    // loading 中：按钮禁用 + Ctrl/Cmd+Enter 短路，均不产生第二次请求
    fireEvent.click(screen.getByRole('button', { name: /执行查询/ }))
    fireEvent.keyDown(promqlInput(), { key: 'Enter', ctrlKey: true })
    expect(mockGet).toHaveBeenCalledTimes(1)

    resolveFirst(VECTOR_OK)
    expect(await screen.findByText('共 1 条结果')).toBeInTheDocument()
  })

  it('scalar 结果展示结果值，并可清空重置', async () => {
    mockGet.mockResolvedValue(SCALAR_OK)

    renderPage()

    await userEvent.type(promqlInput(), 'scalar(count(up))')
    await userEvent.click(screen.getByRole('button', { name: /执行查询/ }))

    expect(await screen.findByText('共 1 条结果')).toBeInTheDocument()
    expect(screen.getByText('结果值')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /清\s*空/ }))

    expect(promqlInput()).toHaveValue('')
    expect(screen.getByText('输入 PromQL 表达式并执行查询，结果将显示在这里')).toBeInTheDocument()
  })

  it('示例按钮填充表达式但不自动执行', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'up' }))

    expect(promqlInput()).toHaveValue('up')
    expect(mockGet).not.toHaveBeenCalled()
  })
})
