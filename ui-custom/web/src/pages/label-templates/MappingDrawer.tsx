/**
 * 映射批量编辑抽屉（Module_07 §3.2 / §5.11 / §5.12）。
 * 所有增删改先保存在本地表格草稿中，点击「统一保存」后一次提交整组映射。
 */
import { useState } from 'react'
import { Button, Drawer, Input, Select, Space, Switch, Table, Typography, message } from 'antd'
import type { TableProps } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { labelTemplateApi } from '../../api/labelTemplates'
import { TABLE_SCROLL_X } from '../../components/tablePresets'
import type { LabelSourceType, LabelTemplate, Mapping, MappingInput } from '../../types/label'
import {
  CMDB_FIELD_OPTIONS,
  COMPOSITE_OPTIONS,
  DICT_TRANSLATABLE_FIELDS,
  MAPPING_SOURCE_TYPE_OPTIONS,
  PROMETHEUS_BUILTIN_OPTIONS,
  PROTECTED_PROMETHEUS_LABELS,
  RESOURCE_FIELD_OPTIONS,
  SOURCE_TYPE_LABEL,
  TRANSFORM_OPTIONS,
} from './labelTemplateConstants'

const { Text } = Typography

interface EditableMapping extends Mapping {
  key: string
  transform: string
}

interface MappingDrawerProps {
  open: boolean
  template: LabelTemplate | null
  onClose: () => void
  onSaved: (mappings: Mapping[]) => void
}

let nextRowKey = 0

function rowKey() {
  nextRowKey += 1
  return `mapping-row-${nextRowKey}`
}

function toEditableRows(template: LabelTemplate | null): EditableMapping[] {
  return (template?.mappings ?? []).map((item) => ({
    ...item,
    key: rowKey(),
    transform: item.transform ?? '',
  }))
}

function FieldError({ text }: { text?: string }) {
  return text ? (
    <div>
      <Text type="danger" style={{ fontSize: 12 }}>
        {text}
      </Text>
    </div>
  ) : null
}

export default function MappingDrawer(props: MappingDrawerProps) {
  return <MappingDrawerEditor key={`${props.template?.id ?? 0}:${props.open}`} {...props} />
}

