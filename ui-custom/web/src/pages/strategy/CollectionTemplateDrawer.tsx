import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Col,
  Collapse,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd'
import { collectionTemplateApi } from '../../api/collectionTemplates'
import { exporterTemplateApi } from '../../api/exporterTemplates'
import { labelTemplateApi } from '../../api/labelTemplates'
import type { LabelTemplateListItem } from '../../types/label'
import type { ResourceCategory } from '../../types/resource'
import type { ExporterTemplate } from '../../types/strategy'
import type {
  CollectionTemplate,
  CollectionTemplateInput,
  Selector,
} from '../../types/collectionTemplate'
import { EMPTY_SELECTOR, normalizeSelector } from '../../types/collectionTemplate'
import { CATEGORY_MAP } from './strategyConstants'
import { SelectorEditor } from './SelectorEditor'
import { useCandidateFields } from './useCollectionTemplateCatalog'

const { Text, Paragraph } = Typography
const { TextArea } = Input

/** 模板编码：小写字母开头，允许小写字母 / 数字 / 下划线，长度 2-64（对齐后端 domain 校验）。 */
const TEMPLATE_CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_MAP) as ResourceCategory[]).map((value) => ({
  value,
  label: CATEGORY_MAP[value],
}))

const SCHEME_OPTIONS = [
  { value: 'http', label: 'http' },
  { value: 'https', label: 'https' },
]

/**
 * 把 Prometheus 时长字面量（15s / 1m / 500ms / 1h，纯数字按秒）换算成秒。
 * 无法解析时返回 undefined：本函数只服务前端「超时 < 间隔」的轻量校验，
 * 真正的合法性由后端统一校验，前端不做过度约束。
 */
function durationSeconds(value?: string | number | null): number | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  if (text === '') return undefined
  const matched = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text)
  if (!matched) return undefined
  const amount = Number(matched[1])
  if (Number.isNaN(amount)) return undefined
  switch (matched[2] ?? 's') {
    case 'ms':
      return amount / 1000
    case 'm':
      return amount * 60
    case 'h':
      return amount * 3600
    default:
      return amount
  }
}

/** 抽屉表单值（提交前会被裁剪成 CollectionTemplateInput）。 */
interface CollectionTemplateFormValues {
  code: string
  name: string
  resource_category: ResourceCategory
  exporter_template_id: string
  default_port: number
  metrics_path: string
  scheme: string
  scrape_interval: string
  scrape_timeout: string
  label_template_id?: string
  description?: string
  sort_order: number
  enabled: boolean
  default_selector?: Selector
}

const CREATE_DEFAULTS = {
  code: '',
  name: '',
  exporter_template_id: undefined as string | undefined,
  default_port: 9100,
  metrics_path: '/metrics',
  scheme: 'http',
  scrape_interval: '15s',
  scrape_timeout: '10s',
  label_template_id: undefined as string | undefined,
  description: '',
  sort_order: 500,
  enabled: true,
  default_selector: EMPTY_SELECTOR,
}

/** 编辑态回填值：模板已有字段原样回显，避免保存时把未展示字段抹成默认值。 */
function toFormValues(record: CollectionTemplate): CollectionTemplateFormValues {
  return {
    code: record.code,
    name: record.name,
    resource_category: record.resource_category,
    exporter_template_id: record.exporter_template_id,
    default_port: record.default_port,
    metrics_path: record.metrics_path,
    scheme: record.scheme,
    scrape_interval: record.scrape_interval,
    scrape_timeout: record.scrape_timeout,
    label_template_id: record.label_template_id || undefined,
    description: record.description ?? '',
    sort_order: record.sort_order,
    enabled: record.enabled,
    default_selector: normalizeSelector(record.default_selector),
  }
}

export interface CollectionTemplateDrawerProps {
  open: boolean
  /** 编辑态传入模板；新建态为 null / undefined。 */
  record?: CollectionTemplate | null
  onCancel: () => void
  /** 保存成功回调（父组件负责刷新共享模板缓存）。 */
  onSaved: () => void
}

