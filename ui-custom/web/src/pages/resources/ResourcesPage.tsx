import { useMemo, useState } from 'react'
import config from 'antd/locale/zh_CN'
import { useSearchParams } from 'react-router-dom'
import { MainLayout } from '../../layouts/MainLayout'
import { Alert, Button, Card, ConfigProvider, Empty, Modal, Space, message } from 'antd'
import {
  DownloadOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import type { ResourceListParams } from '../../api/resources'
import type { ResourceCategory } from '../../types/resource'
import type { CoverageState } from '../../types/query'
import { useResources } from './useResources'
import type { ResourceListItem } from './useResources'
import { useResourceCoverage } from './useResourceCoverage'
import { useResourceDelete } from './useResourceDelete'
import { useResourceDictionaries } from './useResourceDictionaries'
import { useResourceColumnPrefs } from './useResourceColumnPrefs'
import { buildResourceColumns } from './resourceColumns'
import { RESOURCE_TYPES, SUBTYPE_FIELD } from './resourceMeta'
import { ResourceFilterBar } from './ResourceFilterBar'
import { ResourceListAlerts } from './ResourceListAlerts'
import { ResourceCategoryTabs } from './ResourceCategoryTabs'
import { ResourceTable } from './ResourceTable'
import { ResourceFormDrawer } from './ResourceFormDrawer'
import { ResourceDetailDrawer } from './ResourceDetailDrawer'
import { ImportModal } from './ImportModal'
import { TemplateDownloadModal } from './TemplateDownloadModal'
import { ImportRecordsPanel } from './ImportRecordsPanel'
import { downloadResources } from './resourceExport'
import { useSkin } from '../../skinContext'

/**
 * 资源管理列表页（Module_07 §11.1 页面状态矩阵）。
 *
 * T07-R6 起收敛为「状态 + 编排」容器：筛选区、提示区、类别 Tabs、表格分别由
 * `ResourceFilterBar` / `ResourceListAlerts` / `ResourceCategoryTabs` / `ResourceTable`
 * 纯展示组件承载；本页只负责深链解析、数据 Hooks、抽屉/弹窗编排与 Card 头部动作。
 */
export function ResourcesPage() {
  /**
   * 首页下钻深链参数（M05 §3.1 决策 91）：`resource_category` 决定首屏 Tab，
   * `subtype` / `app_code` / `cloud` 做客户端预筛，`import=1` 直接打开导入弹窗。
   * 云卡口径仅主机，故无 `resource_category` 时默认 Tab 落 `host`。
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkCategory = searchParams.get('resource_category') as ResourceCategory | null
  const deepLinkSubtype = searchParams.get('subtype')
  const deepLinkAppCode = searchParams.get('app_code')
  const deepLinkCloud = searchParams.get('cloud')
  const hasDeepLinkFilter = Boolean(deepLinkSubtype || deepLinkAppCode || deepLinkCloud)
  const deepLinkInitialCategory =
    deepLinkCategory && RESOURCE_TYPES.includes(deepLinkCategory) ? deepLinkCategory : undefined

  const {
    category, setCategory, data, loading, error, permissionDenied, filters, setFilters,
    page, pageSize, onPageSizeChange, reload,
  } = useResources(deepLinkInitialCategory ?? 'host')

  const { tokens } = useSkin()
  // 删除动线（T07-R5）：引用预检 + 二次确认 + DELETE + 回刷列表
  const { deletingId, handleDeleteClick } = useResourceDelete({ reload })
  // 决策 47-3：采集状态四态 badge 数据源（M02 coverage 聚合，Map by resource_id）
  const {
    coverageByResource,
    loading: coverageLoading,
    error: coverageError,
  } = useResourceCoverage(category)
  // 决策 47-3：四态筛选（全部/采集中/已下发未采到/未监控），按 coverage.monitor_state 当页过滤
  const [monitorState, setMonitorState] = useState<CoverageState | undefined>()

  /**
   * 六份字典的加载与「编码 → 展示名 / 停用标识」解析（网域 / 业务 / 应用 / 云 / 平台 +
   * 应用↔平台 M:N 关联），口径见 `useResourceDictionaries.ts`。
   * 「应用」筛选下拉按当前所选平台级联，故传入 `filters.platform_code`。
   *
   * v3 资源响应不再内联 `cloud_code` / `zone_type`：二者由所属网域只读派生，
   * 因此字典 Hook 需先于深链云过滤就绪。
   */
  const {
    networkDomains, businessDomains, applicationDomains, platformDicts, filterAppOptions,
    domainNameOf, resolveBizName, isBizDisabled, resolveAppName, isAppDisabled,
    resolveCloudName, isCloudDisabled, resolvePlatformName, isPlatformDisabled,
  } = useResourceDictionaries(filters.platform_code)

  /** 网域 ID → 云编码（深链云过滤 / 列表云列共用） */
  const cloudCodeOf = (domainId: string) =>
    networkDomains.find((d) => d.id === domainId)?.cloud_code || undefined

  const coveredList = useMemo(() => {
    if (!monitorState) return data.list
    return data.list.filter(
      (r) => (coverageByResource[r.resource_id]?.monitor_state ?? 'not_monitored') === monitorState,
    )
  }, [data.list, monitorState, coverageByResource])

  /** 深链预筛后的行（无深链参数时与 coveredList 完全一致） */
  const visibleList = useMemo(() => {
    let list = coveredList
    if (deepLinkAppCode) list = list.filter((r) => r.app_code === deepLinkAppCode)
    // 云卡下钻（§2.1 第 3 条）：v3 资源不内联 cloud_code，按所属网域的 cloud_code 派生比对
    if (deepLinkCloud) list = list.filter((r) => (cloudCodeOf(r.network_domain_id) ?? '') === deepLinkCloud)
    if (deepLinkSubtype) {
      const field = SUBTYPE_FIELD[category]
      list = list.filter((r) => String(r[field] ?? '') === deepLinkSubtype)
    }
    return list
    // cloudCodeOf 依赖 networkDomains；显式列出避免闭包冻结旧网域清单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coveredList, deepLinkAppCode, deepLinkCloud, deepLinkSubtype, category, networkDomains])

  // 资源新增/编辑抽屉（T07-F4）：复用 create/edit 双模式，编辑态携带行 record
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit'>('create')
  const [editingRecord, setEditingRecord] = useState<ResourceListItem | null>(null)
  // 资源详情抽屉（T07-F6）：行点击 / 「详情」入口打开，展示详情 + 适用模板 + 标签管理
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState<ResourceListItem | null>(null)
  // Excel 导入弹窗（T07-F5）；`import=1` 深链（决策 91）在首屏即展开
  const [importOpen, setImportOpen] = useState(() => searchParams.get('import') === '1')
  // F-4：独立「下载模板」弹窗（列清单 + 模板演进提示 + 下载），与 Excel 导入动线分离
  const [templateOpen, setTemplateOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await downloadResources(category, filters as ResourceListParams)
      message.success('资源导出成功')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '资源导出失败')
    } finally {
      setExporting(false)
    }
  }

  const openCreateDrawer = () => {
    setDrawerMode('create')
    setEditingRecord(null)
    setDrawerOpen(true)
  }
  const openEditDrawer = (record: ResourceListItem) => {
    setDrawerMode('edit')
    setEditingRecord(record)
    setDrawerOpen(true)
  }
  // T07-F5：Excel 导入统一进入 ImportModal；导入记录面板内点击时同步关闭，避免弹窗嵌套弹窗
  const openImportModal = () => {
    setRecordsOpen(false)
    setImportOpen(true)
  }
  // F-4：独立「下载模板」动线；导入记录面板内点击时同步关闭，避免弹窗嵌套弹窗
  const openTemplateModal = () => {
    setRecordsOpen(false)
    setTemplateOpen(true)
  }
  // T07-F6：打开资源详情抽屉（行点击 / 「详情」入口），携带行 record 供详情展示
  const openDetailDrawer = (record: ResourceListItem) => {
    setDetailRecord(record)
    setDetailOpen(true)
  }

  /**
   * F-17：列显隐偏好 / 列宽 / 容器宽度 / 可拖动表头计算（T07-R4 收敛到
   * `useResourceColumnPrefs.ts`）。列工厂捕获字典 / coverage / skin token 等异步数据，
   * **不做 `useMemo`**：记忆化会把这些依赖冻在首帧（采集状态、云/应用名等渲染不更新）。
   */
  const {
    visibleColumnKeys, resizableColumns, tableScrollX, tableContainerRef, columnSettingsOpen,
    setColumnSettingsOpen, columnSettingsLabel, handleVisibleColumnKeysChange, handleResetColumnKeys,
  } = useResourceColumnPrefs(category, buildResourceColumns(category, {
      tokens,
      coverageByResource,
      coverageError,
      domainNameOf,
      cloudCodeOf,
      resolveBizName,
      isBizDisabled,
      resolveAppName,
      isAppDisabled,
      resolveCloudName,
      isCloudDisabled,
      resolvePlatformName,
      isPlatformDisabled,
      onDetail: openDetailDrawer,
      onEdit: openEditDrawer,
      onDelete: handleDeleteClick,
      deletingId,
    }),
  )

  return (
    <MainLayout>
      {permissionDenied ? (
        <div style={{ marginTop: 80 }}>
          <Empty description="当前账号无此页面查看权限" />
        </div>
      ) : (
        <ConfigProvider locale={config}>
          <Card
            extra={
              <Space>
                <Button icon={<DownloadOutlined />} onClick={openTemplateModal}>下载模板</Button>
                <Button icon={<UploadOutlined />} onClick={openImportModal}>Excel 导入</Button>
                <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void handleExport()}>导出 CSV</Button>
                <Button icon={<HistoryOutlined />} onClick={() => setRecordsOpen(true)}>导入记录</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateDrawer}>新增资源</Button>
              </Space>
            }
          >
            {error && (
              <Alert
                type="error"
                showIcon
                message="资源列表加载失败，请稍后重试"
                description={error}
                action={
                  <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
                    重新加载
                  </Button>
                }
                style={{ marginBottom: 16 }}
              />
            )}
            <ResourceFilterBar
              filters={filters} onFiltersChange={setFilters} networkDomains={networkDomains}
              platformDicts={platformDicts} filterAppOptions={filterAppOptions} businessDomains={businessDomains}
              monitorState={monitorState} onMonitorStateChange={setMonitorState} category={category}
              visibleColumnKeys={visibleColumnKeys} columnSettingsOpen={columnSettingsOpen}
              setColumnSettingsOpen={setColumnSettingsOpen} columnSettingsLabel={columnSettingsLabel}
              handleVisibleColumnKeysChange={handleVisibleColumnKeysChange}
              handleResetColumnKeys={handleResetColumnKeys}
            />
            <ResourceListAlerts
              monitorState={monitorState} hasDeepLinkFilter={hasDeepLinkFilter}
              deepLinkCloud={deepLinkCloud} deepLinkAppCode={deepLinkAppCode}
              deepLinkSubtype={deepLinkSubtype} visibleCount={visibleList.length}
              resolveCloudName={resolveCloudName} onClearDeepLink={() => setSearchParams({})}
              betweenAlerts={<ResourceCategoryTabs category={category} onChange={setCategory} />}
            />
            <ResourceTable
              dataSource={visibleList} columns={resizableColumns} loading={loading || coverageLoading}
              scrollX={tableScrollX} containerRef={tableContainerRef} onRowClick={openDetailDrawer}
              page={page} pageSize={pageSize} total={data.total} onPageSizeChange={onPageSizeChange}
              onCreate={openCreateDrawer} onDownloadTemplate={openTemplateModal} onImport={openImportModal}
            />
          </Card>
        </ConfigProvider>
      )}
      <ResourceFormDrawer
        open={drawerOpen}
        mode={drawerMode}
        category={editingRecord?.resource_category ?? category}
        record={editingRecord}
        onCancel={() => setDrawerOpen(false)}
        onSuccess={reload}
      />
      {/* T07-F6：资源详情抽屉（详情 + 适用模板 + 标签管理；复用父页已加载的网域/业务字典） */}
      <ResourceDetailDrawer
        open={detailOpen}
        record={detailRecord}
        networkDomains={networkDomains}
        businessDomains={businessDomains}
        onCancel={() => setDetailOpen(false)}
      />
      {/* T07-F5：Excel 导入弹窗（上传 + mode + 结果/错误行）；导入成功后回刷列表 */}
      <ImportModal
        open={importOpen}
        category={category}
        onCancel={() => setImportOpen(false)}
        onSuccess={reload}
      />
      {/* F-4/F-7：模板下载弹窗，与 Excel 导入动线分离 */}
      <TemplateDownloadModal
        open={templateOpen}
        category={category}
        onCancel={() => setTemplateOpen(false)}
        businessDomains={businessDomains}
        applicationDomains={applicationDomains}
      />
      {/* T07-F5：导入记录面板（列表筛选/分页/详情；空态引导打开 ImportModal） */}
      <Modal
        open={recordsOpen}
        title="导入记录"
        width={1000}
        onCancel={() => setRecordsOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <ImportRecordsPanel
          onDownloadTemplate={openImportModal}
          onUploadExcel={openImportModal}
        />
      </Modal>
    </MainLayout>
  )
}

export default ResourcesPage
