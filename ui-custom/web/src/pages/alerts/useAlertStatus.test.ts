/**
 * currentAlertParams 单测（v3 契约回归）：
 * 未结三态并集必须走 status_group=open；status 只接受单态七值。
 * 回归背景：前端曾沿用 legacy status=open，v3 后端按非法状态值返回 400，
 * 导致「当前告警」列表加载失败。
 */
import { describe, it, expect } from 'vitest'
import { currentAlertParams, type CurrentAlertsQuery } from './useAlertStatus'

const baseQuery: CurrentAlertsQuery = {
  networkDomain: 'all',
  status: 'all',
  page: 1,
  pageSize: 20,
}

describe('currentAlertParams', () => {
  it('「全部」筛选发送 status_group=open，不发送 status', () => {
    const params = currentAlertParams(baseQuery, 2, 20)
    expect(params).toMatchObject({
      page: 2,
      page_size: 20,
      sort: 'starts_at desc',
      status_group: 'open',
    })
    expect(params).not.toHaveProperty('status')
  })

  it('单态筛选发送 status，不发送 status_group', () => {
    const params = currentAlertParams({ ...baseQuery, status: 'silenced' }, 1, 50)
    expect(params).toMatchObject({ status: 'silenced', page: 1, page_size: 50 })
    expect(params).not.toHaveProperty('status_group')
  })

  it('网域筛选：全部网域不传参，指定网域透传 ID', () => {
    expect(currentAlertParams(baseQuery, 1, 20)).not.toHaveProperty('network_domain')
    expect(currentAlertParams({ ...baseQuery, networkDomain: 'mc-a' }, 1, 20).network_domain).toBe('mc-a')
  })
})
