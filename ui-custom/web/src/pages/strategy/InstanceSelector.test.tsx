import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
})

describe('InstanceSelector', () => {
  setupAntdTest()

  it('renders candidates for the selected collection template + domain', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('a', 'online'), cand('b', 'offline', true), cand('c', 'online')], total: 3, page: 1, page_size: 20 },
    })

    render(<InstanceSelector templateCode="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={() => {}} />)

    expect(await screen.findByText('inst-a')).toBeInTheDocument()
    expect(screen.getByText('inst-b')).toBeInTheDocument()
    expect(screen.getByText('offline（不可选）')).toBeInTheDocument()
    // 候选查询按采集模板收敛，请求体不再有 monitor_type
    const params = candidatesMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.template_code).toBe('mysql')
    expect(params.monitor_type).toBeUndefined()
    // 列头为「采集模板」；候选行缺失 template_code 时回落到查询所用模板
    expect(screen.getAllByText('采集模板').length).toBeGreaterThan(0)
    expect(screen.getAllByText('mysql').length).toBeGreaterThan(0)
  })

  it('checks a selectable row and reports selection', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('a', 'online'), cand('b', 'online')], total: 2, page: 1, page_size: 20 },
    })
    const onChange = vi.fn()

    render(<InstanceSelector templateCode="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={onChange} />)
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

    render(<InstanceSelector templateCode="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={onChange} />)
    await screen.findByText('inst-a')

    fireEvent.click(screen.getByText('全选当前页'))
    const ids = onChange.mock.calls[0][0] as string[]
    expect(ids).toContain('a')
    expect(ids).toContain('c')
    expect(ids).not.toContain('b')
  })

  it('shows prompt when template / resource category or domain missing', () => {
    candidatesMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    // templateCode / resourceCategory / networkDomainId 均为可选 prop，缺省即表达「未选」
    render(<InstanceSelector selectedIds={[]} onChange={() => {}} />)
    expect(screen.getByText('请先选择采集模板与网域后加载候选实例')).toBeInTheDocument()
    expect(candidatesMock).not.toHaveBeenCalled()
  })

  // 阶段5（拨测改资源选择）：resourceCategory 模式不得再要求采集模板 ——
  // 否则拨测表单选了网域也永远停在引导态（该回归曾真实发生）。
  it('loads candidates by resource_category without template_code', async () => {
    candidatesMock.mockResolvedValue({
      status: 'success',
      data: { list: [cand('api-1', 'online')], total: 1, page: 1, page_size: 20 },
    })

    render(<InstanceSelector resourceCategory="interface_service" networkDomainId="mc-a" selectedIds={[]} onChange={() => {}} />)

    expect(await screen.findByText('inst-api-1')).toBeInTheDocument()
    // 请求必须带 resource_category 且不带 template_code / monitor_type
    const params = candidatesMock.mock.calls[0][0] as Record<string, unknown>
    expect(params.resource_category).toBe('interface_service')
    expect(params.template_code).toBeUndefined()
    expect(params.monitor_type).toBeUndefined()
  })

  it('shows the resource-category prompt (not the template one) when domain missing', () => {
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

    const { unmount } = render(<InstanceSelector templateCode="mysql" networkDomainId="mc-a" selectedIds={[]} onChange={() => {}} />)
    await screen.findByText('inst-a')
    expect(screen.getAllByText('IP').length).toBeGreaterThan(0)
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
    expect(screen.getAllByText('探测地址').length).toBeGreaterThan(0)
  })
})