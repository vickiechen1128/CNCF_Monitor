import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { ApiError } from '../../api/client'
import { AlertConfigPage } from './AlertConfigPage'
import type { AlertmanagerConfigVersionListItem } from '../../types/alertmanager'

const useAlertConfigMock = vi.fn()
const getVersionMock = vi.fn()

vi.mock('./useAlertConfig', () => ({
  useAlertConfig: (...a: unknown[]) => useAlertConfigMock(...a),
}))

vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertmanagerConfigApi: {
      getVersion: (...a: unknown[]) => getVersionMock(...a),
    },
  }
})

const reloadMock = vi.fn()
const submitMock = vi.fn()
const remountMock = vi.fn()

const versionRow = (over: Partial<AlertmanagerConfigVersionListItem> = {}): AlertmanagerConfigVersionListItem => ({
  id: 'acv-1',
  checksum: '7e1b4d9c2a6f8e0d3b9a1c5e7f2d4b8c',
  applied_at: '2026-08-31T10:00:00Z',
  applied_by: '张伟（运维）',
  status: 'applied',
  source_change_no: 'CHG-20260831-001',
  created_at: '2026-08-31T10:00:00Z',
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    current: null,
    versions: [],
    total: 0,
    loading: false,
    error: null,
    permissionDenied: false,
    reload: reloadMock,
    submit: submitMock,
    remount: remountMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <App>
        <AlertConfigPage />
      </App>
    </MemoryRouter>,
  )
}

describe('AlertConfigPage（告警配置文件挂载）', () => {
  setupAntdTest()

  beforeEach(() => {
    useAlertConfigMock.mockReset()
    getVersionMock.mockReset()
    reloadMock.mockReset()
    submitMock.mockReset()
    submitMock.mockResolvedValue({ status: 'success', data: { id: 'acv-2', content: '', checksum: '', status: 'applied', source_change_no: 'CHG-2' } })
    remountMock.mockReset()
    remountMock.mockResolvedValue({ status: 'success', data: { id: 'acv-9', content: '', checksum: '', status: 'applied' } })
  })

  it('加载中提示', () => {
    useAlertConfigMock.mockReturnValue(result({ loading: true }))
    renderPage()
    expect(screen.getByText('告警配置')).toBeInTheDocument()
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })

  it('空态：无当前生效配置时展示挂载引导', () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('配置版本历史')).toBeInTheDocument()
    // 当前生效配置区空态引导
    expect(screen.getByText(/当前无生效配置/)).toBeInTheDocument()
  })

  it('渲染当前生效配置只读视图与版本列表', async () => {
    useAlertConfigMock.mockReturnValue(
      result({ current: { id: 'acv-1', content: 'global:\n  resolve_timeout: 30s', checksum: 'abc', status: 'applied' }, versions: [versionRow()], total: 1 }),
    )
    renderPage()
    // 「当前生效配置」结构化 Descriptions 与「配置版本历史」表格行均展示版本 ID acv-1
    expect((await screen.findAllByText('acv-1')).length).toBeGreaterThan(0)
    expect(screen.getByText(/resolve_timeout/)).toBeInTheDocument()
    expect(screen.getByText('CHG-20260831-001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新挂载此版本/ })).toBeInTheDocument()
  })

  it('权限不足：显示权限不足空态', () => {
    useAlertConfigMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(screen.getByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('接口错误：Alert + 重新加载触发 reload', () => {
    const res = result({ error: 'boom' })
    useAlertConfigMock.mockReturnValue(res)
    renderPage()
    expect(screen.getByText('配置信息加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(res.reload).toHaveBeenCalled()
  })

  it('挂载：前置校验通过后提交并给出「进入变更确认」引导', async () => {
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /挂载新配置/ }))
    const textarea = screen.getByPlaceholderText(/# 在此粘贴 alertmanager\.yml 完整内容/)
    fireEvent.change(textarea, { target: { value: 'route:' } })
    fireEvent.click(screen.getByRole('button', { name: /本地大小检查/ }))
    fireEvent.click(screen.getByRole('button', { name: /提交并进入变更确认/ }))
    await waitFor(() => expect(submitMock).toHaveBeenCalledWith(expect.any(String), expect.any(String)))
  })

  it('挂载：提交时校验失败展示行级分组错误，未落库', async () => {
    const badRequest = new ApiError(
      '校验失败',
      400,
      'bad_request',
      {
        status: 'error',
        data: {
          items: [
            { file: 'alertmanager.yml', line: 14, message: 'unknown receiver "sre-critical" referenced by route' },
            { file: 'alertmanager.yml', line: 3, message: 'cannot unmarshal yaml' },
          ],
          note: '校验失败未保存、未生效；修改后请重新挂载',
        },
        error: '校验失败',
        errorType: 'bad_request',
      },
    )
    submitMock.mockRejectedValue(badRequest)
    useAlertConfigMock.mockReturnValue(result())
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /挂载新配置/ }))
    const textarea = screen.getByPlaceholderText(/# 在此粘贴 alertmanager\.yml 完整内容/)
    fireEvent.change(textarea, { target: { value: 'route: x' } })
    fireEvent.click(screen.getByRole('button', { name: /本地大小检查/ }))
    fireEvent.click(screen.getByRole('button', { name: /提交并进入变更确认/ }))
    await waitFor(() => expect(submitMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('引用闭合错误')).toBeInTheDocument())
    expect(screen.getByText('配置语法错误')).toBeInTheDocument()
  })

  it('重新挂载历史版本：Modal 二次确认后调用 remount', async () => {
    useAlertConfigMock.mockReturnValue(result({ versions: [versionRow()], total: 1 }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /重新挂载此版本/ }))
    expect(modal.confirm).toHaveBeenCalled()
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    expect(remountMock).toHaveBeenCalledWith('acv-1', expect.any(String))
  })
})