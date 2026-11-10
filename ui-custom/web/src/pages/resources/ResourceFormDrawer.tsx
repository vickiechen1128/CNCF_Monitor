import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Form, InputNumber, Space, Typography, message } from 'antd'
import { networkDomainApi } from '../../api/domain'
import {
  applicationDictApi,
  appPlatformRelApi,
  businessDomainApi,
  osOptionApi,
  platformDictApi,
  resourceApi,
} from '../../api/resources'
import type { NetworkDomain } from '../../types/domain'
import type {
  AppPlatformRel,
  ApplicationDict,
  BusinessDomain,
  OSOption,
  PlatformDict,
  ResourceCategory,
} from '../../types/resource'
import type { ResourceListItem } from './useResources'
import { RESOURCE_TYPE_MAP, SOURCE_TYPE_MAP } from './resourceMeta'
import { ENV_VALUES, buildCreateInput, buildUpdateInput, recordToFormValues } from './resourceFormMappers'
import { optionalPortRules, renderResourceSharedFields, renderResourceTypeFields } from './resourceFormFields'
import type { ResourceFormFieldsContext } from './resourceFormFields'

const { Text } = Typography

/**
 * 资源新增/编辑抽屉（Module_07 §11.2）。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md
 * - Drawer 复用新增/编辑两种模式：新增态走 resourceApi.create（resource_id 由后端生成不展示）；
 *   编辑态预填 row 走 resourceApi.update（resource_id/resource_category/source_type 只读展示、§5.2 不可改）。
 * - 表单字段按 resource_category 差异化渲染（§5.6~§5.9 字段表，字段标签用 PRD「UI 展示名」）。
 * - biz_code 必填下拉（businessDomainApi.list 仅启用项，停用不可选）；network_domain 下拉（networkDomainApi.list）。
 * - 校验错误置于字段下方（antd Form rules）；提交按钮 loading+disabled 防重复；
 *   提交失败透传后端错误 Alert（尤其 403/400 场景）；成功后回刷列表（onSuccess）。
 *
 * 字段渲染见 `resourceFormFields.tsx`（纯渲染函数），请求体映射见 `resourceFormMappers.ts`。
 */

interface ResourceFormDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  /** 新增态取当前 Tab 类型；编辑态取行 resource_category */
  category: ResourceCategory
  /** 编辑态预填行（新增态为 null） */
  record?: ResourceListItem | null
  onCancel: () => void
  /** 提交成功后回刷列表（ResourcesPage 传入 reload） */
  onSuccess: () => void
}

/**
 * 资源新增/编辑抽屉（Module_07 §11.2）。
 * - 新增态：create，resource_id 由后端生成不展示；编辑态：update，resource_id/资源类别/数据来源只读展示（§5.2 不可改）。
 * - biz_code 必填下拉仅启用业务可选；network_domain 下拉来自 M06 网域清单；停用业务不可选。
 * - 校验错误置于字段下方（antd Form rules）；提交按钮 loading+disabled 防重复；
 *   提交失败透传后端错误 Alert（尤其 403/400）；成功后回刷列表（onSuccess）。
 */
