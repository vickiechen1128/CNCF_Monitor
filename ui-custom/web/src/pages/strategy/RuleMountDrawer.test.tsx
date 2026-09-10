import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { RuleMountDrawer } from './RuleMountDrawer'
import { validateYamlClient } from './rulesYaml'

const createMock = vi.fn()
const updateMock = vi.fn()
const validateYamlMock = vi.fn()
const triggerAllMock = vi.fn()

vi.mock('../../api/monitoringRules', () => ({
  monitoringRuleApi: {
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    validateYaml: (...args: unknown[]) => validateYamlMock(...args),
  },
}))

// 变更单同步触发走公共 helper（内部依赖网域列表接口），此处 mock 聚焦抽屉行为
vi.mock('../config-center/preview/triggerConfigDraft', () => ({
  triggerConfigDraftsForAllDomains: (...args: unknown[]) => triggerAllMock(...args),
}))

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  validateYamlMock.mockReset()
  triggerAllMock.mockReset()
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

  function renderDrawer(props?: { onCancel?: () => void; onSuccess?: () => void }) {
    render(
      <MemoryRouter>
        <RuleMountDrawer
          open
          onCancel={props?.onCancel ?? (() => {})}
          onSuccess={props?.onSuccess ?? (() => {})}
        />
      </MemoryRouter>,
    )
  }

  it('renders mount drawer with paste area and upload', async () => {
    renderDrawer()
    expect(screen.getByText('挂载规则')).toBeInTheDocument()
    expect(screen.getByText('上传 / 粘贴 rules.yml')).toBeInTheDocument()
    expect(screen.getByText('从本地选择 rules.yml')).toBeInTheDocument()
  })

  it('blocks submit with invalid YAML and keeps content', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: false, error: '缺少顶层 groups 数组' } })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-name'), 'my-rule')
    await userEvent.type(screen.getByTestId('rule-content'), 'invalid')
    fireEvent.click(screen.getByText('提交生效'))

    // 无效 YAML：Alert 提示、不调用 create
    expect(await screen.findByText(/缺少顶层 groups 数组/)).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('F-04: falls back to local YAML validation when validate-yaml API fails', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    validateYamlMock.mockRejectedValue(new Error('network error'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-name'), 'my-rule')
    await userEvent.type(screen.getByTestId('rule-content'), 'invalid')
    fireEvent.click(screen.getByText('提交生效'))

    // 接口异常回落本地校验：仍按本地规则拦截非法 YAML
    expect(await screen.findByText(/缺少顶层 groups 数组/)).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // 决策 66：validate-yaml 返回 job 引用问题（error + warning）→ 抽屉行内提示，
  // 但不阻断保存（保存仍成功、仍触发变更单生成）。
  it('shows job-ref hints but does not block save (decision 66)', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({
      status: 'success',
      data: {
        valid: true,
        job_ref: [
          {
            group: 'g',
            rule_name: 'HostDown',
            expr: 'absent(up{job="miss"})',
            referenced_job: 'miss',
            severity: 'error',
            message: '规则 "HostDown" 的查询表达式引用的 job "miss" 不存在',
          },
          {
            group: 'g',
            rule_name: 'HighCPU',
            expr: 'node_cpu_usage{job="ghost"} > 0.9',
            referenced_job: 'ghost',
            severity: 'warning',
            message: '规则 "HighCPU" 的查询表达式引用的 job "ghost" 不存在',
          },
        ],
      },
    })
    renderDrawer()

    await userEvent.type(
      screen.getByTestId('rule-content'),
      'groups:\n  - name: g\n    rules:\n      - alert: HostDown',
    )
    fireEvent.click(screen.getByText('提交生效'))

    // 行内提示出现（error/warning 两色文案）
    expect(await screen.findByText(/规则 job 引用提示/)).toBeInTheDocument()
    expect(screen.getByText(/\[错误\]/)).toBeInTheDocument()
    expect(screen.getByText(/\[告警\]/)).toBeInTheDocument()
    // 提示不影响保存：仍调用 create
    await waitFor(() => expect(createMock).toHaveBeenCalled())
    // 决策 66 回归：存在 job 引用提示时抽屉保持打开，不自动关闭（否则提示一闪而过）
    expect(screen.getByText(/已保存，存在规则 job 引用提示/)).toBeInTheDocument()
  })

  // 决策 66 回归：job 引用提示下保存成功 → 不自动关闭抽屉（避免「红色提示一闪而过」）。
  it('keeps drawer open on flagged save', async () => {
    const onCancel = vi.fn()
    const onSuccess = vi.fn()
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({
      status: 'success',
      data: {
        valid: true,
        job_ref: [{ group: 'g', rule_name: 'Down', expr: 'absent(up{job="miss"})', referenced_job: 'miss', severity: 'error', message: 'j1' }],
      },
    })
    renderDrawer({ onCancel, onSuccess })
    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: A')
    fireEvent.click(screen.getByText('提交生效'))
    expect(await screen.findByText(/已保存，存在规则 job 引用提示/)).toBeInTheDocument()
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(onCancel).not.toHaveBeenCalled()
  })

  // 决策 66 回归：干净保存（无 job 引用问题）→ 自动关闭抽屉。
  it('closes drawer on clean save', async () => {
    const onCancel = vi.fn()
    const onSuccess = vi.fn()
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: true, job_ref: [] } })
    renderDrawer({ onCancel, onSuccess })
    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: A')
    fireEvent.click(screen.getByText('提交生效'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
  })

  // 决策 66：job 引用全部命中 → 不展示提示区，正常提交。
  it('does not render job-ref hint when no issues', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: true, job_ref: [] } })
    renderDrawer()

    await userEvent.type(
      screen.getByTestId('rule-content'),
      'groups:\n  - name: g\n    rules:\n      - alert: A',
    )
    fireEvent.click(screen.getByText('提交生效'))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(screen.queryByText(/规则 job 引用提示/)).toBeNull()
  })

  it('F-04: submits valid YAML validated by backend validate-yaml in create mode', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: true } })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-name'), 'my-rule')
    await userEvent.type(
      screen.getByTestId('rule-content'),
      'groups:\n  - name: g\n    rules:\n      - alert: A',
    )
    fireEvent.click(screen.getByText('提交生效'))

    // 保存成功：同步触发全部已纳管网域的变更单生成
    await waitFor(() =>
      expect(triggerAllMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: '规则已挂载' })),
    )
    // 新建场景走后端校验（id 占位 0，body 仅含 rule_content）
    expect(validateYamlMock).toHaveBeenCalledWith(0, 'groups:\n  - name: g\n    rules:\n      - alert: A')
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
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: true } })
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

    await waitFor(() =>
      expect(triggerAllMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: '规则已挂载' })),
    )
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.monitor_type).toBe('mysql')
    // resource_category 仅用于表单级联，不进入提交载荷
    expect(body).not.toHaveProperty('resource_category')
    expect(body.enabled).toBe(true)
  })

  it('edit mode pre-fills fields and submits via update without changing enabled', async () => {
    updateMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    render(
      <MemoryRouter>
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
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('编辑规则')).toBeInTheDocument()
    expect((screen.getByTestId('rule-name') as HTMLInputElement).value).toBe('my-rule')
    // 监控对象类型回显（级联反推资源类别=数据库）
    expect(screen.getByText('MySQL')).toBeInTheDocument()

    fireEvent.click(screen.getByText('保存变更'))
    await waitFor(() =>
      expect(triggerAllMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: '规则已更新' })),
    )
    // 编辑模式：PUT update，不携带 enabled，不改启停状态
    expect(updateMock).toHaveBeenCalledWith(1, {
      name: 'my-rule',
      monitor_type: 'mysql',
      rule_content: 'groups:\n  - name: g\n    rules:\n      - alert: A',
    })
    // 决策 66：编辑模式统一走后端 validate-yaml（含 job 引用校验），id 用编辑目标
    expect(validateYamlMock).toHaveBeenCalledWith(1, 'groups:\n  - name: g\n    rules:\n      - alert: A')
    expect(createMock).not.toHaveBeenCalled()
  })

  // 回归：#18 后用户实测「刷新页面后首次点编辑内容为空、第二次才回显」。
  // 根因：antd Drawer 首次打开时内容惰性挂载，父组件 useEffect 里 setFieldsValue
  // 先于 Form 字段注册执行被吞；forceRender 保证 Form 常驻挂载后首次打开即回显。
  it('edit mode echoes fields when drawer transitions from closed to open (first open)', () => {
    const { rerender } = render(
      <MemoryRouter>
        <RuleMountDrawer open={false} onCancel={() => {}} onSuccess={() => {}} />
      </MemoryRouter>,
    )

    rerender(
      <MemoryRouter>
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
        />
      </MemoryRouter>,
    )

    expect((screen.getByTestId('rule-name') as HTMLInputElement).value).toBe('my-rule')
    expect((screen.getByTestId('rule-content') as HTMLTextAreaElement).value).toBe(
      'groups:\n  - name: g\n    rules:\n      - alert: A',
    )
  })
})