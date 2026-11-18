import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BulkReassignModal } from './BulkReassignModal'
import { setupAntdTest, mockAntdMessage } from '../../test/antdTestUtils'
import { ApiError } from '../../api/client'
import type {
  ApplicationDict,
  BusinessDomain,
  PlatformDict,
  ResourceCategory,
} from '../../types/resource'

const bulkReassignMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: {
    bulkReassign: (...args: unknown[]) => bulkReassignMock(...args),
  },
  // dictionaryLifecycle（dictionaryStatusOf 所在模块）在模块顶层引用该 API
  dictionaryAuditApi: { list: vi.fn() },
}))

const cancelMock = vi.fn()
const successMock = vi.fn()

function businessDomain(
  code: string,
  name: string,
  over: Partial<BusinessDomain> = {},
): BusinessDomain {
  return {
    code,
    name,
    enabled: true,
    status: 'enabled',
    reference_count: 0,
    ...over,
  }
}

function applicationDict(
  appCode: string,
  appName: string,
  over: Partial<ApplicationDict> = {},
): ApplicationDict {
  return {
    app_code: appCode,
    app_name: appName,
    enabled: true,
    status: 'enabled',
    reference_count: 0,
    platform_codes: [],
    ...over,
  } as ApplicationDict
}

function platformDict(
  platformCode: string,
  platformName: string,
  over: Partial<PlatformDict> = {},
): PlatformDict {
  return {
    platform_code: platformCode,
    platform_name: platformName,
    enabled: true,
    status: 'enabled',
    reference_count: 0,
    ...over,
  } as PlatformDict
}

const businessDomains = [
  businessDomain('payment', '支付业务'),
  businessDomain('ops', '运维业务'),
  businessDomain('legacy', '旧业务', { enabled: false, status: 'disabled' }),
  businessDomain('merged-old', '历史业务', { enabled: false, status: 'merged', merged_into: 'payment' }),
]

const applicationDomains = [
  applicationDict('order-service', '订单服务'),
  applicationDict('legacy-app', '旧应用', { status: 'disabled' }),
]

const platformDicts = [
  platformDict('ecommerce', '电商平台'),
  platformDict('legacy-platform', '旧平台', { enabled: false, status: 'disabled' }),
]

function renderModal(over: Partial<{
  category: ResourceCategory
  resourceIDs: string[]
}> = {}) {
  return render(
    <BulkReassignModal
      open
      category={over.category ?? 'host'}
      resourceIDs={over.resourceIDs ?? ['res-1', 'res-2']}
      businessDomains={businessDomains}
      applicationDomains={applicationDomains}
      platformDicts={platformDicts}
      onCancel={cancelMock}
      onSuccess={successMock}
    />,
  )
}

/** 按弹窗内出现顺序打开 Select：0 = 修改字段，1 = 目标条目。 */
function openSelect(index: number) {
  const selectors = document.querySelectorAll('.ant-select-selector')
  expect(selectors.length).toBeGreaterThan(index)
  fireEvent.mouseDown(selectors[index] as HTMLElement)
}

async function pickOption(label: string) {
  fireEvent.click(
    await screen.findByText(label, { selector: '.ant-select-item-option-content' }),
  )
}

describe('BulkReassignModal', () => {
  setupAntdTest()

  beforeEach(() => {
    bulkReassignMock.mockReset()
    cancelMock.mockReset()
    successMock.mockReset()
    mockAntdMessage()
  })

  it('静态资源默认改业务归属，目标只列启用中的条目', async () => {
    bulkReassignMock.mockResolvedValue({
      status: 'success',
      data: { updated_count: 2, field: 'biz_code', target_code: 'payment' },
    })
    renderModal()

    expect(screen.getByText('已选 2 条主机资源')).toBeInTheDocument()

    openSelect(1)
    expect(
      await screen.findByText('支付业务（payment）', { selector: '.ant-select-item-option-content' }),
    ).toBeInTheDocument()
    // 停用 / 已合并条目不得出现在批量改归属目标中（FR-28 目标必须启用）
    expect(screen.queryByText('旧业务（legacy）', { selector: '.ant-select-item-option-content' })).toBeNull()
    expect(screen.queryByText('历史业务（merged-old）', { selector: '.ant-select-item-option-content' })).toBeNull()

    await pickOption('支付业务（payment）')
    fireEvent.click(screen.getByRole('button', { name: /确认修改/ }))

    await waitFor(() =>
      expect(bulkReassignMock).toHaveBeenCalledWith({
        resource_ids: ['res-1', 'res-2'],
        field: 'biz_code',
        target_code: 'payment',
      }),
    )
    await waitFor(() => expect(successMock).toHaveBeenCalledWith(2))
  })

  it('组成型资源默认改应用归属，平台归属不可选并提示派生规则', async () => {
    renderModal({ category: 'application' })

    expect(screen.getByText(/平台归属由应用主平台自动派生/)).toBeInTheDocument()
    expect(screen.getByText('已选 2 条应用服务资源')).toBeInTheDocument()

    openSelect(0)
    const platformOption = (await screen.findByText('平台归属', {
      selector: '.ant-select-item-option-content',
    })).closest('.ant-select-item-option')
    expect(platformOption).toHaveClass('ant-select-item-option-disabled')

    await pickOption('应用归属')
    openSelect(1)
    expect(
      await screen.findByText('订单服务（order-service）', {
        selector: '.ant-select-item-option-content',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('旧应用（legacy-app）', { selector: '.ant-select-item-option-content' }),
    ).toBeNull()
  })

  it('400 响应按 data.failures 逐条展示失败明细，且不回调成功', async () => {
    bulkReassignMock.mockRejectedValue(
      new ApiError('1 条资源校验失败，整批未修改，请查看失败明细', 400, 'bad_request', {
        status: 'error',
        errorType: 'bad_request',
        error: '1 条资源校验失败，整批未修改，请查看失败明细',
        data: {
          failures: [
            { resource_id: 'res-1', reason: '平台 "lab" 未关联目标应用 "inventory"' },
          ],
        },
      }),
    )
    renderModal()

    openSelect(1)
    await pickOption('支付业务（payment）')
    fireEvent.click(screen.getByRole('button', { name: /确认修改/ }))

    expect(await screen.findByText('整批未修改')).toBeInTheDocument()
    expect(screen.getByText('res-1')).toBeInTheDocument()
    expect(screen.getByText(/平台 "lab" 未关联目标应用 "inventory"/)).toBeInTheDocument()
    expect(successMock).not.toHaveBeenCalled()
  })
})
