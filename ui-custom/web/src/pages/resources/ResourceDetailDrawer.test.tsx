import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest, mockAntdModal, type MockedModal } from '@/test/antdTestUtils'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ResourceDetailDrawer } from './ResourceDetailDrawer'
import type { NetworkDomain } from '../../types/domain'
import type { BusinessDomain, ResourceLabelItem } from '../../types/resource'
import type { LabelTemplateListItem } from '../../types/label'
import type { ResourceListItem } from './useResources'

const labelsMock = vi.fn()
const createLabelMock = vi.fn()
const updateLabelMock = vi.fn()
const removeLabelMock = vi.fn()
const listTemplateMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: {
    labels: (...args: unknown[]) => labelsMock(...args),
    createLabel: (...args: unknown[]) => createLabelMock(...args),
    updateLabel: (...args: unknown[]) => updateLabelMock(...args),
    removeLabel: (...args: unknown[]) => removeLabelMock(...args),
  },
}))

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    list: (...args: unknown[]) => listTemplateMock(...args),
  },
}))

// handleWriteError 通过 isApiError(err) && err.code === 403 判定静态资源只读提示，测试侧用 code 判别
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    isApiError: (e: unknown) =>
      !!e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 403,
  }
})

const cancelMock = vi.fn()

const networkDomains: NetworkDomain[] = [
  {
    id: 'mc-a',
    name: '政务网A区',
    description: '',
    domain_type: 'edge',
    zone_type: 'internet',
    tenant_id: 'platform_admin',
    authorized_tenant_ids: ['platform_admin'],
    cmdb_cloud_area_id: '',
    cmdb_cloud_area_path: '',
    channel: 'local',
    is_monitored: false,
    status: 'enabled',
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
  },
]

const businessDomains: BusinessDomain[] = [
  { code: 'infra', name: '公共基础设施', description: '', enabled: true },
  { code: 'legacy', name: '停用业务', description: '', enabled: false },
]

/** application 资源行（可打 user 标签） */
function appRecord(): ResourceListItem {
  return {
    resource_id: 'mc-app-1',
    resource_category: 'application',
    network_domain_id: 'mc-a',
    biz_code: 'infra',
    app_name: 'order',
    env: 'prod',
    cluster: 'c1',
    owner: 'chenrt',
    status: 'online',
    source_type: 'manual',
    service_name: 'order-service',
    endpoint: '/api/v1/order',
  }
}

/** host 静态资源行（只读标签） */
function hostRecord(): ResourceListItem {
  return {
    resource_id: 'mc-res-1',
    resource_category: 'host',
    network_domain_id: 'mc-a',
    biz_code: 'infra',
    app_name: 'order',
    env: 'prod',
    cluster: 'c1',
    owner: 'chenrt',
    status: 'online',
    source_type: 'manual',
    instance_name: 'prod-web-01',
    instance_ip: '10.0.1.11',
    os_type: 'Linux',
  }
}

/** application 默认标签模板（含 app 映射，供冲突提示用例） */
function defaultTemplate(extra: Partial<LabelTemplateListItem> = {}): LabelTemplateListItem {
  return {
    id: 5,
    name: '应用默认模板',
    resource_category: 'application',
    is_default: true,
    mappings: [{ source_field: 'service_name', source_type: 'resource_field', target_label: 'app', enabled: true }],
    instance_count: 3,
    created_at: '2026-08-21T00:00:00Z',
    updated_at: '2026-08-21T00:00:00Z',
    ...extra,
  }
}

function templateListResponse(templates: LabelTemplateListItem[]) {
  return { status: 'success', data: { list: templates, total: templates.length, page: 1, page_size: 10 } }
}

function labelsResponse(items: ResourceLabelItem[]) {
  return { status: 'success', data: { items, total: items.length } }
}

/** 标签项构造器（默认 user 来源） */
function labelItem(partial: Partial<ResourceLabelItem> = {}): ResourceLabelItem {
  return { id: 1, key: 'team', value: 'sre', source: 'user', ...partial }
}

