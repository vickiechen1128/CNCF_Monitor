import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { BlackboxModulesPage } from './BlackboxModulesPage'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()

vi.mock('../../api/blackboxModules', () => ({
  blackboxModuleApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}))

const moduleRow = {
  id: 1,
  name: 'http_2xx',
  content: 'http_2xx:\n  prober: http\n  timeout: 5s\n',
  enabled: true,
  prober: 'http',
  referenced_jobs: 1,
  created_at: '2026-10-28T01:00:00Z',
  updated_at: '2026-10-28T01:00:00Z',
}

describe('BlackboxModulesPage', () => {
  setupAntdTest()

  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue({ status: 'success', data: { list: [moduleRow], total: 1, page: 1, page_size: 100 } })
    createMock.mockResolvedValue({ status: 'success', data: { ...moduleRow, id: 2, name: 'custom_https' } })
  })

  it('lists modules and creates a YAML module', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><BlackboxModulesPage /></MemoryRouter>)

    expect(await screen.findByText('http_2xx')).toBeInTheDocument()
    expect(screen.getByText('http')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /新\s*增\s*模\s*块/ }))

    const nameInput = await screen.findByPlaceholderText('例如：http_2xx')
    await user.clear(nameInput)
    await user.type(nameInput, 'custom_https')
    const editor = document.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'custom_https:\n  prober: http\n  timeout: 10s\n' } })
    await user.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      'custom_https',
      'custom_https:\n  prober: http\n  timeout: 10s\n',
    ))
  })

  it('shows API errors and keeps referenced modules protected from deletion', async () => {
    listMock.mockRejectedValue(new Error('module service unavailable'))
    render(<MemoryRouter><BlackboxModulesPage /></MemoryRouter>)
    expect(await screen.findByText('module service unavailable')).toBeInTheDocument()
  })
})
