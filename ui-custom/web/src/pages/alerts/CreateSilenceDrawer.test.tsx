/**
 * CreateSilenceDrawer 交互测试（v1.16 决策 71）。
 * 核心回归：Form.List 重构修复「匹配条件渲染死锁」（dev-feedback 第 10 条）——
 * 原实现 Form.useWatch 驱动行渲染，抽屉内始终 0 行、点击添加无反应。
 * 另覆盖：告警标签分组联想（label-options）、正则预检、从资源清单选择实例生成 resource_id matcher
 * （M07 §6.1 resource_category 必填 → CI 类型 + 实例名双框，按类懒加载 + keyword 服务端搜索）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { setupAntdTest } from '../../test/antdTestUtils'
import { CreateSilenceDrawer } from './CreateSilenceDrawer'
import type { Resource } from '../../types/resource'

const getLabelOptionsMock = vi.fn()
vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertmanagerSilenceApi: {
      ...actual.alertmanagerSilenceApi,
      getLabelOptions: (...a: unknown[]) => getLabelOptionsMock(...a),
    },
  }
})

const resourceListMock = vi.fn()
vi.mock('../../api/resources', () => ({
  resourceApi: {
    list: (...a: unknown[]) => resourceListMock(...a),
  },
}))

// 告警标签输入是 AutoComplete（Select 系）：placeholder 渲染为 span 而非 input 属性，
// 须按 Form.Item label 关联查询（aria-labelledby → inner input id）。
const nameInput = () => screen.getAllByLabelText('告警标签') as unknown as HTMLInputElement[]
const valueInput = () => screen.getAllByPlaceholderText('如 critical') as unknown as HTMLInputElement[]

function renderDrawer(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(
    <App>
      <CreateSilenceDrawer open={true} onClose={() => {}} onSubmit={onSubmit} />
    </App>,
  )
  return onSubmit
}

describe('CreateSilenceDrawer（创建静默抽屉，决策 71）', () => {
  setupAntdTest()

  beforeEach(() => {
    vi.clearAllMocks()
    getLabelOptionsMock.mockResolvedValue({
      status: 'success',
      data: {
        groups: [
          {
            source: 'target_system',
            label: '系统与采集标签',
            items: [{ name: 'resource_id', description: '资源唯一 ID；实例级静默推荐用此键' }],
          },
          {
            source: 'rule',
            label: '规则标签',
            items: [{ name: 'alertname', description: '告警规则名（规则求值自动附加）' }],
          },
        ],
      },
    })
    const host: Resource = {
      id: 1,
      resource_id: 'rid-host-1',
      tenant_id: 't',
      resource_type: 'host',
      resource_category: 'host',
      network_domain_id: 'default',
      biz_code: 'b',
      env: 'PRD',
      owner: '',
      status: 'online',
      created_at: '',
      updated_at: '',
      instance_name: 'web-01',
      private_ip: '10.0.0.5',
    } as unknown as Resource
    // resource_category 必填（M07 §6.1）：按所选类型单类拉取，仅 host 类返回样例
    resourceListMock.mockImplementation((params?: { resource_category?: string }) => {
      const list = params?.resource_category === 'host' ? [host] : []
      return Promise.resolve({
        status: 'success',
        data: { list, total: list.length, page: 1, page_size: 100 },
      })
    })
  })

  it('回归（dev-feedback 10）：打开即渲染 1 行匹配条件，点「添加匹配条件」出现第 2 行', async () => {
    renderDrawer()
    await waitFor(() => expect(nameInput()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: /添加匹配条件/ }))
    await waitFor(() => expect(nameInput()).toHaveLength(2))
    expect(valueInput()).toHaveLength(2)
  })

  it('提交组装 payload：匹配器过滤 + 时间 ISO 化 + 原因必填', async () => {
    const onSubmit = renderDrawer()
    await waitFor(() => expect(nameInput()).toHaveLength(1))
    fireEvent.change(nameInput()[0], { target: { value: 'alertname' } })
    fireEvent.change(valueInput()[0], { target: { value: 'HostDown' } })
    fireEvent.change(screen.getByPlaceholderText(/灰度发布/), { target: { value: '计划内变更' } })
    fireEvent.click(screen.getByRole('button', { name: /提交创建/ }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const payload = onSubmit.mock.calls[0][0]
    expect(payload.matchers).toEqual([
      { name: 'alertname', value: 'HostDown', is_equal: true, is_regex: false },
    ])
    expect(payload.comment).toBe('计划内变更')
    expect(payload.starts_at).toBeTruthy()
    expect(payload.ends_at).toBeTruthy()
  })

  it('AND 语义提示展示', async () => {
    renderDrawer()
    expect(await screen.findByText(/AND/)).toBeInTheDocument()
  })

  it('告警标签分组联想：label-options 分组渲染（系统与采集标签 / 规则标签）', async () => {
    renderDrawer()
    await waitFor(() => expect(getLabelOptionsMock).toHaveBeenCalled())
    const input = nameInput()[0]
    // 输入 'res' → 命中 resource_id → 「系统与采集标签」组可见（另一组被过滤隐藏）
    fireEvent.change(input, { target: { value: 'res' } })
    expect(await screen.findByText('系统与采集标签')).toBeInTheDocument()
    expect(await screen.findByText(/资源唯一 ID/)).toBeInTheDocument()
    // 输入 'alert' → 命中 alertname → 「规则标签」组可见
    fireEvent.change(input, { target: { value: 'alert' } })
    expect(await screen.findByText('规则标签')).toBeInTheDocument()
    expect(await screen.findByText(/告警规则名/)).toBeInTheDocument()
  })

  it('正则预检：is_regex 开启后非法正则即时报错，合法正则通过', async () => {
    renderDrawer()
    await waitFor(() => expect(nameInput()).toHaveLength(1))
    fireEvent.change(valueInput()[0], { target: { value: '[invalid' } })
    // 行内第二个开关为「正则」
    const switches = screen.getAllByRole('switch')
    fireEvent.click(switches[1])
    // onChange 立即触发重校验 → 内联错误
    expect(await screen.findByText(/正则表达式不合法/)).toBeInTheDocument()
    // 改为合法正则后错误消失
    fireEvent.change(valueInput()[0], { target: { value: 'host-.*' } })
    await waitFor(() => expect(screen.queryByText(/正则表达式不合法/)).toBeNull())
  })

  it('从资源清单选择实例：CI 类型 + 实例名双框，默认按 host 单类懒加载（不并发五类）', async () => {
    renderDrawer()
    await waitFor(() => expect(resourceListMock).toHaveBeenCalled())
    // 仅请求默认类型 host（M07 §6.1 resource_category 必填）
    expect(resourceListMock).toHaveBeenCalledWith(
      expect.objectContaining({ resource_category: 'host', page_size: 100 }),
    )
    // 不再五类并发（旧实现一次性发 5 个请求、每类 100 条合并后会被截断）
    expect(resourceListMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ resource_category: 'generic_target' }),
    )
    // 双框就位：CI 类型框 + 实例名框
    expect(screen.getByLabelText('CI 类型')).toBeInTheDocument()
    expect(screen.getByLabelText('实例名')).toBeInTheDocument()
  })

  it('切换 CI 类型后按新类型重新拉取（含切换前的 host 请求共 2 次）', async () => {
    renderDrawer()
    await waitFor(() => expect(resourceListMock).toHaveBeenCalledTimes(1))
    fireEvent.mouseDown(screen.getByLabelText('CI 类型'))
    fireEvent.click(await screen.findByText('数据库'))
    await waitFor(() => expect(resourceListMock).toHaveBeenCalledTimes(2))
    expect(resourceListMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource_category: 'database' }),
    )
  })

  it('实例名搜索走服务端 keyword（防抖后带 keyword 请求）', async () => {
    renderDrawer()
    await waitFor(() => expect(resourceListMock).toHaveBeenCalledTimes(1))
    const combo = screen.getByLabelText('实例名') as HTMLInputElement
    fireEvent.mouseDown(combo)
    fireEvent.change(combo, { target: { value: 'web' } })
    await waitFor(() => expect(resourceListMock).toHaveBeenCalledTimes(2))
    expect(resourceListMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource_category: 'host', keyword: 'web' }),
    )
  })

  it('从资源清单选择实例：上方有空行时填入空行，不新增行', async () => {
    renderDrawer()
    await waitFor(() => expect(nameInput()).toHaveLength(1))
    // 实例选择器（实例名框）在匹配条件行之后（快捷添加区），经 label 关联定位
    const combo = screen.getByLabelText('实例名') as HTMLInputElement
    fireEvent.mouseDown(combo)
    fireEvent.click(await screen.findByText(/web-01（10.0.0.5）/))
    // 初始空行被填充（不残留空白行、不新增行）
    await waitFor(() => {
      const inputs = nameInput()
      expect(inputs).toHaveLength(1)
      expect((inputs[0] as HTMLInputElement).value).toBe('resource_id')
    })
    expect(
      await waitFor(() => (valueInput()[0] as HTMLInputElement).value),
    ).toBe('rid-host-1')
  })

  it('从资源清单选择实例：无空行时才追加 resource_id 匹配行', async () => {
    renderDrawer()
    await waitFor(() => expect(nameInput()).toHaveLength(1))
    // 先把首行填成有效条件（alertname/HostDown）
    fireEvent.change(nameInput()[0], { target: { value: 'alertname' } })
    fireEvent.change(valueInput()[0], { target: { value: 'HostDown' } })
    const combo = screen.getByLabelText('实例名') as HTMLInputElement
    fireEvent.mouseDown(combo)
    fireEvent.click(await screen.findByText(/web-01（10.0.0.5）/))
    // 首行内容保持不变，新增第二行 resource_id = 资源 ID
    await waitFor(() => {
      const inputs = nameInput()
      expect(inputs).toHaveLength(2)
      expect((inputs[0] as HTMLInputElement).value).toBe('alertname')
      expect((inputs[1] as HTMLInputElement).value).toBe('resource_id')
    })
    expect(
      await waitFor(() => (valueInput()[1] as HTMLInputElement).value),
    ).toBe('rid-host-1')
  })

  it('文案去歧义：字段名为「告警标签」且说明区分告警标签与标签模板', async () => {
    renderDrawer()
    expect(await screen.findByText('告警标签')).toBeInTheDocument()
    expect(screen.getByText(/告警携带的标签/)).toBeInTheDocument()
    expect(screen.getByText(/不是「标签模板管理」里的模板标签/)).toBeInTheDocument()
    expect(screen.queryByText('标签名')).toBeNull()
  })

  it('生效方式动线：默认立即生效（无生效时间选择器），切到定时生效后出现', async () => {
    renderDrawer()
    // 默认「立即生效」：生效时间选择器不渲染（starts_at 由提交时刻决定）
    expect(screen.getByRole('radio', { name: '立即生效' })).toBeChecked()
    expect(screen.queryByLabelText('生效时间')).toBeNull()
    // 切到「定时生效」：生效时间选择器出现
    fireEvent.click(screen.getByRole('radio', { name: '定时生效' }))
    expect(await screen.findByLabelText('生效时间')).toBeInTheDocument()
  })

  it('定时生效未选择生效时间时提交被表单规则拦截', async () => {
    const onSubmit = renderDrawer()
    await waitFor(() => expect(nameInput()).toHaveLength(1))
    fireEvent.click(screen.getByRole('radio', { name: '定时生效' }))
    fireEvent.change(nameInput()[0], { target: { value: 'alertname' } })
    fireEvent.change(valueInput()[0], { target: { value: 'HostDown' } })
    fireEvent.change(screen.getByPlaceholderText(/灰度发布/), { target: { value: '计划内变更' } })
    fireEvent.click(screen.getByRole('button', { name: /提交创建/ }))
    // required 规则拦截，payload 不外发
    expect(await screen.findByText('请选择生效时间')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('时间校验格子化：失效时间早于生效时间提交时内联标红，不走顶部「创建失败」Alert', async () => {
    const onSubmit = renderDrawer()
    await waitFor(() => expect(nameInput()).toHaveLength(1))
    fireEvent.change(nameInput()[0], { target: { value: 'alertname' } })
    fireEvent.change(valueInput()[0], { target: { value: 'HostDown' } })
    fireEvent.change(screen.getByPlaceholderText(/灰度发布/), { target: { value: '计划内变更' } })
    // 切定时生效：生效时间填 2027（远晚于默认失效时间 now+24h → 失效时间校验必炸）
    fireEvent.click(screen.getByRole('radio', { name: '定时生效' }))
    const startInput = await screen.findByLabelText('生效时间')
    fireEvent.change(startInput, { target: { value: '2027-01-01 08:00:00' } })
    // rc-picker 输入合法文本后按 Enter 确认（fireEvent 无 pressEnter 快捷，手动派发回车）
    fireEvent.keyDown(startInput, { key: 'Enter', keyCode: 13, which: 13 })
    fireEvent.click(screen.getByRole('button', { name: /提交创建/ }))
    // 错误内联显示在失效时间字段下方（格子标红），顶部「创建失败」Alert 不出现
    expect(await screen.findByText('失效时间必须晚于生效时间')).toBeInTheDocument()
    expect(screen.queryByText('创建失败')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
