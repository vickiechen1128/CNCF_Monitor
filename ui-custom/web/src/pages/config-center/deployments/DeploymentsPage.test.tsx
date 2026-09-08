import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { setupAntdTest, mockAntdModal } from '../../../test/antdTestUtils'
import { DeploymentsPage } from './DeploymentsPage'
import type { ConfigDeployment } from '../../../types/config-center'

const useDeploymentsMock = vi.fn()
const fetchAllDomainsMock = vi.fn()
const deploymentApiMock = {
  list: vi.fn(),
  retry: vi.fn(),
  rollback: vi.fn(),
  getConfigVersion: vi.fn(),
}
const reloadMock = vi.fn()

vi.mock('./useDeployments', () => ({
  useDeployments: (...a: unknown[]) => useDeploymentsMock(...a),
  fetchAllDomains: (...a: unknown[]) => fetchAllDomainsMock(...a),
}))
vi.mock('../../../api/configCenter', () => ({
  deploymentApi: {
    list: (...a: unknown[]) => deploymentApiMock.list(...a),
    retry: (...a: unknown[]) => deploymentApiMock.retry(...a),
    rollback: (...a: unknown[]) => deploymentApiMock.rollback(...a),
    getConfigVersion: (...a: unknown[]) => deploymentApiMock.getConfigVersion(...a),
  },
}))
vi.mock('antd/locale/zh_CN', () => ({ default: {} }))

const deploymentRow = (over: Partial<ConfigDeployment> = {}): ConfigDeployment => ({
  id: 'deploy-001',
  network_domain_id: 'default',
  config_version_id: 'cv-20260823-001',
  source_change_no: 'CHG-20260823-001',
  channel: 'local',
  status: 'success',
  validation_status: 'passed',
  includes_blackbox: false,
  triggered_by: '张伟（运维）',
  triggered_at: '2026-08-23T10:00:00Z',
  completed_at: '2026-08-23T10:00:05Z',
  ...over,
})

function result(over: Record<string, unknown> = {}) {
  return {
    data: { items: [] as ConfigDeployment[], total: 0 },
    loading: false,
    error: null,
    permissionDenied: false,
    page: 1,
    pageSize: 20,
    onPageSizeChange: vi.fn(),
    reload: reloadMock,
    locChangeNo: undefined,
    locDomain: undefined,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DeploymentsPage />
    </MemoryRouter>,
  )
}

