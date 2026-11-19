import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  applyMonitorTypeList,
  currentMonitorTypeCatalog,
  refreshMonitorTypeCatalog,
  resetMonitorTypeCatalogForTest,
} from './useMonitorTypeCatalog'

const listMock = vi.fn()

vi.mock('../../api/monitorTypes', () => ({
  monitorTypeApi: {
    list: (...args: unknown[]) => listMock(...args),
  },
}))

function registryType(code: string, name: string, sortOrder = 1) {
  return {
    code,
    name,
    resource_category: 'database' as const,
    enabled: true,
    is_builtin: false,
    sort_order: sortOrder,
  }
}

/**
 * 筛选下拉「打开时刷新」：监控对象类型可手动新增，
 * 目录必须能从注册表重新拉取，且刷新失败不能把可用目录降级成内置回退。
 */
describe('refreshMonitorTypeCatalog', () => {
  beforeEach(() => {
    listMock.mockReset()
    resetMonitorTypeCatalogForTest()
  })

  it('pulls newly added monitor types without resetting the snapshot', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [registryType('mysql', 'MySQL'), registryType('dameng', '达梦数据库', 2)], total: 2 },
    })

    refreshMonitorTypeCatalog()

    await vi.waitFor(() => {
      expect(currentMonitorTypeCatalog().loaded).toBe(true)
      expect(currentMonitorTypeCatalog().nameOf('dameng')).toBe('达梦数据库')
    })
    expect(currentMonitorTypeCatalog().optionsForCategory('database')).toEqual(['mysql', 'dameng'])
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the loaded catalog when the refresh request fails', async () => {
    applyMonitorTypeList([registryType('mysql', 'MySQL')])
    listMock.mockRejectedValue(new Error('network down'))

    refreshMonitorTypeCatalog()

    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))
    const catalog = currentMonitorTypeCatalog()
    expect(catalog.loaded).toBe(true)
    expect(catalog.nameOf('mysql')).toBe('MySQL')
    expect(catalog.optionsForCategory('database')).toEqual(['mysql'])
  })
})
