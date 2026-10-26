import { afterEach, describe, expect, it } from 'vitest'
import { attachKioskEventGuards } from './kioskEvents'

describe('attachKioskEventGuards', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('blocks double-click and Escape without affecting normal interaction', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument!
    doc.body.innerHTML = '<button>正常筛选</button>'
    const cleanup = attachKioskEventGuards(iframe)

    const dblclick = new MouseEvent('dblclick', { bubbles: true, cancelable: true })
    doc.body.dispatchEvent(dblclick)
    expect(dblclick.defaultPrevented).toBe(true)

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    doc.body.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    doc.body.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    doc.body.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)

    cleanup()
    const afterCleanup = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    doc.body.dispatchEvent(afterCleanup)
    expect(afterCleanup.defaultPrevented).toBe(false)
  })

  it('does not break loading when the iframe is still cross-origin', () => {
    const iframe = document.createElement('iframe')
    Object.defineProperty(iframe, 'contentDocument', {
      get: () => { throw new DOMException('cross-origin', 'SecurityError') },
    })
    expect(() => attachKioskEventGuards(iframe)).not.toThrow()
  })
})
