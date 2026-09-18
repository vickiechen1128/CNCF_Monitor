import { describe, it, expect } from 'vitest'
import { ALERT_PAGE_SIZE, computeAlertPageSize } from './homeLayout'

/**
 * 首页告警卡的固定分页约束（用户 2026-09-18 二次反馈）。
 *
 * 关键不变式：页大小只由「池子大小 + 常量上限」决定，**与视口高度/分辨率无关**。
 * 旧版把「可用高度 → 行数」做成纯函数，页大小随窗口漂移（1440×900 得 6 行、1000 高得 8 行），
 * 卡片高度与分页器出现时机都不可预期——本组用例把这层耦合钉死。
 */
describe('computeAlertPageSize', () => {
  it('caps every page at the fixed ALERT_PAGE_SIZE no matter how tall the pool is', () => {
    expect(computeAlertPageSize(ALERT_PAGE_SIZE + 1)).toBe(ALERT_PAGE_SIZE)
    expect(computeAlertPageSize(ALERT_PAGE_SIZE * 5)).toBe(ALERT_PAGE_SIZE)
  })

  it('has no viewport input at all (page size is resolution-independent)', () => {
    // 旧签名是 (availableHeight, total)；若有人把视口高度重新塞回来，这条会失败
    expect(computeAlertPageSize.length).toBe(1)
  })

  it('keeps small pools on a single page so the pager stays hidden', () => {
    expect(computeAlertPageSize(1)).toBe(1)
    expect(computeAlertPageSize(2)).toBe(2)
    // 恰好等于上限：单页展示（首页数据池「近 8 条」> 6，故满池时会翻页）
    expect(computeAlertPageSize(ALERT_PAGE_SIZE)).toBe(ALERT_PAGE_SIZE)
  })

  it('degrades safely for empty / invalid pools', () => {
    expect(computeAlertPageSize(0)).toBe(ALERT_PAGE_SIZE)
    expect(computeAlertPageSize(-3)).toBe(ALERT_PAGE_SIZE)
    expect(computeAlertPageSize(Number.NaN)).toBe(ALERT_PAGE_SIZE)
    // 小数（不应出现，但不得算出非法分页 size）
    expect(computeAlertPageSize(3.7)).toBe(3)
  })
})
