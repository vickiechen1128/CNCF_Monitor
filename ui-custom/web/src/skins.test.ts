/**
 * 皮肤注册表不变量测试（用户 2026-09-18 决策：双皮肤运行时切换）。
 *
 * 这些不变量是「切到某套皮肤后某个颜色取不到值」这类运行时空洞的编译期之外的第二道防线：
 * 两套皮肤必须同键、默认皮肤必须保真旧配色、非法持久化值必须安全回落。
 */
import { describe, it, expect } from 'vitest'
import {
  CSS_VAR_BY_TOKEN,
  DEFAULT_SKIN,
  SKINS,
  SKIN_ORDER,
  buildSkinTheme,
  isSkinKey,
  skinDefinition,
  skinTokens,
} from './skins'

describe('skins 注册表', () => {
  it('registers exactly the ordered skins', () => {
    expect(SKIN_ORDER).toEqual(['volcengine', 'inesa'])
    expect(Object.keys(SKINS).sort()).toEqual([...SKIN_ORDER].sort())
  })

  it('gives every skin the same token keys（避免切肤后取到 undefined）', () => {
    const reference = Object.keys(SKINS[DEFAULT_SKIN].tokens).sort()
    for (const key of SKIN_ORDER) {
      expect(Object.keys(SKINS[key].tokens).sort()).toEqual(reference)
    }
    // 每个 token 都是非空字符串（不允许留空占位）
    for (const key of SKIN_ORDER) {
      for (const [token, value] of Object.entries(SKINS[key].tokens)) {
        expect(typeof value, `${key}.${token}`).toBe('string')
        expect(value.length, `${key}.${token}`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps 火山青 as the default skin and preserves the legacy palette', () => {
    expect(DEFAULT_SKIN).toBe('volcengine')
    // 默认皮肤必须与切换前的线上配色逐字一致（零视觉回归基线）
    expect(skinTokens('volcengine').colorPrimary).toBe('#0ECDEB')
    expect(skinTokens('volcengine').colorHeaderBg).toBe('#0B1B2A')
    expect(skinTokens('volcengine').colorError).toBe('#FF4C3A')
  })

  it('carries the INESA brand palette and its own semantic red', () => {
    const inesa = skinTokens('inesa')
    expect(inesa.colorPrimary).toBe('#1B5BA3')
    expect(inesa.colorHeaderBg).toBe('#164A87')
    // 语义红随皮肤切换（用户 2026-09-18 拍板），不是全皮肤固定值
    expect(inesa.colorError).toBe('#C0392B')
    expect(inesa.colorError).not.toBe(skinTokens('volcengine').colorError)
  })

  it('falls back to the default skin for unknown keys instead of throwing', () => {
    expect(isSkinKey('inesa')).toBe(true)
    expect(isSkinKey('nope')).toBe(false)
    expect(isSkinKey(null)).toBe(false)
    // 非法 key 经 skinDefinition 收窄后回落默认皮肤（含 localStorage 脏值场景）
    expect(skinDefinition('nope' as never)).toBe(SKINS[DEFAULT_SKIN])
  })

  it('maps every CSS variable to an existing token key', () => {
    for (const [cssVar, token] of Object.entries(CSS_VAR_BY_TOKEN)) {
      expect(cssVar.startsWith('--app-')).toBe(true)
      expect(SKINS[DEFAULT_SKIN].tokens).toHaveProperty(token)
    }
  })

  it('derives the antd theme from the given tokens（纯函数，可随皮肤重建）', () => {
    const inesa = skinTokens('inesa')
    const theme = buildSkinTheme(inesa)
    expect(theme.token?.colorPrimary).toBe(inesa.colorPrimary)
    expect(theme.token?.colorError).toBe(inesa.colorError)
    expect(theme.components?.Layout?.headerBg).toBe(inesa.colorHeaderBg)
  })
})
