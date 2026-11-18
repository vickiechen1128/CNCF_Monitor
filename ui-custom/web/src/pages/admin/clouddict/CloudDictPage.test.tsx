import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CloudDictPage } from './CloudDictPage'
import { DICT_LIFECYCLE_NOTICE } from '../../resources/DictLifecycleNotice'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { CloudDict } from '../../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const disableMock = vi.fn()
const revokeMock = vi.fn()
const mergeMock = vi.fn()
const auditListMock = vi.fn()

vi.mock('../../../api/resources', () => ({
  cloudDictApi: {
    list: (...a: unknown[]) => listMock(...a),
    create: (...a: unknown[]) => createMock(...a),
    disable: (...a: unknown[]) => disableMock(...a),
    revoke: (...a: unknown[]) => revokeMock(...a),
    merge: (...a: unknown[]) => mergeMock(...a),
  },
  dictionaryAuditApi: {
    list: (...a: unknown[]) => auditListMock(...a),
  },
}))

// vitest jsdom 的 window.localStorage 行为不可靠（MainLayout 会读写侧栏折叠偏好），
// 用内存 Map 替换，避免 clear / getItem 非函数导致用例间互相污染。
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

function setRole(role: 'admin' | 'user' | null) {
  if (!role) {
    storageMap.delete(USER_STORAGE_KEY)
    return
  }
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

const cloudRow = (over: Partial<CloudDict> = {}): CloudDict => ({
  cloud_code: 'PUB-TX',
  cloud_name: '腾讯云',
  cloud_type: 'PUB',
  carrier: 'TX',
  enabled: true,
  status: 'enabled',
  reference_count: 0,
  ...over,
})

function result(list: CloudDict[]) {
  return { status: 'success', data: { list, total: list.length } }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/cloud-dict']}>
      <CloudDictPage />
    </MemoryRouter>,
  )
}

