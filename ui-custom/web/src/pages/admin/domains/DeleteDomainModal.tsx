import { useState } from 'react'
import { Alert, Checkbox, Input, Modal, Typography, message } from 'antd'
import { networkDomainApi } from '../../../api/domain'
import type { NetworkDomain } from '../../../types/domain'

const { Paragraph } = Typography

interface DeleteDomainModalProps {
  open: boolean
  domain: NetworkDomain | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 网域删除二次确认弹窗（Module_06 §6.2 / §11.2，决策 82-1）。
 * 未纳管网域：简单确认；已纳管网域：展示级联清退警告并要求输入网域名称确认。
 * 若后端拒绝（存在 M07 资源引用），展示错误并引导走「禁用」冻结。
 */
export function DeleteDomainModal({ open, domain, onCancel, onSuccess }: DeleteDomainModalProps) {
  const [confirming, setConfirming] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [rejectMessage, setRejectMessage] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [confirmChecked, setConfirmChecked] = useState(false)

  if (!domain) return null

  const isMonitored = domain.is_monitored

  const handleOk = async () => {
    setConfirming(true)
    setRejected(false)
    try {
      const res = await networkDomainApi.remove(domain.id)
      const retired = res.data?.cascade_retired

      if (isMonitored && retired?.agent_count) {
        message.success(`网域已删除，${retired.agent_count} 个采集节点已标记退役`)
      } else {
        message.success('网域已删除')
      }

      onSuccess()
      onCancel()
      resetState()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败'
      setRejectMessage(msg)
      setRejected(true)
      setConfirming(false)
    }
  }

  const resetState = () => {
    setConfirmInput('')
    setConfirmChecked(false)
  }

  const handleClose = () => {
    if (!confirming) {
      resetState()
      onCancel()
    }
  }

  const canConfirm = isMonitored ? confirmInput === domain.name && confirmChecked : true

  return (
    <Modal
      title="删除网域"
      open={open}
      onCancel={handleClose}
      onOk={handleOk}
      confirmLoading={confirming}
      okText="确认删除"
      okType="danger"
      okButtonProps={{ disabled: !canConfirm && !rejected }}
      cancelText="取消"
      closable={!confirming}
      destroyOnHidden
    >
      {rejected ? (
        <Alert
          type="warning"
          showIcon
          message="该网域不可删除"
          description={rejectMessage || '该网域存在资源引用，请先移除资源或改用「禁用」冻结。'}
        />
      ) : isMonitored ? (
        <>
          <Alert
            type="warning"
            showIcon
            message="该网域已纳管，删除后将执行级联清退"
            description={
              <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                <li>所有采集节点将断连</li>
                <li>凭据（Token）将废止</li>
                <li>配置下发将停止</li>
                <li>采集节点将被标记为「已退场」（retired，终态，供审计追溯）</li>
              </ul>
            }
          />
          <Paragraph style={{ marginTop: 16 }}>
            请输入网域名称 <strong>{domain.name}</strong> 以确认删除：
          </Paragraph>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder={domain.name}
            disabled={confirming}
          />
          <Checkbox
            checked={confirmChecked}
            onChange={(e) => setConfirmChecked(e.target.checked)}
            disabled={confirming}
            style={{ marginTop: 12 }}
          >
            我已了解级联清退影响，确认删除
          </Checkbox>
        </>
      ) : (
        <>
          <Paragraph>确定删除网域「{domain.name}」（{domain.id}）吗？</Paragraph>
          <Paragraph type="secondary">
            删除为软删，删除后该网域不再可被引用。
          </Paragraph>
        </>
      )}
    </Modal>
  )
}
