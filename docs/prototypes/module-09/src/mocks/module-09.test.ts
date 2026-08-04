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

  it('should record PRD 4.4 metadata on every config draft', () => {
    configDrafts.forEach((draft) => {
      expect(draft.metadata.source_data_version).toBeTruthy()
      expect(draft.metadata.trigger_summary).toBeTruthy()
      expect(draft.metadata.checksum).toMatch(/^[0-9a-f]{64}$/)
      expect(draft.metadata.generator_version).toBeTruthy()
    })
  })

  it('should include a draft that fails pre-deploy validation (PRD 3.5.1 demo)', () => {
    const failed = configDrafts.find((d) => d.validation_status === 'failed')
    expect(failed).toBeDefined()
    expect(failed?.validation_error).toContain('promtool')
  })

  it('should mark deployments with pre-deploy validation result and blackbox participation', () => {
    configDeployments.forEach((deployment) => {
      expect(['passed', 'failed', 'pending']).toContain(deployment.validation_status)
      expect(typeof deployment.includes_blackbox).toBe('boolean')
    })
    const failedValidation = configDeployments.find((d) => d.validation_status === 'failed')
    expect(failedValidation?.error_message).toBeTruthy()
  })

  it('should expose an agent demonstrating config package checksum failure', () => {
    const agent = edgeAgents.find((a) => a.last_error.includes('checksum'))
    expect(agent).toBeDefined()
    expect(agent?.config_sync_status).toBe('out_of_sync')
  })
})
