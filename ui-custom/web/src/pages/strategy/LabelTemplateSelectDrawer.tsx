import { useEffect, useState } from 'react'
import { Alert, Button, Divider, Drawer, Select, Space, Tag, Typography, message } from 'antd'
import { ciExporterMappingApi } from '../../api/ciExporterMappings'
import { exporterTemplateApi } from '../../api/exporterTemplates'
import { labelTemplateApi } from '../../api/labelTemplates'
import type { ResourceCategory } from '../../types/resource'
import type { LabelTemplateListItem } from '../../types/label'
import type { CITypeExporterMapping, ExporterTemplate, MonitorType } from '../../types/strategy'
import { CATEGORY_MAP, MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'

const { Text } = Typography

interface LabelTemplateSelectDrawerProps {
  open: boolean
  /** replace=更换（已配置）；supplement=补配（待配置）。二者功能一致，仅标题与说明文案区分 */
  mode: 'replace' | 'supplement'
  record: CITypeExporterMapping
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 标签模板选择轻量抽屉（Q1b 用户裁定：更换/补配与「编辑」分离，独立入口）。
 * - 职责：仅设置「默认采集配置」的 label_template_id，**不触及其他字段**（端口/路径/协议/频率等采集器信息）；
 * - 展示该映射上下文：监控对象类型 / 资源类别 / 默认采集器，让用户明确在给哪条默认采集配置换/配标签模板；
 * - 「更换」时高亮展示**当前已选模板**（回显确认，PRD L241「更换=同资源类别其他模板」）；
 * - 候选按当前监控对象类型所属**资源类别**过滤；空态提供「前往标签模板管理创建」引导；
 * - 提交仅发送 label_template_id（后端 §4 部分更新）。
 */
export function LabelTemplateSelectDrawer({ open, mode, record, onCancel, onSuccess }: LabelTemplateSelectDrawerProps) {
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplateListItem[]>([])
  const [exporterTemplates, setExporterTemplates] = useState<ExporterTemplate[]>([])
  const [value, setValue] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingTemplates, setLoadingTemplates] = useState(false)

  // 所有 hooks 置于条件 return 之前（React hooks 规则：调用顺序必须无条件稳定）
  // 抽屉打开时重置表单态并装载候选；沿用本模块既有 set-state-in-effect 模式
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open || !record) return
    setError(null)
    setSubmitting(false)
    setValue(record.label_template_id || undefined)
    setLoadingTemplates(true)
    labelTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setLabelTemplates(res.data?.list ?? []))
      .catch(() => setLabelTemplates([]))
      .finally(() => setLoadingTemplates(false))
    // 装载采集器模板池，用于展示「默认采集器」上下文（只读）
    exporterTemplateApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setExporterTemplates(res.data?.list ?? []))
      .catch(() => setExporterTemplates([]))
  }, [open, record])
  /* eslint-enable react-hooks/set-state-in-effect */

  // 顶层 record 可能为 null（父组件以 open 联动传入）；未就绪则不挂载内容
  if (!record) return null

  const resourceCategory = MONITOR_TYPE_CASCADE.find((g) => g.types.includes(record.monitor_type as MonitorType))?.category as
    | ResourceCategory
    | undefined
  const categoryLabelTemplates = labelTemplates.filter((t) => t.resource_category === resourceCategory)
  // 上下文：默认采集器名 / 监控对象类型/资源类别展示
  const exporterName =
    exporterTemplates.find((t) => String(t.id) === String(record.exporter_template_id))?.name ??
    (record.exporter_template_id ? `#${record.exporter_template_id}` : '-')
  const monitorTypeLabel = MONITOR_TYPE_MAP[record.monitor_type as MonitorType] ?? record.monitor_type
  const categoryLabel = resourceCategory ? CATEGORY_MAP[resourceCategory] : '-'
  // 「更换」需显性回显当前已选模板（PRD L241）
  const currentLabel = labelTemplates.find((t) => String(t.id) === String(record.label_template_id))
  const showCurrent = mode === 'replace' && !!record.label_template_id

  const handleSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      // 仅提交标签模板：value 为空串表示解除关联（后端 label_template_id="" 视为清除）
      await ciExporterMappingApi.update(record.id, { label_template_id: value ?? '' })
      message.success(mode === 'supplement' ? '标签模板已补配' : '标签模板已更换')
      onSuccess()
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={mode === 'supplement' ? '补配标签模板' : '更换标签模板'}
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={420}
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
      {error && (
        <Alert type="error" showIcon message="保存失败" description={error} style={{ marginBottom: 16 }} />
      )}
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {mode === 'replace' ? '仅更换本默认采集配置关联的标签模板' : '仅补配本默认采集配置关联的标签模板'}；采集器、端口、采集频率等采集信息保持不变。
      </Text>

      {showCurrent && (
        <div
          style={{
            border: '1px solid #d9d9d9',
            borderRadius: 8,
            padding: '10px 12px',
            marginBottom: 12,
            background: 'var(--color-bg-layout, #fafafa)',
          }}
        >
          <Space size={6} direction="vertical">
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前模板
            </Text>
            <Space size={6}>
              <Text strong>{currentLabel?.name ?? `#${record.label_template_id}`}</Text>
              {currentLabel?.is_default && <Tag color="blue">默认</Tag>}
            </Space>
            {currentLabel && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {CATEGORY_MAP[currentLabel.resource_category] ?? currentLabel.resource_category} · #{currentLabel.id}
              </Text>
            )}
          </Space>
        </div>
      )}

      <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          监控对象类型：{monitorTypeLabel}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          资源类别：{categoryLabel}
        </Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          默认采集器：{exporterName}
        </Text>
      </Space>

      <Divider style={{ margin: '4px 0 12px' }} />

      <div>
        <div style={{ marginBottom: 8 }}>
          <Text strong>标签模板</Text>
        </div>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: '100%' }}
          loading={loadingTemplates}
          placeholder={resourceCategory ? '请选择该资源类别的标签模板' : '该监控对象类型暂无可选标签模板'}
          value={value}
          onChange={(v: string | undefined) => setValue(v || undefined)}
          notFoundContent={
            resourceCategory && categoryLabelTemplates.length === 0 ? (
              <span>
                该资源类别尚无标签模板，
                <a href="/label-templates" rel="noreferrer">
                  前往标签模板管理创建
                </a>
              </span>
            ) : undefined
          }
          options={categoryLabelTemplates.map((t) => ({
            value: String(t.id),
            label: `${t.name}（${CATEGORY_MAP[t.resource_category] ?? t.resource_category}）`,
          }))}
        />
      </div>
    </Drawer>
  )
}

export default LabelTemplateSelectDrawer