describe('DeploymentsPage（下发记录）', () => {
  setupAntdTest()

  beforeEach(() => {
    useDeploymentsMock.mockReset()
    deploymentApiMock.list.mockReset()
    deploymentApiMock.retry.mockReset()
    deploymentApiMock.rollback.mockReset()
    deploymentApiMock.getConfigVersion.mockReset()
    reloadMock.mockReset()
    fetchAllDomainsMock.mockReset()
    fetchAllDomainsMock.mockResolvedValue([{ id: 'default', name: '默认域' }])
  })

  it('加载中提示', () => {
    useDeploymentsMock.mockReturnValue(result({ loading: true }))
    fetchAllDomainsMock.mockResolvedValue([])
    renderPage()
    expect(screen.getByText('配置发布与回滚记录')).toBeInTheDocument()
    expect(screen.getByText(/加载中/)).toBeInTheDocument()
  })

  it('渲染下发列表：部署 ID + 网域 + 通道 + 版本 + 来源变更单号 + 状态', async () => {
    useDeploymentsMock.mockReturnValue(result({ data: { items: [deploymentRow()], total: 1 } }))
    renderPage()
    expect(await screen.findByText('deploy-001')).toBeInTheDocument()
    expect(screen.getByText('默认域')).toBeInTheDocument()
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(screen.getByText('cv-20260823-001')).toBeInTheDocument()
    expect(screen.getByText('CHG-20260823-001')).toBeInTheDocument()
    expect(screen.getByText('成功')).toBeInTheDocument()
  })

  it('failed 记录带错误 Tooltip：local 展示「重试」按钮，agent_pull 不展示', async () => {
    useDeploymentsMock.mockReturnValue(
      result({
        data: {
          items: [
            deploymentRow({ id: 'deploy-local', status: 'failed', channel: 'local', error_message: '写盘失败' }),
            deploymentRow({ id: 'deploy-agent', status: 'failed', channel: 'agent_pull', error_message: '平台故障' }),
          ],
          total: 2,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('deploy-local')).toBeInTheDocument()
    // local failed 行有「重试」按钮；agent_pull 行没有
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
    const deployAgentRow = screen.getByText('deploy-agent').closest('tr')
    expect(deployAgentRow).not.toBeNull()
  })

  it('空态：暂无下发记录', async () => {
    useDeploymentsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('暂无下发记录')).toBeInTheDocument()
  })

  it('接口错误展示错误 Alert，重试触发 reload', async () => {
    useDeploymentsMock.mockReturnValue(result({ error: '接口异常' }))
    renderPage()
    expect(await screen.findByText('下发记录加载失败')).toBeInTheDocument()
    // antd Button 会在两个汉字间插入空格（「重 试」），比对时忽略空白
    const retryBtn = screen.getAllByRole('button').find((b) => b.textContent?.replace(/\s/g, '') === '重试')
    expect(retryBtn).toBeDefined()
    fireEvent.click(retryBtn as HTMLElement)
    expect(reloadMock).toHaveBeenCalled()
  })

  it('权限不足展示警告 Alert', async () => {
    useDeploymentsMock.mockReturnValue(result({ permissionDenied: true }))
    renderPage()
    expect(await screen.findByText('权限不足')).toBeInTheDocument()
  })

  it('定位参数：change_no + network_domain 展示定位 Alert', async () => {
    useDeploymentsMock.mockReturnValue(result({ locChangeNo: 'CHG-20260823-001', locDomain: 'default' }))
    renderPage()
    expect(await screen.findByText(/当前定位：变更单 CHG-20260823-001/)).toBeInTheDocument()
    expect(screen.getByText(/列表已按该变更单过滤/)).toBeInTheDocument()
  })

  it('详情抽屉：点击详情展示 Deployment Descriptions 字段', async () => {
    useDeploymentsMock.mockReturnValue(result({ data: { items: [deploymentRow()], total: 1 } }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /查看详情/ }))
    expect(await screen.findByText('下发记录详情：deploy-001')).toBeInTheDocument()
    expect(screen.getByText('操作人')).toBeInTheDocument()
  })

  it('回滚：Modal 二次确认后调用 rollback 并 reload', async () => {
    useDeploymentsMock.mockReturnValue(result({ data: { items: [deploymentRow()], total: 1 } }))
    deploymentApiMock.rollback.mockResolvedValue({ status: 'success', data: deploymentRow() })
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /回滚/ }))
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    expect(deploymentApiMock.rollback).toHaveBeenCalledWith('cv-20260823-001', expect.any(String))
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
  })

  it('回滚确认弹窗文案指向所选版本（PRD §3.5：不出现「上一可用版本」误导表述）', async () => {
    useDeploymentsMock.mockReturnValue(result({ data: { items: [deploymentRow()], total: 1 } }))
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /回滚/ }))
    const content = modal.confirm.mock.calls[0][0].content as ReactElement
    const { container } = render(<MemoryRouter>{content}</MemoryRouter>)
    expect(container.textContent).toContain('回滚到所选版本')
    expect(container.textContent).toContain('cv-20260823-001')
    expect(container.textContent).toContain('CHG-20260823-001')
    expect(container.textContent).not.toContain('上一可用配置版本')
  })

  it('rolled_back 记录渲染「已回滚」标签且回滚按钮可点（PRD §8：可再次作为回滚目标）', async () => {
    useDeploymentsMock.mockReturnValue(
      result({
        data: {
          items: [
            deploymentRow({ id: 'deploy-rb', status: 'rolled_back' }),
            deploymentRow({ id: 'deploy-ok', status: 'success' }),
          ],
          total: 2,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('已回滚')).toBeInTheDocument()
    // rolled_back 行回滚按钮可用
    const rbRow = screen.getByText('deploy-rb').closest('tr') as HTMLElement
    const rbBtn = Array.from(rbRow.querySelectorAll('button')).find((b) => b.textContent?.replace(/\s/g, '') === '回滚')
    expect(rbBtn).toBeDefined()
    expect(rbBtn).not.toBeDisabled()
    // success 行同样可点；failed/pending 禁用
    const okRow = screen.getByText('deploy-ok').closest('tr') as HTMLElement
    const okBtn = Array.from(okRow.querySelectorAll('button')).find((b) => b.textContent?.replace(/\s/g, '') === '回滚')
    expect(okBtn).not.toBeDisabled()
  })

  it('failed / pending 记录回滚按钮保持禁用', async () => {
    useDeploymentsMock.mockReturnValue(
      result({
        data: {
          items: [
            deploymentRow({ id: 'deploy-failed', status: 'failed', error_message: '写盘失败' }),
            deploymentRow({ id: 'deploy-pending', status: 'pending' }),
          ],
          total: 2,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('deploy-failed')).toBeInTheDocument()
    for (const id of ['deploy-failed', 'deploy-pending']) {
      const row = screen.getByText(id).closest('tr') as HTMLElement
      const btn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.replace(/\s/g, '') === '回滚')
      expect(btn).toBeDisabled()
    }
  })

  it('详情抽屉「查看版本配置」：展开时懒加载并按文件分 Tab 只读展示', async () => {
    useDeploymentsMock.mockReturnValue(result({ data: { items: [deploymentRow()], total: 1 } }))
    deploymentApiMock.getConfigVersion.mockResolvedValue({
      status: 'success',
      data: {
        id: 'cv-20260823-001',
        network_domain_id: 'default',
        prometheus_yml: 'global:\n  scrape_interval: 15s\n',
        rules_yml: 'groups: []\n',
        targets_files: { 'node-exporter.json': '[{"targets":["1.2.3.4:9100"]}]' },
      },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /查看详情/ }))
    expect(await screen.findByText('下发记录详情：deploy-001')).toBeInTheDocument()
    // 展开前不调用（懒加载）
    expect(deploymentApiMock.getConfigVersion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText(/查看版本配置/))
    await waitFor(() =>
      expect(deploymentApiMock.getConfigVersion).toHaveBeenCalledWith('cv-20260823-001'),
    )
    expect(await screen.findByText(/scrape_interval: 15s/)).toBeInTheDocument()
    expect(screen.getByText('rules.yml')).toBeInTheDocument()
    expect(screen.getByText('targets/*.json')).toBeInTheDocument()
  })

  it('详情抽屉「查看版本配置」加载失败展示错误态，可重试', async () => {
    useDeploymentsMock.mockReturnValue(result({ data: { items: [deploymentRow()], total: 1 } }))
    deploymentApiMock.getConfigVersion
      .mockRejectedValueOnce(new Error('网络异常'))
      .mockResolvedValueOnce({
        status: 'success',
        data: { id: 'cv-20260823-001', network_domain_id: 'default', prometheus_yml: 'global: {}\n' },
      })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /查看详情/ }))
    fireEvent.click(await screen.findByText(/查看版本配置/))
    expect(await screen.findByText('版本配置加载失败')).toBeInTheDocument()
    expect(screen.getByText('网络异常')).toBeInTheDocument()
    // 错误态重试（抽屉内唯一的「重试」按钮）
    const retryBtn = screen.getAllByRole('button').find((b) => b.textContent?.replace(/\s/g, '') === '重试')
    fireEvent.click(retryBtn as HTMLElement)
    await waitFor(() => expect(deploymentApiMock.getConfigVersion).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/global: \{\}/)).toBeInTheDocument()
  })

  it('重试：local failed 行 Modal 二次确认后调用 retry 并 reload', async () => {
    useDeploymentsMock.mockReturnValue(
      result({ data: { items: [deploymentRow({ status: 'failed', channel: 'local', error_message: '写盘失败' })], total: 1 } }),
    )
    deploymentApiMock.retry.mockResolvedValue({ status: 'success', data: deploymentRow({ status: 'success' }) })
    const modal = mockAntdModal()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /重试/ }))
    const onOk = modal.confirm.mock.calls[0][0].onOk as () => Promise<void>
    await onOk()
    expect(deploymentApiMock.retry).toHaveBeenCalledWith('deploy-001', expect.any(String))
    await waitFor(() => expect(reloadMock).toHaveBeenCalled())
  })
})