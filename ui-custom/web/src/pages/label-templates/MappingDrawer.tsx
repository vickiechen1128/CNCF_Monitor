/**
 * 映射新增/编辑抽屉（T07-F8，Module_07 §3.2 / §5.11 / §5.12）。
 *
 * 右栏 Tab1「映射明细」的新增/编辑入口：保留模板上下文（编辑时对照映射表格，§11.2）。
 * 字段：来源类型 / 来源字段 / 目标标签 / 转换规则 / 启用状态。
 *
 * 前端预校验（与后端 models/label/mappings.go 校验一致）：
 * - 目标标签不得为保护 label（PROTECTED_PROMETHEUS_LABELS，composite→instance 例外）；
 * - 同模板内 target_label 必须唯一（编辑排除自身）；
 * 校验失败置于目标标签字段下方（§11.2）；提交失败透传后端错误 message。
 *
 * 保存成功后由 API 返回全量 mappings，经 onSaved 透传上级统一刷新（Tab1 表格与左栏 badge）。
 * 默认模板（is_default）为只读保护，映射变更禁止——由 Tab1 侧隐藏入口，本组件不重复拦截。
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Col,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd'
import { labelTemplateApi } from '../../api/labelTemplates'
import type { LabelSourceType, LabelTemplate, Mapping, MappingInput } from '../../types/label'
import {
  CMDB_FIELD_OPTIONS,
  COMPOSITE_OPTIONS,
  MAPPING_SOURCE_TYPE_OPTIONS,
  PROMETHEUS_BUILTIN_OPTIONS,
  PROTECTED_PROMETHEUS_LABELS,
  RESOURCE_FIELD_OPTIONS,
  SOURCE_TYPE_LABEL,
  TRANSFORM_OPTIONS,
} from './labelTemplateConstants'

const { Text } = Typography

interface MappingFormValues {
  source_type: LabelSourceType
  source_field: string
  target_label: string
  transform?: string
  enabled?: boolean
}

interface MappingDrawerProps {
  /** 抽屉是否打开 */
  open: boolean
  /** 所属模板（保留上下文：资源类别字段选项 + 同模板唯一性校验） */
  template: LabelTemplate | null
  /** 正在编辑的映射；null 表示新增 */
  editingMapping: Mapping | null
  /** 编辑映射的 1-based 数组位置（后端 mapping_id，§6.6.3），用于唯一性校验排除自身 */
  editingIndex: number | null
  onClose: () => void
  /** 保存成功后回调，携带服务端返回的最新 mappings */
  onSaved: (mappings: Mapping[]) => void
}

/** 来源字段 extra 文案（按来源类型给引导） */
function sourceFieldExtra(sourceType?: LabelSourceType) {
  switch (sourceType) {
    case 'composite':
      return '组合字段，由多个字段拼接生成标签'
    case 'cmdb_field':
      return 'CMDB 字段，后续版本由 CMDB 同步'
    case 'prometheus_builtin':
      return 'Prometheus 原生注入字段'
    default:
      return '从资源固定字段中选取'
  }
}

/**
 * 映射新增/编辑抽屉（T07-F8）。
 * 保留模板上下文；前端预校验保护 label 与同模板 target_label 唯一后提交 API。
 */
