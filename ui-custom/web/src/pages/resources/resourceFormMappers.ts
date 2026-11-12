/**
 * 资源表单纯映射函数（Module_07 §5.6~§5.9）。
 *
 * 从 `ResourceFormDrawer.tsx` 抽出的无副作用函数与常量：
 * - 表单值 ↔ 创建 / 编辑请求体（`buildCreateInput` / `buildUpdateInput` / `buildTypeFields`）；
 * - 编辑态行 → 表单初始值（`recordToFormValues`）。
 *
 * 不依赖 React / antd 组件，便于独立推理与复用；字段渲染见 `resourceFormFields.tsx`。
 * v3 的 `attributes` 嵌套由 `api/resources.ts` 适配层统一组装，本文件保持页面平铺语义。
 */
import dayjs from 'dayjs'
import type {
  ResourceCategory,
  ResourceCreateInput,
  ResourceStatus,
  ResourceUpdateInput,
} from '../../types/resource'
import type { ResourceListItem } from '../../types/resource'

/** 环境取值（§5.16.1 / ValidEnvs）：2026-10-21 起收敛为 OPS / PRD / UAT */
export const ENV_VALUES = ['OPS', 'PRD', 'UAT']

/** 组装新增请求体：resource_category 创建必传；source_type 由后端置 manual（§5.2/§6.1/T07-06） */
export function buildCreateInput(
  category: ResourceCategory,
  values: Record<string, unknown>,
): ResourceCreateInput {
  return {
    resource_category: category,
    network_domain_id: String(values.network_domain_id),
    biz_code: String(values.biz_code),
    app_code: values.app_code ? String(values.app_code) : undefined,
    // {v2026-09-28 决策 110} 平台归属（资源行一等字段）：留空则不下发该键（undefined），
    // 由服务端按所属应用主平台兜底；不传空串，避免被当作显式取值。
    platform_code: values.platform_code ? String(values.platform_code) : undefined,
    // 决策 103 scheme-B：cloud_code 不再随资源写请求体——云由所属网域派生（只读），
    // 表单无「云」录入项，服务端亦不接受该字段。
    env: String(values.env),
    cluster: values.cluster ? String(values.cluster) : undefined,
    owner: values.owner ? String(values.owner) : undefined,
    status: values.status as ResourceStatus,
    // {T01-P5} 采集端口：留空 → 提交 0（= 未指定，与 NULL 等价；编辑清空时以 0 回退解析链）
    scrape_port: values.scrape_port ? Number(values.scrape_port) : 0,
    ...buildTypeFields(category, values),
  } as ResourceCreateInput
}

/** 组装编辑请求体：v3 全量更新必带 resource_category；source_type 不可改、不随请求体（§6.1/T07-06） */
export function buildUpdateInput(
  category: ResourceCategory,
  values: Record<string, unknown>,
): ResourceUpdateInput {
  return {
    resource_category: category,
    network_domain_id: String(values.network_domain_id),
    biz_code: String(values.biz_code),
    app_code: values.app_code ? String(values.app_code) : undefined,
    // {v2026-09-28 决策 110} 平台归属：编辑态**显式给出**——选中传编码、
    // 清空传 null（表达「取消平台归属」），undefined 会导致「清空后不提交 → 平台残留」。
    platform_code: values.platform_code ? String(values.platform_code) : null,
    // 决策 103 scheme-B：同新增，cloud_code 不经编辑请求体（云随所属网域派生）
    env: String(values.env),
    cluster: values.cluster ? String(values.cluster) : undefined,
    owner: values.owner ? String(values.owner) : undefined,
    status: values.status as ResourceStatus,
    // {T01-P5} 采集端口语义同新增：留空/0 = 未指定
    scrape_port: values.scrape_port ? Number(values.scrape_port) : 0,
    ...buildTypeFields(category, values),
  } as ResourceUpdateInput
}

