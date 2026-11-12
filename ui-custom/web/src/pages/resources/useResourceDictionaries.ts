import { useEffect, useMemo, useState } from 'react'
import { networkDomainApi } from '../../api/domain'
import {
  appPlatformRelApi,
  applicationDictApi,
  businessDomainApi,
  cloudDictApi,
  platformDictApi,
} from '../../api/resources'
import type { NetworkDomain } from '../../types/domain'
import type {
  AppPlatformRel,
  ApplicationDict,
  BusinessDomain,
  CloudDict,
  PlatformDict,
} from '../../types/resource'

export interface UseResourceDictionariesResult {
  /** 网域清单（M06）：网域筛选下拉 + 网域列 / 详情抽屉展示名解析 */
  networkDomains: NetworkDomain[]
  /** 业务字典：业务筛选下拉 + 业务列 / 模板弹窗 / 详情抽屉展示名解析 */
  businessDomains: BusinessDomain[]
  /** 应用字典（决策 92/96）：应用列 / 模板弹窗展示名解析，与业务字典正交两维 */
  applicationDomains: ApplicationDict[]
  /** 云字典（决策 103，部署级只读）：云列展示名解析 */
  cloudDicts: CloudDict[]
  /** 平台字典（决策 110）：平台筛选下拉 + 平台列展示名解析 */
  platformDicts: PlatformDict[]
  /** 应用↔平台 M:N 关联（F-18 / 决策 111）：「应用」筛选器按所选平台级联的数据源 */
  appPlatformRels: AppPlatformRel[]
  /** 「应用」筛选下拉的级联候选：启用应用 ∩ 所选平台关联集合（见实现内降级口径） */
  filterAppOptions: ApplicationDict[]
  /** 网域 ID → 展示名，未匹配兜底展示 ID */
  domainNameOf: (id: string) => string
  /** 网域 ID → 云编码（决策 103 scheme-B：云归属由所属网域派生，资源侧只读） */
  cloudCodeOf: (domainId: string) => string | undefined
  /** 网域 ID → 网络分区编码（决策 103 scheme-B：分区由所属网域派生，资源侧只读） */
  zoneTypeOf: (domainId: string) => string | undefined
  /** 业务编码 → biz_name，空值 '-'、缺条目回退编码 */
  resolveBizName: (code?: string) => string
  /** 业务是否停用（停用业务以「业务名（已停用）」标识） */
  isBizDisabled: (code: string) => boolean
  /** 应用编码 → app_name，空值 '-'、缺条目回退 app_code */
  resolveAppName: (code?: string) => string
  /** 应用是否停用（停用应用以「应用名（已停用）」标识） */
  isAppDisabled: (code: string) => boolean
  /** 云编码 → cloud_name，空值 '-'、缺条目回退 cloud_code */
  resolveCloudName: (code?: string) => string
  /** 云是否停用（停用条目以「云名（已停用）」标识） */
  isCloudDisabled: (code: string) => boolean
  /** 平台编码 → platform_name，空值 '-'、缺条目回退 platform_code */
  resolvePlatformName: (code?: string) => string
  /** 平台是否停用（停用条目以「平台名（已停用）」标识） */
  isPlatformDisabled: (code: string) => boolean
}

/**
 * 资源列表字典 Hook（Module_07 §11.1；F-18 / 决策 92/98/103/110/111）。
 *
 * 收敛资源页六份字典的加载与「编码 → 展示名 / 停用标识」解析，供筛选下拉、
 * 列渲染（`resourceColumns.tsx`）与抽屉 / 弹窗共用同一口径：
 *
 * - 首屏五份字典（网域 / 业务 / 应用 / 云 / 平台）走**一次** `Promise.all` 并行拉取，
 *   调用次数与顺序保持不变；任一份失败整体 `.catch` 静默吞掉，下拉退化为空、
 *   列渲染回落编码 / '-'，**不阻塞列表主流程**。
 * - 应用↔平台关联独立加载：失败、结构异常（非数组）、空数据统一落到「无关联数据」，
 *   `filterAppOptions` 据此放宽为全部启用应用（见该方法内注释）。
 */
