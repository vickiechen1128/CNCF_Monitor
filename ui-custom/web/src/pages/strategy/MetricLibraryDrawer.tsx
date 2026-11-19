import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, Form, Input, Select, Space, Switch, Typography, message } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { metricLibraryApi } from '../../api/metricLibrary'
import type { ExporterMetricLibraryItem, MetricType } from '../../types/strategy'
import { CATEGORY_MAP, METRIC_TYPE_MAP } from './strategyConstants'
import { refreshMonitorTypeCatalog, useMonitorTypeCatalog } from './useMonitorTypeCatalog'

const { Text } = Typography

/** Prometheus 指标命名规则（与后端 service.validateMetric 一致） */
const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/

interface AnchorRow {
  monitor_type?: string
  source_exporter?: string
}

interface MetricFormValues {
  metric_name: string
  metric_type: MetricType
  anchors: AnchorRow[]
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
 * - 「挂接监控对象类型」是核心：新建的监控对象类型保存后即可在此挂指标，
 *   下拉选项来自注册表（打开抽屉时重新拉取，避免选项滞后）。
 * - 同名 + 同锚点重复登记由后端返回 409，抽屉内展示错误信息。
 */
export function MetricLibraryDrawer({ open, editing, onClose, onSaved }: MetricLibraryDrawerProps) {
  const catalog = useMonitorTypeCatalog()
  const [form] = Form.useForm<MetricFormValues>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // 新建监控对象类型后立刻给新类型挂指标：打开抽屉时刷新注册表
    refreshMonitorTypeCatalog()
    form.resetFields()
    if (editing) {
      form.setFieldsValue({
        metric_name: editing.metric_name,
        metric_type: editing.metric_type,
        anchors:
          editing.monitor_types.length > 0
            ? editing.monitor_types.map((anchor) => ({
                monitor_type: anchor.monitor_type,
                source_exporter: anchor.source_exporter,
              }))
            : [{}],
        help: editing.help,
        unit: editing.unit,
        labels: editing.labels,
        category: editing.category,
        enabled: editing.enabled,
      })
    } else {
      form.setFieldsValue({ metric_type: 'gauge', anchors: [{}], labels: [], enabled: true })
    }
  }, [open, editing, form])

  const typeOptions = catalog.cascade.map((group) => ({
    label: CATEGORY_MAP[group.category],
    options: group.types.map((code) => ({ value: code, label: catalog.nameOf(code) })),
  }))

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
    const anchors = (values.anchors ?? [])
      .filter((row) => row?.monitor_type)
      .map((row) => ({
        monitor_type: row.monitor_type as string,
        source_exporter: row.source_exporter?.trim() || undefined,
      }))
    if (anchors.length === 0) {
      setError('请至少挂接一个监控对象类型')
      return
    }
    const payload = {
      metric_name: values.metric_name.trim(),
      metric_type: values.metric_type,
      help: values.help?.trim(),
      unit: values.unit?.trim(),
      labels: (values.labels ?? []).map((label) => label.trim()).filter(Boolean),
      monitor_types: anchors,
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
        message.success('指标已创建，已挂接到所选监控对象类型')
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

        <Form.Item label="挂接监控对象类型" required extra="至少挂接一个类型；该指标会出现在这些类型的指标库筛选中">
          <Form.List name="anchors">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {fields.map((field) => (
                  <Space key={field.key} align="start" wrap>
                    <Form.Item
                      name={[field.name, 'monitor_type']}
                      rules={[{ required: true, message: '请选择监控对象类型' }]}
                      style={{ marginBottom: 8, minWidth: 240 }}
                    >
                      <Select placeholder="请选择监控对象类型" options={typeOptions} data-testid={`anchor-type-${field.name}`} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'source_exporter']} style={{ marginBottom: 8, minWidth: 200 }}>
                      <Input placeholder="来源采集器（选填）" allowClear />
                    </Form.Item>
                    {fields.length > 1 && (
                      <Button
                        type="text"
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                        aria-label={`删除第 ${field.name + 1} 个挂接类型`}
                      />
                    )}
                  </Space>
                ))}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} data-testid="add-anchor">
                  添加挂接类型
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>

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
