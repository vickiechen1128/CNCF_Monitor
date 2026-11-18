import { useEffect, useMemo, useState } from 'react'
import { Alert, Modal, Select, Space, Typography, message } from 'antd'
import { ApiError } from '../../api/client'
import { resourceApi } from '../../api/resources'
import type {
  ApplicationDict,
  BulkReassignFailure,
  BulkReassignField,
  BusinessDomain,
  PlatformDict,
  ResourceCategory,
} from '../../types/resource'
import { dictionaryStatusOf } from './dictionaryLifecycle'
import { RESOURCE_TYPE_MAP } from './resourceMeta'

const { Text } = Typography

export interface BulkReassignModalProps {
  open: boolean
  /** 当前 Tab 的资源类别（同一次批量选择只含同一类别） */
  category: ResourceCategory
  /** 勾选的资源 ID */
  resourceIDs: string[]
  businessDomains: BusinessDomain[]
  applicationDomains: ApplicationDict[]
  platformDicts: PlatformDict[]
  onCancel: () => void
  onSuccess: (updatedCount: number) => void
}

const FIELD_OPTIONS: Array<{ value: BulkReassignField; label: string }> = [
  { value: 'biz_code', label: '业务归属' },
  { value: 'app_code', label: '应用归属' },
  { value: 'platform_code', label: '平台归属' },
]

/**
 * 批量改归属弹窗（M07 SRS v2.0 FR-28）。
 *
 * - 目标只列启用中的字典条目；
 * - 组成型资源（应用服务 / 接口服务）的平台由应用主平台派生，平台归属不可直接批量修改；
 * - 单事务提交：任一资源校验失败整批回滚，弹窗内逐条展示失败明细。
 */
export function BulkReassignModal({
  open,
  category,
  resourceIDs,
  businessDomains,
  applicationDomains,
  platformDicts,
  onCancel,
  onSuccess,
}: BulkReassignModalProps) {
  const composed = category === 'application' || category === 'interface_service'
  const defaultField: BulkReassignField = composed ? 'app_code' : 'biz_code'

  const [field, setField] = useState<BulkReassignField>(defaultField)
  const [target, setTarget] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)
  const [failures, setFailures] = useState<BulkReassignFailure[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setField(defaultField)
    setTarget(undefined)
    setFailures([])
    setError(null)
  }, [open, defaultField])

  const targetOptions = useMemo(() => {
    switch (field) {
      case 'biz_code':
        return businessDomains
          .filter((item) => dictionaryStatusOf(item) === 'enabled')
          .map((item) => ({ value: item.code, label: `${item.name}（${item.code}）` }))
      case 'app_code':
        return applicationDomains
          .filter((item) => dictionaryStatusOf(item) === 'enabled')
          .map((item) => ({ value: item.app_code, label: `${item.app_name}（${item.app_code}）` }))
      case 'platform_code':
        return platformDicts
          .filter((item) => dictionaryStatusOf(item) === 'enabled')
          .map((item) => ({ value: item.platform_code, label: `${item.platform_name}（${item.platform_code}）` }))
      default:
        return []
    }
  }, [field, businessDomains, applicationDomains, platformDicts])

  const fieldOptions = useMemo(
    () =>
      FIELD_OPTIONS.map((option) =>
        option.value === 'platform_code' && composed ? { ...option, disabled: true } : option,
      ),
    [composed],
  )

  const handleSubmit = async () => {
    if (!target) {
      message.warning('请选择目标条目')
      return
    }
    setSubmitting(true)
    setFailures([])
    setError(null)
    try {
      const res = await resourceApi.bulkReassign({
        resource_ids: resourceIDs,
        field,
        target_code: target,
      })
      const updated = res.data?.updated_count ?? resourceIDs.length
      message.success(`已修改 ${updated} 条资源的归属`)
      onSuccess(updated)
    } catch (e) {
      if (e instanceof ApiError) {
        const payload = e.payload as
          | { data?: { failures?: BulkReassignFailure[] } }
          | undefined
        const list = payload?.data?.failures ?? []
        if (list.length > 0) {
          setFailures(list)
          setError(e.message)
          return
        }
      }
      setError(e instanceof Error ? e.message : '批量改归属失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      title="批量改归属"
      open={open}
      onCancel={onCancel}
      onOk={() => void handleSubmit()}
      okText="确认修改"
      cancelText="取消"
      okButtonProps={{ disabled: !target }}
      confirmLoading={submitting}
      destroyOnHidden
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message={`已选 ${resourceIDs.length} 条${RESOURCE_TYPE_MAP[category]}资源`}
          description="整批单事务提交：任一资源校验失败则全部不修改，并给出逐条原因。"
        />
        {composed && (
          <Alert
            type="warning"
            showIcon
            message="平台归属由应用主平台自动派生"
            description="应用服务 / 接口服务不能直接批量改平台；修改应用归属时会自动跟随目标应用的主平台。"
          />
        )}
        <div>
          <Text type="secondary">修改字段</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            aria-label="修改字段"
            value={field}
            options={fieldOptions}
            onChange={(value) => {
              setField(value)
              setTarget(undefined)
              setFailures([])
              setError(null)
            }}
          />
        </div>
        <div>
          <Text type="secondary">目标条目</Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            aria-label="目标条目"
            placeholder="仅列出启用中的条目"
            value={target}
            options={targetOptions}
            onChange={(value) => {
              setTarget(value)
              setFailures([])
              setError(null)
            }}
            showSearch
            optionFilterProp="label"
          />
        </div>
        {error && (
          <Alert
            type="error"
            showIcon
            message={failures.length > 0 ? '整批未修改' : '批量改归属失败'}
            description={
              failures.length > 0 ? (
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {failures.map((failure) => (
                    <li key={failure.resource_id}>
                      <Text code>{failure.resource_id}</Text>：{failure.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                error
              )
            }
          />
        )}
      </Space>
    </Modal>
  )
}
