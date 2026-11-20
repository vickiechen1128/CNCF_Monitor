import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Select, Space, Switch, Typography, message } from 'antd'
import { metricLibraryApi } from '../../api/metricLibrary'
import type { ExporterMetricLibraryItem, MetricType } from '../../types/strategy'
import { METRIC_TYPE_MAP } from './strategyConstants'
import { useCollectionTemplateCatalog } from './useCollectionTemplateCatalog'

const { Text } = Typography

/** Prometheus 指标命名规则（与后端 service.validateMetric 一致） */
const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/

interface MetricFormValues {
  metric_name: string
  metric_type: MetricType
  /** 挂接的采集模板 code（多选） */
  template_codes?: string[]
  /** 按采集模板记录来源采集器（选填，同名不同义区分） */
  sources?: Record<string, string | undefined>
  help?: string
  unit?: string
  labels?: string[]
  category?: string
  enabled: boolean
}

export interface MetricLibraryDrawerProps {
  open: boolean
  /** null = 新增；否则编辑该用户扩展指标 */
  editing: ExporterMetricLibraryItem | null
  onClose: () => void
  /** 保存成功后回调（父组件刷新列表并关闭抽屉） */
  onSaved: () => void
}

/**
 * 指标库新增 / 编辑抽屉（用户扩展指标）。
 *
 * - 内置指标只读，只能在列表查看；本抽屉只处理 is_builtin=false 的行。
 * - 「挂接采集模板」是核心：指标锚点为 `{template_code, source_exporter}`（M01 v2.0 重构，
 *   监控对象类型已退场），下拉选项来自 `useCollectionTemplateCatalog()`，禁止写死列表。
 * - 每个模板可选填「来源采集器」，用于区分同名不同义的指标；不填则仅按模板归属。
 * - 同名 + 同锚点重复登记由后端返回 409，抽屉内展示错误信息。
 */
