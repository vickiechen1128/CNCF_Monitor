import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  message,
} from 'antd'
import { ciExporterMappingApi, type CITypeExporterMappingInput } from '../../api/ciExporterMappings'
import { exporterTemplateApi } from '../../api/exporterTemplates'
import { MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP, CATEGORY_MAP } from './strategyConstants'
import type { ExporterTemplate } from '../../types/strategy'
import type { CITypeExporterMapping } from '../../types/strategy'

interface MappingDrawerProps {
  open: boolean
  /** 编辑态（补配/更换默认采集配置）需传递行 record；新增态为 null */
  record?: CITypeExporterMapping | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 默认采集配置抽屉（Module_01 §9.1 / api-contract-snapshot §4）。
 * 新增默认采集配置：monitor_type + exporter_template_id 必填；每类型至多一个 is_default。
 * 编辑态（补配）：label_template_id 可改，其余只读展示。
 */
export function MappingDrawer({ open, record, onCancel, onSuccess }: MappingDrawerProps) {
  const [form] = Form.useForm<CITypeExporterMappingInput & { _noop?: boolean }>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ExporterTemplate[]>([])

  const isEdit = !!record

  useEffect(() => {
    if (!open) return
    // 打开时重置提交错误；异步请求回调内完成 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    exporterTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setTemplates(res.data?.list ?? []))
      .catch(() => setTemplates([]))
    if (record) {
      form.resetFields()
      form.setFieldsValue({
        monitor_type: record.monitor_type,
        exporter_template_id: record.exporter_template_id,
        is_default: record.is_default,
        default_port: record.default_port,
        metrics_path: record.metrics_path,
        scheme: record.scheme,
        scrape_interval: record.scrape_interval,
        scrape_timeout: record.scrape_timeout,
        label_template_id: record.label_template_id,
      } as CITypeExporterMappingInput)
    } else {
      form.resetFields()
      form.setFieldsValue({ is_default: false } as CITypeExporterMappingInput)
    }
  }, [open, record, form])

  const handleSubmit = async () => {
    let values: CITypeExporterMappingInput & { _noop?: boolean }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const { _noop, ...body } = values
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (record) {
        await ciExporterMappingApi.update(record.id, { ...body } as CITypeExporterMappingInput)
        message.success('默认采集配置已更新')
      } else {
        await ciExporterMappingApi.create({ ...(body as CITypeExporterMappingInput), monitor_type: body.monitor_type! })
        message.success('默认采集配置已新增')
      }
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? '编辑默认采集配置' : '新增默认采集配置'}
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={520}
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
              {isEdit ? '保存' : '提交'}
            </Button>
          </Space>
        </div>
      }
    >
      {submitError && (
        <Alert type="error" showIcon message="保存失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      <Form
        form={form}
        layout="vertical"
        name="mapping-form"
        requiredMark
        preserve={false}
        initialValues={{ is_default: false }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="监控类型" name="monitor_type" rules={[{ required: true, message: '请选择监控类型' }]}>
              <Select placeholder="按资源类别 → 细粒度选择" disabled={isEdit}>
                {MONITOR_TYPE_CASCADE.map((g) => (
                  <Select.OptGroup label={CATEGORY_MAP[g.category]} key={g.category}>
                    {g.types.map((t) => (
                      <Select.Option key={t} value={t}>
                        {MONITOR_TYPE_MAP[t]}
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="默认采集器"
              name="exporter_template_id"
              rules={[{ required: true, message: '请选择采集器' }]}
            >
              <Select placeholder="选择采集器模板" disabled={isEdit} showSearch optionFilterProp="label">
                {templates.map((t) => (
                  <Select.Option key={t.id} value={t.id} label={t.name}>
                    {t.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="默认端口" name="default_port" rules={[{ type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' }]}>
              <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：9104" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="采集路径" name="metrics_path">
              <Input placeholder="/metrics（默认）" maxLength={128} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="协议" name="scheme">
              <Select>
                <Select.Option value="http">http</Select.Option>
                <Select.Option value="https">https</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="采集间隔" name="scrape_interval">
              <Input placeholder="例如：15s" maxLength={16} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="采集超时" name="scrape_timeout">
              <Input placeholder="例如：10s" maxLength={16} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="默认标记" name="is_default" valuePropName="checked">
              <Switch checkedChildren="默认" unCheckedChildren={undefined} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="标签模板 ID" name="label_template_id" extra="M07 标签模板只读引用，可空（补配）">
          <Input placeholder="例如：label-template-001（可选）" maxLength={64} disabled={!isEdit} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}

export default MappingDrawer