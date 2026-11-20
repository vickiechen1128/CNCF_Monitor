/**
 * 选择器编辑器（SRS Module_01 v1.5 FR-22）。
 *
 * 条件字段来自服务端字段字典，操作符随字段类型收敛；取值控件按类型切换：
 * boolean / os_family / enum 给固定选项，text 允许自由输入标签。
 */
import { Button, Card, Empty, Radio, Select, Space, Tag, Tooltip, Typography } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { CandidateField, Selector, SelectorFilter } from '../../types/collectionTemplate'
import { fixedValuesForField, operatorsForField } from './selectorUtils'
import { EMPTY_SELECTOR, OPERATOR_LABEL } from '../../types/collectionTemplate'
import type { ResourceCategory } from '../../types/resource'

const { Text } = Typography

export interface SelectorEditorProps {
  value?: Selector
  onChange?: (next: Selector) => void
  category?: ResourceCategory
  fields: CandidateField[]
  disabled?: boolean
  /** 条件为空时的提示文案（不同页面语境不同）。 */
  emptyText?: string
}

export function SelectorEditor({
  value,
  onChange,
  category,
  fields,
  disabled,
  emptyText = '不限条件：该类别下全部资源都会被纳入候选',
}: SelectorEditorProps) {
  const selector = value ?? EMPTY_SELECTOR
  const available = category ? fields.filter((field) => field.categories.includes(category)) : fields

  const update = (next: Selector) => onChange?.(next)

  const updateFilter = (index: number, patch: Partial<SelectorFilter>) => {
    const filters = selector.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter))
    update({ ...selector, filters })
  }

  const removeFilter = (index: number) => {
    update({ ...selector, filters: selector.filters.filter((_, i) => i !== index) })
  }

  const addFilter = () => {
    const first = available[0]
    if (!first) return
    update({
      ...selector,
      filters: [...selector.filters, { field: first.key, operator: 'eq', values: [] }],
    })
  }

  return (
    <Card size="small" styles={{ body: { padding: 12 } }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space size={8} wrap>
          <Text type="secondary">多条件组合</Text>
          <Radio.Group
            size="small"
            value={selector.logic}
            disabled={disabled}
            onChange={(event) => update({ ...selector, logic: event.target.value })}
            options={[
              { value: 'all', label: '全部满足（AND）' },
              { value: 'any', label: '满足任一（OR）' },
            ]}
          />
        </Space>

        {selector.filters.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
        ) : (
          selector.filters.map((filter, index) => {
            const field = available.find((item) => item.key === filter.field)
            const operators = operatorsForField(field)
            const fixedValues = fixedValuesForField(field)
            const singleValue = filter.operator === 'eq' || filter.operator === 'contains' || filter.operator === 'regexp'
            return (
              <Space key={`${filter.field}-${index}`} align="start" wrap>
                <Select
                  style={{ width: 180 }}
                  size="small"
                  placeholder="选择字段"
                  value={filter.field || undefined}
                  disabled={disabled}
                  showSearch
                  optionFilterProp="label"
                  options={available.map((item) => ({
                    value: item.key,
                    label: item.custom ? `${item.label}（自定义）` : item.label,
                  }))}
                  onChange={(key) => {
                    const nextField = available.find((item) => item.key === key)
                    const nextOperators = operatorsForField(nextField)
                    updateFilter(index, {
                      field: key,
                      operator: nextOperators.includes(filter.operator) ? filter.operator : 'eq',
                      values: [],
                    })
                  }}
                />
                <Select
                  style={{ width: 140 }}
                  size="small"
                  value={filter.operator}
                  disabled={disabled}
                  options={operators.map((operator) => ({ value: operator, label: OPERATOR_LABEL[operator] }))}
                  onChange={(operator) =>
                    updateFilter(index, {
                      operator,
                      values: operator === 'always' ? [] : filter.values,
                    })
                  }
                />
                {filter.operator !== 'always' &&
                  (fixedValues ? (
                    <Select
                      style={{ minWidth: 200 }}
                      size="small"
                      mode={singleValue ? undefined : 'multiple'}
                      placeholder="选择取值"
                      value={singleValue ? filter.values?.[0] : filter.values}
                      disabled={disabled}
                      options={fixedValues}
                      onChange={(next) =>
                        updateFilter(index, {
                          values: Array.isArray(next) ? next : next ? [next] : [],
                        })
                      }
                    />
                  ) : (
                    <Select
                      style={{ minWidth: 240 }}
                      size="small"
                      mode={singleValue ? 'tags' : 'tags'}
                      maxCount={singleValue ? 1 : undefined}
                      placeholder="输入取值后回车"
                      value={filter.values}
                      disabled={disabled}
                      onChange={(next) => updateFilter(index, { values: next })}
                    />
                  ))}
                {filter.operator === 'always' && <Tag>该类别全部资源</Tag>}
                {!disabled && (
                  <Tooltip title="删除条件">
                    <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => removeFilter(index)} />
                  </Tooltip>
                )}
              </Space>
            )
          })
        )}

        {!disabled && (
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={addFilter} disabled={!available.length}>
            添加条件
          </Button>
        )}
      </Space>
    </Card>
  )
}

export default SelectorEditor
