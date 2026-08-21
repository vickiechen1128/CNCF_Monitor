import { useState } from 'react'
import { Alert, Modal, Typography, message } from 'antd'
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
 * 空网域删除二次确认弹窗（Module_06 §6.2 / §11.2）。
 * 仅空网域（无 M07 资源引用、无已纳管 EdgeAgent）可删除；若后端拒绝（非空网域），
 * 展示错误并引导走「禁用」冻结；管理域（default）由列表页不提供删除入口。
 */
export function DeleteDomainModal({ open, domain, onCancel, onSuccess }: DeleteDomainModalProps) {
  const [confirming, setConfirming] = useState(false)
  const [rejected, setRejected] = useState(false)

  if (!domain) return null

  const handleOk = async () => {
    setConfirming(true)
    setRejected(false)
    try {
      await networkDomainApi.remove(domain.id)
      message.success('网域已删除')
      onSuccess()
      onCancel()
    } catch {
      setRejected(true)
      setConfirming(false)
    }
  }

  return (
    <Modal
      title="删除网域"
      open={open}
      onCancel={confirming ? undefined : onCancel}
      onOk={handleOk}
      confirmLoading={confirming}
      okText="确认删除"
      okType="danger"
      cancelText="取消"
      closable={!confirming}
      destroyOnClose
    >
      {rejected ? (
        <Alert
          type="warning"
          showIcon
          message="该网域不可删除"
          description="该网域存在资源引用 / 已纳管，请改用「禁用」冻结。"
        />
      ) : (
        <>
          <Paragraph>确定删除空网域「{domain.name}」（{domain.id}）吗？</Paragraph>
          <Paragraph type="secondary">
            删除为软删，仅对未纳管、无资源引用的空网域生效；删除后该网域不再可被引用。
          </Paragraph>
        </>
      )}
    </Modal>
  )
}
