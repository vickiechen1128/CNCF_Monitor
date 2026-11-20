import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupAntdTest } from '../../test/antdTestUtils'
import { CollectionTemplateDrawer } from './CollectionTemplateDrawer'
import { resetCollectionCatalogCache } from './useCollectionTemplateCatalog'
import type { CollectionTemplate } from '../../types/collectionTemplate'
import { EMPTY_SELECTOR } from '../../types/collectionTemplate'

const createMock = vi.fn()
const updateMock = vi.fn()
const candidateFieldListMock = vi.fn()
const exporterListMock = vi.fn()
const labelListMock = vi.fn()

vi.mock('../../api/collectionTemplates', () => ({
  collectionTemplateApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: vi.fn(),
    impact: vi.fn(),
  },
  candidateFieldApi: {
    list: (...args: unknown[]) => candidateFieldListMock(...args),
  },
}))

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: {
    list: (...args: unknown[]) => exporterListMock(...args),
  },
}))

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    list: (...args: unknown[]) => labelListMock(...args),
  },
}))

function exporterTemplate(id: string, name: string) {
  return {
    id,
    name,
    version: '1.0.0',
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    os: 'linux',
    arch: 'amd64',
    download_url: '',
    homepage: '',
    install_guide: '',
    description: '',
    is_builtin: false,
    source: 'internal',
    created_at: '',
    updated_at: '',
  }
}

const EDIT_RECORD: CollectionTemplate = {
  code: 'mysql_default',
  name: 'MySQL 标准采集',
  resource_category: 'database',
  exporter_template_id: 'exp-1',
  exporter_template_name: 'mysqld-exporter',
  default_port: 9104,
  metrics_path: '/metrics',
  scheme: 'http',
  scrape_interval: '15s',
  scrape_timeout: '10s',
  label_template_id: '',
  default_selector: EMPTY_SELECTOR,
  description: '',
  sort_order: 100,
  enabled: true,
  is_builtin: false,
  reference_job_count: 2,
}

function renderDrawer(record: CollectionTemplate | null = null, handlers: { onSaved?: () => void } = {}) {
  render(
    <CollectionTemplateDrawer
      open
      record={record}
      onCancel={() => {}}
      onSaved={handlers.onSaved ?? (() => {})}
    />,
  )
}

/** 打开一个 antd Select（按 placeholder 定位）并点选目标选项。 */
async function pickOption(placeholder: string, optionText: string) {
  fireEvent.mouseDown(screen.getByText(placeholder))
  const option = await screen.findByText(optionText, { selector: '.ant-select-item-option-content' })
  await userEvent.click(option)
}

