import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { RuleMountDrawer } from './RuleMountDrawer'
import { validateYamlClient } from './rulesYaml'

const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('../../api/monitoringRules', () => ({
  monitoringRuleApi: {
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
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

  it('cascades monitor type by resource category and submits monitor_type', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    renderDrawer()

    // 选中资源类别=数据库 → 监控对象类型候选按类别收敛（不含主机类型）
    fireEvent.mouseDown(screen.getByText('全部类别'))
    await selectAntdOption('数据库')
    fireEvent.mouseDown(screen.getByText('请选择监控对象类型'))
    expect(await screen.findByText('MySQL')).toBeInTheDocument()
    expect(screen.queryByText('Linux 主机')).toBeNull()
    await selectAntdOption('MySQL')

    await userEvent.type(
      screen.getByTestId('rule-content'),
      'groups:\n  - name: g\n    rules:\n      - alert: A',
    )
    fireEvent.click(screen.getByText('提交生效'))

    expect(await screen.findByText(/规则已挂载/)).toBeInTheDocument()
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.monitor_type).toBe('mysql')
    // resource_category 仅用于表单级联，不进入提交载荷
    expect(body).not.toHaveProperty('resource_category')
    expect(body.enabled).toBe(true)
  })

  it('edit mode pre-fills fields and submits via update without changing enabled', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    render(
      <RuleMountDrawer
        open
        onCancel={() => {}}
        onSuccess={() => {}}
        editingRule={
          {
            id: 1,
            name: 'my-rule',
            content_mode: 'yaml_passthrough',
            monitor_type: 'mysql',
            rule_content: 'groups:\n  - name: g\n    rules:\n      - alert: A',
          } as unknown as import('../../types/strategy').MonitoringRule
        }
      />,
    )

    expect(screen.getByText('编辑规则')).toBeInTheDocument()
    expect((screen.getByTestId('rule-name') as HTMLInputElement).value).toBe('my-rule')
    // 监控对象类型回显（级联反推资源类别=数据库）
    expect(screen.getByText('MySQL')).toBeInTheDocument()

    fireEvent.click(screen.getByText('保存变更'))
    expect(await screen.findByText(/规则已更新/)).toBeInTheDocument()
    // 编辑模式：PUT update，不携带 enabled，不改启停状态
    expect(updateMock).toHaveBeenCalledWith(1, {
      name: 'my-rule',
      monitor_type: 'mysql',
      rule_content: 'groups:\n  - name: g\n    rules:\n      - alert: A',
    })
    expect(createMock).not.toHaveBeenCalled()
  })

  // 回归：#18 后用户实测「刷新页面后首次点编辑内容为空、第二次才回显」。
  // 根因：antd Drawer 首次打开时内容惰性挂载，父组件 useEffect 里 setFieldsValue
  // 先于 Form 字段注册执行被吞；forceRender 保证 Form 常驻挂载后首次打开即回显。
  it('edit mode echoes fields when drawer transitions from closed to open (first open)', () => {
    const { rerender } = render(<RuleMountDrawer open={false} onCancel={() => {}} onSuccess={() => {}} />)

    rerender(
      <RuleMountDrawer
        open
        onCancel={() => {}}
        onSuccess={() => {}}
        editingRule={
          {
            id: 1,
            name: 'my-rule',
            content_mode: 'yaml_passthrough',
            monitor_type: 'mysql',
            rule_content: 'groups:\n  - name: g\n    rules:\n      - alert: A',
          } as unknown as import('../../types/strategy').MonitoringRule
        }
      />,
    )

    expect((screen.getByTestId('rule-name') as HTMLInputElement).value).toBe('my-rule')
    expect((screen.getByTestId('rule-content') as HTMLTextAreaElement).value).toBe(
      'groups:\n  - name: g\n    rules:\n      - alert: A',
    )
  })
})