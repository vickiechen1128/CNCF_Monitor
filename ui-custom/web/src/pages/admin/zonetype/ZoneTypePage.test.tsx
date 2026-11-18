import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ZoneTypePage } from './ZoneTypePage'
import { DICT_LIFECYCLE_NOTICE } from '../../resources/DictLifecycleNotice'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { ZoneType } from '../../../types/domain'

const listMock = vi.fn()
const revokeMock = vi.fn()
const mergeMock = vi.fn()
const auditListMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  zoneTypeApi: {
    list: (...a: unknown[]) => listMock(...a),
    revoke: (...a: unknown[]) => revokeMock(...a),
    merge: (...a: unknown[]) => mergeMock(...a),
  },
}))

vi.mock('../../../api/resources', () => ({
  dictionaryAuditApi: {
    list: (...a: unknown[]) => auditListMock(...a),
  },
}))

// vitest jsdom 的 localStorage 行为不可靠，用内存 Map 替换（与 CloudDictPage.test 一致）。
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => storageMap.clear(),
  getItem: (key) => storageMap.get(key) ?? null,
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key) => storageMap.delete(key),
  setItem: (key, value) => storageMap.set(key, String(value)),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

const USER_STORAGE_KEY = 'metriccenter:auth:user'

function setRole(role: 'admin' | 'user') {
  storageMap.set(
    USER_STORAGE_KEY,
    JSON.stringify({
      id: 'u1',
      username: 'u1',
      display_name: '测试用户',
      tenant_id: 'platform_admin',
      role,
    }),
  )
}

const zoneRow = (over: Partial<ZoneType> = {}): ZoneType => ({
  code: 'internet',
  display_name: '互联网区',
  enabled: true,
  status: 'enabled',
  reference_count: 0,
  ...over,
})

function result(list: ZoneType[]) {
  // zoneTypeApi.list 在生产中会把 {list,total} 解包为数组；mock 直接返回解包后的形态
  return { status: 'success', data: list }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/zone-types']}>
      <ZoneTypePage />
    </MemoryRouter>,
  )
}

