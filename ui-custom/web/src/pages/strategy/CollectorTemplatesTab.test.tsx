import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { CollectorTemplatesTab } from './CollectorTemplatesTab'

const mappingListMock = vi.fn()
const tmplListMock = vi.fn()
const tmplRemoveMock = vi.fn()
const mappingUpdateMock = vi.fn()
const mappingRemoveMock = vi.fn()
const labelTemplateListMock = vi.fn()

vi.mock('../../api/ciExporterMappings', () => ({
  ciExporterMappingApi: {
    list: (...args: unknown[]) => mappingListMock(...args),
    create: vi.fn(),
    update: (...args: unknown[]) => mappingUpdateMock(...args),
    remove: (...args: unknown[]) => mappingRemoveMock(...args),
  },
}))

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: {
    list: (...args: unknown[]) => tmplListMock(...args),
    remove: (...args: unknown[]) => tmplRemoveMock(...args),
  },
}))

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: { list: (...args: unknown[]) => labelTemplateListMock(...args) },
}))

function mapping(id: number, monitor_type: string, exporter_template_id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    monitor_type,
    exporter_template_id,
    is_default: false,
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    is_builtin: false,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...extra,
  }
}

function template(id: number, name: string, source = 'official') {
  return {
    id,
    name,
    version: '1.0.0',
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_monitor_types: [],
    os: 'linux',
    arch: 'amd64',
    download_url: '',
    homepage: '',
    install_guide: '',
    description: '',
    is_builtin: true,
    source,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
  }
}