export function useResourceDictionaries(platformCode?: string): UseResourceDictionariesResult {
  const [networkDomains, setNetworkDomains] = useState<NetworkDomain[]>([])
  const [businessDomains, setBusinessDomains] = useState<BusinessDomain[]>([])
  const [applicationDomains, setApplicationDomains] = useState<ApplicationDict[]>([])
  const [cloudDicts, setCloudDicts] = useState<CloudDict[]>([])
  const [platformDicts, setPlatformDicts] = useState<PlatformDict[]>([])
  const [appPlatformRels, setAppPlatformRels] = useState<AppPlatformRel[]>([])

  useEffect(() => {
    Promise.all([
      networkDomainApi.list({ page: 1, page_size: 100 }),
      businessDomainApi.list(),
      applicationDictApi.list(),
      cloudDictApi.list(),
      platformDictApi.list(),
    ])
      .then(([nd, bd, ad, cd, pd]) => {
        setNetworkDomains(nd.data?.list ?? [])
        setBusinessDomains(bd.data?.list ?? [])
        setApplicationDomains(ad.data?.list ?? [])
        setCloudDicts(cd.data?.list ?? [])
        setPlatformDicts(pd.data?.list ?? [])
      })
      .catch(() => {
        // 下拉字典加载失败不阻塞列表展示
      })
    // F-18 / 决策 111：应用↔平台关联仅用于「应用」筛选器的级联收敛度。
    // 加载失败时**静默降级为「不按平台过滤」**（应用下拉列出全部启用应用），与资源表单级联
    // 同一降级口径。降级方向是「放宽」而非「收紧」——`filterAppOptions` 以
    // `appPlatformRels.length === 0` 判定「关联数据不可用」，故失败态（rels 为空）
    // 自动落到放宽路径，不会让用户选了平台后下拉**一个选项都没有**且无任何提示
    // （frontend-reviewer M-2）；有关联数据时仍正常按平台收敛。
    appPlatformRelApi
      .list()
      .then((r) => {
        // 数据缺失（如接口返回异常结构）同样按「无关联数据」处理，保持降级口径一致
        setAppPlatformRels(Array.isArray(r.data?.list) ? r.data.list : [])
      })
      .catch(() => {
        // 忽略：应用筛选器退化为全量启用应用（不按平台过滤）
      })
  }, [])

  /**
   * F-18：「应用」筛选下拉的级联选项——启用应用 ∩ 所选平台关联集合。
   *
   * 与资源表单三级级联同源（`app_platform_rel` 为平台→应用归属的唯一权威，
   * 决策 111 M:N）；未选平台时不按平台过滤（保持「先选平台」非硬前置），
   * 与表单 `appCodesOnSelectedPlatform` 口径一致。
   */
  const filterAppOptions = useMemo(() => {
    if (!platformCode) return applicationDomains.filter((d) => d.status === 'enabled')
    const relAppCodes = new Set(
      appPlatformRels.filter((r) => r.platform_code === platformCode).map((r) => r.app_code),
    )
    // 关联数据不可用（加载失败，或加载成功但一条关联都没有）→ 放宽为全部启用应用。
    // 若此时仍按平台收敛，会让用户选了平台后应用下拉**一个选项都没有**且无任何提示
    // （frontend-reviewer M-2）。故只要 `appPlatformRels` 为空就走放宽路径——
    // 「该平台确无关联」与「关联数据不可用」在 UI 上无区别，放宽是唯一不失真的选择；
    // 一旦有关联数据（length > 0）即正常按平台收敛。
    if (appPlatformRels.length === 0) return applicationDomains.filter((d) => d.status === 'enabled')
    return applicationDomains.filter((d) => d.status === 'enabled' && relAppCodes.has(d.app_code))
  }, [applicationDomains, appPlatformRels, platformCode])

  /** 网域 ID → 展示名（M06 网域清单），未匹配兜底展示 ID */
  const domainNameOf = (id: string) => networkDomains.find((d) => d.id === id)?.name ?? id
  /** 网域 ID → 云编码（v3 资源不再内联 cloud_code，云归属由所属网域只读派生） */
  const cloudCodeOf = (domainId: string) => {
    const domain = networkDomains.find((d) => d.id === domainId)
    return domain?.cloud_code || undefined
  }
  /** 网域 ID → 网络分区编码（v3 资源不再内联 zone_type，分区由所属网域只读派生） */
  const zoneTypeOf = (domainId: string) => {
    const domain = networkDomains.find((d) => d.id === domainId)
    return domain?.zone_type || undefined
  }
  /** 业务编码 → biz_name（Module_07 §11.2 业务列展示 biz_name） */
  const resolveBizName = (code?: string) => {
    if (!code) return '-'
    return businessDomains.find((b) => b.code === code)?.name ?? code
  }
  /** 业务是否停用（停用业务以「业务名（已停用）」标识，存量保留历史值，§11.2） */
  const isBizDisabled = (code: string) => {
    const b = businessDomains.find((d) => d.code === code)
    return !!b && !b.enabled
  }
  /** 应用编码 → app_name（§5.19 / 决策 92：应用列展示字典展示名，缺条目回退 app_code） */
  const resolveAppName = (code?: string) => {
    if (!code) return '-'
    return applicationDomains.find((a) => a.app_code === code)?.app_name ?? code
  }
  /** 应用是否停用（决策 92：停用应用以「应用名（已停用）」标识，存量保留历史值，§11.2） */
  const isAppDisabled = (code: string) => {
    const a = applicationDomains.find((d) => d.app_code === code)
    return !!a && a.status === 'disabled'
  }
  /** 云编码 → cloud_name（§5.20 / 决策 98：云列展示字典展示名，缺条目回退 cloud_code） */
  const resolveCloudName = (code?: string) => {
    if (!code) return '-'
    return cloudDicts.find((c) => c.cloud_code === code)?.cloud_name ?? code
  }
  /** 云是否停用（决策 98：停用条目以「云名（已停用）」标识，存量资源保留历史值） */
  const isCloudDisabled = (code: string) => {
    const c = cloudDicts.find((d) => d.cloud_code === code)
    return !!c && !c.enabled
  }
  /**
   * 平台展示名（{v2026-09-28 决策 110} / 契约快照 §11）：**资源行 `platform_code` 一等字段**为唯一权威，
   * 经 `GET /platform-dict` 解析 `platform_name`；字典缺条目回退显示 `platform_code`，
   * 停用条目标识「平台名（已停用）」（存量资源保留历史值）。留空显示 '-'。
   *
   * ⚠️ 停用**已废弃**的 `app_code → ApplicationDict.platform_code` 派生（决策 111 M:N 后恒为「-」，
   * 使 M:N 关系 UI 成「写入后不可见」的死功能）；资源行留空时的应用主平台兜底属**标签层**语义，
   * 不回写本字段，故此处不做兜底展示。
   */
  const resolvePlatformName = (code?: string) => {
    if (!code) return '-'
    return platformDicts.find((d) => d.platform_code === code)?.platform_name ?? code
  }
  /** 平台是否停用（停用条目以「平台名（已停用）」标识，存量资源保留历史值） */
  const isPlatformDisabled = (code: string) => {
    const p = platformDicts.find((d) => d.platform_code === code)
    return !!p && !p.enabled
  }

  return {
    networkDomains,
    businessDomains,
    applicationDomains,
    cloudDicts,
    platformDicts,
    appPlatformRels,
    filterAppOptions,
    domainNameOf,
    cloudCodeOf,
    zoneTypeOf,
    resolveBizName,
    isBizDisabled,
    resolveAppName,
    isAppDisabled,
    resolveCloudName,
    isCloudDisabled,
    resolvePlatformName,
    isPlatformDisabled,
  }
}
