import { useState } from 'react'
import { Alert, Checkbox, Input, Modal, Tag, Typography, message } from 'antd'
import { networkDomainApi } from '../../../api/domain'
import type { CascadeImpact, NetworkDomain } from '../../../types/domain'

const { Paragraph } = Typography

/** 采集节点状态中文展示（决策 82：online / unknown / offline / retired） */
const AGENT_STATUS_LABEL: Record<string, string> = {
  online: '在线',
  unknown: '未知',
  offline: '离线',
  retired: '已退场',
}

/** 返回在确认输入上最多展示的采集节点条数 */
const MAX_AGENTS_SHOWN = 10

interface DeleteDomainModalProps {
  open: boolean
  domain: NetworkDomain | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 网域删除二次确认弹窗（Module_06 §6.2 / §11.2，决策 82-1，契约 §5.1.2）。
 * 未纳管网域：简单确认；已纳管网域：展示级联清退警告并要求输入网域名称确认；
 * 删除成功后展示实际退场（retired）采集节点清单（最多 10 条，超出省略）。
 * 若后端拒绝（存在 M07 资源引用），展示中文引导并建议改用「禁用」冻结。
 */
export function DeleteDomainModal({ open, domain, onCancel, onSuccess }: DeleteDomainModalProps) {
  // H2：以 domain.id 作为 key，网域变化 / 关闭重开时整体重建弹窗状态，
  // 避免 rejected / confirmInput / confirmChecked / 结果阶段等跨打开残留（React key 重建模式）。
  return (
    <DeleteDomainModalInner
      key={domain?.id ?? '__closed__'}
      open={open}
      domain={domain}
      onCancel={onCancel}
      onSuccess={onSuccess}
    />
  )
}

function DeleteDomainModalInner({ open, domain, onCancel, onSuccess }: DeleteDomainModalProps) {
  const [confirming, setConfirming] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [rejectMessage, setRejectMessage] = useState('')
  const [confirmInput, setConfirmInput] = useState('')
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [phase, setPhase] = useState<'confirm' | 'result'>('confirm')
  const [cascadeImpact, setCascadeImpact] = useState<CascadeImpact | null>(null)

  if (!domain) return null

  const isMonitored = !!domain.is_monitored

  const handleOk = async () => {
    if (phase === 'result') {
      const edgeAgentCount = cascadeImpact?.edge_agent_count ?? 0
      if (edgeAgentCount > 0) {
        message.success(`网域已删除，${edgeAgentCount} 个采集节点已标记退场`)
      } else {
        message.success('网域已删除')
      }
      resetState()
      onSuccess()
      onCancel()
      return
    }

    setConfirming(true)
    setRejected(false)
    try {
      const res = await networkDomainApi.remove(domain.id)
      const impact = res.data?.cascade_impact
      setConfirming(false)

      if (isMonitored && (impact?.edge_agent_count ?? 0) > 0) {
        // 已纳管分支（edge_agent_count > 0）：进入结果视图实列展示已退场采集节点清单
        setCascadeImpact(impact ?? null)
        setPhase('result')
        return
      }
      message.success('网域已删除')
      resetState()
      onSuccess()
      onCancel()
    } catch (err) {
      const raw = err instanceof Error ? err.message : ''
      // M1：后端拒绝（M07 资源引用）时不直接渲染英文原文，映射为中文；技术细节保留到日志
      if (raw) console.warn('[DeleteDomain] 网域删除被拒，技术细节：', raw)
      const matched = raw.match(/(\d+)/)
      setRejectMessage(
        raw && /M07|resource reference|资源引用/i.test(raw)
          ? `该网域存在资源引用（${matched?.[1] ?? ''} 个），请先移除资源或改用「禁用」冻结。`
          : '该网域存在资源引用，请先移除资源或改用「禁用」冻结。',
      )
      setRejected(true)
      setConfirming(false)
    }
  }

  const resetState = () => {
    setConfirmInput('')
    setConfirmChecked(false)
  }

  const handleClose = () => {
    if (!confirming) onCancel()
  }

  const canConfirm = isMonitored
    ? confirmInput.trim() === domain.name.trim() && confirmChecked
    : true
  const okDisabled = phase === 'result' ? false : !canConfirm && !rejected

  const edgeAgentCount = cascadeImpact?.edge_agent_count ?? 0
  const willRetireAgents = cascadeImpact?.will_retire_agents ?? []
  const shownAgents = willRetireAgents.slice(0, MAX_AGENTS_SHOWN)
  const omittedAgents = willRetireAgents.length - shownAgents.length

  return (
    <Modal
      title="删除网域"
      open={open}
      onCancel={handleClose}
      onOk={handleOk}
      confirmLoading={confirming}
      okText={phase === 'result' ? '完成' : '确认删除'}
      okType={phase === 'result' ? 'primary' : 'danger'}
      cancelText={phase === 'result' ? undefined : '取消'}
      cancelButtonProps={phase === 'result' ? { style: { display: 'none' } } : undefined}
      okButtonProps={{ disabled: okDisabled }}
      closable={!confirming}
      destroyOnHidden
    >
      {phase === 'result' ? (
        <>
          <Alert type="success" showIcon message="网域已删除" />
          {edgeAgentCount > 0 && (
            <>
              <Paragraph style={{ marginTop: 12 }}>
                已退场（retired）采集节点 <strong>{edgeAgentCount}</strong> 个：
              </Paragraph>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 0' }}>
                {shownAgents.map((a) => (
                  <Tag key={a.id}>
                    {a.hostname}（{AGENT_STATUS_LABEL[a.status] ?? a.status}）
                  </Tag>
                ))}
                {omittedAgents > 0 && <Tag>…等 {omittedAgents} 个</Tag>}
              </div>
            </>
          )}
        </>
      ) : rejected ? (
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
            message="该网域已纳管，删除后将执行级联清退：① 废止所有 Token；② 停止配置下发；③ 将采集节点标记为「已退场」（retired）。"
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
          <Paragraph type="secondary">删除为软删，删除后该网域不再可被引用。</Paragraph>
        </>
      )}
    </Modal>
  )
}