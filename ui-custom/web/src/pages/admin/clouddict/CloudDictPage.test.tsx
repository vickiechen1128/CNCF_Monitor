import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CloudDictPage } from './CloudDictPage'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { CloudDict } from '../../../types/resource'

const listMock = vi.fn()

vi.mock('../../../api/resources', () => ({
  cloudDictApi: { list: (...a: unknown[]) => listMock(...a) },
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
    listMock.mockReset()
  })

  it('渲染云字典列表并完成云类型 / 云载体中文映射', async () => {
    listMock.mockResolvedValue(
      result([
        cloudRow(),
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

  it('为部署级只读字典：不提供任何新增 / 编辑 / 删除 / 启停入口', async () => {
    listMock.mockResolvedValue(result([cloudRow()]))
    const { container } = renderPage()
    await screen.findByText('PUB-TX')

    for (const name of ['新增', '登记', '编辑', '删除', '停用', '启用']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // 无操作列（fixed: 'right'）：表格右侧无固定操作单元格
    expect(container.querySelector('.ant-table-cell-fix-right')).toBeNull()
    // 仅保留只读刷新入口
    expect(screen.getByRole('button', { name: /刷新/ })).toBeInTheDocument()
  })

  it('展示「部署级只读字典，不在本页维护」说明 hint', async () => {
    listMock.mockResolvedValue(result([cloudRow()]))
    renderPage()

    expect(
      await screen.findByText('云字典为部署级只读字典，条目增删随版本发版 / 部署配置更新，不在本页维护。'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('云归属（cloud）是资源标签的唯一取值来源；云类型 / 云载体仅为条目描述属性，不作为筛选或标签维度。'),
    ).toBeInTheDocument()
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

  it('表格首列固定在左侧、无右侧固定列', async () => {
    listMock.mockResolvedValue(result([cloudRow()]))
    const { container } = renderPage()
    await screen.findByText('PUB-TX')

    // 首列（云编码）固定左侧；无操作列故不存在右侧固定细胞
    expect(container.querySelector('.ant-table-cell-fix-left')).not.toBeNull()
    expect(container.querySelector('.ant-table-cell-fix-right')).toBeNull()
  })
})