function MappingDrawerEditor({ open, template, onClose, onSaved }: MappingDrawerProps) {
  const [rows, setRows] = useState<EditableMapping[]>(() => toEditableRows(template))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const clearError = (key: string, field: string) => {
    setErrors((current) => {
      const next = { ...current }
      delete next[`${key}:${field}`]
      return next
    })
  }

  const updateRow = (key: string, update: (row: EditableMapping) => EditableMapping) => {
    setRows((current) => current.map((row) => (row.key === key ? update(row) : row)))
  }

  const handleSourceTypeChange = (row: EditableMapping, value: LabelSourceType) => {
    updateRow(row.key, (current) => ({
      ...current,
      source_type: value,
      source_field: '',
      target_label: value === 'composite' ? 'instance' : '',
      transform: value !== 'resource_field' && current.transform === 'dict' ? '' : current.transform,
    }))
    clearError(row.key, 'source_field')
    clearError(row.key, 'target_label')
  }

  const handleSourceFieldChange = (row: EditableMapping, value: string) => {
    updateRow(row.key, (current) => ({
      ...current,
      source_field: value,
      target_label:
        !current.target_label || current.target_label === current.source_field ? value : current.target_label,
      transform:
        current.transform === 'dict' && !DICT_TRANSLATABLE_FIELDS.includes(value) ? '' : current.transform,
    }))
    clearError(row.key, 'source_field')
    clearError(row.key, 'target_label')
  }

  const sourceTypeOptions = (row: EditableMapping) => {
    const options = [...MAPPING_SOURCE_TYPE_OPTIONS]
    if (row.source_type !== 'resource_field' && row.source_type !== 'cmdb_field') {
      options.unshift({
        value: row.source_type,
        label: SOURCE_TYPE_LABEL[row.source_type],
        disabled: true,
      })
    }
    return options
  }

  const sourceFieldOptions = (row: EditableMapping) => {
    let fields: string[]
    switch (row.source_type) {
      case 'composite':
        fields = COMPOSITE_OPTIONS
        break
      case 'prometheus_builtin':
        fields = PROMETHEUS_BUILTIN_OPTIONS
        break
      case 'cmdb_field':
        fields = CMDB_FIELD_OPTIONS
        break
      default:
        fields = template ? RESOURCE_FIELD_OPTIONS[template.resource_category] : []
    }
    const values = row.source_field && !fields.includes(row.source_field) ? [...fields, row.source_field] : fields
    return values.map((field) => ({
      value: field,
      label: row.source_type === 'cmdb_field' ? `${field}（后续版本开放）` : field,
    }))
  }

  const transformOptions = (row: EditableMapping) => {
    const dictSupported =
      row.source_type === 'resource_field' && DICT_TRANSLATABLE_FIELDS.includes(row.source_field)
    return TRANSFORM_OPTIONS.filter(
      (option) => option.value !== 'dict' || dictSupported || row.transform === 'dict',
    )
  }

  const columns: TableProps<EditableMapping>['columns'] = [
    {
      title: '来源类型',
      width: 170,
      render: (_, row, index) => (
        <Select
          aria-label={`来源类型 ${index + 1}`}
          style={{ width: '100%' }}
          value={row.source_type}
          options={sourceTypeOptions(row)}
          disabled={row.source_type === 'composite' || row.source_type === 'prometheus_builtin'}
          onChange={(value) => handleSourceTypeChange(row, value)}
        />
      ),
    },
    {
      title: '来源字段',
      width: 220,
      render: (_, row, index) => (
        <>
          <Select
            aria-label={`来源字段 ${index + 1}`}
            style={{ width: '100%' }}
            placeholder="请选择来源字段"
            showSearch
            optionFilterProp="label"
            value={row.source_field || undefined}
            options={sourceFieldOptions(row)}
            disabled={row.source_type === 'composite' || row.source_type === 'cmdb_field'}
            onChange={(value) => handleSourceFieldChange(row, value)}
          />
          <FieldError text={errors[`${row.key}:source_field`]} />
        </>
      ),
    },
    {
      title: '目标标签',
      width: 210,
      render: (_, row, index) => (
        <>
          <Input
            aria-label={`目标标签 ${index + 1}`}
            placeholder="如 app"
            value={row.target_label}
            disabled={row.source_type === 'composite'}
            onChange={(event) => {
              updateRow(row.key, (current) => ({ ...current, target_label: event.target.value }))
              clearError(row.key, 'target_label')
            }}
          />
          <FieldError text={errors[`${row.key}:target_label`]} />
        </>
      ),
    },
    {
      title: '转换规则',
      width: 210,
      render: (_, row, index) => (
        <Select
          aria-label={`转换规则 ${index + 1}`}
          style={{ width: '100%' }}
          value={row.transform}
          options={transformOptions(row)}
          onChange={(value) => updateRow(row.key, (current) => ({ ...current, transform: value }))}
        />
      ),
    },
    {
      title: '启用',
      width: 80,
      render: (_, row, index) => (
        <Switch
          aria-label={`启用状态 ${index + 1}`}
          checked={row.enabled}
          onChange={(checked) => updateRow(row.key, (current) => ({ ...current, enabled: checked }))}
        />
      ),
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right',
      render: (_, row, index) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          aria-label={`删除第 ${index + 1} 行`}
          onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
        />
      ),
    },
  ]

  const validate = () => {
    const nextErrors: Record<string, string> = {}
    const seen = new Map<string, number>()
    rows.forEach((row, index) => {
      if (!row.source_field.trim()) {
        nextErrors[`${row.key}:source_field`] = '请选择来源字段'
      }
      const targetLabel = row.target_label.trim()
      if (!targetLabel) {
        nextErrors[`${row.key}:target_label`] = '请输入目标标签'
        return
      }
      const isCompositeInstance = row.source_type === 'composite' && targetLabel === 'instance'
      if (PROTECTED_PROMETHEUS_LABELS.includes(targetLabel) && !isCompositeInstance) {
        nextErrors[`${row.key}:target_label`] = `目标标签「${targetLabel}」是 Prometheus 保护 label，禁止作为目标标签`
      }
      if (seen.has(targetLabel)) {
        nextErrors[`${row.key}:target_label`] = `目标标签「${targetLabel}」在该模板内已存在，target_label 重复、必须唯一`
      } else {
        seen.set(targetLabel, index)
      }
    })
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSave = async () => {
    if (!template || !validate()) return
    const input: MappingInput[] = rows.map((row) => ({
      target_label: row.target_label.trim(),
      source_type: row.source_type,
      source_field: row.source_field.trim(),
      transform_rule: row.transform,
      enabled: row.enabled,
    }))
    setSaving(true)
    try {
      const res = await labelTemplateApi.replaceMappings(template.id, input)
      message.success('映射已保存')
      onSaved(res.data)
      onClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      title="编辑映射"
      width={1200}
      open={open}
      onClose={onClose}
      forceRender
      extra={
        <Space>
          <Button autoInsertSpace={false} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            统一保存
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Text type="secondary">可在表格中连续新增、修改或删除映射，所有变更将在统一保存后生效。</Text>
        <Table
          rowKey="key"
          size="small"
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: '暂无映射，点击下方「新增一行」添加' }}
        />
        <Button aria-label="新增一行" icon={<PlusOutlined />} onClick={() => setRows((current) => [
          ...current,
          {
            key: rowKey(),
            source_type: 'resource_field',
            source_field: '',
            target_label: '',
            transform: '',
            enabled: true,
          },
        ])}>
          新增一行
        </Button>
      </Space>
    </Drawer>
  )
}