describe('CloudDictPage', () => {
  setupAntdTest()

  beforeEach(() => {
    storageMap.clear()
    setRole('admin')
    listMock.mockReset()
    createMock.mockReset()
    disableMock.mockReset()
    revokeMock.mockReset()
    mergeMock.mockReset()
    auditListMock.mockReset()
    auditListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    revokeMock.mockResolvedValue({
      status: 'success',
      data: cloudRow({ enabled: false, status: 'revoked' }),
    })
    mergeMock.mockResolvedValue({
      status: 'success',
      data: { source: 'PUB-TX', target: 'PUB-ALI', moved_references: 0 },
    })
  })

  it('渲染云字典列表并完成云类型 / 云载体中文映射', async () => {
    listMock.mockResolvedValue(
      result([
        cloudRow({ description: '预置条目' }),
        cloudRow({
          cloud_code: 'GM-CU',
          cloud_name: '政务云（联通）',
          cloud_type: 'GM',
          carrier: 'CU',
          enabled: true,
        }),
      ]),
    )
    renderPage()

    // 云编码 / 云名称两列直接展示原值
    expect(await screen.findByText('PUB-TX')).toBeInTheDocument()
    expect(screen.getByText('腾讯云')).toBeInTheDocument()
    expect(screen.getByText('GM-CU')).toBeInTheDocument()
    expect(screen.getByText('政务云（联通）')).toBeInTheDocument()

    // cloud_type 中文映射：PUB→公有云、GM→政务云
    expect(screen.getByText('公有云')).toBeInTheDocument()
    expect(screen.getByText('政务云')).toBeInTheDocument()
    // carrier 中文映射：TX→腾讯、CU→联通
    expect(screen.getByText('腾讯')).toBeInTheDocument()
    expect(screen.getByText('联通')).toBeInTheDocument()
    // 描述列（D37 读视图补充字段），空值回退 —
    expect(screen.getByText('预置条目')).toBeInTheDocument()

    // 四态状态列（共享 DictionaryStatusBadge）
    expect(screen.getAllByText('启用').length).toBe(2)
  })

  it('未收录的云类型 / 云载体编码回退展示原码（不隐藏未知值）', async () => {
    listMock.mockResolvedValue(
      result([
        cloudRow({
          cloud_code: 'PRI-HW',
          cloud_name: '私有云（华为）',
          cloud_type: 'PRI',
          carrier: 'HW',
          enabled: false,
          status: 'disabled',
        }),
      ]),
    )
    renderPage()

    expect(await screen.findByText('PRI-HW')).toBeInTheDocument()
    // 已知类型命中映射，未知载体回退原码
    expect(screen.getByText('私有云')).toBeInTheDocument()
    expect(screen.getByText('HW')).toBeInTheDocument()
    // 停用条目：名称加「（已停用）」后缀，状态列展示「停用」
    expect(screen.getByText('私有云（华为）（已停用）')).toBeInTheDocument()
    expect(screen.getByText('停用')).toBeInTheDocument()
  })

  it('普通用户只读：不提供新增 / 编辑 / 删除 / 停用入口', async () => {
    setRole('user')
    listMock.mockResolvedValue(result([cloudRow()]))
    const { container } = renderPage()
    await screen.findByText('PUB-TX')

    for (const name of ['新增云', '编辑', '删除', '停用']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // 无操作列（fixed: 'right'）：表格右侧无固定操作单元格
    expect(container.querySelector('.ant-table-cell-fix-right')).toBeNull()
    // 仅保留只读刷新入口
    expect(screen.getByRole('button', { name: /刷新/ })).toBeInTheDocument()
    expect(
      screen.getByText('云字典为只读视图：新增、停用、撤销与合并由平台管理员操作。'),
    ).toBeInTheDocument()
  })

  it('管理员可见「新增云」与行内生命周期入口，并展示维护说明', async () => {
    listMock.mockResolvedValue(result([cloudRow()]))
    renderPage()

    expect(await screen.findByText('PUB-TX')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新增云/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '合并' })).toBeInTheDocument()
    expect(
      screen.getByText('云字典由管理员维护：支持新增、停用、零引用撤销与错建合并；编码创建后不可修改、条目不可删除。'),
    ).toBeInTheDocument()
  })

  it('新增云：复合码由云类型 + 云载体派生并提交', async () => {
    listMock
      .mockResolvedValueOnce(result([cloudRow()]))
      .mockResolvedValue(
        result([
          cloudRow(),
          cloudRow({
            cloud_code: 'IND-CM',
            cloud_name: '行业云（移动）',
            cloud_type: 'IND',
            carrier: 'CM',
            description: '新增条目',
          }),
        ]),
      )
    createMock.mockResolvedValue({
      status: 'success',
      data: cloudRow({
        cloud_code: 'IND-CM',
        cloud_name: '行业云（移动）',
        cloud_type: 'IND',
        carrier: 'CM',
        description: '新增条目',
      }),
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('PUB-TX')

    await user.click(screen.getByRole('button', { name: /新增云/ }))
    await user.click(screen.getByLabelText('云类型'))
    await user.click(await screen.findByText('行业云'))
    await user.click(screen.getByLabelText('云载体'))
    await user.click(await screen.findByText('移动'))
    await user.type(screen.getByLabelText('云名称'), '行业云（移动）')
    await user.type(screen.getByLabelText('描述'), '新增条目')

    // 复合码预览由两个 Select 派生
    expect(screen.getByDisplayValue('IND-CM')).toBeInTheDocument()

    // AntD 为两字中文按钮插入空格：新增 → 新 增；变更日志 Drawer 也带 dialog role，
    // 因此把查找范围限定在新增 Modal 内。
    await user.click(
      within(document.querySelector('.ant-modal') as HTMLElement).getByRole('button', { name: /新\s*增/ }),
    )

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        cloud_code: 'IND-CM',
        cloud_name: '行业云（移动）',
        cloud_type: 'IND',
        carrier: 'CM',
        description: '新增条目',
      }),
    )
    expect(await screen.findByText('IND-CM')).toBeInTheDocument()
  })

  it('停用云：二次确认后调用 disable 并刷新列表', async () => {
    listMock
      .mockResolvedValueOnce(result([cloudRow()]))
      .mockResolvedValue(result([cloudRow({ enabled: false, status: 'disabled' })]))
    disableMock.mockResolvedValue({
      status: 'success',
      data: cloudRow({ enabled: false, status: 'disabled' }),
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('PUB-TX')

    await user.click(screen.getByRole('button', { name: '停用' }))
    expect(await screen.findByText('停用后该云编码不可再用于新建网域')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认停用' }))

    await waitFor(() => expect(disableMock).toHaveBeenCalledWith('PUB-TX'))
    expect(await screen.findByText('停用')).toBeInTheDocument()
  })

  it('列表为空时展示空态', async () => {
    listMock.mockResolvedValue(result([]))
    renderPage()

    expect(await screen.findByText('暂无云字典条目')).toBeInTheDocument()
  })

  it('加载失败展示错误 Alert，点击「重新加载」触发重新请求', async () => {
    listMock.mockRejectedValueOnce(new Error('boom'))
    renderPage()

    expect(await screen.findByText('云字典加载失败，请稍后重试')).toBeInTheDocument()
    // 失败后提供重新加载入口，点击后再次拉取
    listMock.mockResolvedValue(result([cloudRow()]))
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    expect(await screen.findByText('PUB-TX')).toBeInTheDocument()
  })

  it('表格首列固定在左侧；管理员额外展示右侧固定操作列', async () => {
    listMock.mockResolvedValue(result([cloudRow()]))
    const { container } = renderPage()
    await screen.findByText('PUB-TX')

    expect(container.querySelector('.ant-table-cell-fix-left')).not.toBeNull()
    expect(container.querySelector('.ant-table-cell-fix-right')).not.toBeNull()
  })

  it('展示生命周期说明；展示引用数，有引用条目撤销禁用、零引用条目可撤销', async () => {
    listMock.mockResolvedValue(
      result([
        cloudRow({ cloud_code: 'PUB-TX', reference_count: 3 }),
        cloudRow({
          cloud_code: 'GM-CU',
          cloud_name: '政务云（联通）',
          cloud_type: 'GM',
          carrier: 'CU',
          reference_count: 0,
        }),
      ]),
    )
    renderPage()
    await screen.findByText('PUB-TX')

    expect(screen.getByText(DICT_LIFECYCLE_NOTICE)).toBeInTheDocument()
    const referencedRow = screen.getByText('PUB-TX').closest('tr')!
    expect(within(referencedRow).getByText('3')).toBeInTheDocument()
    expect(within(referencedRow).getByRole('button', { name: '撤销' })).toBeDisabled()

    const freeRow = screen.getByText('GM-CU').closest('tr')!
    await userEvent.click(within(freeRow).getByRole('button', { name: '撤销' }))
    await userEvent.click(await screen.findByRole('button', { name: /确认撤销/ }))
    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('GM-CU'))
  })

  it('合并弹窗提交源云编码与目标云编码（target_code）', async () => {
    listMock.mockResolvedValue(
      result([
        cloudRow(),
        cloudRow({ cloud_code: 'PUB-ALI', cloud_name: '阿里云', carrier: 'ALI' }),
      ]),
    )
    renderPage()
    await screen.findByText('PUB-TX')

    const sourceRow = screen.getByText('PUB-TX').closest('tr')!
    await userEvent.click(within(sourceRow).getByRole('button', { name: '合并' }))
    expect(await screen.findByText('合并会迁移引用，历史监控数据不追溯改写')).toBeInTheDocument()

    const mergeModal = screen.getByText('合并「腾讯云」').closest('.ant-modal') as HTMLElement
    fireEvent.mouseDown(mergeModal.querySelector('.ant-select-selector') as HTMLElement)
    fireEvent.click(await screen.findByText('阿里云（PUB-ALI）', { selector: '.ant-select-item-option-content' }))
    await userEvent.click(screen.getByRole('button', { name: /确认合并/ }))
    await waitFor(() => expect(mergeMock).toHaveBeenCalledWith('PUB-TX', 'PUB-ALI'))
  })

  it('终态条目默认隐藏；切到「全部」后展示合并目标且不再提供撤销 / 合并', async () => {
    listMock.mockResolvedValue(
      result([
        cloudRow(),
        cloudRow({ cloud_code: 'GM-CU', cloud_name: '政务云（联通）', status: 'merged', merged_into: 'PUB-TX', enabled: false }),
        cloudRow({ cloud_code: 'PRI-HW', cloud_name: '私有云（华为）', status: 'revoked', enabled: false }),
      ]),
    )
    renderPage()
    await screen.findByText('PUB-TX')
    expect(screen.queryByText('政务云（联通）（已合并）')).toBeNull()
    expect(screen.queryByText('私有云（华为）（已撤销）')).toBeNull()

    await userEvent.click(screen.getByText('全部'))
    expect(await screen.findByText('政务云（联通）（已合并）')).toBeInTheDocument()
    expect(screen.getByText('已合并 → PUB-TX')).toBeInTheDocument()
    const mergedRow = screen.getByText('政务云（联通）（已合并）').closest('tr')!
    expect(within(mergedRow).queryByRole('button', { name: '撤销' })).toBeNull()
    expect(within(mergedRow).queryByRole('button', { name: '合并' })).toBeNull()
    expect(screen.getByText('私有云（华为）（已撤销）')).toBeInTheDocument()
  })

  it('变更日志按 cloud 类型拉取审计日志', async () => {
    listMock.mockResolvedValue(result([cloudRow()]))
    renderPage()
    await screen.findByText('PUB-TX')

    await userEvent.click(screen.getByRole('button', { name: '变更日志' }))
    expect(await screen.findByText('字典变更日志')).toBeInTheDocument()
    await waitFor(() =>
      expect(auditListMock).toHaveBeenCalledWith({ dictionary_type: 'cloud', limit: 100 }),
    )
  })
})