export function ResourceFormDrawer({ open, mode, category, record, onCancel, onSuccess }: ResourceFormDrawerProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [networkDomains, setNetworkDomains] = useState<NetworkDomain[]>([])
  const [businessDomains, setBusinessDomains] = useState<BusinessDomain[]>([])
  // 应用字典（决策 92）：app_code 必填下拉取启用条目；展示名 app_name 由字典解析
  const [applicationDicts, setApplicationDicts] = useState<ApplicationDict[]>([])
  // {v2026-09-28 决策 110} 平台字典：「平台归属」可选下拉取启用条目（资源行一等字段）
  const [platformDicts, setPlatformDicts] = useState<PlatformDict[]>([])
  // 决策 111：应用↔平台 M:N 关联（app_platform_rel）——应用下拉按所选平台过滤的数据源。
  // 应用字典条目上的 platform_code 已废弃（决策 118-3），平台→应用的归属只能经本关联表反查。
  const [appPlatformRels, setAppPlatformRels] = useState<AppPlatformRel[]>([])
  // 操作系统内置字典（仅 host 表单「操作系统」下拉使用，os_dict.go）
  const [osOptions, setOsOptions] = useState<OSOption[]>([])
  const [dictError, setDictError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** 存量环境值（dev/test/staging/prod）不在新枚举内：不迁移，编辑时清空并提示重新选择 */
  const legacyEnv = record?.env && !ENV_VALUES.includes(record.env) ? record.env : undefined

  /** 编辑态以行 resource_category 为准，新增态取传入 Tab 类型 */
  const displayCategory = record?.resource_category ?? category
  const enabledBizDomains = businessDomains.filter((d) => d.enabled)
  // {v2026-09-28 决策 110} 平台字典：下拉仅列启用条目（停用平台禁止新引用，§5C 红线④）
  const enabledPlatformDicts = platformDicts.filter((d) => d.enabled)
  // §5.2 必填口径：application / database / middleware / interface_service 必填，host / generic_target 可空
  const appCodeRequired =
    displayCategory === 'application' ||
    displayCategory === 'database' ||
    displayCategory === 'middleware' ||
    displayCategory === 'interface_service'
  // 决策 F（§5.2）：cluster 必填规则 —— application / database / middleware 必填，
  // host / generic_target / interface_service 放开为可空（SNMP 交换机等设备类无集群归属，
  // 强制必填会逼填假数据污染 cluster 标签；接口服务后端 validateInterfaceService 亦不要求
  // cluster；空值不注入标签，见 5.15 规则 4）。与后端 validate.go 的三处 cluster 必填校验同口径，
  // 否则用户在必填类提交空 cluster 会撞后端 400 且前端无任何提示（静默失败）。
  // 刻意与 appCodeRequired 解耦——interface_service 要求 app_code 但不要求 cluster。
  const clusterRequired =
    displayCategory === 'application' || displayCategory === 'database' || displayCategory === 'middleware'

  /**
   * {v2026-09-28 决策 110 ④} 表单级联：**先选平台 → 再选应用（按所选平台过滤）**。
   *
   * 平台→应用的过滤依据**只能**是 `app_platform_rel`（决策 111 M:N）：应用字典条目上的
   * 单值 `platform_code` 已废弃（决策 118-3 全仓生产消费者归零），不可用于派生。
   * 未选平台时不做过滤（保持全量启用应用可选，避免「先选平台」成为硬前置）。
   */
  const selectedPlatformCode = Form.useWatch('platform_code', form) as string | undefined

  /** 关联到所选平台的应用编码集合（未选平台时为 null，表示「不按平台过滤」） */
  const appCodesOnSelectedPlatform = useMemo(() => {
    if (!selectedPlatformCode) return null
    return new Set(
      appPlatformRels.filter((r) => r.platform_code === selectedPlatformCode).map((r) => r.app_code),
    )
  }, [appPlatformRels, selectedPlatformCode])

  /** 应用下拉选项：启用条目 ∩ 所选平台关联集合（决策 110 ④ 级联过滤） */
  const appDictOptions = useMemo(
    () =>
      applicationDicts.filter((d) => {
        if (d.status !== 'enabled') return false
        if (!appCodesOnSelectedPlatform) return true
        return appCodesOnSelectedPlatform.has(d.app_code)
      }),
    [applicationDicts, appCodesOnSelectedPlatform],
  )
  // 应用下拉实际渲染时用（已按平台过滤）；未选平台时退化为全部启用应用
  const enabledAppDicts = appDictOptions

  useEffect(() => {
    if (!open) return
    // 打开抽屉时同步重置提交错误；沿用本模块既有 set-state-in-effect 模式（异步请求回调内才异步 setState）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubmitError(null)
    if (mode === 'create') {
      form.resetFields()
      // 仅预填 scheme:http（其他监控目标采集协议默认）；status 为 PRD 必填项，刻意不预填，强制用户显式选择
      form.setFieldsValue({ scheme: 'http' })
    } else if (record) {
      form.resetFields()
      form.setFieldsValue(recordToFormValues(record))
    }
    // 网域 / 业务字典 + 操作系统字典下拉（M06 网域清单 / §3.1 业务字典 / os_dict.go）
    // 决策 103 scheme-B：不再拉取云字典——表单无「云」录入项，云由所属网域派生。
    // {v2026-09-28 决策 110}：增拉平台字典（「平台归属」下拉）。
    Promise.all([
      networkDomainApi.list({ page: 1, page_size: 100 }),
      businessDomainApi.list(),
      osOptionApi.list(),
      applicationDictApi.list(),
      platformDictApi.list(),
    ])
      .then(([nd, bd, os, ad, pd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
        setOsOptions(os.data?.list ?? [])
        setApplicationDicts(ad.data?.list ?? [])
        setPlatformDicts(pd.data?.list ?? [])
        setDictError(null)
      })
      .catch((err: Error) => setDictError(err.message))
    // 决策 110 ④ 级联：应用↔平台 M:N 关联（app_platform_rel），用于按所选平台过滤应用下拉。
    // 该数据仅影响级联过滤的收敛度，**加载失败静默降级**为「不按平台过滤」，不阻塞表单填写。
    appPlatformRelApi
      .list()
      .then((res) => setAppPlatformRels(res.data?.list ?? []))
      .catch(() => setAppPlatformRels([]))
  }, [open, mode, record, form])

  const handleSubmit = async () => {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      // 字段校验失败，错误已由 Form.Item 置于字段下方；不提交
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (mode === 'create') {
        await resourceApi.create(buildCreateInput(category, values))
        message.success('资源已新增')
      } else if (record) {
        await resourceApi.update(record.resource_id, buildUpdateInput(displayCategory, values))
        message.success('资源已更新')
      }
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '提交失败，请稍后重试')
      setSubmitting(false)
    }
  }

  /**
   * {v2026-10-03 决策 110 ④} 级联收敛：切换 / 清空「平台归属」后，若已选应用不再属于
   * 新平台（或未选平台时为全量可用），则一并清空应用与服务选择——否则会残留
   * 「应用不属于所选平台」的组合，提交时被服务端自洽性校验拒绝。
   */
  const handlePlatformChange = () => {
    // setFieldsValue 不触发 onChange 递归；用 setTimeout 推至本轮渲染后读取最新 watch 值
    setTimeout(() => {
      const platform = form.getFieldValue('platform_code') as string | undefined
      const appCode = form.getFieldValue('app_code') as string | undefined
      if (!platform || !appCode) return
      const stillValid = appPlatformRels.some((r) => r.platform_code === platform && r.app_code === appCode)
      if (!stillValid) {
        form.setFieldsValue({ app_code: undefined })
      }
    })
  }

  /**
   * {T01-P5} host / database / middleware 三类表单共用的「采集端口（选填）」
   * （提案 resource-scrape-port-chain §5.3 录入动线；留空合法，由解析链回落默认端口）。
   *
   * D3a/D3b 守护：application / generic_target **不渲染**该项——application 的
   * 「端口（采集端口）」即采集目标本身（必填直用）、generic_target 的「端口」是端点
   * 自身属性，再展示一个「采集端口」会造成误填暗示。
   *
   * 刻意不设 InputNumber min/max：失焦钳制会把 70000 静默改写成 65535 而无从报错，
   * 放开控件层边界、仅由 rules 在提交时以「端口范围为 1-65535」阻断，保证越界必报错。
   */
  const scrapePortField = (
    <Form.Item
      label="采集端口（选填）"
      name="scrape_port"
      extra="留空时由采集端口解析链取默认（类型映射 → 采集器模板 → 业务端口）"
      rules={optionalPortRules}
    >
      <InputNumber style={{ width: '100%' }} placeholder="例如：9100（可选）" data-testid="scrape-port-input" />
    </Form.Item>
  )

  /** 编辑态只读展示：resource_id / 资源类别 / 数据来源（§5.2 创建后不可改） */
  const renderReadonlyInfo = () => {
    if (mode !== 'edit' || !record) return null
    return (
      <div style={{ marginBottom: 16, background: 'rgba(0,0,0,0.02)', padding: '8px 12px', borderRadius: 6 }}>
        <Space size={24} wrap>
          <Text type="secondary">
            资源 ID：<Text code>{record.resource_id}</Text>
          </Text>
          <Text type="secondary">资源类别：{RESOURCE_TYPE_MAP[displayCategory]}</Text>
          <Text type="secondary">数据来源：{SOURCE_TYPE_MAP[record.source_type] ?? record.source_type}</Text>
        </Space>
      </div>
    )
  }

  /** 字段渲染上下文：只读当前表单状态，渲染函数不引入额外 hooks / 请求 */
  const fieldsContext: ResourceFormFieldsContext = {
    form,
    category: displayCategory,
    networkDomains,
    enabledBizDomains,
    enabledAppDicts,
    enabledPlatformDicts,
    selectedPlatformCode,
    legacyEnv,
    appCodeRequired,
    clusterRequired,
    osOptions,
    handlePlatformChange,
    scrapePortField,
  }

  return (
    <Drawer
      title={
        mode === 'create'
          ? `新增资源（${RESOURCE_TYPE_MAP[category]}）`
          : `编辑资源（${RESOURCE_TYPE_MAP[displayCategory]}）`
      }
      open={open}
      onClose={submitting ? undefined : onCancel}
      width={560}
      // forceRender：Drawer 首次打开时内容惰性挂载（rc-drawer 动画期先于父组件
      // useEffect 的 setFieldsValue 完成挂载），导致编辑回显首次为空、二次才出现；
      // forceRender 保证 Form 常驻挂载，首次打开即正确回显（#19 通病，M07 资源抽屉）。
      forceRender
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={onCancel} disabled={submitting}>
              取消
            </Button>
            <Button type="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
              {mode === 'create' ? '提交' : '保存'}
            </Button>
          </Space>
        </div>
      }
    >
      {dictError && (
        <Alert
          type="warning"
          showIcon
          message="字典加载失败"
          description="网域 / 业务 / 应用 / 操作系统字典加载失败，请稍后重试"
          style={{ marginBottom: 16 }}
        />
      )}
      {submitError && (
        <Alert type="error" showIcon message="提交失败" description={submitError} style={{ marginBottom: 16 }} />
      )}
      {renderReadonlyInfo()}
      <Form form={form} layout="vertical" name="resource-form" requiredMark preserve={false}>
        {renderResourceSharedFields(fieldsContext)}
        {renderResourceTypeFields(fieldsContext)}
      </Form>
    </Drawer>
  )
}

export default ResourceFormDrawer