describe('CollectorTemplatesTab', () => {
  setupAntdTest()

  beforeEach(() => {
    mappingListMock.mockReset()
    tmplListMock.mockReset()
    tmplRemoveMock.mockReset()
    mappingUpdateMock.mockReset()
    mappingRemoveMock.mockReset()
    labelTemplateListMock.mockReset()
    labelTemplateListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 7, name: 'MySQL 标准标签', resource_category: 'database', is_default: true, mappings: [], instance_count: 0 },
          { id: 8, name: 'MySQL 备选标签', resource_category: 'database', is_default: false, mappings: [], instance_count: 0 },
          { id: 9, name: '主机标签', resource_category: 'host', is_default: false, mappings: [], instance_count: 0 },
        ],
        total: 3,
        page: 1,
        page_size: 100,
      },
    })
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: { list: [template(1, 'mysqld-exporter'), template(2, 'redis-exporter')], total: 2, page: 1, page_size: 100 },
    })
  })

  it('renders mapping rows with resolved collector names', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [mapping(1, 'mysql', 1, { is_default: true }), mapping(2, 'redis', 2, {})],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )

    expect(await screen.findByText('mysqld-exporter')).toBeInTheDocument()
    expect(screen.getByText('redis-exporter')).toBeInTheDocument()
    expect(screen.getByText('MySQL')).toBeInTheDocument()
    // 「默认」列已移除（mapping 行恒为默认配置、template 行恒「-」，无区分度；行类型列已表达语义）
    // 默认端口列：生效端口（绿色语义 Tag）+ 加粗端口值（F1-6 展示增强）
    expect(screen.getAllByText('生效端口').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('9104').length).toBeGreaterThanOrEqual(2)
    // 来源列（F-32 放开后补）：两模板均 source=official → 「官方」Tag
    expect(screen.getAllByText('官方').length).toBeGreaterThanOrEqual(2)
  })

  it('shows 未被引用 tag when is_referenced=false and 待配置 badge when no label template', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [mapping(1, 'mysql', 1, { is_referenced: false, has_label_template: false })],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )

    // 等待异步数据渲染完成（mysql mapping 行出现）后再断言
    await screen.findByText('MySQL')
    // 「未被引用」可能同时出现在 mapping 行标记与并入的模板池行，需容忍多处
    expect(screen.getAllByText('未被引用').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('待配置').length).toBeGreaterThanOrEqual(1)
  })

  it('filters rows by source (client-side) when source selected', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          mapping(1, 'mysql', 1, { is_referenced: false, has_label_template: false }),
          mapping(2, 'redis', 2, { is_referenced: false, has_label_template: false }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })
    // mysql → template 1 (official)；redis → template 2 (third_party)
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: { list: [template(1, 'mysqld-exporter', 'official'), template(2, 'redis-exporter', 'third_party')], total: 2, page: 1, page_size: 100 },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('mysqld-exporter')

    // 置 official 后仅保留 mysql 行（来源列已渲染「官方」Tag，下拉选项需限定在 dropdown 内点击）
    fireEvent.mouseDown(screen.getByText('全部来源'))
    const dropdown = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') as HTMLElement
    fireEvent.click(await within(dropdown).findByText('官方'))

    expect(screen.getByText('mysqld-exporter')).toBeInTheDocument()
    expect(screen.queryByText('redis-exporter')).toBeNull()
  })

  it('renders empty state 暂无默认采集配置 with inline register entry (A9)', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    // 空态需采集器池也为空（F1-5：池有模板时以「未被引用」行并入，不显空态）
    tmplListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )

    expect(await screen.findByText('暂无默认采集配置')).toBeInTheDocument()
    expect(screen.getByText('池中没有需要的采集器？')).toBeInTheDocument()
    // 「登记采集器」同时出现在右上角按钮与空态内联按钮，容忍多处
    expect(screen.getAllByText('登记采集器').length).toBeGreaterThanOrEqual(1)
  })

  it('opens registration drawer on 登记采集器 click', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    // 「登记采集器」同时出现在右上角按钮与（数据加载前的）空态按钮，取第一个打开抽屉
    fireEvent.click(screen.getAllByRole('button', { name: /登记采集器/ })[0])

    // 抽屉打开后展示登记表单（采集器名称必填输入 + antd 两字按钮自动加空格「登 记」）
    expect(screen.getByPlaceholderText('例如：mysql-exporter')).toBeInTheDocument()
    expect(screen.getByText('登 记')).toBeInTheDocument()
  })

  it('requires default_port/metrics_path/scheme on register (F-32 放开来源后恒必填)', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    // 「登记采集器」同时出现在右上角按钮与（数据加载前的）空态按钮，取第一个打开抽屉
    fireEvent.click(screen.getAllByRole('button', { name: /登记采集器/ })[0])
    await screen.findByPlaceholderText('例如：mysql-exporter')

    // default_port/metrics_path/scheme 对任何来源登记均必填（登记入库需完整采集参数）
    const drawer = screen.getByPlaceholderText('例如：mysql-exporter').closest('.ant-drawer') as HTMLElement
    fireEvent.click(within(drawer).getByRole('button', { name: /登\s*记/ }))
    expect(await screen.findByText('请输入默认端口')).toBeInTheDocument()
    expect(screen.getByText('请输入采集路径')).toBeInTheDocument()
    // 协议 error 文案与 placeholder 同为「请选择协议」，需容忍多处匹配
    expect(screen.getAllByText('请选择协议').length).toBeGreaterThanOrEqual(1)
  })

  // ---- F10 增强：Steps 使用指引 / 未被引用模板行并入+去配置 / 安装与文档入口 ----
  it('renders Steps three-step flow with navigable step (A4)', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    tmplListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )

    expect(await screen.findByText('配置指引')).toBeInTheDocument()
    // 「登记采集器」同时出现在 Steps 标题与右上按钮，容忍多处
    expect(screen.getAllByText('登记采集器').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('配置默认采集')).toBeInTheDocument()
    // 第 3 步：跳转「采集 Job」的可点击按钮（不再用纯文字，直接以按钮代替）
    expect(screen.getByText('创建采集 Job')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /前\s*往/ })).toBeInTheDocument()
  })

  it('collapses and re-expands by clicking the guide header (与网域纳管一致，header 常驻)', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    tmplListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('配置指引')

    // 默认展开：item 带 ant-collapse-item-active，Steps 主体可见
    expect(screen.getAllByText('配置默认采集').length).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('.ant-collapse-item-active')).not.toBeNull()

    // 点击 header 收起：header 常驻，item 移除 active（内容区隐藏）
    fireEvent.click(screen.getByText('配置指引'))
    await waitFor(() => expect(document.querySelector('.ant-collapse-item-active')).toBeNull())

    // 再次点击 header 重新展开：item 恢复 active，主体恢复
    fireEvent.click(screen.getByText('配置指引'))
    await waitFor(() => expect(document.querySelector('.ant-collapse-item-active')).not.toBeNull())
    expect(screen.getAllByText('配置默认采集').length).toBeGreaterThanOrEqual(1)
  })

  it('merges unreferenced template rows with 去配置 action (F1-5)', async () => {
    // 仅一个 mapping 引用 t1；t3（池中未被引用）应并入列表
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: { list: [mapping(1, 'mysql', 1, {})], total: 1, page: 1, page_size: 20 },
    })
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          template(1, 'mysqld-exporter'),
          template(2, 'redis-exporter'),
          template(3, 'snmp-exporter'),
        ],
        total: 3,
        page: 1,
        page_size: 100,
      },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )

    // 未被引用的池中模板 snmp-exporter 并入为行（引用 t2 及被引用的 t1 通过 mapping 行呈现）
    await screen.findByText('mysqld-exporter')
    expect(screen.findByText('snmp-exporter')).resolves.toBeTruthy()
    expect(screen.getAllByText('未被引用').length).toBeGreaterThanOrEqual(1)
    // 行操作「去配置」存在（每个模板池行各一）
    const gotoConfig = screen.getAllByText('去配置')
    expect(gotoConfig.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(gotoConfig[0])
  })

  it('shows delete only on non-builtin template rows and calls remove (F-27 A)', async () => {
    mappingListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          template(1, 'mysqld-exporter'), // 内置 → 无删除按钮
          { ...template(2, 'custom-exporter', 'internal'), is_builtin: false },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })
    tmplRemoveMock.mockResolvedValue({ status: 'success', data: { id: 2 } })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('custom-exporter')

    // 仅自建（非内置）模板行有「删除」
    const delButtons = screen.queryAllByRole('button', { name: '删 除' }).length
      ? screen.queryAllByRole('button', { name: '删 除' })
      : screen.queryAllByRole('button', { name: '删除' })
    expect(delButtons).toHaveLength(1)

    // Popconfirm 二次确认后调用 remove(2)
    fireEvent.click(delButtons[0])
    const confirm = await screen.findAllByRole('button', { name: '删 除' })
    fireEvent.click(confirm[confirm.length - 1])
    await waitFor(() => expect(tmplRemoveMock).toHaveBeenCalledWith(2))
  })

  // ---- F-28：映射行删除 + 采集器查看抽屉 ----
  it('shows delete on non-builtin mapping rows and calls remove (F-28)', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          mapping(1, 'mysql', 1, {}), // 非内置 → 有删除
          mapping(2, 'redis', 2, { is_builtin: true }), // 内置 → 无删除
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })
    mappingRemoveMock.mockResolvedValue({ status: 'success', data: { id: 1 } })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('mysqld-exporter')

    // 操作列「删除」按钮仅出现在非内置映射行（模板池行为空，无其他删除入口）
    const delButtons = screen.getAllByRole('button', { name: /删\s*除/ })
    expect(delButtons).toHaveLength(1)

    fireEvent.click(delButtons[0])
    const confirm = await screen.findAllByRole('button', { name: '删 除' })
    fireEvent.click(confirm[confirm.length - 1])
    await waitFor(() => expect(mappingRemoveMock).toHaveBeenCalledWith(1))
  })

  it('opens collector detail drawer from 查看 with supported monitor types (F-28)', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: { list: [mapping(1, 'mysql', 1, {})], total: 1, page: 1, page_size: 20 },
    })
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [{ ...template(1, 'mysqld-exporter'), supported_monitor_types: ['mysql'], description: 'MySQL 指标采集器' }],
        total: 1,
        page: 1,
        page_size: 100,
      },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('mysqld-exporter')

    // 行内有两个「查看」（标签模板列 + 操作列），取操作列（行内最后一个）
    const row = screen.getByText('mysqld-exporter').closest('tr') as HTMLElement
    const viewButtons = within(row).getAllByRole('button', { name: /查\s*看/ })
    fireEvent.click(viewButtons[viewButtons.length - 1])
    // 只读详情抽屉：来源 / 支持的监控对象类型 / 端口 / 路径 / 协议全字段回显
    expect(await screen.findByText('采集器详情：mysqld-exporter')).toBeInTheDocument()
    expect(screen.getByText('支持的监控对象类型')).toBeInTheDocument()
    // 「官方」同时出现在列表来源列与详情抽屉，容忍多处
    expect(screen.getAllByText('官方').length).toBeGreaterThanOrEqual(1)
    // 描述内容（Drawer 内容区可能出现多处，容忍）
    expect(screen.getAllByText('MySQL 指标采集器').length).toBeGreaterThanOrEqual(1)
    // Descriptions 内容区内 MySQL 标签（监控类型列也有 MySQL，容忍多处）
    expect(screen.getAllByText('MySQL').length).toBeGreaterThanOrEqual(1)
  })

  it('shows install/download/doc entry on install column (F1-6)', async () => {    mappingListMock.mockResolvedValue({
      status: 'success',
      data: { list: [mapping(1, 'mysql', 1, {})], total: 1, page: 1, page_size: 20 },
    })
    // 给模板注入 download_url/homepage 以呈现图标链
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { ...template(1, 'mysqld-exporter'), download_url: 'https://x/download', homepage: 'https://x/doc', install_guide: 'a,b,c' },
          template(2, 'redis-exporter'),
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )

    await screen.findByText('mysqld-exporter')
    // 安装指南/下载/文档 图标按钮存在（F1-6 图标链，对齐原型 v3.13：图标 + Tooltip）
    expect(screen.getByLabelText('read')).toBeInTheDocument()
    expect(screen.getByLabelText('download')).toBeInTheDocument()
    expect(screen.getByLabelText('file-text')).toBeInTheDocument()
    // 点击安装指南图标展开 Popover 展示安装指南内容
    fireEvent.click(screen.getByLabelText('read'))
    expect(await screen.findByText('a,b,c')).toBeInTheDocument()
    // 架构列仅展示 arch（arm/x86 为安装选包关键信息）；OS 不再展示
    expect(screen.getAllByText('amd64').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('linux')).toBeNull()
  })

  // ---- Q1b：更换/补配独立轻量抽屉（仅改标签模板，不进入采集参数编辑） ----
  it('opens label template drawer with 更换 mode and only label field (Q1b)', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: { list: [mapping(1, 'mysql', 1, { has_label_template: true, label_template_id: '7' })], total: 1, page: 1, page_size: 20 },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('mysqld-exporter')

    fireEvent.click(screen.getAllByText('更换')[0])
    expect(await screen.findByText('更换标签模板')).toBeInTheDocument()
    // #19 修复后：同页内的 ExporterTemplateDrawer/MappingDrawer 因 forceRender 常驻挂载
    // （关闭态也渲染 role=dialog），故需按标题定位「更换标签模板」抽屉而非单一 getByRole('dialog')
    const drawer = screen.getAllByRole('dialog').find((d) => within(d).queryByText('更换标签模板')) as HTMLElement
    // 更换需回显「当前已选模板」确认（PRD L241）——抽屉内同时存在当前模板块与 Select 选中值，故用 getAllByText
    expect(within(drawer).getAllByText(/MySQL 标准标签/).length).toBeGreaterThanOrEqual(1)
    // 抽屉带入上下文：监控对象类型 / 资源类别 / 默认采集器（方便确认在给哪条默认采集配置换属主标签）
    expect(within(drawer).getByText('监控对象类型：MySQL')).toBeInTheDocument()
    expect(within(drawer).getByText('资源类别：数据库')).toBeInTheDocument()
    expect(within(drawer).getByText('默认采集器：mysqld-exporter')).toBeInTheDocument()
    // 轻量抽屉不含采集器相关可编辑字段（端口/路径/协议/采集间隔/超时）——限定在抽屉容器内断言
    expect(within(drawer).queryByText('采集间隔')).toBeNull()
    expect(within(drawer).queryByText('默认端口')).toBeNull()
    expect(within(drawer).queryByText('采集路径')).toBeNull()
  })

  it('submits only label_template_id from label drawer (Q1b)', async () => {
    mappingUpdateMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: { list: [mapping(1, 'mysql', 1, { has_label_template: false })], total: 1, page: 1, page_size: 20 },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('mysqld-exporter')

    fireEvent.click(screen.getAllByText('补配')[0])
    expect(await screen.findByText('补配标签模板')).toBeInTheDocument()
    // 候选按资源类别过滤：database 模板出现、host 模板不出现
    fireEvent.mouseDown(screen.getByText('请选择该资源类别的标签模板'))
    expect(await screen.findByText(/MySQL 备选标签/)).toBeInTheDocument()
    expect(screen.queryByText(/主机标签/)).toBeNull()
    // 选择模板后保存
    await selectAntdOption('MySQL 标准标签（数据库）')
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(mappingUpdateMock).toHaveBeenCalled())
    expect(mappingUpdateMock.mock.calls[0][0]).toBe(1)
    // 载荷仅包含 label_template_id，不含采集参数
    expect(mappingUpdateMock.mock.calls[0][1]).toEqual({ label_template_id: '7' })
  })

  // ---- F-30 分页 bug：referenced 基于全量 mapping（跨分页），其他页引用的模板不在本页误显示为「未被引用」 ----
  it('does not treat templates referenced on other mapping pages as unreferenced (F-30 pagination bug)', async () => {
    // 当前页只返回一条 mapping（引用 t1）；全量拉取（第二页）包含 t2 的引用
    mappingListMock
      .mockResolvedValueOnce({
        status: 'success',
        data: { list: [mapping(1, 'mysql', 1, {})], total: 2, page: 1, page_size: 20 },
      })
      .mockResolvedValueOnce({
        status: 'success',
        data: { list: [mapping(1, 'mysql', 1, {}), mapping(2, 'redis', 2, {})], total: 2, page: 1, page_size: 100 },
      })
    tmplListMock.mockResolvedValue({
      status: 'success',
      data: { list: [template(1, 'mysqld-exporter'), template(2, 'redis-exporter'), template(3, 'snmp-exporter')], total: 3, page: 1, page_size: 100 },
    })

    render(
      <MemoryRouter>
        <CollectorTemplatesTab />
      </MemoryRouter>,
    )
    await screen.findByText('mysqld-exporter')

    // t2 已被第二页的 mapping 引用 → 不应作为「未被引用」采集器行出现；
    // t3 未被任何页引用 → 并入为「未引用采集器」行（bug 存在时会额外多出 t2 行，断言数量=1）
    await screen.findByText('snmp-exporter')
    await waitFor(() => expect(screen.getAllByText('未引用采集器')).toHaveLength(1))
  })
})