describe('CollectionTemplateDrawer', () => {
  setupAntdTest()

  beforeEach(() => {
    // 模块级字段字典缓存必须清空，否则后续用例拿不到 mock 的字段（跨用例污染）
    resetCollectionCatalogCache()
    createMock.mockReset()
    updateMock.mockReset()
    candidateFieldListMock.mockReset()
    exporterListMock.mockReset()
    labelListMock.mockReset()

    createMock.mockResolvedValue({ status: 'success', data: EDIT_RECORD })
    updateMock.mockResolvedValue({ status: 'success', data: EDIT_RECORD })
    candidateFieldListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          {
            key: 'os_family',
            label: '操作系统',
            kind: 'os_family',
            categories: ['host', 'database', 'middleware', 'application', 'generic_target', 'interface_service'],
            custom: false,
          },
        ],
        total: 1,
      },
    })
    exporterListMock.mockResolvedValue({
      status: 'success',
      data: { list: [exporterTemplate('exp-1', 'mysqld-exporter')], total: 1, page: 1, page_size: 100 },
    })
    labelListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 'lt-db', name: 'MySQL 标准标签', resource_category: 'database', is_default: true, mappings: [] },
          { id: 'lt-host', name: '主机标签', resource_category: 'host', is_default: false, mappings: [] },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })
  })

  it('renders create form with defaults and the prefill-only selector hint', async () => {
    renderDrawer()

    expect(screen.getByText('新建采集模板')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：mysql_default')).toBeInTheDocument()
    // 「推荐条件」默认收起，标题常驻并明确其只作预填提示（不是适用范围）
    expect(screen.getByText('新建任务时的推荐条件')).toBeInTheDocument()
    expect(screen.getByText('仅作预填提示，不影响已有任务的选择器')).toBeInTheDocument()
    // 展开后才挂载 SelectorEditor
    fireEvent.click(screen.getByText('新建任务时的推荐条件'))
    expect(await screen.findByText('多条件组合')).toBeInTheDocument()
  })

  it('creates a template with normalized payload', async () => {
    const onSaved = vi.fn()
    renderDrawer(null, { onSaved })

    await userEvent.type(screen.getByPlaceholderText('例如：mysql_default'), 'mysql_default')
    await userEvent.type(screen.getByPlaceholderText('例如：MySQL 标准采集'), 'MySQL 标准采集')
    await pickOption('请选择资源类别', '数据库')
    await pickOption('请选择采集实现', 'mysqld-exporter')

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1), { timeout: 8000 })
    const payload = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      code: 'mysql_default',
      name: 'MySQL 标准采集',
      resource_category: 'database',
      exporter_template_id: 'exp-1',
      default_port: 9100,
      metrics_path: '/metrics',
      scheme: 'http',
      scrape_interval: '15s',
      scrape_timeout: '10s',
      enabled: true,
    })
    expect(payload.default_selector).toEqual({ logic: 'all', filters: [] })
    // 保存成功要回刷共享模板缓存
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('validates code pattern, name and exporter on create', async () => {
    renderDrawer()

    fireEvent.change(screen.getByPlaceholderText('例如：mysql_default'), { target: { value: 'Bad Code' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    // 「请选择资源类别 / 请选择采集实现」同时是 Select 占位符，故按表单项错误文案断言
    await waitFor(() => {
      const errorTexts = Array.from(document.querySelectorAll('.ant-form-item-explain-error')).map(
        (node) => node.textContent,
      )
      expect(errorTexts).toContain('编码需以小写字母开头，仅含小写字母、数字和下划线，长度 2-64')
      expect(errorTexts).toContain('请输入模板名称')
      expect(errorTexts).toContain('请选择资源类别')
      expect(errorTexts).toContain('请选择采集实现')
    }, { timeout: 8000 })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('rejects scrape_timeout >= scrape_interval', async () => {
    renderDrawer()

    fireEvent.change(screen.getByPlaceholderText('15s'), { target: { value: '5s' } })
    fireEvent.change(screen.getByPlaceholderText('10s'), { target: { value: '10s' } })
    await userEvent.type(screen.getByPlaceholderText('例如：mysql_default'), 'mysql_default')
    await userEvent.type(screen.getByPlaceholderText('例如：MySQL 标准采集'), 'MySQL 标准采集')
    await pickOption('请选择资源类别', '数据库')
    await pickOption('请选择采集实现', 'mysqld-exporter')

    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    expect(await screen.findByText('采集超时必须小于采集间隔')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('keeps the code immutable on edit and sends no code on update', async () => {
    const onSaved = vi.fn()
    renderDrawer(EDIT_RECORD, { onSaved })

    expect(screen.getByText('编辑采集模板：MySQL 标准采集')).toBeInTheDocument()
    const codeInput = screen.getByDisplayValue('mysql_default')
    expect(codeInput).toBeDisabled()
    // 已有值回显：资源类别、采集实现、端口
    expect(screen.getByText('数据库')).toBeInTheDocument()
    expect(screen.getByDisplayValue('9104')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('MySQL 标准采集'), {
      target: { value: 'MySQL 标准采集（改）' },
    })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1), { timeout: 8000 })
    expect(updateMock.mock.calls[0][0]).toBe('mysql_default')
    const payload = updateMock.mock.calls[0][1] as Record<string, unknown>
    expect(payload.name).toBe('MySQL 标准采集（改）')
    expect(payload).not.toHaveProperty('code')
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing default_selector on edit even when the collapsed panel was never expanded', async () => {
    const existingSelector = {
      logic: 'any' as const,
      filters: [{ field: 'os_family', operator: 'eq' as const, values: ['linux'] }],
    }
    renderDrawer({ ...EDIT_RECORD, default_selector: existingSelector })

    // 未展开「新建任务时的推荐条件」直接保存：SelectorEditor 未挂载，但已有条件不能被清空
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1), { timeout: 8000 })
    expect((updateMock.mock.calls[0][1] as Record<string, unknown>).default_selector).toEqual(existingSelector)
  })

  it('shows the backend error message when create conflicts (duplicate code)', async () => {
    createMock.mockRejectedValue(new Error('collection template "mysql_default" already exists'))
    renderDrawer()

    await userEvent.type(screen.getByPlaceholderText('例如：mysql_default'), 'mysql_default')
    await userEvent.type(screen.getByPlaceholderText('例如：MySQL 标准采集'), 'MySQL 标准采集')
    await pickOption('请选择资源类别', '数据库')
    await pickOption('请选择采集实现', 'mysqld-exporter')
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    expect(await screen.findByText('collection template "mysql_default" already exists')).toBeInTheDocument()
    expect(createMock).toHaveBeenCalledTimes(1)
  })
})