/** 渲染抽屉：MemoryRouter + Routes 供「前往标签模板」跳转断言 */
function renderDrawer(over: Partial<{ open: boolean; record: ResourceListItem | null }> = {}) {
  const open = over.open ?? true
  const record = over.record ?? appRecord()
  return render(
    <MemoryRouter initialEntries={['/resources']}>
      <Routes>
        <Route
          path="/resources"
          element={
            <ResourceDetailDrawer
              open={open}
              record={record}
              networkDomains={networkDomains}
              businessDomains={businessDomains}
              onCancel={cancelMock}
            />
          }
        />
        <Route path="/label-templates" element={<div>label-templates-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ResourceDetailDrawer', () => {
  setupAntdTest()

  let modal: MockedModal

  beforeEach(() => {
    // antd 静态 Modal 在 jsdom 下不稳定，统一用 antdTestUtils 捕获配置断言（§2.3）
    modal = mockAntdModal()
    labelsMock.mockReset()
    createLabelMock.mockReset()
    updateLabelMock.mockReset()
    removeLabelMock.mockReset()
    listTemplateMock.mockReset()
    cancelMock.mockReset()
    labelsMock.mockResolvedValue(labelsResponse([]))
    listTemplateMock.mockResolvedValue(templateListResponse([]))
  })

  it('renders base info with domain / business / status / source', async () => {
    renderDrawer({ record: hostRecord() })
    // 资源 ID / 网域 / 业务 biz_name / 运行状态 / 来源 / 资源类型（§5.4 网域置顶）
    expect(screen.getByText('mc-res-1')).toBeInTheDocument()
    expect(screen.getByText('政务网A区')).toBeInTheDocument()
    expect(screen.getByText('公共基础设施')).toBeInTheDocument()
    expect(screen.getByText('在线')).toBeInTheDocument()
    expect(screen.getByText('手动录入')).toBeInTheDocument()
    expect(screen.getByText('主机')).toBeInTheDocument()
    // 类型字段（host 差异化字段）
    expect(screen.getByText('prod-web-01')).toBeInTheDocument()
    expect(screen.getByText('10.0.1.11')).toBeInTheDocument()
  })

  it('marks disabled business with （已停用）', async () => {
    const rec = hostRecord()
    rec.biz_code = 'legacy'
    renderDrawer({ record: rec })
    expect(screen.getByText('停用业务（已停用）')).toBeInTheDocument()
  })

  it('shows applicable default template with name + id and navigates on click', async () => {
    listTemplateMock.mockResolvedValue(templateListResponse([defaultTemplate()]))
    renderDrawer({ record: appRecord() })
    const templateLink = await screen.findByText('应用默认模板（5）')
    expect(templateLink).toBeInTheDocument()
    fireEvent.click(templateLink)
    expect(await screen.findByText('label-templates-page')).toBeInTheDocument()
  })

  it('shows all labels with source annotations (system template / user manual / cmdb placeholder)', async () => {
    listTemplateMock.mockResolvedValue(templateListResponse([defaultTemplate()]))
    labelsMock.mockResolvedValue(
      labelsResponse([
        labelItem({ id: 1, key: 'app', value: 'order', source: 'system', source_map: 'service_name→app' }),
        labelItem({ id: 2, key: 'team', value: 'sre', source: 'user' }),
        labelItem({ id: 3, key: 'biz', value: '公共基础设施', source: 'cmdb' }),
      ]),
    )
    renderDrawer({ record: appRecord() })
    // system：来自模板 · source_map（§5.3 联动呈现），并展示「系统」来源
    expect(await screen.findByText('来自 应用默认模板 · service_name→app')).toBeInTheDocument()
    expect(screen.getByText('系统')).toBeInTheDocument()
    // user：手动添加
    expect(screen.getByText('手动添加')).toBeInTheDocument()
    expect(screen.getByText('用户')).toBeInTheDocument()
    // cmdb：v0.4+ 预留占位（§3.3 统一口径）
    expect(screen.getByText('CMDB · v0.4+ 预留')).toBeInTheDocument()
  })

  it('shows editable label entry for application resource', async () => {
    renderDrawer({ record: appRecord() })
    // 初始为加载骨架屏，等待标签加载完成后渲染编辑入口（§3.3），故用 findBy*
    expect(await screen.findByText('自定义标签（非必须）')).toBeInTheDocument()
    expect(await screen.findByText(/大多数场景下，标签模板已自动生成所需标签/)).toBeInTheDocument()
    expect(await screen.findByPlaceholderText('标签 Key，如 team')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('标签值')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /添\s*加/ })).toBeInTheDocument()
  })

  it('shows read-only label entry for static resource (host)', async () => {
    renderDrawer({ record: hostRecord() })
    expect(await screen.findByText('自定义标签（静态资源只读）')).toBeInTheDocument()
    expect(await screen.findByText(/静态资源标签由 CMDB/)).toBeInTheDocument()
    // 不提供打标入口
    expect(screen.queryByPlaceholderText('标签 Key，如 team')).toBeNull()
    expect(screen.queryByRole('button', { name: /添\s*加/ })).toBeNull()
  })

  it('allows editing and deleting user labels for application', async () => {
    labelsMock.mockResolvedValue(labelsResponse([labelItem({ id: 2 })]))
    renderDrawer({ record: appRecord() })
    expect(await screen.findByRole('button', { name: /编\s*辑/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /删\s*除/ })).toBeInTheDocument()
    // system / cmdb 标签在 application 下仍只读（带锁标识）
    labelsMock.mockResolvedValue(labelsResponse([labelItem({ id: 2, source: 'system', source_map: 'service_name→app' })]))
  })

  it('renders user labels read-only for static resource', async () => {
    labelsMock.mockResolvedValue(labelsResponse([labelItem({ id: 2 })]))
    renderDrawer({ record: hostRecord() })
    expect(await screen.findByText('team')).toBeInTheDocument()
    expect(screen.getByText('手动添加')).toBeInTheDocument()
    // 静态资源 user 标签只读：无编辑/删除按钮
    expect(screen.queryByRole('button', { name: /编\s*辑/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删\s*除/ })).toBeNull()
  })

  it('adds user label via createLabel for application', async () => {
    createLabelMock.mockResolvedValue({ status: 'success', data: labelItem({ id: 9 }) })
    renderDrawer({ record: appRecord() })
    const keyInput = await screen.findByPlaceholderText('标签 Key，如 team')
    fireEvent.change(keyInput, { target: { value: 'team' } })
    fireEvent.change(screen.getByPlaceholderText('标签值'), { target: { value: 'sre' } })
    fireEvent.click(screen.getByRole('button', { name: /添\s*加/ }))
    await waitFor(() => expect(createLabelMock).toHaveBeenCalledWith('mc-app-1', { key: 'team', value: 'sre' }))
  })

  it('shows 403 static-resource alert when write rejected with 403', async () => {
    createLabelMock.mockRejectedValue(Object.assign(new Error('禁止写入'), { code: 403 }))
    renderDrawer({ record: appRecord() })
    const keyInput = await screen.findByPlaceholderText('标签 Key，如 team')
    fireEvent.change(keyInput, { target: { value: 'team' } })
    fireEvent.change(screen.getByPlaceholderText('标签值'), { target: { value: 'sre' } })
    fireEvent.click(screen.getByRole('button', { name: /添\s*加/ }))
    // §11.1 静态资源只读提示
    expect(
      await screen.findByText('该资源为静态资源，标签由 CMDB / Excel 带入，不支持手动打标'),
    ).toBeInTheDocument()
  })

  it('warns when adding a key conflicting with template mapping', async () => {
    listTemplateMock.mockResolvedValue(templateListResponse([defaultTemplate()]))
    renderDrawer({ record: appRecord() })
    // 等待适用模板加载完成（冲突判定依赖 template 状态）
    await screen.findByText('应用默认模板（5）')
    const keyInput = await screen.findByPlaceholderText('标签 Key，如 team')
    fireEvent.change(keyInput, { target: { value: 'app' } })
    fireEvent.change(screen.getByPlaceholderText('标签值'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /添\s*加/ }))
    // 冲突判定命中 → 弹确认（Modal.confirm 被调用），不直接 createLabel（§3.3/§5.3）
    await waitFor(() => expect(modal.confirm).toHaveBeenCalled())
    expect(modal.confirm.mock.calls[0][0].title).toBe('该标签由标签模板生成')
    expect(createLabelMock).not.toHaveBeenCalled()
  })

  it('proceeds with add when confirming conflict', async () => {
    listTemplateMock.mockResolvedValue(templateListResponse([defaultTemplate()]))
    createLabelMock.mockResolvedValue({ status: 'success', data: labelItem({ id: 10, key: 'app' }) })
    renderDrawer({ record: appRecord() })
    await screen.findByText('应用默认模板（5）')
    const keyInput = await screen.findByPlaceholderText('标签 Key，如 team')
    fireEvent.change(keyInput, { target: { value: 'app' } })
    fireEvent.change(screen.getByPlaceholderText('标签值'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /添\s*加/ }))
    await waitFor(() => expect(modal.confirm).toHaveBeenCalled())
    // 模拟弹窗「仍要继续」→ 放行实例级操作
    modal.confirm.mock.calls[0][0].onOk?.()
    await waitFor(() => expect(createLabelMock).toHaveBeenCalledWith('mc-app-1', { key: 'app', value: 'x' }))
  })

  it('navigates to label templates page from conflict dialog', async () => {
    listTemplateMock.mockResolvedValue(templateListResponse([defaultTemplate()]))
    renderDrawer({ record: appRecord() })
    await screen.findByText('应用默认模板（5）')
    const keyInput = await screen.findByPlaceholderText('标签 Key，如 team')
    fireEvent.change(keyInput, { target: { value: 'app' } })
    fireEvent.change(screen.getByPlaceholderText('标签值'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /添\s*加/ }))
    await waitFor(() => expect(modal.confirm).toHaveBeenCalled())
    // 模拟弹窗「前往标签模板」→ 跳转模板页
    modal.confirm.mock.calls[0][0].onCancel?.()
    expect(await screen.findByText('label-templates-page')).toBeInTheDocument()
  })

  it('warns when editing a user label whose key conflicts with template mapping', async () => {
    listTemplateMock.mockResolvedValue(templateListResponse([defaultTemplate()]))
    labelsMock.mockResolvedValue(labelsResponse([labelItem({ id: 2, key: 'app', value: 'old' })]))
    renderDrawer({ record: appRecord() })
    await screen.findByText('应用默认模板（5）')
    fireEvent.click(await screen.findByRole('button', { name: /编\s*辑/ }))
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    // 编辑 key 命中模板映射 → 弹确认，不直接 updateLabel（§3.3/§5.3）
    await waitFor(() => expect(modal.confirm).toHaveBeenCalled())
    expect(modal.confirm.mock.calls[0][0].title).toBe('该标签由标签模板生成')
    expect(updateLabelMock).not.toHaveBeenCalled()
  })

  it('deletes a user label via removeLabel', async () => {
    labelsMock.mockResolvedValue(labelsResponse([labelItem({ id: 2 })]))
    removeLabelMock.mockResolvedValue({ status: 'success', data: { label_id: 2 } })
    renderDrawer({ record: appRecord() })
    fireEvent.click(await screen.findByRole('button', { name: /删\s*除/ }))
    await waitFor(() => expect(removeLabelMock).toHaveBeenCalledWith('mc-app-1', 2))
    await waitFor(() => expect(screen.queryByText('team')).toBeNull())
  })

  it('shows label load error alert and reloads', async () => {
    labelsMock.mockRejectedValueOnce(new Error('network error'))
    labelsMock.mockResolvedValueOnce(labelsResponse([labelItem({ id: 2 })]))
    renderDrawer({ record: appRecord() })
    expect(await screen.findByText('标签数据加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(await screen.findByText('team')).toBeInTheDocument()
  })
})