/** 按资源类别取差异化字段（与 §5.6~§5.9 字段表一致；scrape_port 已上移为公共字段） */
export function buildTypeFields(
  category: ResourceCategory,
  values: Record<string, unknown>,
): Record<string, unknown> {
  switch (category) {
    case 'host':
      return {
        // v3 host 的 attributes.hostname 是唯一主机名来源，页面以「实例名」承载
        instance_name: String(values.instance_name),
        instance_ip: String(values.instance_ip),
        os_type: values.os_type ? String(values.os_type) : undefined,
        activated_at:
          values.activated_at && dayjs.isDayjs(values.activated_at)
            ? values.activated_at.toISOString()
            : undefined,
      }
    case 'database':
      return {
        database_type: String(values.database_type),
        instance_ip: String(values.instance_ip),
        port: Number(values.port),
        version: values.version ? String(values.version) : undefined,
      }
    case 'middleware':
      return {
        middleware_type: String(values.middleware_type),
        instance_ip: String(values.instance_ip),
        port: Number(values.port),
        version: values.version ? String(values.version) : undefined,
      }
    case 'application':
      return {
        service_name: String(values.service_name),
        endpoint: values.endpoint ? String(values.endpoint) : undefined,
        health_check_url: String(values.health_check_url),
        owner1: values.owner1 ? String(values.owner1) : undefined,
        owner1_contact: values.owner1_contact ? String(values.owner1_contact) : undefined,
        owner2: values.owner2 ? String(values.owner2) : undefined,
        owner2_contact: values.owner2_contact ? String(values.owner2_contact) : undefined,
        ops_person: values.ops_person ? String(values.ops_person) : undefined,
        ops_person_contact: values.ops_person_contact ? String(values.ops_person_contact) : undefined,
        go_live_at: values.go_live_at && dayjs.isDayjs(values.go_live_at) ? values.go_live_at.toISOString() : undefined,
        protocol: values.protocol ? String(values.protocol) : undefined,
        port: values.port ? Number(values.port) : undefined,
      }
    case 'generic_target':
      return {
        target_name: String(values.target_name),
        instance_ip: String(values.instance_ip),
        port: values.port ? Number(values.port) : undefined,
        metrics_path: values.metrics_path ? String(values.metrics_path) : undefined,
        scheme: values.scheme ? String(values.scheme) : undefined,
        exporter_type: values.exporter_type ? String(values.exporter_type) : undefined,
      }
    case 'interface_service':
      // 接口服务差异化字段：接口名（展示名）+ 接口地址（完整 URL，含 ? 查询参数）。
      // 无采集端口语义，**不提交 scrape_port**（后端 validateScrapePort 仅在填值时校验）。
      return {
        api_name: String(values.api_name),
        api_url: String(values.api_url),
      }
  }
}

/** 编辑态行（ResourceListItem 平铺字段）→ 表单初始值（Form 字段名） */
export function recordToFormValues(record: ResourceListItem): Record<string, unknown> {
  return {
    network_domain_id: record.network_domain_id,
    biz_code: record.biz_code,
    app_code: record.app_code,
    // {v2026-09-28 决策 110} 平台归属回显：资源行一等字段；空串归一为 undefined 交由 Select 走未选态
    platform_code: record.platform_code || undefined,
    // 存量环境值（dev/test/staging/prod）不在新枚举内：清空，保存时强制重新选择
    env: record.env && ENV_VALUES.includes(record.env) ? record.env : undefined,
    cluster: record.cluster,
    owner: record.owner,
    status: record.status,
    instance_name: record.instance_name,
    instance_ip: record.instance_ip,
    os_type: record.os_type,
    activated_at: record.activated_at ? dayjs(record.activated_at) : undefined,
    database_type: record.database_type,
    middleware_type: record.middleware_type,
    port: record.port,
    // {T01-P5} 采集端口回显：后端 0 = 未指定 → 归一为空态（与「留空提交 0」对称）
    scrape_port: record.scrape_port || undefined,
    version: record.version,
    service_name: record.service_name,
    health_check_url: record.health_check_url,
    owner1: record.owner1,
    owner1_contact: record.owner1_contact,
    owner2: record.owner2,
    owner2_contact: record.owner2_contact,
    ops_person: record.ops_person,
    ops_person_contact: record.ops_person_contact,
    go_live_at: record.go_live_at ? dayjs(record.go_live_at) : undefined,
    protocol: record.protocol,
    endpoint: record.endpoint,
    target_name: record.target_name,
    metrics_path: record.metrics_path,
    scheme: record.scheme,
    exporter_type: record.exporter_type,
    api_name: record.api_name,
    api_url: record.api_url,
  }
}
