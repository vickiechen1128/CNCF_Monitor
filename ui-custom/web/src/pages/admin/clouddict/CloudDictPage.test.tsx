import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { CloudDictPage } from './CloudDictPage'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { CloudDict } from '../../../types/resource'

const listMock = vi.fn()
const createMock = vi.fn()
const disableMock = vi.fn()

vi.mock('../../../api/resources', () => ({
  cloudDictApi: {
    list: (...a: unknown[]) => listMock(...a),
    create: (...a: unknown[]) => createMock(...a),
    disable: (...a: unknown[]) => disableMock(...a),
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

    // 启用状态列
    expect(screen.getAllByText('已启用').length).toBe(2)
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
        }),
      ]),
    )
    renderPage()

    expect(await screen.findByText('PRI-HW')).toBeInTheDocument()
    // 已知类型命中映射，未知载体回退原码
    expect(screen.getByText('私有云')).toBeInTheDocument()
    expect(screen.getByText('HW')).toBeInTheDocument()
    // 停用条目展示「已停用」
    expect(screen.getByText('已停用')).toBeInTheDocument()
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
      screen.getByText('云字典为只读视图：新增与停用由平台管理员操作。'),
    ).toBeInTheDocument()
  })

  it('管理员可见「新增云」与行内「停用」入口，并展示只增维护说明', async () => {
    listMock.mockResolvedValue(result([cloudRow()]))
    renderPage()

    expect(await screen.findByText('PUB-TX')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /新增云/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停用' })).toBeInTheDocument()
    expect(
      screen.getByText('云字典由管理员维护：仅支持新增与停用，编码创建后不可修改、条目不可删除。'),
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

    // AntD 为两字中文按钮插入空格：新增 → 新 增；页面顶部也有「新增云」，
    // 因此把查找范围限定在新增弹窗内。
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /新\s*增/ }))

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
      .mockResolvedValue(result([cloudRow({ enabled: false })]))
    disableMock.mockResolvedValue({ status: 'success', data: cloudRow({ enabled: false }) })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('PUB-TX')

    await user.click(screen.getByRole('button', { name: '停用' }))
    expect(await screen.findByText('停用后该云编码不可再用于新建网域')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '确认停用' }))

    await waitFor(() => expect(disableMock).toHaveBeenCalledWith('PUB-TX'))
    expect(await screen.findByText('已停用')).toBeInTheDocument()
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
})
