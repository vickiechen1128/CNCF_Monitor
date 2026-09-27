import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { OnboardDomainDrawer } from './OnboardDomainDrawer'
import { DOMAIN_FIELD_TIP } from '../configCenterConstants'
import type { NetworkDomain } from '../../../types/config-center'

const baseDomain: NetworkDomain = {
  id: 'gov-cloud-a',
  name: '政务云A区',
  domain_type: 'edge',
  tenant_id: 'platform_admin',
  channel: 'agent_pull',
  is_monitored: false,
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
}

function renderDrawer(domain: NetworkDomain = baseDomain) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <OnboardDomainDrawer open domain={domain} onSubmit={onSubmit} onClose={onClose} />,
  )
  return { onSubmit, onClose }
}

/**
 * 网域纳管抽屉（M11 网域边缘接入）：字段解释形态 + 用户术语。
 * 形态约定：字段级解释一律走标签旁问号 Tooltip，字段下方不散落 12px 灰字注释。
 */
describe('OnboardDomainDrawer（网域纳管抽屉）', () => {
  setupAntdTest()

  beforeEach(() => {
    vi.useRealTimers()
  })

  it('字段解释走标签旁 Tooltip：默认不常显，悬浮问号后才出现', async () => {
    renderDrawer()

    // ① 说明文本默认不在 DOM 中（不再以字段下方小字形式常显）
    expect(screen.queryByText(DOMAIN_FIELD_TIP.remoteWriteUrl)).toBeNull()

    // ② 五个字段均带问号悬浮入口
    const icons = document.querySelectorAll('.anticon-question-circle')
    expect(icons.length).toBe(5)

    // ③ 悬浮「指标回传地址」的问号（顺序：目标网域 / 接入方式 / 采集器类型 / 回传地址 / 描述）
    fireEvent.mouseEnter(icons[3])
    expect(await screen.findByText(DOMAIN_FIELD_TIP.remoteWriteUrl)).toBeInTheDocument()
  })

  it('用户术语：标签为「指标回传地址」，接入方式 Tag 为「采集节点域」，不复现「Remote Write URL / 边缘域」', () => {
    renderDrawer()

    expect(screen.getByText('指标回传地址')).toBeInTheDocument()
    expect(screen.getByText('采集节点域')).toBeInTheDocument()
    expect(screen.queryByText('Remote Write URL')).toBeNull()
    expect(screen.queryByText('边缘域')).toBeNull()
    expect(screen.queryByText('agent_pull')).toBeNull()
  })

  it('中心直连域（local）：接入方式 Tag 为「中心直连域」，悬浮说明为直连口径', async () => {
    renderDrawer({ ...baseDomain, id: 'default', name: 'default', domain_type: 'management', channel: 'local' })

    expect(screen.getByText('中心直连域')).toBeInTheDocument()
    const icons = document.querySelectorAll('.anticon-question-circle')
    fireEvent.mouseEnter(icons[1])
    expect(await screen.findByText(DOMAIN_FIELD_TIP.channelLocal)).toBeInTheDocument()
  })
})
