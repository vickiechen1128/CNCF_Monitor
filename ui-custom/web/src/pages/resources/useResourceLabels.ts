import { useEffect, useState } from 'react'
import { Modal, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { isApiError } from '../../api/client'
import { resourceApi } from '../../api/resources'
import { labelTemplateApi } from '../../api/labelTemplates'
import type { ResourceLabelItem } from '../../types/resource'
import type { LabelTemplateListItem } from '../../types/label'
import type { ResourceListItem } from './useResources'

/**
 * 资源详情标签管理状态与动线（T07-R8 从 ResourceDetailDrawer 抽离，行为等价）。
 *
 * 打开抽屉时抓取标签全量（resourceApi.labels）+ 适用模板（labelTemplateApi.list is_default），
 * 并重置标签卡编辑态；标签卡状态矩阵：加载骨架屏 / 空态 / 接口错误 Alert + 重新加载 /
 * 写操作 403 提示。user 标签编辑入口仅 application 资源展示（由调用方判定）。
 * 新增 / 编辑 key 与模板映射目标冲突时弹出确认，引导前往标签模板管理（/label-templates）。
 */

/** 保护 label 清单（§5.3/§5.11：禁止作为标签 key），与后端 PROTECTED_PROMETHEUS_LABELS 一致 */
const PROTECTED_PROMETHEUS_LABELS = [
  'instance',
  'job',
  'scheme',
  '__address__',
  '__scheme__',
  '__metrics_path__',
  '__name__',
]

/** key 校验规则：小写字母 / 数字 / 下划线（§5.3） */
const LABEL_KEY_RE = /^[a-z0-9_]+$/

/** key 前端预校验（§5.3：小写/下划线/禁 __ 开头/≤128/禁内置 label/不重复） */
function validateLabelKey(key: string, existing: ResourceLabelItem[]): string | null {
  if (!key) return '请输入标签 Key'
  if (key.length > 128) return 'Key 长度不能超过 128 字符'
  if (key.startsWith('__')) return 'Key 禁止以 __ 开头'
  if (!LABEL_KEY_RE.test(key)) return 'Key 仅支持小写字母 / 数字 / 下划线'
  if (PROTECTED_PROMETHEUS_LABELS.includes(key)) return '禁止覆盖 Prometheus 内置标签'
  if (existing.some((l) => l.key === key)) return '该 Key 已存在'
  return null
}

export interface UseResourceLabelsResult {
  labels: ResourceLabelItem[]
  labelsLoading: boolean
  labelsError: string | null
  /** 该资源类别的默认标签模板（标签来源标注 / 冲突判定 / 适用模板行共用） */
  template: LabelTemplateListItem | null
  writeError: string | null
  submitting: boolean
  newKey: string
  newValue: string
  editingId: number | null
  editValue: string
  setNewKey: (value: string) => void
  setNewValue: (value: string) => void
  setEditingId: (id: number | null) => void
  setEditValue: (value: string) => void
  /** 标签数据重新加载（接口错误 Alert 的「重新加载」） */
  reloadLabels: () => void
  handleAddLabel: () => void
  handleEditValue: (label: ResourceLabelItem) => void
  handleSaveEdit: (label: ResourceLabelItem) => void
  handleDeleteLabel: (label: ResourceLabelItem) => void
}

export function useResourceLabels(open: boolean, record: ResourceListItem | null): UseResourceLabelsResult {
  const navigate = useNavigate()
  const [labels, setLabels] = useState<ResourceLabelItem[]>([])
  const [labelsLoading, setLabelsLoading] = useState(false)
  const [labelsError, setLabelsError] = useState<string | null>(null)
  const [template, setTemplate] = useState<LabelTemplateListItem | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  /** 打开抽屉时重置状态并抓取标签 + 适用模板（沿用本模块既有 set-state-in-effect 模式） */
  useEffect(() => {
    if (!open || !record) return
    // 打开抽屉时同步重置标签卡状态；异步请求回调内才异步 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabelsLoading(true)
    setLabelsError(null)
    setWriteError(null)
    setEditingId(null)
    setNewKey('')
    setNewValue('')
    setLabels([])
    setTemplate(null)
    resourceApi
      .labels(record.resource_id)
      .then((res) => {
        setLabels(res.data?.items ?? [])
        setLabelsLoading(false)
      })
      .catch((err: Error) => {
        setLabelsError(err.message || '标签数据加载失败，请稍后重试')
        setLabelsLoading(false)
      })
    // 适用模板：该资源类别默认模板（labelTemplateApi.list({resource_category, is_default}) 取首条，§5.3）
    labelTemplateApi
      .list({ resource_category: record.resource_category, is_default: true, page: 1, page_size: 10 })
      .then((res) => {
        setTemplate(res.data?.list?.[0] ?? null)
      })
      .catch(() => {
        // 模板加载失败不阻塞详情展示
        setTemplate(null)
      })
  }, [open, record])

  /** 标签数据重新加载（接口错误 Alert 的「重新加载」） */
  const reloadLabels = () => {
    if (!record) return
    setLabelsLoading(true)
    setLabelsError(null)
    resourceApi
      .labels(record.resource_id)
      .then((res) => {
        setLabels(res.data?.items ?? [])
        setLabelsLoading(false)
      })
      .catch((err: Error) => {
        setLabelsError(err.message || '标签数据加载失败，请稍后重试')
        setLabelsLoading(false)
      })
  }

  /** 写操作错误统一处理：403 → 静态资源只读提示（§11.1/§6.2），其余透传后端文案 */
  const handleWriteError = (err: unknown) => {
    if (isApiError(err) && err.code === 403) {
      setWriteError('该资源为静态资源，标签由 CMDB / Excel 带入，不支持手动打标')
    } else {
      setWriteError(err instanceof Error ? err.message : '标签操作失败，请稍后重试')
    }
  }

  /** key 是否被适用模板映射为生成目标（§3.3/§5.3 冲突提示；system 标签保护、引导走模板） */
  const isTemplateMappedLabel = (key: string) => !!template && template.mappings.some((m) => m.target_label === key)

  /**
   * key 与模板映射目标冲突时弹出确认：提示「该标签由标签模板生成，如需修改请前往标签模板管理」，
   * 「前往标签模板」跳转模板页；「仍要继续」放行实例级操作。返回是否命中冲突（命中则已弹窗）。
   */
  const guardTemplateConflict = (key: string, onOk: () => void) => {
    if (isTemplateMappedLabel(key)) {
      Modal.confirm({
        title: '该标签由标签模板生成',
        content: `「${key}」由标签模板生成，如需修改请前往标签模板管理。确认仍要继续吗？`,
        okText: '仍要继续',
        cancelText: '前往标签模板',
        onOk: () => onOk(),
        onCancel: () => navigate('/label-templates'),
      })
      return true
    }
    return false
  }

  /** 新增 user 标签（仅 application 展示入口；key 冲突 / 校验失败拦截） */
  const handleAddLabel = () => {
    if (!record) return
    const key = newKey.trim()
    const value = newValue.trim()
    const keyError = validateLabelKey(key, labels)
    if (keyError) {
      message.error(keyError)
      return
    }
    if (guardTemplateConflict(key, () => doAddUserLabel(key, value))) return
    doAddUserLabel(key, value)
  }

  const doAddUserLabel = (key: string, value: string) => {
    if (!record) return
    setSubmitting(true)
    setWriteError(null)
    resourceApi
      .createLabel(record.resource_id, { key, value })
      .then((res) => {
        setLabels((prev) => [...prev, res.data])
        setNewKey('')
        setNewValue('')
        message.success('标签已添加')
      })
      .catch((err: unknown) => handleWriteError(err))
      .finally(() => setSubmitting(false))
  }

  /** 进入编辑态（仅 application 的 user 标签） */
  const handleEditValue = (label: ResourceLabelItem) => {
    setEditingId(label.id)
    setEditValue(label.value)
  }

  /** 编辑 user 标签值（key 不可改，仅更新 value，§6.2/PUT）；key 命中模板映射同样弹冲突提示 */
  const handleSaveEdit = (label: ResourceLabelItem) => {
    if (!record) return
    if (guardTemplateConflict(label.key, () => doUpdateLabel(label))) return
    doUpdateLabel(label)
  }

  const doUpdateLabel = (label: ResourceLabelItem) => {
    if (!record) return
    setSubmitting(true)
    setWriteError(null)
    resourceApi
      .updateLabel(record.resource_id, label.id, { value: editValue })
      .then((res) => {
        setLabels((prev) => prev.map((l) => (l.id === label.id ? res.data : l)))
        setEditingId(null)
        message.success('标签已更新')
      })
      .catch((err: unknown) => handleWriteError(err))
      .finally(() => setSubmitting(false))
  }

  /** 删除 user 标签 */
  const handleDeleteLabel = (label: ResourceLabelItem) => {
    if (!record) return
    setSubmitting(true)
    setWriteError(null)
    resourceApi
      .removeLabel(record.resource_id, label.id)
      .then(() => {
        setLabels((prev) => prev.filter((l) => l.id !== label.id))
        message.success('标签已删除')
      })
      .catch((err: unknown) => handleWriteError(err))
      .finally(() => setSubmitting(false))
  }

  return {
    labels,
    labelsLoading,
    labelsError,
    template,
    writeError,
    submitting,
    newKey,
    newValue,
    editingId,
    editValue,
    setNewKey,
    setNewValue,
    setEditingId,
    setEditValue,
    reloadLabels,
    handleAddLabel,
    handleEditValue,
    handleSaveEdit,
    handleDeleteLabel,
  }
}
