import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { InstanceSelector } from './InstanceSelector'
import type { InstanceCandidate } from '../../types/strategy'

const candidatesMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    instanceCandidates: (...args: unknown[]) => candidatesMock(...args),
  },
}))

function cand(resource_id: string, status: string, disabled = false): InstanceCandidate {
  return { resource_id, instance_name: `inst-${resource_id}`, instance_ip: `10.0.0.${resource_id}`, status, disabled }
}

beforeEach(() => {
  candidatesMock.mockReset()
})

describe('InstanceSelector', () => {
  setupAntdTest()

  it('renders candidates for monitor_type + domain', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('a', 'online'), cand('b', 'offline', true), cand('c', 'online')], total: 3, page: 1, page_size: 20 },
    })

    render(<InstanceSelector monitorType="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={() => {}} />)

    expect(await screen.findByText('inst-a')).toBeInTheDocument()
    expect(screen.getByText('inst-b')).toBeInTheDocument()
    expect(screen.getByText('offline（不可选）')).toBeInTheDocument()
  })

  it('checks a selectable row and reports selection', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('a', 'online'), cand('b', 'online')], total: 2, page: 1, page_size: 20 },
    })
    const onChange = vi.fn()

    render(<InstanceSelector monitorType="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={onChange} />)
    const row = await screen.findByText('inst-a')
    const checkbox = row.closest('tr')?.querySelector('input[type="checkbox"]')
    expect(checkbox).toBeTruthy()
    if (checkbox) {
      fireEvent.click(checkbox)
    }
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0]).toContain('a')
  })

  it('selects all selectable rows via 全选当前页', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('a', 'online'), cand('b', 'offline', true), cand('c', 'online')], total: 3, page: 1, page_size: 20 },
    })
    const onChange = vi.fn()

    render(<InstanceSelector monitorType="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={onChange} />)
    await screen.findByText('inst-a')

    fireEvent.click(screen.getByText('全选当前页'))
    const ids = onChange.mock.calls[0][0] as string[]
    expect(ids).toContain('a')
    expect(ids).toContain('c')
    expect(ids).not.toContain('b')
  })

  it('shows prompt when monitor_type or domain missing', () => {
    candidatesMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    // monitorType / networkDomainId 均为可选 prop，缺省即表达「未选」
    render(<InstanceSelector selectedIds={[]} onChange={() => {}} />)
    expect(screen.getByText('请先选择监控对象类型与网域后加载候选实例')).toBeInTheDocument()
  })

  // 阶段5（拨测改资源选择）：resourceCategory 模式不得再要求 monitorType ——
  // 否则拨测表单选了网域也永远停在引导态（该回归曾真实发生）。
  it('loads candidates by resource_category without monitor_type', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('api-1', 'online')], total: 1, page: 1, page_size: 20 },
    })

    render(<InstanceSelector resourceCategory="interface_service" networkDomainId="mc-a" selectedIds={[]} onChange={() => {}} />)

    expect(await screen.findByText('inst-api-1')).toBeInTheDocument()
    // 请求必须带 resource_category 且不带 monitor_type
    const params = candidatesMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.resource_category).toBe('interface_service')
    expect(params.monitor_type).toBeUndefined()
  })

  it('shows the resource-category prompt (not the monitor_type one) when domain missing', () => {
    candidatesMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    render(<InstanceSelector resourceCategory="interface_service" selectedIds={[]} onChange={() => {}} />)
    expect(screen.getByText('请先选择网域后加载候选实例')).toBeInTheDocument()
  })

  // 阶段5（拨测改资源选择）：拨测目标字段由用户选定，未必是 IP，
  // 第二列表头可经 addressColumnTitle 覆写为「探测地址」；缺省仍为「IP」。
  it('defaults the address column header to IP and honors addressColumnTitle', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('a', 'online')], total: 1, page: 1, page_size: 20 },
    })

    const { unmount } = render(<InstanceSelector monitorType="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={() => {}} />)
    await screen.findByText('inst-a')
    expect(screen.getByText('IP')).toBeInTheDocument()
    unmount()

    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('api-1', 'online')], total: 1, page: 1, page_size: 20 },
    })
    render(
      <InstanceSelector
        resourceCategory="interface_service"
        networkDomainId="mc-a"
        addressColumnTitle="探测地址"
        selectedIds={[]}
        onChange={() => {}}
      />,
    )
    await screen.findByText('inst-api-1')
    expect(screen.getByText('探测地址')).toBeInTheDocument()
  })
})