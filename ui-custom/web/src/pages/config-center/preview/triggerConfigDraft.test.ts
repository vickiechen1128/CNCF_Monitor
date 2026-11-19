import { describe, it, expect, vi, beforeEach } from 'vitest'
import { triggerConfigDrafts, triggerConfigDraftsForAllDomains } from './triggerConfigDraft'

const triggerMock = vi.fn()

vi.mock('../../../api/configCenter', () => ({
  configSyncTriggerApi: {
    trigger: (...args: unknown[]) => triggerMock(...args),
  },
}))

beforeEach(() => {
  triggerMock.mockReset()
  triggerMock.mockResolvedValue({ status: 'success', data: { accepted: true, completed: false } })
})

describe('triggerConfigDraft', () => {
  it('dedupes and trims domain ids when triggering domain sync', async () => {
    await triggerConfigDrafts([' mc-a ', 'mc-a', '', 'mc-b'])

    expect(triggerMock).toHaveBeenCalledTimes(1)
    expect(triggerMock).toHaveBeenCalledWith({
      scope: 'domain',
      network_domain_ids: ['mc-a', 'mc-b'],
      wait: false,
    })
  })

  it('skips the request when no domain id is supplied', async () => {
    await triggerConfigDrafts([' ', ''])
    expect(triggerMock).not.toHaveBeenCalled()
  })

  it('triggers center rules without domain ids', async () => {
    await triggerConfigDraftsForAllDomains()
    expect(triggerMock).toHaveBeenCalledWith({ scope: 'center', wait: false })
  })

  it('swallows trigger failures so the save flow is never blocked', async () => {
    triggerMock.mockRejectedValue(new Error('backend down'))
    await expect(triggerConfigDrafts(['mc-a'])).resolves.toBeUndefined()
    await expect(triggerConfigDraftsForAllDomains()).resolves.toBeUndefined()
  })
})
