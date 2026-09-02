import { describe, it, expect } from 'vitest'
import {
  configStatusLabel,
  configStatusColor,
  silenceStatusLabel,
  silenceStatusColor,
  partitionValidateErrors,
  formatMatchers,
  validateSectionLabel,
  validateSectionColor,
} from './alertmanagerConstants'
import { shortChecksum } from '../../utils/shortChecksum'
import type { ValidateErrorItem } from '../../types/alertmanager'

const err = (over: Partial<ValidateErrorItem> = {}): ValidateErrorItem => ({
  file: 'alertmanager.yml',
  line: 14,
  message: '',
  ...over,
})

describe('alertmanagerConstants（M08 枚举/常量/展示名映射）', () => {
  describe('配置版本状态（AlertmanagerConfigVersion.status）', () => {
    it('applied → 已生效（成功绿），本表恒 applied（决策 60）', () => {
      expect(configStatusLabel.applied).toBe('已生效')
      expect(configStatusColor.applied).toBe('success')
    })
  })

  describe('静默状态（Silence.status）展示名', () => {
    it('三态映射齐全且与契约 §8 对齐', () => {
      expect(silenceStatusLabel.active).toBe('生效中')
      expect(silenceStatusColor.active).toBe('success')
      expect(silenceStatusLabel.pending).toBe('待生效')
      expect(silenceStatusColor.pending).toBe('warning')
      expect(silenceStatusLabel.expired).toBe('已过期')
      expect(silenceStatusColor.expired).toBe('default')
    })
  })

  describe('shortChecksum（sha256 短显）', () => {
    it('超过 16 位时首尾 8 位省略中间', () => {
      expect(shortChecksum('7e1b4d9c2a6f8e0d3b9a1c5e')).toBe('7e1b4d9c…3b9a1c5e')
    })
    it('不超过 16 位时原样返回', () => {
      expect(shortChecksum('abc123')).toBe('abc123')
    })
    it('空值返回占位 -', () => {
      expect(shortChecksum('')).toBe('-')
      expect(shortChecksum(undefined)).toBe('-')
    })
  })

  describe('partitionValidateErrors（行级校验错误分区）', () => {
    it('引用闭合类：unknown receiver / undefined 归 reference', () => {
      const parts = partitionValidateErrors([
        err({ message: 'unknown receiver "sre-critical" referenced by route' }),
        err({ message: 'receiver "x" is undefined' }),
      ])
      expect(parts.reference).toHaveLength(2)
      expect(parts.syntax).toHaveLength(0)
    })

    it('语法类：yaml unmarshal / syntax 归 syntax', () => {
      const parts = partitionValidateErrors([
        err({ message: 'cannot unmarshal yaml: line 3 mismatch' }),
        err({ message: 'syntax error in config' }),
      ])
      expect(parts.syntax).toHaveLength(2)
      expect(parts.reference).toHaveLength(0)
    })

    it('其余归 other 兜底，保证每条都落在某分区', () => {
      const parts = partitionValidateErrors([
        err({ message: 'some unexpected problem happened' }),
      ])
      expect(parts.other).toHaveLength(1)
    })

    it('空数组返回空分区', () => {
      const parts = partitionValidateErrors([])
      expect(parts.syntax).toEqual([])
      expect(parts.reference).toEqual([])
      expect(parts.other).toEqual([])
    })

    it('undefined 输入安全返回空分区', () => {
      const parts = partitionValidateErrors(undefined as unknown as ValidateErrorItem[])
      expect(parts.other).toEqual([])
    })
  })

  describe('validateSectionLabel / Color', () => {
    it('三类分区均有标题与颜色，用户语言不含决策编号', () => {
      expect(validateSectionLabel.syntax).toBe('配置语法错误')
      expect(validateSectionLabel.reference).toBe('引用闭合错误')
      expect(validateSectionLabel.other).toBe('其他校验错误')
      expect(validateSectionColor.syntax).toBe('error')
      expect(validateSectionColor.reference).toBe('warning')
      expect(validateSectionColor.other).toBe('default')
    })
  })

  describe('formatMatchers（静默 matcher 展示串）', () => {
    it('默认 is_equal 缺省按 `=` 拼接', () => {
      expect(formatMatchers([{ name: 'severity', value: 'critical' }])).toBe('severity="critical"')
    })
    it('is_equal=false 输出 `!=`，is_regex=true 输出 `=~`', () => {
      expect(
        formatMatchers([
          { name: 'network_domain', value: 'gov-*', is_equal: true, is_regex: true },
          { name: 'severity', value: 'info', is_equal: false },
        ]),
      ).toBe('network_domain=~"gov-*", severity!="info"')
    })
  })
})