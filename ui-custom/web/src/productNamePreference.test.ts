/**
 * 产品名称偏好测试（用户 2026-09-18 补充：平台名可自定义，不再固定叫 MetricCenter）。
 *
 * 重点在「品牌位永不出现空字符串」与「超长/脏值不落盘成畸形值」——
 * 名称直接渲染在顶栏与浏览器标签页，任何异常值都会立刻被用户看到。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_PRODUCT_NAME,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_NAME_STORAGE_KEY,
  clearProductName,
  normalizeProductName,
  readProductName,
  writeProductName,
} from './productNamePreference'

describe('normalizeProductName', () => {
  it('falls back to the default for non-string values（含「从未设置过」的 null）', () => {
    expect(normalizeProductName(null)).toBe(DEFAULT_PRODUCT_NAME)
    expect(normalizeProductName(undefined)).toBe(DEFAULT_PRODUCT_NAME)
    expect(normalizeProductName(42)).toBe(DEFAULT_PRODUCT_NAME)
  })

  it('treats blank / whitespace-only input as the default name', () => {
    expect(normalizeProductName('')).toBe(DEFAULT_PRODUCT_NAME)
    expect(normalizeProductName('   ')).toBe(DEFAULT_PRODUCT_NAME)
  })

  it('trims edges and collapses inner whitespace', () => {
    expect(normalizeProductName('  仪电  监控中心  ')).toBe('仪电 监控中心')
  })

  it('truncates over-long values（防御被手工改写的 localStorage）', () => {
    const long = 'x'.repeat(PRODUCT_NAME_MAX_LENGTH + 10)
    expect(normalizeProductName(long)).toHaveLength(PRODUCT_NAME_MAX_LENGTH)
  })
})

describe('产品名称持久化', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to the built-in name when nothing is stored', () => {
    expect(readProductName()).toBe(DEFAULT_PRODUCT_NAME)
  })

  it('round-trips a custom name and returns the normalized value', () => {
    expect(writeProductName('  自建监控平台 ')).toBe('自建监控平台')
    expect(window.localStorage.getItem(PRODUCT_NAME_STORAGE_KEY)).toBe('自建监控平台')
    expect(readProductName()).toBe('自建监控平台')
  })

  it('does not persist a value equal to the default（保持「未自定义」状态）', () => {
    window.localStorage.setItem(PRODUCT_NAME_STORAGE_KEY, '自定义')
    expect(writeProductName(`  ${DEFAULT_PRODUCT_NAME}  `)).toBe(DEFAULT_PRODUCT_NAME)
    expect(window.localStorage.getItem(PRODUCT_NAME_STORAGE_KEY)).toBeNull()
  })

  it('clears the stored preference', () => {
    writeProductName('临时名称')
    clearProductName()
    expect(readProductName()).toBe(DEFAULT_PRODUCT_NAME)
  })

  it('falls back to the default when the stored value is not a usable name', () => {
    window.localStorage.setItem(PRODUCT_NAME_STORAGE_KEY, '   ')
    expect(readProductName()).toBe(DEFAULT_PRODUCT_NAME)
  })
})
