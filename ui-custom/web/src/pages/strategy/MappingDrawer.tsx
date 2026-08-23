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
import type { ResourceCategory } from '../../types/resource'
import type { ExporterTemplate } from '../../types/strategy'
import type { CITypeExporterMapping } from '../../types/strategy'
import type { MonitorType } from '../../types/strategy'

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
 * 编辑态（补配）：采集器/参数/默认标记可改，其余只读展示。
 * 注意：标签模板不再在本抽屉编辑（Q1b 收敛），统一经「标签模板」列「更换/补配」轻量抽屉维护，避免双入口写同一字段。
 */
export function MappingDrawer({ open, record, onCancel, onSuccess }: MappingDrawerProps) {
  const [form] = Form.useForm<CITypeExporterMappingInput & { _noop?: boolean; resource_category?: ResourceCategory }>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ExporterTemplate[]>([])

  const isEdit = !!record
  // F1-8：监控对象类型候选 = 按已选资源类别过滤（两级级联）
  const resourceCategory = Form.useWatch('resource_category', form) as ResourceCategory | undefined
  const categoryTypes = (resourceCategory ? MONITOR_TYPE_CASCADE.find((g) => g.category === resourceCategory)?.types : []) ?? []

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
      // F1-8 编辑态回显：由 record.monitor_type 反推所属资源类别预填（提交载荷仍为 single monitor_type）
      const echoedCategory = MONITOR_TYPE_CASCADE.find((g) => g.types.includes(record.monitor_type as MonitorType))?.category
      form.setFieldsValue({
        resource_category: echoedCategory,
        monitor_type: record.monitor_type,
        exporter_template_id: record.exporter_template_id,
        is_default: record.is_default,
        default_port: record.default_port,
        metrics_path: record.metrics_path,
        scheme: record.scheme,
        scrape_interval: record.scrape_interval,
        scrape_timeout: record.scrape_timeout,
      } as CITypeExporterMappingInput)
    } else {
      form.resetFields()
      form.setFieldsValue({ is_default: false } as CITypeExporterMappingInput)
    }
  }, [open, record, form])

  const handleSubmit = async () => {
    let values: CITypeExporterMappingInput & { _noop?: boolean; resource_category?: ResourceCategory }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    // resource_category 仅用于表单两级级联，不进入提交载荷（契约仍为 single monitor_type）
    const { _noop, resource_category: _resourceCategory, ...body } = values
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
      {isEdit && (
        <Alert
          type="info"
          showIcon
          message="变更仅影响新建 Job，不影响已存在 Job"
          description="默认采集配置为「快照」语义：此处修改只作用于之后新建的采集 Job；已引用本配置的存量 Job 参数不受影响，也无需 M09 变更确认（PRD §5.4 保护存量）。如需存量 Job 采用新参数，请在对应采集 Job 内手动「同步映射默认值」。"
          style={{ marginBottom: 16 }}
        />
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
            <Form.Item label="资源类别" name="resource_category" rules={[{ required: true, message: '请选择资源类别' }]}>
              <Select
                placeholder="请选择"
                disabled={isEdit}
                options={MONITOR_TYPE_CASCADE.map((g) => ({ value: g.category, label: CATEGORY_MAP[g.category] }))}
                // F-10：切换资源类别后原监控对象类型候选失效，需同步清空
                onChange={() => form.setFieldsValue({ monitor_type: undefined })}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="监控对象类型" name="monitor_type" rules={[{ required: true, message: '请选择监控对象类型' }]}>
              <Select
                placeholder={categoryTypes.length > 0 ? '请选择监控对象类型' : '请先选择资源类别'}
                disabled={isEdit}
                options={categoryTypes.map((t) => ({ value: t, label: MONITOR_TYPE_MAP[t] }))}
              />
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
      </Form>
    </Drawer>
  )
}

export default MappingDrawer