import { useEffect, useMemo, useState } from 'react'
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
  /** 新增态预填采集器（模板行「去配置」/ 登记成功后引导，C1/F1-5 动线补齐） */
  initialTemplate?: ExporterTemplate | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 默认采集配置抽屉（Module_01 §9.1 / api-contract-snapshot §4）。
 * 新增默认采集配置：monitor_type + exporter_template_id 必填；每类型至多一个 is_default。
 * 编辑态（补配）：采集器/参数/默认标记可改，其余只读展示。
 * 注意：标签模板不再在本抽屉编辑（Q1b 收敛），统一经「标签模板」列「更换/补配」轻量抽屉维护，避免双入口写同一字段。
 */
export function MappingDrawer({ open, record, initialTemplate, onCancel, onSuccess }: MappingDrawerProps) {
  const [form] = Form.useForm<CITypeExporterMappingInput & { _noop?: boolean; resource_category?: ResourceCategory }>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ExporterTemplate[]>([])

  const isEdit = !!record
  // F1-8：监控对象类型候选 = 按已选资源类别过滤（两级级联）
  const resourceCategory = Form.useWatch('resource_category', form) as ResourceCategory | undefined
  const categoryTypes = (resourceCategory ? MONITOR_TYPE_CASCADE.find((g) => g.category === resourceCategory)?.types : []) ?? []
  const monitorType = Form.useWatch('monitor_type', form) as MonitorType | undefined
  const exporterTemplateId = Form.useWatch('exporter_template_id', form) as string | undefined

  // F-27 B：采集器候选按 supported_monitor_types 对齐所选监控对象类型（声明为空的模板放行，
  // 兼容未标注存量）；已选中的模板始终保留在候选中避免回显裸 ID；编辑态不过滤。
  const filteredTemplates = useMemo(() => {
    if (isEdit || !monitorType) return templates
    const matched = templates.filter(
      (t) => (t.supported_monitor_types?.length ?? 0) === 0 || t.supported_monitor_types.includes(monitorType),
    )
    const selected = templates.find((t) => String(t.id) === exporterTemplateId)
    if (selected && !matched.includes(selected)) return [...matched, selected]
    return matched
  }, [templates, monitorType, exporterTemplateId, isEdit])

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
      // 「去配置」/ 登记成功引导：仅预填采集器选择；采集参数不再值预填（F-28 稀疏覆盖），
      // 改为 placeholder 展示所选采集器的默认参数，留空=继承下层默认。
      if (initialTemplate) {
        form.setFieldsValue({
          exporter_template_id: String(initialTemplate.id),
        } as CITypeExporterMappingInput)
      }
    }
  }, [open, record, initialTemplate, form])

  // F-28：当前选中采集器（决定各参数字段 placeholder 展示的继承默认值）
  const selectedTemplate = useMemo(
    () => templates.find((t) => String(t.id) === exporterTemplateId),
    [templates, exporterTemplateId],
  )

  const handleSubmit = async () => {
    let values: CITypeExporterMappingInput & { _noop?: boolean; resource_category?: ResourceCategory }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    // resource_category 仅用于表单两级级联，不进入提交载荷（契约仍为 single monitor_type）
    const { _noop, resource_category: _resourceCategory, ...body } = values
    // F-28 稀疏覆盖：空值显式归一为 ''/0 提交——编辑态清空字段即「恢复继承下层默认」，
    // 新增态留空则存储为空（生成 Job / 渲染配置时按 映射→模板→全局 链解析生效值）。
    body.default_port = body.default_port ?? 0
    body.metrics_path = body.metrics_path ?? ''
    body.scheme = body.scheme ?? ''
    body.scrape_interval = body.scrape_interval ?? ''
    body.scrape_timeout = body.scrape_timeout ?? ''
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (record) {
        await ciExporterMappingApi.update(record.id, { ...body } as CITypeExporterMappingInput)
        message.success('默认采集配置已更新')
      } else {
        await ciExporterMappingApi.create({ ...(body as CITypeExporterMappingInput), monitor_type: body.monitor_type! })
        // F-30 消除「消失感」：明确告知采集器已并入默认配置行（列表按 PRD D22 的「登记即入池」展示）
        const name = selectedTemplate?.name ?? '该采集器'
        message.success(`默认采集配置已新增：${name} 已并入默认配置行，点击该行「查看」可看登记详情`)
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
      // forceRender：Drawer 首次打开时内容惰性挂载（rc-drawer 动画期先于父组件
      // useEffect 的 setFieldsValue 完成挂载），导致编辑回显首次为空、二次才出现；
      // forceRender 保证 Form 常驻挂载，首次打开即正确回显（#19 同源问题，映射抽屉）。
      forceRender
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
      <Alert
        type="info"
        showIcon
        message="采集参数均可留空：留空 = 继承下层默认"
        description="端口 / 采集路径 / 协议留空时继承所选采集器的默认参数；采集间隔 / 超时留空时使用全局默认（15s / 10s）。填写即覆盖，仅对本条默认采集配置生效。"
        style={{ marginBottom: 16 }}
      />
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
              extra={isEdit ? undefined : '仅展示声明支持所选监控对象类型的采集器（未标注类型的采集器也会列出）'}
            >
              <Select
                placeholder="选择采集器模板"
                disabled={isEdit}
                showSearch
                optionFilterProp="label"
                notFoundContent="暂无声明支持该类型的采集器，可先去「登记采集器」"
              >
                {filteredTemplates.map((t) => (
                  // 契约口径：exporter_template_id 为字符串承载的数字 ID（后端 string 字段 +
                  // strconv.ParseUint），Select value 必须 String() 化，否则提交 JSON number 被 400
                  <Select.Option key={t.id} value={String(t.id)} label={t.name}>
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
              <InputNumber
                style={{ width: '100%' }}
                min={1}
                max={65535}
                placeholder={selectedTemplate?.default_port ? `留空继承采集器默认（${selectedTemplate.default_port}）` : '留空继承采集器默认'}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="采集路径" name="metrics_path">
              <Input
                placeholder={selectedTemplate?.metrics_path ? `留空继承采集器默认（${selectedTemplate.metrics_path}）` : '留空继承采集器默认（/metrics）'}
                maxLength={128}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="协议" name="scheme">
              <Select
                allowClear
                placeholder={selectedTemplate?.scheme ? `留空继承采集器默认（${selectedTemplate.scheme}）` : '留空继承采集器默认（http）'}
              >
                <Select.Option value="http">http</Select.Option>
                <Select.Option value="https">https</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="采集间隔" name="scrape_interval">
              <Input placeholder="留空使用全局默认（15s）" maxLength={16} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="采集超时" name="scrape_timeout">
              <Input placeholder="留空使用全局默认（10s）" maxLength={16} />
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