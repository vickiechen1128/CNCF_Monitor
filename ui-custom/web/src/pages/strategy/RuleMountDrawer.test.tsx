import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupAntdTest } from '../../test/antdTestUtils'
import { RuleMountDrawer } from './RuleMountDrawer'
import { validateYamlClient } from './rulesYaml'

const createMock = vi.fn()

vi.mock('../../api/monitoringRules', () => ({
  monitoringRuleApi: {
    create: (...args: unknown[]) => createMock(...args),
  },
}))

beforeEach(() => {
  createMock.mockReset()
})

describe('validateYamlClient', () => {
  it('rejects empty and missing groups', () => {
    expect(validateYamlClient('').valid).toBe(false)
    expect(validateYamlClient('alert: x').valid).toBe(false)
  })

  it('accepts content with groups array', () => {
    expect(validateYamlClient('groups:\n  - name: g\n    rules:\n      - alert: A').valid).toBe(true)
  })
})

describe('RuleMountDrawer', () => {
  setupAntdTest()

  function renderDrawer() {
    render(<RuleMountDrawer open onCancel={() => {}} onSuccess={() => {}} />)
  }

  it('renders mount drawer with paste area and upload', async () => {
    renderDrawer()
    expect(screen.getByText('挂载规则')).toBeInTheDocument()
    expect(screen.getByText('上传 / 粘贴 rules.yml')).toBeInTheDocument()
    expect(screen.getByText('从本地选择 rules.yml')).toBeInTheDocument()
  })

  it('blocks submit with invalid YAML and keeps content', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-name'), 'my-rule')
    await userEvent.type(screen.getByTestId('rule-content'), 'invalid')
    fireEvent.click(screen.getByText('提交生效'))

    // 无效 YAML：Alert 提示、不调用 create
    expect(await screen.findByText(/缺少顶层 groups 数组/)).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('submits valid YAML and calls create with yaml_passthrough', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-name'), 'my-rule')
    await userEvent.type(
      screen.getByTestId('rule-content'),
      'groups:\n  - name: g\n    rules:\n      - alert: A',
    )
    fireEvent.click(screen.getByText('提交生效'))

    expect(await screen.findByText(/规则已挂载/)).toBeInTheDocument()
    // 创建默认启用（M01 PRD §8）：必须显式携带 enabled: true
    expect(createMock).toHaveBeenCalledWith({
      content_mode: 'yaml_passthrough',
      rule_content: 'groups:\n  - name: g\n    rules:\n      - alert: A',
      name: 'my-rule',
      enabled: true,
    })
  })
})