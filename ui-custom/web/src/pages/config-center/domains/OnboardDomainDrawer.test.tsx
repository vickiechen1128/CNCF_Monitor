import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { OnboardDomainDrawer } from './OnboardDomainDrawer'
import type { NetworkDomain } from '../../../types/config-center'

const baseDomain: NetworkDomain = {
  id: 'gov-cloud-a',
  name: '政务云A区',
  domain_type: 'edge',
  tenant_id: '',
  channel: 'agent_pull',
  cloud_code: 'aliyun',
  zone_type: 'internet',
  is_monitored: false,
  created_at: '2026-09-25T00:00:00Z',
  updated_at: '2026-09-25T00:00:00Z',
}

function renderDrawer(domain: NetworkDomain = baseDomain) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  const utils = render(
    <OnboardDomainDrawer open domain={domain} onSubmit={onSubmit} onClose={onClose} />,
  )
  return { ...utils, onSubmit, onClose }
}

/**
 * 网域纳管抽屉（M09 v3 §2.2）：v3 纳管接口不接收请求体，
 * 抽屉只做信息确认，Token/回传地址由后端签发/推导。
 */
describe('OnboardDomainDrawer（网域纳管抽屉）', () => {
  setupAntdTest()

  it('只读展示网域行政信息（名称 / ID / 云归属 / 网络区域）', () => {
    renderDrawer()

    expect(screen.getByText('政务云A区')).toBeInTheDocument()
    expect(screen.getByText('gov-cloud-a')).toBeInTheDocument()
    expect(screen.getByText('aliyun')).toBeInTheDocument()
    expect(screen.getByText('internet')).toBeInTheDocument()
  })

  it('不再渲染可编辑的监控参数表单（v3 纳管无请求体）', () => {
    renderDrawer()

    expect(screen.queryByText('指标回传地址')).not.toBeInTheDocument()
    expect(screen.queryByText('回传积压磁盘上限')).not.toBeInTheDocument()
    expect(screen.queryByText('指标采集器类型')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/留空按采集节点默认兜底/)).not.toBeInTheDocument()
  })

  it('确认纳管触发 onSubmit（无参数）', async () => {
    const { onSubmit } = renderDrawer()

    fireEvent.click(screen.getByRole('button', { name: /确认纳管/ }))

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith())
  })

  it('取消触发 onClose，不提交', () => {
    const { onSubmit, onClose } = renderDrawer()

    // antd 会在两个汉字之间插入空格（取 消），用宽松匹配
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
