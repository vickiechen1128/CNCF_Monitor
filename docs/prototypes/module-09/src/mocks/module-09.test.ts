import { describe, it, expect } from 'vitest'
import { currentTenant, networkDomains, edgeAgents, configDrafts, configVersions, configDeployments } from './module-09'

describe('module-09 mocks', () => {
  it('should expose current tenant with multi_site_enabled flag', () => {
    expect(currentTenant).toHaveProperty('id')
    expect(currentTenant).toHaveProperty('multi_site_enabled')
    expect(typeof currentTenant.multi_site_enabled).toBe('boolean')
  })

  it('should include a default management domain', () => {
    const defaultDomain = networkDomains.find((d) => d.id === 'default')
    expect(defaultDomain).toBeDefined()
    expect(defaultDomain?.domain_type).toBe('management')
  })

  it('should have edge agents matching declared network domains', () => {
    const domainIds = new Set(networkDomains.map((d) => d.id))
    edgeAgents.forEach((agent) => {
      expect(domainIds.has(agent.network_domain_id)).toBe(true)
    })
  })

  it('should have config drafts/versions/deployments aligned with network domains', () => {
    const domainIds = new Set(networkDomains.map((d) => d.id))
    configDrafts.forEach((draft) => expect(domainIds.has(draft.network_domain_id)).toBe(true))
    configVersions.forEach((version) => expect(domainIds.has(version.network_domain_id)).toBe(true))
    configDeployments.forEach((deployment) => expect(domainIds.has(deployment.network_domain_id)).toBe(true))
  })
})
