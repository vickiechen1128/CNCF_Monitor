import { Button, Modal, Typography, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'

const { Text } = Typography

interface PlainTokenModalProps {
  open: boolean
  title?: string
  token: string
  tokenMasked?: string
  domainName?: string
  onClose: () => void
}

/**
 * 一次性明文 Token 展示 Modal（Module_09 契约 §3 / dev-feedback #1）。
 * list / detail 接口不返回明文 token，仅 /monitor 与 /reset-token 单次返回明文；
 * 因此明文用高对比一次性 Modal 展示并引导「复制明文」，禁止常驻 toast 暴露明文（LOW-1 / MEDIUM-1 统一交互）。
 * local 域无明文，不弹（MEDIUM-1）。
 */
export function PlainTokenModal({ open, title = '接入 Token', token, tokenMasked, domainName, onClose }: PlainTokenModalProps) {
  const handleCopy = () => {
    navigator.clipboard?.writeText(token).then(
      () => message.success('明文 Token 已复制，请妥善保存'),
      () => message.error('复制失败'),
    )
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      width={520}
      footer={[
        <Button key="close" onClick={onClose}>我已保存</Button>,
        <Button key="copy" type="primary" icon={<CopyOutlined />} onClick={handleCopy}>复制明文</Button>,
      ]}
      destroyOnHidden
    >
      {domainName ? (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          网域：{domainName}
        </Text>
      ) : null}
      <div
        style={{
          background: '#F7F8FA',
          border: '1px solid #E5E7EB',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 12,
          wordBreak: 'break-all',
          fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
          fontSize: 13,
          lineHeight: '20px',
        }}
      >
        {token}
      </div>
      <Text type="danger" style={{ fontSize: 12 }}>
        Token 仅本次展示，关闭后不再可见，请立即复制并妥善保存；遗失需重置 Token。
      </Text>
      {tokenMasked ? (
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
          脱敏表示：{tokenMasked}（用于在页面核对）
        </Text>
      ) : null}
    </Modal>
  )
}

export default PlainTokenModal