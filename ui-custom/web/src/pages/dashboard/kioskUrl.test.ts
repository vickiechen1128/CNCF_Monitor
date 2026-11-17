import { describe, expect, it } from 'vitest'
import { buildKioskURL } from './kioskUrl'

const BASE_URL =
  'http://grafana.example.com:3000/d/abc/overview?var-interval=5m&var-device=$__all&refresh=1m'

describe('buildKioskURL', () => {
  it('appends kiosk and hideLogo without rewriting existing query parameters', () => {
    expect(buildKioskURL(BASE_URL)).toBe(`${BASE_URL}&kiosk&hideLogo=true`)
  })

  it('keeps kiosk parameters before the fragment', () => {
    expect(buildKioskURL('http://grafana.example.com/d/abc/overview#panel-2')).toBe(
      'http://grafana.example.com/d/abc/overview?kiosk&hideLogo=true#panel-2',
    )
    expect(buildKioskURL('http://grafana.example.com/d/abc/overview?x=1#panel-2')).toBe(
      'http://grafana.example.com/d/abc/overview?x=1&kiosk&hideLogo=true#panel-2',
    )
  })

  it('does not create a double question mark when the URL ends with an empty query', () => {
    expect(buildKioskURL('http://grafana.example.com/d/abc/overview?')).toBe(
      'http://grafana.example.com/d/abc/overview?kiosk&hideLogo=true',
    )
  })

  it('does not duplicate kiosk / hideLogo that already exist', () => {
    expect(buildKioskURL(`${BASE_URL}&kiosk`)).toBe(`${BASE_URL}&kiosk&hideLogo=true`)
    expect(buildKioskURL(`${BASE_URL}&hideLogo=true`)).toBe(`${BASE_URL}&hideLogo=true&kiosk`)
    expect(buildKioskURL(`${BASE_URL}&kiosk&hideLogo=true`)).toBe(`${BASE_URL}&kiosk&hideLogo=true`)
  })

  it('throws on an invalid URL so the caller can degrade to a readable error', () => {
    expect(() => buildKioskURL('not-a-url')).toThrow()
  })
})
