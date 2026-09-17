import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { RuleMountDrawer } from './RuleMountDrawer'
import { validateYamlClient } from './rulesYaml'
import { ApiError } from '../../api/client'

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

  /** 决策 69-2：抽屉为两段式，「检查」常驻、提交按钮按状态出现 */
  const CHECK = '检查'
  const SUBMIT = '提交并进入变更确认'

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

  /** 一条 error 级 job 引用问题（存活类缺 job） */
  const errorJobRefIssue = {
    group: 'g',
    rule_name: 'HostDown',
    expr: 'absent(up{job="miss"})',
    referenced_job: 'miss',
    severity: 'error' as const,
    message: '规则 "HostDown" 的查询表达式引用的 job "miss" 不存在',
  }

  it('renders mount drawer with paste area and upload', async () => {
    renderDrawer()
    expect(screen.getByText('挂载规则')).toBeInTheDocument()
    expect(screen.getByText('上传 / 粘贴 rules.yml')).toBeInTheDocument()
    expect(screen.getByText('从本地选择 rules.yml')).toBeInTheDocument()
  })

  // 「从本地选择 rules.yml」入口须在编辑框**上方**（16 行文本域会把下方的入口顶到
  // 折叠线以下，用户需滚动才能发现）。
  it('places the local file picker above the rule content editor', () => {
    renderDrawer()
    const upload = screen.getByTestId('rule-upload-btn')
    const editor = screen.getByTestId('rule-content')
    // DOCUMENT_POSITION_FOLLOWING：editor 在 upload 之后 → upload 在上
    expect(upload.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // 决策 69-2：未检查时不出现提交按钮（状态机而非 disabled）。
  it('hides the submit button until the check passes (decision 69-2)', () => {
    renderDrawer()
    expect(screen.getByText(CHECK)).toBeInTheDocument()
    expect(screen.queryByText(SUBMIT)).toBeNull()
  })

  // 决策 69-1/69-2：检查即暴露语法错误（不再等提交），且提交按钮不出现。
  it('surfaces YAML syntax error on check and keeps the submit button hidden', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: false, error: '缺少顶层 groups 数组' } })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-name'), 'my-rule')
    await userEvent.type(screen.getByTestId('rule-content'), 'invalid')
    fireEvent.click(screen.getByText(CHECK))

    expect(await screen.findByText(/缺少顶层 groups 数组/)).toBeInTheDocument()
    expect(screen.getByText('规则检查未通过')).toBeInTheDocument()
    expect(screen.queryByText(SUBMIT)).toBeNull()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('F-04: falls back to local YAML validation when validate-yaml API fails', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    validateYamlMock.mockRejectedValue(new Error('network error'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-name'), 'my-rule')
    await userEvent.type(screen.getByTestId('rule-content'), 'invalid')
    fireEvent.click(screen.getByText(CHECK))

    // 接口异常回落本地校验：仍按本地规则拦截非法 YAML
    expect(await screen.findByText(/缺少顶层 groups 数组/)).toBeInTheDocument()
    expect(screen.queryByText(SUBMIT)).toBeNull()
    expect(createMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  // 决策 67-2 + 69-2：error 级 job 引用（存活类缺 job）在**检查阶段**即阻断，
  // 展示问题清单 + 逃生门，提交按钮不出现。
  it('blocks on error-level job-ref issues at check time (decision 67-2/69-2)', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({
      status: 'success',
      data: { valid: true, job_ref: [errorJobRefIssue] },
    })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: HostDown')
    fireEvent.click(screen.getByText(CHECK))

    // 阻断态：error 面板 + 逃生门勾选，提交按钮不出现、未提交
    expect(await screen.findByText(/规则 job 引用错误：提交已被阻断/)).toBeInTheDocument()
    expect(screen.getByText(/\[错误\]/)).toBeInTheDocument()
    expect(screen.getByTestId('rule-jobref-ack')).toBeInTheDocument()
    expect(screen.queryByText(SUBMIT)).toBeNull()
    expect(createMock).not.toHaveBeenCalled()
  })

  // 决策 67-2 逃生门 + 69-2 状态机：勾选「已知晓」后提交按钮出现，提交携带
  // ack_job_ref_errors=true；保存成功后抽屉保持打开（问题留痕），不自动关闭。
  it('reveals submit after ack escape hatch and sends ack flag (decision 67-2/69-2)', async () => {
    const onCancel = vi.fn()
    const onSuccess = vi.fn()
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({
      status: 'success',
      data: { valid: true, job_ref: [errorJobRefIssue] },
    })
    renderDrawer({ onCancel, onSuccess })

    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: HostDown')
    fireEvent.click(screen.getByText(CHECK))
    const ack = await screen.findByTestId('rule-jobref-ack')

    fireEvent.click(ack)
    // 勾选只参与「提交按钮是否出现」的计算，不提交任何东西（决策 69-2）
    expect(await screen.findByText(SUBMIT)).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(SUBMIT))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).toMatchObject({ ack_job_ref_errors: true })
    expect(await screen.findByText(/已保存（已显式确认）/)).toBeInTheDocument()
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(onCancel).not.toHaveBeenCalled()
  })

  // 决策 67-2：仅 warning 级 job 引用不阻断提交——检查通过后提交按钮直接出现，
  // 「检查」按钮不做任何提交动作；保存后抽屉保持打开以便阅读提示（决策 66 回归保留）。
  it('does not block on warning-level job-ref issues (decision 67-2)', async () => {
    const onCancel = vi.fn()
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({
      status: 'success',
      data: {
        valid: true,
        job_ref: [
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
    renderDrawer({ onCancel })

    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: HighCPU')
    fireEvent.click(screen.getByText(CHECK))

    expect(await screen.findByText(SUBMIT)).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(SUBMIT))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect(createMock.mock.calls[0][0]).not.toHaveProperty('ack_job_ref_errors')
    expect(await screen.findByText(/已保存，存在规则 job 引用提示/)).toBeInTheDocument()
    expect(screen.queryByTestId('rule-jobref-ack')).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
  })

  // 决策 67-2 后端兜底 + 69-2 状态机：validate-yaml 不可用（本地回落无 job_ref）时，
  // 检查通过、提交按钮出现；POST 返回 errorType=job_ref_unresolved → 面板出现逃生门
  // 且提交按钮重新隐藏，勾选后按钮再现、重试携带 ack 放行。
  it('surfaces backend job_ref_unresolved gate with escape hatch', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    validateYamlMock.mockRejectedValue(new Error('network error'))
    createMock
      .mockRejectedValueOnce(
        new ApiError(
          '规则存在未确认的 job 引用错误：存在 1 条存活类规则的 job 引用错误（引用了不存在的 job：miss）',
          400,
          'job_ref_unresolved',
        ),
      )
      .mockResolvedValueOnce({ status: 'success', data: { id: 9 } })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: A')
    fireEvent.click(screen.getByText(CHECK))
    fireEvent.click(await screen.findByText(SUBMIT))

    expect(await screen.findByTestId('rule-jobref-ack')).toBeInTheDocument()
    // 后端兜底文案用的是全角冒号（job：miss），断言须与之对齐，否则匹配不到
    expect(screen.getByText(/引用了不存在的 job：miss/)).toBeInTheDocument()
    expect(createMock).toHaveBeenCalledTimes(1)
    // 阻断态：提交按钮重新隐藏，须勾选逃生门后才再现
    expect(screen.queryByText(SUBMIT)).toBeNull()

    fireEvent.click(screen.getByTestId('rule-jobref-ack'))
    fireEvent.click(await screen.findByText(SUBMIT))

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2))
    expect(createMock.mock.calls[1][0]).toMatchObject({ ack_job_ref_errors: true })
    warnSpy.mockRestore()
  })

  // 决策 67-2/69-2：规则内容变更后，先前的**检查结论与显式确认一并作废**，
  // 提交按钮重新隐藏，须重新检查（防「确认 A 内容、提交 B 内容」）。
  it('invalidates check result and ack when rule content changes', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({
      status: 'success',
      data: { valid: true, job_ref: [errorJobRefIssue] },
    })
    renderDrawer()

    const content = screen.getByTestId('rule-content')
    await userEvent.type(content, 'groups:\n  - name: g\n    rules:\n      - alert: HostDown')
    fireEvent.click(screen.getByText(CHECK))
    const ack = await screen.findByTestId('rule-jobref-ack')
    fireEvent.click(ack)
    expect(await screen.findByText(SUBMIT)).toBeInTheDocument()

    // 内容变更 → 检查结论与 ack 作废：逃生门消失、提交按钮重新隐藏
    await userEvent.type(content, '\n# changed')
    await waitFor(() => expect(screen.queryByTestId('rule-jobref-ack')).toBeNull())
    expect(screen.queryByText(SUBMIT)).toBeNull()
    expect(createMock).not.toHaveBeenCalled()
  })

  // 决策 66 回归 + 决策 69-2：干净保存（检查通过且无 job 引用问题）→ 自动关闭抽屉。
  it('closes drawer on clean save', async () => {
    const onCancel = vi.fn()
    const onSuccess = vi.fn()
    createMock.mockResolvedValue({ status: 'success', data: { id: 9 } })
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: true, job_ref: [] } })
    renderDrawer({ onCancel, onSuccess })
    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: A')
    fireEvent.click(screen.getByText(CHECK))
    fireEvent.click(await screen.findByText(SUBMIT))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    await waitFor(() => expect(onCancel).toHaveBeenCalled())
  })

  // 决策 66 + 69-3：检查通过展示绿色「检查通过」（含服务端复核边界说明）。
  it('shows a success hint with server-side recheck disclaimer when check passes', async () => {
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: true, job_ref: [] } })
    renderDrawer()

    await userEvent.type(screen.getByTestId('rule-content'), 'groups:\n  - name: g\n    rules:\n      - alert: A')
    fireEvent.click(screen.getByText(CHECK))

    expect(await screen.findByText('检查通过')).toBeInTheDocument()
    expect(screen.getByText(/服务端仍会复核/)).toBeInTheDocument()
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
    fireEvent.click(screen.getByText(CHECK))
    fireEvent.click(await screen.findByText(SUBMIT))

    // 保存成功：同步触发全部已纳管网域的变更单生成
    await waitFor(() =>
      expect(triggerAllMock).toHaveBeenCalledWith(expect.objectContaining({ prefix: '规则已挂载' })),
    )
    // 新建场景走后端校验（id 占位 0，body 仅含 rule_content），且检查仅执行一次
    expect(validateYamlMock).toHaveBeenCalledTimes(1)
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
    fireEvent.click(screen.getByText(CHECK))
    fireEvent.click(await screen.findByText(SUBMIT))

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
    validateYamlMock.mockResolvedValue({ status: 'success', data: { valid: true, job_ref: [] } })
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

    fireEvent.click(screen.getByText(CHECK))
    fireEvent.click(await screen.findByText(SUBMIT))
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