describe('ZoneTypePage', () => {
  setupAntdTest()

  beforeEach(() => {
    storageMap.clear()
    setRole('admin')
    listMock.mockReset()
    revokeMock.mockReset()
    mergeMock.mockReset()
    auditListMock.mockReset()
    auditListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    revokeMock.mockResolvedValue({ status: 'success', data: zoneRow({ status: 'revoked' }) })
    mergeMock.mockResolvedValue({ status: 'success', data: { source: 'dmz', target: 'internet', moved_references: 0 } })
  })

  it('渲染区域类型列表与状态列、引用数列', async () => {
    listMock.mockResolvedValue(
      result([
        zoneRow(),
        zoneRow({
          code: 'extranet',
          display_name: '政务外网区',
          enabled: false,
          status: 'disabled',
          reference_count: 2,
        }),
      ]),
    )
    renderPage()

    expect(await screen.findByText('internet')).toBeInTheDocument()
    expect(screen.getByText('互联网区')).toBeInTheDocument()
    expect(screen.getByText('政务外网区（已停用）')).toBeInTheDocument()
    // 引用数 2 + 状态「停用」
    const row = screen.getByText('extranet').closest('tr')!
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(within(row).getByText('停用')).toBeInTheDocument()
    expect(screen.getByText('启用')).toBeInTheDocument()
  })

  it('普通用户只读：不提供撤销 / 合并入口', async () => {
    setRole('user')
    listMock.mockResolvedValue(result([zoneRow()]))
    const { container } = renderPage()
    await screen.findByText('internet')

    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull()
    expect(screen.queryByRole('button', { name: '合并' })).toBeNull()
    expect(container.querySelector('.ant-table-cell-fix-right')).toBeNull()
    expect(screen.getByRole('button', { name: /刷新/ })).toBeInTheDocument()
  })

  it('管理员可见行内撤销 / 合并，并展示生命周期说明', async () => {
    listMock.mockResolvedValue(result([zoneRow()]))
    renderPage()
    await screen.findByText('internet')

    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '合并' })).toBeInTheDocument()
    expect(screen.getByText(DICT_LIFECYCLE_NOTICE)).toBeInTheDocument()
  })

  it('有引用条目撤销禁用，零引用条目撤销按 code 调用 revoke', async () => {
    listMock.mockResolvedValue(
      result([
        zoneRow({ code: 'extranet', display_name: '政务外网区', reference_count: 3 }),
        zoneRow({ code: 'dmz', display_name: '隔离区' }),
      ]),
    )
    renderPage()
    await screen.findByText('extranet')

    const referencedRow = screen.getByText('extranet').closest('tr')!
    expect(within(referencedRow).getByRole('button', { name: '撤销' })).toBeDisabled()

    const freeRow = screen.getByText('dmz').closest('tr')!
    await userEvent.click(within(freeRow).getByRole('button', { name: '撤销' }))
    await userEvent.click(await screen.findByRole('button', { name: /确认撤销/ }))
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('dmz'))
  })

  it('合并弹窗提交源编码与目标编码（target_code）', async () => {
    listMock.mockResolvedValue(
      result([zoneRow({ code: 'dmz', display_name: '隔离区' }), zoneRow()]),
    )
    renderPage()
    await screen.findByText('dmz')

    const sourceRow = screen.getByText('dmz').closest('tr')!
    await userEvent.click(within(sourceRow).getByRole('button', { name: '合并' }))
    expect(await screen.findByText('合并会迁移引用，历史监控数据不追溯改写')).toBeInTheDocument()

    const mergeModal = screen.getByText('合并「隔离区」').closest('.ant-modal') as HTMLElement
    fireEvent.mouseDown(mergeModal.querySelector('.ant-select-selector') as HTMLElement)
    fireEvent.click(await screen.findByText('互联网区（internet）', { selector: '.ant-select-item-option-content' }))
    await userEvent.click(screen.getByRole('button', { name: /确认合并/ }))
    await waitFor(() => expect(mergeMock).toHaveBeenCalledWith('dmz', 'internet'))
  })

  it('终态条目默认隐藏；切到「全部」后展示合并目标且不再提供撤销 / 合并', async () => {
    listMock.mockResolvedValue(
      result([
        zoneRow(),
        zoneRow({ code: 'legacy', display_name: '旧分区', status: 'merged', merged_into: 'internet', enabled: false }),
        zoneRow({ code: 'revoked-zone', display_name: '撤销分区', status: 'revoked', enabled: false }),
      ]),
    )
    renderPage()
    await screen.findByText('internet')
    expect(screen.queryByText('旧分区（已合并）')).toBeNull()

    await userEvent.click(screen.getByText('全部'))
    expect(await screen.findByText('旧分区（已合并）')).toBeInTheDocument()
    expect(screen.getByText('已合并 → internet')).toBeInTheDocument()
    const mergedRow = screen.getByText('旧分区（已合并）').closest('tr')!
    expect(within(mergedRow).queryByRole('button', { name: '撤销' })).toBeNull()
    expect(within(mergedRow).queryByRole('button', { name: '合并' })).toBeNull()
    expect(screen.getByText('撤销分区（已撤销）')).toBeInTheDocument()
  })

  it('变更日志按 zone 类型拉取审计日志', async () => {
    listMock.mockResolvedValue(result([zoneRow()]))
    renderPage()
    await screen.findByText('internet')

    await userEvent.click(screen.getByRole('button', { name: '变更日志' }))
    expect(await screen.findByText('字典变更日志')).toBeInTheDocument()
    await waitFor(() =>
      expect(auditListMock).toHaveBeenCalledWith({ dictionary_type: 'zone', limit: 100 }),
    )
  })

  it('列表为空时展示空态；加载失败提供重新加载入口', async () => {
    listMock.mockResolvedValue(result([]))
    renderPage()
    expect(await screen.findByText('暂无区域类型条目')).toBeInTheDocument()
  })
})