export default function MappingDrawer({
  open,
  template,
  editingMapping,
  editingIndex,
  onClose,
  onSaved,
}: MappingDrawerProps) {
  const [form] = Form.useForm<MappingFormValues>()
  const [saving, setSaving] = useState(false)
  const watchedSourceType = Form.useWatch('source_type', form)
  const watchedSourceField = Form.useWatch('source_field', form)

  // 编辑存量 composite / prometheus_builtin 映射时，选项需含当前来源并置灰（MVP 不可新增）
  const sourceTypeOptions = useMemo(() => {
    const options = [...MAPPING_SOURCE_TYPE_OPTIONS]
    if (
      editingMapping &&
      editingMapping.source_type !== 'resource_field' &&
      editingMapping.source_type !== 'cmdb_field'
    ) {
      options.unshift({
        value: editingMapping.source_type,
        label: SOURCE_TYPE_LABEL[editingMapping.source_type],
        disabled: true,
      })
    }
    return options
  }, [editingMapping])

  const sourceFieldOptions = useMemo(() => {
    const toOptions = (fields: string[]) => fields.map((f) => ({ value: f, label: f }))
    switch (watchedSourceType) {
      case 'composite':
        return toOptions(COMPOSITE_OPTIONS)
      case 'prometheus_builtin':
        return toOptions(PROMETHEUS_BUILTIN_OPTIONS)
      case 'cmdb_field':
        return CMDB_FIELD_OPTIONS.map((f) => ({ value: f, label: `${f}（后续版本开放）` }))
      default:
        return toOptions(template ? RESOURCE_FIELD_OPTIONS[template.resource_category] : [])
    }
  }, [watchedSourceType, template])

  // 抽屉打开时初始化表单：新增默认 resource_field / 无转换 / 启用；编辑回填存量映射
  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (editingMapping) {
      form.setFieldsValue({
        source_type: editingMapping.source_type,
        source_field: editingMapping.source_field,
        target_label: editingMapping.target_label,
        transform: editingMapping.transform ?? '',
        enabled: editingMapping.enabled,
      })
    } else {
      form.setFieldsValue({
        source_type: 'resource_field',
        transform: '',
        enabled: true,
      })
    }
  }, [open, editingMapping, form])

  const handleSourceTypeChange = (value: LabelSourceType) => {
    form.setFieldsValue({ source_field: undefined })
    // composite 目标标签锁定 instance；其余来源清空由来源字段联动预填
    form.setFieldValue('target_label', value === 'composite' ? 'instance' : '')
  }

  // resource_field 来源新增时目标标签默认 = 来源字段（可修改，不覆盖用户手输值）
  const handleSourceFieldChange = (value: string) => {
    const currentTarget = form.getFieldValue('target_label') as string | undefined
    if (!currentTarget || currentTarget === watchedSourceField) {
      form.setFieldValue('target_label', value)
    }
  }

  const handleSave = async () => {
    if (!template) return
    let values: MappingFormValues
    try {
      values = await form.validateFields()
    } catch {
      return // 表单校验错误已置于字段下方
    }
    const targetLabel = values.target_label.trim()
    const sourceType = values.source_type
    const isCompositeInstance = sourceType === 'composite' && targetLabel === 'instance'

    // 前端预校验 1：保护 label 拒绝（composite→instance 例外，§5.11）
    if (PROTECTED_PROMETHEUS_LABELS.includes(targetLabel) && !isCompositeInstance) {
      form.setFields([{ name: 'target_label', errors: [`目标标签「${targetLabel}」是 Prometheus 保护 label，禁止作为目标标签`] }])
      return
    }
    // 前端预校验 2：同模板 target_label 唯一（编辑排除自身，§5.11）
    const duplicated = template.mappings.some((m, i) => m.target_label === targetLabel && i + 1 !== editingIndex)
    if (duplicated) {
      form.setFields([{ name: 'target_label', errors: [`目标标签「${targetLabel}」在该模板内已存在，target_label 重复、必须唯一`] }])
      return
    }

    const input: MappingInput = {
      target_label: targetLabel,
      source_type: sourceType,
      source_field: values.source_field,
      transform_rule: values.transform ?? '',
    }
    setSaving(true)
    try {
      const res =
        editingMapping && editingIndex
          ? await labelTemplateApi.updateMapping(template.id, editingIndex, input)
          : await labelTemplateApi.addMapping(template.id, input)
      message.success(editingMapping ? '映射已更新' : '映射已新增')
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
      title={editingMapping ? '编辑映射' : '新增映射'}
      width={520}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="来源类型"
              name="source_type"
              rules={[{ required: true, message: '请选择来源类型' }]}
            >
              <Select
                placeholder="请选择"
                disabled={editingMapping?.source_type === 'composite' || editingMapping?.source_type === 'prometheus_builtin'}
                onChange={handleSourceTypeChange}
                options={sourceTypeOptions}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="来源字段"
              name="source_field"
              rules={[{ required: true, message: '请选择来源字段' }]}
              extra={sourceFieldExtra(watchedSourceType)}
            >
              <Select
                placeholder={watchedSourceType === 'cmdb_field' ? '后续版本开放' : '请选择'}
                showSearch
                optionFilterProp="label"
                options={sourceFieldOptions}
                disabled={watchedSourceType === 'composite' || watchedSourceType === 'cmdb_field'}
                onChange={handleSourceFieldChange}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="目标标签"
              name="target_label"
              rules={[{ required: true, message: '请输入目标标签' }]}
              extra={
                watchedSourceType === 'composite'
                  ? '组合字段固定生成 instance 标签，无需修改'
                  : '资源字段来源默认取来源字段，可修改；保护标签（instance/job 等）不允许使用'
              }
            >
              <Input placeholder="如 instance" disabled={watchedSourceType === 'composite'} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="转换规则" name="transform" extra="可留空（原样透传）；加前缀 / 正则替换需参数，后续版本开放">
              <Select placeholder="无（原样透传）" options={TRANSFORM_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="启用状态" name="enabled" valuePropName="checked" extra="关闭后该映射不参与标签生成">
          <Switch />
        </Form.Item>
        <Text type="secondary" style={{ fontSize: 12 }}>
          映射保存即生效：被引用采集 Job 会按新映射重新生成标签，修改立即生效、无版本回滚能力。
        </Text>
      </Form>
    </Drawer>
  )
}
