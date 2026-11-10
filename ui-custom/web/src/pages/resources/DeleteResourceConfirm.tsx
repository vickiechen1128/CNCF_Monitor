import { Alert, Button } from 'antd'
import type { ResourceReferenceJob } from '../../api/resources'

/**
 * 删除资源二次确认内容（B 方案知情确认，dev-feedback §15 F-21）：回显引用该资源的采集 Job
 * 数与名单，并提供「查看引用 Job」跳转（/scrape-jobs）。无引用时仅提示不可恢复。
 */
export function DeleteResourceConfirm({
  displayName,
  total,
  jobs,
  onViewReferences,
}: {
  displayName: string
  total: number
  jobs: ResourceReferenceJob[]
  onViewReferences: () => void
}) {
  if (total === 0) {
    return <p>确认删除资源「{displayName}」？删除后不可恢复。</p>
  }
  return (
    <div>
      <Alert
        type="warning"
        showIcon
        message={`该资源正被 ${total} 个采集 Job 引用，删除后这些 Job 将停止采集该实例`}
        style={{ marginBottom: 12 }}
      />
      <div style={{ marginBottom: 8 }}>引用该资源的采集 Job：</div>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        {jobs.map((j) => (
          <li key={j.job_name}>
            {j.job_name}
            {!j.enabled && <span style={{ color: 'rgba(0,0,0,0.45)' }}>（已停用）</span>}
            <span style={{ color: 'rgba(0,0,0,0.45)' }}> · 网域 {j.network_domain_id}</span>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 12 }}>
        <Button type="link" size="small" onClick={onViewReferences}>
          查看引用 Job
        </Button>
      </div>
    </div>
  )
}

export default DeleteResourceConfirm
