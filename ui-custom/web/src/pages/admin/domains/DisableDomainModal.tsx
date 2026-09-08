import { useState } from 'react'
import { Alert, Modal, Typography, message } from 'antd'
import { networkDomainApi, resolveNetworkDomainImpact } from '../../../api/domain'
import type { NetworkDomain, NetworkDomainImpact } from '../../../types/domain'

const { Paragraph } = Typography

interface DisableDomainModalProps {
  open: boolean
  domain: NetworkDomain | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 禁用网域二次确认弹窗（Module_06 §6.2 / §11.2）。
 * 禁用 = 冻结：禁用需二次确认并展示后端返回的影响范围（该网域下资源数 / 已纳管 EdgeAgent 数）；
 * 管理域（default）不可禁用（页面已置灰，此处双重防御）。
 */
export function DisableDomainModal({ open, domain, onCancel, onSuccess }: DisableDomainModalProps) {
  const [confirming, setConfirming] = useState(false)
  const [phase, setPhase] = useState<'confirm' | 'result'>('confirm')
  const [impact, setImpact] = useState<NetworkDomainImpact | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!domain) return null

  const handleOk = async () => {
    if (phase === 'result') {
      onSuccess()
      onCancel()
      return
    }
    if (domain.domain_type === 'management') {
      message.error('系统预置管理域不可禁用')
      return
    }
    setConfirming(true)
    setError(null)
    try {
      const res = await networkDomainApi.updateStatus(domain.id, 'disabled')
      setImpact(resolveNetworkDomainImpact(res))
      setConfirming(false)
      setPhase('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : '禁用失败，请稍后重试')
      setConfirming(false)
    }
  }

  return (
    <Modal
      title="禁用网域"
      open={open}
      onCancel={confirming ? undefined : onCancel}
      onOk={handleOk}
      confirmLoading={confirming}
      okText={phase === 'result' ? '完成' : '确认禁用'}
      okType={phase === 'result' ? 'primary' : 'danger'}
      cancelText={phase === 'result' ? undefined : '取消'}
      cancelButtonProps={phase === 'result' ? { style: { display: 'none' } } : undefined}
      closable={!confirming}
      destroyOnHidden
    >
      {phase === 'confirm' ? (
        <>
          <Paragraph>确定禁用网域「{domain.name}」（{domain.id}）吗？</Paragraph>
          <Paragraph type="secondary">
            禁用 = 冻结：禁用后该网域不再接受新资源登记与新纳管；存量资源与采集配置不受影响、继续采集。
          </Paragraph>
          {error && <Alert type="error" showIcon message={error} />}
        </>
      ) : (
        <Alert
          type="warning"
          showIcon
          message="禁用已生效，影响范围如下"
          description={
            <div>
              <p>该网域下 M07 资源数：{impact?.resource_count ?? 0}</p>
              <p>已纳管 EdgeAgent 数：{impact?.managed_edge_agent_count ?? 0}</p>
            </div>
          }
        />
      )}
    </Modal>
  )
}