export function MetricLibraryDrawer({ open, editing, onClose, onSaved }: MetricLibraryDrawerProps) {
  const templateCatalog = useCollectionTemplateCatalog()
  const [form] = Form.useForm<MetricFormValues>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const templateOptions = useMemo(
    () => templateCatalog.templates.map((t) => ({ value: t.code, label: t.name })),
    [templateCatalog.templates],
  )
  // 采集模板是数据（可新增/停用）：每次打开抽屉都重新拉取，避免选项滞后
  const reloadTemplates = templateCatalog.reload

  useEffect(() => {
    if (!open) return
    reloadTemplates()
    form.resetFields()
    if (editing) {
      const anchors = editing.collection_templates ?? []
      form.setFieldsValue({
        metric_name: editing.metric_name,
        metric_type: editing.metric_type,
        template_codes: anchors.map((anchor) => anchor.template_code),
        sources: Object.fromEntries(anchors.map((anchor) => [anchor.template_code, anchor.source_exporter ?? ''])),
        help: editing.help,
        unit: editing.unit,
        labels: editing.labels,
        category: editing.category,
        enabled: editing.enabled,
      })
    } else {
      form.setFieldsValue({ metric_type: 'gauge', template_codes: [], sources: {}, labels: [], enabled: true })
    }
  }, [open, editing, form, reloadTemplates])

  // 选中的模板决定「来源采集器」输入行；useWatch 保证勾选后即时出现
  const selectedCodes = Form.useWatch('template_codes', form) ?? []

  const templateName = (code: string) => templateCatalog.templates.find((t) => t.code === code)?.name ?? code

  const handleClose = () => {
    if (saving) return
    // 关闭即清空上次的保存错误，避免下次打开沿用旧提示
    setError(null)
    onClose()
  }

  const submit = async () => {
    let values: MetricFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const codes = values.template_codes ?? []
    const collectionTemplates = codes.map((code) => ({
      template_code: code,
      source_exporter: values.sources?.[code]?.trim() || undefined,
    }))
    if (collectionTemplates.length === 0) {
      setError('请至少挂接一个采集模板')
      return
    }
    const payload = {
      metric_name: values.metric_name.trim(),
      metric_type: values.metric_type,
      help: values.help?.trim(),
      unit: values.unit?.trim(),
      labels: (values.labels ?? []).map((label) => label.trim()).filter(Boolean),
      collection_templates: collectionTemplates,
      category: values.category?.trim(),
      enabled: values.enabled,
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await metricLibraryApi.update(editing.id, payload)
        message.success('指标已更新')
      } else {
        await metricLibraryApi.create(payload)
        message.success('指标已创建，已挂接到所选采集模板')
      }
      setSaving(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      setSaving(false)
    }
  }

  return (
    <Drawer
      title={editing ? `编辑指标 · ${editing.metric_name}` : '新增指标（用户扩展）'}
      open={open}
      onClose={saving ? undefined : handleClose}
      width={640}
      // forceRender：保证 Form 常驻挂载，首次打开即正确回显（Web 开发规范 §8）
      forceRender
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={handleClose} disabled={saving}>
              取消
            </Button>
            <Button type="primary" loading={saving} disabled={saving} onClick={() => void submit()} data-testid="submit-metric">
              保存
            </Button>
          </Space>
        </div>
      }
    >
      {error && <Alert type="error" showIcon message="保存失败" description={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" name="metric-library-form" requiredMark preserve={false}>
        <Form.Item
          label="指标名"
          name="metric_name"
          rules={[
            { required: true, message: '请输入指标名' },
            { pattern: METRIC_NAME_PATTERN, message: '需符合 Prometheus 命名规范（字母/数字/下划线/冒号，不能以数字开头）' },
          ]}
          extra="与 Prometheus 中的指标名保持一致，例如 app_payment_success_total"
        >
          <Input placeholder="例如 app_payment_success_total" maxLength={200} />
        </Form.Item>

        <Form.Item
          label="指标类型"
          name="metric_type"
          rules={[{ required: true, message: '请选择指标类型' }]}
          extra="与采集端点 # TYPE 声明一致；无法确定时选「未知」"
        >
          <Select options={Object.entries(METRIC_TYPE_MAP).map(([value, label]) => ({ value, label }))} />
        </Form.Item>

        <Form.Item
          label="采集模板"
          name="template_codes"
          rules={[{ required: true, message: '请至少选择一个采集模板' }]}
          extra="至少挂接一个采集模板；该指标会出现在这些模板的指标库筛选中"
        >
          <Select
            mode="multiple"
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="请选择采集模板"
            data-testid="anchor-templates"
            options={templateOptions}
          />
        </Form.Item>

        {selectedCodes.length > 0 && (
          <Form.Item
            label="来源采集器（按采集模板，选填）"
            extra="同名指标在不同采集器下含义不同时填写，便于区分来源"
          >
            <Space direction="vertical" style={{ width: '100%' }} size={6}>
              {selectedCodes.map((code) => (
                <Space key={code} align="center" wrap>
                  <Text style={{ display: 'inline-block', minWidth: 150 }}>{templateName(code)}</Text>
                  <Form.Item name={['sources', code]} noStyle>
                    <Input
                      placeholder="来源采集器（选填）"
                      aria-label={`来源采集器-${code}`}
                      allowClear
                      style={{ width: 220 }}
                    />
                  </Form.Item>
                </Space>
              ))}
            </Space>
          </Form.Item>
        )}

        <Form.Item label="说明（HELP）" name="help">
          <Input.TextArea rows={2} maxLength={500} showCount placeholder="指标含义，便于规则编辑时理解" />
        </Form.Item>

        <Space size="large" style={{ display: 'flex' }} align="start">
          <Form.Item label="单位" name="unit" style={{ minWidth: 160 }}>
            <Input placeholder="例如 percent" maxLength={40} />
          </Form.Item>
          <Form.Item
            label="标签键"
            name="labels"
            style={{ minWidth: 320 }}
            extra="常见标签键，如 instance / job / mountpoint"
          >
            <Select mode="tags" placeholder="输入后回车" tokenSeparators={[',', ' ']} open={false} suffixIcon={null} />
          </Form.Item>
        </Space>

        <Space size="large" style={{ display: 'flex' }} align="start">
          <Form.Item label="语义域" name="category" style={{ minWidth: 200 }} extra="可选，如 cpu / memory / connection">
            <Input placeholder="例如 connection" maxLength={40} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Space>

        {editing && (
          <Text type="secondary">编辑只影响用户扩展指标；内置指标保持只读。</Text>
        )}
      </Form>
    </Drawer>
  )
}

export default MetricLibraryDrawer
