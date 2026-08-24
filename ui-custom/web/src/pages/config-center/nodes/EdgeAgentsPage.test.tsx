import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../../test/antdTestUtils'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

import { EdgeAgentsPage } from './EdgeAgentsPage'

describe('EdgeAgentsPage（采集节点状态 - MVP 空态）', () => {
  setupAntdTest()

  beforeEach(() => {
    navigateMock.mockReset()
  })

  it('渲染标题与空态引导（尚未接入采集节点）', () => {
    render(
      <MemoryRouter>
        <EdgeAgentsPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('采集节点状态')).toBeInTheDocument()
    expect(screen.getByText('尚未接入采集节点')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /去网域纳管/ })).toBeInTheDocument()
  })

  it('空态引导说明 local / agent_pull 差异（local 不部署 Edge Agent）', () => {
    render(
      <MemoryRouter>
        <EdgeAgentsPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Edge Sync Agent/)).toBeInTheDocument()
    expect(screen.getByText(/local 通道网域（如 default）由中心直接采集，不部署 Edge Agent/)).toBeInTheDocument()
  })

  it('点击「去网域纳管」跳转 /domain-onboarding', () => {
    render(
      <MemoryRouter>
        <EdgeAgentsPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: /去网域纳管/ }))
    expect(navigateMock).toHaveBeenCalledWith('/domain-onboarding')
  })
})