import { describe, expect, it } from 'vitest'
import { COMPOSITE_OPTIONS, RESOURCE_FIELD_OPTIONS } from './labelTemplateConstants'

describe('label template source fields', () => {
  it('excludes system-injected and non-existent fields', () => {
    for (const fields of Object.values(RESOURCE_FIELD_OPTIONS)) {
      expect(fields).not.toContain('resource_id')
      expect(fields).not.toContain('connection_string')
      expect(fields).not.toContain('os_version')
    }
    for (const category of ['database', 'middleware', 'application', 'generic_target'] as const) {
      expect(RESOURCE_FIELD_OPTIONS[category]).not.toContain('instance_name')
    }
    expect(COMPOSITE_OPTIONS).toEqual([])
  })

  it('keeps application owner fields editable as label sources', () => {
    for (const field of ['owner1', 'owner1_contact', 'owner2', 'owner2_contact', 'go_live_at']) {
      expect(RESOURCE_FIELD_OPTIONS.application).toContain(field)
    }
  })
})
