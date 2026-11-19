import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyMonitorTypeList,
  currentMonitorTypeCatalog,
  ensureMonitorTypeCatalog,
  resetMonitorTypeCatalogForTest,
} from './useMonitorTypeCatalog'

/**
 * 监控对象类型目录（SRS Module_01 v1.3 §5.6）。
 *
 * 回归点：类型已配置化，前端下拉必须跟随注册表——否则「新增类型后采集器管理 /
 * 采集 Job 选不到」的问题会再次出现。
 */
describe('monitor type catalog', () => {
  beforeEach(() => {
    resetMonitorTypeCatalogForTest()
  })

  it('falls back to built-in types before the registry loads', () => {
    const catalog = currentMonitorTypeCatalog()
    expect(catalog.loaded).toBe(false)
    // 回退数据同样使用新编码（npu 已更名为 host_npu）
    expect(catalog.optionsForCategory('host')).toContain('host_npu')
    expect(catalog.nameOf('host_npu')).toBe('NPU 主机')
  })

  it('exposes every enabled type pushed by the management page', () => {
    applyMonitorTypeList([
      {
        code: 'host_dpu',
        name: 'DPU 主机',
        resource_category: 'host',
        enabled: true,
        is_builtin: false,
        sort_order: 40,
      },
      {
        code: 'host_linux',
        name: 'Linux 主机',
        resource_category: 'host',
        enabled: true,
        is_builtin: true,
        sort_order: 10,
      },
    ])

    const catalog = currentMonitorTypeCatalog()
    expect(catalog.loaded).toBe(true)
    expect(catalog.optionsForCategory('host')).toEqual(['host_linux', 'host_dpu'])
    expect(catalog.nameOf('host_dpu')).toBe('DPU 主机')
    expect(catalog.categoryFor('host_dpu')).toBe('host')
    expect(catalog.allCodes()).toContain('host_dpu')
  })

  it('hides disabled types from pickers but keeps their names resolvable', () => {
    applyMonitorTypeList([
      {
        code: 'host_npu',
        name: 'NPU 主机',
        resource_category: 'host',
        enabled: false,
        is_builtin: true,
        sort_order: 30,
      },
    ])

    const catalog = currentMonitorTypeCatalog()
    expect(catalog.optionsForCategory('host')).not.toContain('host_npu')
    // 存量 Job 仍要能显示已停用类型的名字
    expect(catalog.nameOf('host_npu')).toBe('NPU 主机')
  })

  it('keeps an unknown code readable instead of rendering undefined', () => {
    ensureMonitorTypeCatalog()
    expect(currentMonitorTypeCatalog().nameOf('some_future_type')).toBe('some_future_type')
    expect(currentMonitorTypeCatalog().nameOf(undefined)).toBe('-')
  })
})
