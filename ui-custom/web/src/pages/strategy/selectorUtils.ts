/**
 * 选择器编辑器的字段/操作符推导（与组件分离，便于测试并保持 Fast Refresh 生效）。
 */
import type { CandidateField, Selector, SelectorOperator } from '../../types/collectionTemplate'

const TEXT_OPERATORS: SelectorOperator[] = ['eq', 'contains', 'contains_any', 'in', 'regexp', 'always']
const SIMPLE_OPERATORS: SelectorOperator[] = ['eq', 'in', 'always']

export function operatorsForField(field?: CandidateField): SelectorOperator[] {
  switch (field?.kind) {
    case 'boolean':
    case 'os_family':
    case 'enum':
      return SIMPLE_OPERATORS
    default:
      return TEXT_OPERATORS
  }
}

export function fixedValuesForField(field?: CandidateField): { value: string; label: string }[] | undefined {
  switch (field?.kind) {
    case 'boolean':
      return [
        { value: 'true', label: '是' },
        { value: 'false', label: '否' },
      ]
    case 'os_family':
      return [
        { value: 'linux', label: 'Linux / Unix' },
        { value: 'windows', label: 'Windows' },
      ]
    case 'enum':
      return ['online', 'offline', 'maintenance'].map((value) => ({ value, label: value }))
    default:
      return undefined
  }
}


export function summarizeSelector(selector?: Selector | null): string {
  const filters = selector?.filters ?? []
  if (filters.length === 0) return '不限条件'
  const opSymbol: Record<string, string> = {
    eq: '=',
    contains: '包含',
    contains_any: '包含任一',
    in: '∈',
    regexp: '~',
    always: '恒真',
  }
  const body = filters
    .map((filter) => {
      if (filter.operator === 'always') return `${filter.field}（不限）`
      const values = (filter.values ?? []).join('、')
      return `${filter.field}${opSymbol[filter.operator] ?? filter.operator}${values}`
    })
    .join('，')
  return `${selector?.logic === 'any' ? '满足任一' : '全部满足'}：${body}`
}

