import { useState } from 'react'
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
  message,
} from 'antd'
import { exporterTemplateApi, type ExporterTemplateInput } from '../../api/exporterTemplates'
import { MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'
import type { MonitorType } from '../../types/strategy'

const { TextArea } = Input

interface ExporterTemplateDrawerProps {
  open: boolean
  onCancel: () => void
  /** 登记成功后回刷采集器池列表 */
  onSuccess: () => void
}

/** 登记采集器来源 */
const SOURCE_OPTIONS = [
  { value: 'official', label: '官方（内置）' },
  { value: 'third_party', label: '第三方' },
  { value: 'internal', label: '内部自建' },
]

/**
 * 登记采集器抽屉（Module_01 §9.1 / api-contract-snapshot §3）。
 * source=internal 时 default_port/metrics_path/scheme 必填；登记即入池。
 */
export function ExporterTemplateDrawer({ open, onCancel, onSuccess }: ExporterTemplateDrawerProps) {
  const [form] = Form.useForm<ExporterTemplateInput>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // source=internal（内部自建）时 default_port/metrics_path/scheme 为动态必填（契约 §3），其余来源可选
  const source = (Form.useWatch('source', form) ?? 'internal') as ExporterTemplateInput['source']

  const handleSubmit = async () => {
    let values: ExporterTemplateInput
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await exporterTemplateApi.create({
        ...values,
        supported_monitor_types: (values.supported_monitor_types ?? []) as MonitorType[],
        source: values.source ?? 'internal',
      })
      message.success('采集器已登记')
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '登记失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title="登记采集器"
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
              登记
            </Button>
          </Space>
        </div>
      }
    >
      {submitError && (
        <Alert type="error" showIcon message="登记失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      <Form form={form} layout="vertical" name="exporter-template-form" requiredMark preserve={false} initialValues={{ source: 'internal' }}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="采集器名称" name="name" rules={[{ required: true, message: '请输入采集器名称' }]}>
              <Input placeholder="例如：mysql-exporter" maxLength={64} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="版本" name="version">
              <Input placeholder="例如：1.0.0（可选）" maxLength={32} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="来源"
              name="source"
              rules={[{ required: true, message: '请选择来源' }]}
            >
              <Select placeholder="请选择来源">
                {SOURCE_OPTIONS.map((s) => (
                  <Select.Option key={s.value} value={s.value}>
                    {s.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="支持监控类型" name="supported_monitor_types">
              <Select mode="multiple" allowClear placeholder="关联的监控对象类型">
                {MONITOR_TYPE_CASCADE.flatMap((g) =>
                  g.types.map((t) => (
                    <Select.Option key={t} value={t}>
                      {MONITOR_TYPE_MAP[t]}
                    </Select.Option>
                  )),
                )}
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="默认端口"
              name="default_port"
              rules={[
                ...(source === 'internal' ? [{ required: true, message: '请输入默认端口' }] : []),
                { type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' },
              ]}
            >
              <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：9104" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="采集路径"
              name="metrics_path"
              rules={source === 'internal' ? [{ required: true, message: '请输入采集路径' }] : []}
            >
              <Input placeholder="/metrics（默认）" maxLength={128} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="协议"
              name="scheme"
              rules={source === 'internal' ? [{ required: true, message: '请选择协议' }] : []}
            >
              <Select placeholder="请选择协议">
                <Select.Option value="http">http</Select.Option>
                <Select.Option value="https">https</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="操作系统" name="os">
              <Select allowClear placeholder="linux / windows / any">
                <Select.Option value="linux">linux</Select.Option>
                <Select.Option value="windows">windows</Select.Option>
                <Select.Option value="any">any</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="安装指引" name="install_guide">
          <TextArea rows={3} placeholder="安装部署说明（可选）" maxLength={512} />
        </Form.Item>
      </Form>
    </Drawer>
  )
}

export default ExporterTemplateDrawer