import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { RulesPage } from './RulesPage'

const listMock = vi.fn()
const getMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()

vi.mock('../../api/monitoringRules', () => ({
  monitoringRuleApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: (...args: unknown[]) => getMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}))

// 页面测试不深入挂载抽屉（RuleMountDrawer 单独测）
vi.mock('./RuleMountDrawer', () => ({
  RuleMountDrawer: ({ open, onCancel }: { open: boolean; onCancel: () => void }) =>
    open ? <div data-testid="rule-mount-drawer">mount</div> : <button onClick={onCancel}>noop</button>,
}))

function rule(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `rule-${id}`,
    content_mode: 'yaml_passthrough',
    rule_content: 'groups:\n  - name: g\n    rules:\n      - alert: A\n      - alert: B',
    enabled: true,
    draft_status: 'ready',
    change_status: 'pending',
    scope: 'central',
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...extra,
  }
}

beforeEach(() => {
  listMock.mockReset()
  getMock.mockReset()
  updateMock.mockReset()
  removeMock.mockReset()
})

describe('RulesPage', () => {
  setupAntdTest()

  it('renders rules with count, status, change_status', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          rule(1, { change_status: 'pending', monitor_type: 'mysql' }),
          rule(2, { change_status: 'deployed', enabled: true }),
          rule(3, { enabled: false }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    render(
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('rule-1')).toBeInTheDocument()
    expect(screen.getByText('MetricCenter')).toBeInTheDocument()
    expect(screen.getAllByText('文件透传').length).toBeGreaterThanOrEqual(1)
    // 监控对象类型列：有值映射展示名，无值显示占位「-」
    expect(screen.getAllByText('MySQL').length).toBeGreaterThanOrEqual(1)
    // 两条 `- alert:` → 规则条数 2
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('待确认').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('待生效').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('已生效').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('停用').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state 暂无规则', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('暂无规则')).toBeInTheDocument()
  })

  it('opening mount drawer renders rule mount', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('挂载规则'))
    expect(screen.getByTestId('rule-mount-drawer')).toBeInTheDocument()
  })

  it('edit button is disabled for pending rules and opens drawer in edit mode otherwise', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          rule(1, { change_status: 'pending', enabled: true }),
          rule(2, { change_status: 'deployed', enabled: true }),
          rule(3, { enabled: false, change_status: 'none' }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    render(
      <MemoryRouter>
        <RulesPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('rule-1')).toBeInTheDocument()

    // 三行按序渲染：rule-1(pending) 编辑禁用；rule-2(已生效) 与 rule-3(停用) 可编辑
    const editButtons = screen.getAllByText('编辑').map((el) => el.closest('button'))
    expect(editButtons[0]).toBeDisabled()
    expect(editButtons[1]).toBeEnabled()
    expect(editButtons[2]).toBeEnabled()

    // 点击停用规则（rule-3）的「编辑」→ 打开抽屉进入编辑模式
    fireEvent.click(editButtons[2]!)
    expect(screen.getByTestId('rule-mount-drawer')).toBeInTheDocument()
  })
})