/**
 * 采集模板新建 / 编辑抽屉（SRS Module_01 v1.5 FR-21）。
 *
 * 模板回答「这类对象怎么采」：一个采集实现 + 一套抓取参数 + 一个标签模板。
 * 「采哪些对象」不在这里——任务的 selector 才决定适用范围；抽屉里的
 * `default_selector` 只是新建任务时的预填建议，后端从不据此筛选资源。
 *
 * 编码创建后不可修改：模板编码被采集任务与指标锚点稳定引用，改名会打断引用。
 */
export function CollectionTemplateDrawer({ open, record, onCancel, onSaved }: CollectionTemplateDrawerProps) {
  const [form] = Form.useForm<CollectionTemplateFormValues>()
  const isEdit = Boolean(record?.code)
  const [exporterTemplates, setExporterTemplates] = useState<ExporterTemplate[]>([])
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateListItem[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fieldCatalog = useCandidateFields()

  // 打开抽屉时装载候选并回填表单；Drawer 首次打开时 rc-drawer 惰性挂载内容，
  // 故配合 forceRender 让 Form 常驻，保证首开即正确回填。
  // 此处 effect 内同步重置提交态属于「表单重置」而非渲染派生，沿用本模块既有的
  // set-state-in-effect 豁免写法（同 LabelTemplateSelectDrawer / ExporterTemplateDrawer）。
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return
    setSubmitError(null)
    setSubmitting(false)
    form.setFieldsValue(record ? toFormValues(record) : { ...CREATE_DEFAULTS })
    exporterTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setExporterTemplates(res.data?.list ?? []))
      .catch(() => setExporterTemplates([]))
    labelTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setLabelTemplates(res.data?.list ?? []))
      .catch(() => setLabelTemplates([]))
  }, [open, record, form])
  /* eslint-enable react-hooks/set-state-in-effect */

  const category = Form.useWatch('resource_category', form)

  // 标签模板按资源类别收敛：后端会拒绝类别不匹配的标签模板，前端先过滤掉。
  const labelOptions = useMemo(() => {
    const scoped = category
      ? labelTemplates.filter((template) => template.resource_category === category)
      : labelTemplates
    return scoped.map((template) => ({
      value: String(template.id),
      label: `${template.name}（${CATEGORY_MAP[template.resource_category] ?? template.resource_category}）`,
    }))
  }, [labelTemplates, category])

  const exporterOptions = useMemo(
    () =>
      exporterTemplates.map((template) => ({
        value: String(template.id),
        label: template.is_builtin ? `${template.name}（内置）` : template.name,
      })),
    [exporterTemplates],
  )

  const handleSubmit = async () => {
    let values: CollectionTemplateFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const payload: CollectionTemplateInput = {
      ...(isEdit ? {} : { code: values.code.trim() }),
      name: values.name.trim(),
      resource_category: values.resource_category,
      exporter_template_id: values.exporter_template_id,
      default_port: values.default_port,
      metrics_path: values.metrics_path,
      scheme: values.scheme,
      scrape_interval: values.scrape_interval,
      scrape_timeout: values.scrape_timeout,
      label_template_id: values.label_template_id ?? '',
      // 「推荐条件」面板默认收起，折叠期间 SelectorEditor 未挂载 → 表单值可能缺失，
      // 回落到行记录里已有的默认选择器，避免保存时把已有预填条件清空。
      default_selector: normalizeSelector(values.default_selector ?? record?.default_selector),
      description: values.description ?? '',
      sort_order: values.sort_order ?? 500,
      enabled: values.enabled ?? true,
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (isEdit) {
        await collectionTemplateApi.update(record!.code, payload)
        message.success(`采集模板「${payload.name}」已保存`)
      } else {
        await collectionTemplateApi.create(payload)
        message.success(`采集模板「${payload.name}」已创建`)
      }
      setSubmitting(false)
      onSaved()
      onCancel()
    } catch (err) {
      // 409（编码重复）/ 400（字段校验）等后端信息原样透出，不做二次包装
      setSubmitError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={isEdit ? `编辑采集模板：${record?.name ?? ''}` : '新建采集模板'}
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={720}
      forceRender
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
              保存
            </Button>
          </Space>
        </div>
      }
    >
      {submitError && (
        <Alert type="error" showIcon message="保存失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      <Form form={form} layout="vertical" name="collection-template-form" requiredMark preserve={false}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="模板编码"
              name="code"
              extra={isEdit ? '编码创建后不可修改（采集任务与指标锚点按编码引用）' : '小写字母开头，可含小写字母 / 数字 / 下划线，2-64 位'}
              rules={
                isEdit
                  ? []
                  : [
                      { required: true, message: '请输入模板编码' },
                      { pattern: TEMPLATE_CODE_PATTERN, message: '编码需以小写字母开头，仅含小写字母、数字和下划线，长度 2-64' },
                    ]
              }
            >
              <Input placeholder="例如：mysql_default" maxLength={64} disabled={isEdit} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="模板名称" name="name" rules={[{ required: true, message: '请输入模板名称' }]}>
              <Input placeholder="例如：MySQL 标准采集" maxLength={64} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="资源类别"
              name="resource_category"
              rules={[{ required: true, message: '请选择资源类别' }]}
            >
              <Select placeholder="请选择资源类别" options={CATEGORY_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="采集实现"
              name="exporter_template_id"
              rules={[{ required: true, message: '请选择采集实现' }]}
              extra="来自采集实现（exporter）池，一个模板绑定一个实现"
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="请选择采集实现"
                options={exporterOptions}
                notFoundContent="暂无可选采集实现，请先在「采集实现」页登记"
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item
              label="默认端口"
              name="default_port"
              rules={[{ type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' }]}
            >
              <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：9104" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="采集路径" name="metrics_path">
              <Input placeholder="/metrics（默认）" maxLength={128} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="协议" name="scheme">
              <Select options={SCHEME_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="采集间隔" name="scrape_interval" extra="如 15s / 1m">
              <Input placeholder="15s" maxLength={16} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="采集超时"
              name="scrape_timeout"
              dependencies={['scrape_interval']}
              extra="需小于采集间隔"
              rules={[
                ({ getFieldValue }) => ({
                  validator(_, value: string) {
                    const interval = durationSeconds(getFieldValue('scrape_interval'))
                    const timeout = durationSeconds(value)
                    if (interval === undefined || timeout === undefined) return Promise.resolve()
                    if (timeout >= interval) return Promise.reject(new Error('采集超时必须小于采集间隔'))
                    return Promise.resolve()
                  },
                }),
              ]}
            >
              <Input placeholder="10s" maxLength={16} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="标签模板"
              name="label_template_id"
              extra="仅可选同资源类别的标签模板；留空表示不挂标签模板"
            >
              <Select allowClear showSearch optionFilterProp="label" placeholder="请选择标签模板" options={labelOptions} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="排序" name="sort_order" extra="升序展示，默认 500">
              <InputNumber style={{ width: '100%' }} min={0} max={9999} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="状态" name="enabled" valuePropName="checked" extra="停用后不再出现在新建任务的可选模板中">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="描述" name="description">
          <TextArea rows={2} placeholder="模板适用场景与注意事项" maxLength={512} />
        </Form.Item>

        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'default-selector',
              label: (
                <Space size={8} wrap>
                  <Text strong>新建任务时的推荐条件</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    仅作预填提示，不影响已有任务的选择器
                  </Text>
                </Space>
              ),
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                    这里的条件只在「新建采集任务」时作为选择器的预填建议；任务最终采哪些对象，由任务自己的选择器决定，
                    模板不会限制资源范围。
                  </Paragraph>
                  <Form.Item name="default_selector" noStyle>
                    <SelectorEditor category={category} fields={fieldCatalog.fields} />
                  </Form.Item>
                </Space>
              ),
            },
          ]}
        />
      </Form>
    </Drawer>
  )
}

export default CollectionTemplateDrawer
