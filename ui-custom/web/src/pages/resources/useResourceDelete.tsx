import { useState } from 'react'
import { App, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { ExclamationCircleOutlined } from '@ant-design/icons'
import { resourceApi } from '../../api/resources'
import type { ResourceReferenceResponse } from '../../api/resources'
import type { ResourceListItem } from './useResources'
import { resourceDisplayName } from './resourceMeta'
import { DeleteResourceConfirm } from './DeleteResourceConfirm'

/**
 * 删除资源动线（T07-R5 从 ResourcesPage 抽离，行为等价）。
 *
 * B 方案知情确认（dev-feedback §15 F-21）：点击「删除」先调
 * GET /resources/:resource_id/referenced-by 预检引用关系，再经 App.useApp().modal.confirm
 * 弹二次确认（渲染在 React 树内，随 RTL cleanup 卸载，避免静态 Modal.confirm 泄漏到 document.body）。
 * 弹窗回显引用数与引用名单 + 「查看引用 Job」跳转（/scrape-jobs）；无引用时仅提示不可恢复；
 * 引用查询失败静默降级、不阻断删除，仅不展示引用提示。确认后调 DELETE /resources/:resource_id，
 * 成功提示并回刷列表，失败提示错误信息。
 */
export function useResourceDelete({ reload }: { reload: () => void }): {
  deletingId: string | null
  handleDeleteClick: (record: ResourceListItem) => Promise<void>
} {
  const { modal } = App.useApp()
  const navigate = useNavigate()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (record: ResourceListItem) => {
    setDeletingId(record.resource_id)
    try {
      await resourceApi.remove(record.resource_id)
      message.success('资源已删除')
      reload()
    } catch (err) {
      // B 方案（dev-feedback §15 F-21）：删除静默放行，不再返回 403；引用信息在确认弹窗预检回显。
      message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDeleteClick = async (record: ResourceListItem) => {
    let ref: ResourceReferenceResponse | null
    try {
      const res = await resourceApi.referencedBy(record.resource_id)
      ref = res.data ?? null
    } catch {
      ref = null
    }
    const total = ref?.total ?? 0
    const jobs = ref?.jobs ?? []
    modal.confirm({
      title: '删除资源',
      icon: <ExclamationCircleOutlined />,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => handleDelete(record),
      content: (
        <DeleteResourceConfirm
          displayName={resourceDisplayName(record)}
          total={total}
          jobs={jobs}
          onViewReferences={() => navigate('/scrape-jobs')}
        />
      ),
    })
  }

  return { deletingId, handleDeleteClick }
}
