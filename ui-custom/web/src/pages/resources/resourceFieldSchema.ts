/**
 * CI 模型内置字段元数据（SRS Module_07 v2.2 §5.8 FR-30 / FR-33）。
 *
 * 用途：
 * 1. 表单与模型页共用的「字段 → 分组 / 组内顺序」单一来源；
 * 2. 测试守护：表单渲染的内置字段必须全部登记在这里，防止新增字段漏分组；
 * 3. 与后端 domain/builtin_fields.go 的 key 集合保持一致（由测试守护）。
 *
 * 只登记分组、顺序与必填，不登记展示名与控件：展示名与渲染由
 * `resourceFormFields.tsx` 负责，避免同一文案两处维护。
 */
import type { AttributeGroup } from '../../types/attribute'
import type { ResourceCategory } from '../../types/resource'

/** 分组展示顺序（与后端 ValidAttributeGroups 一致）。 */
export const FIELD_GROUP_ORDER: AttributeGroup[] = [
  'identity',
  'ownership',
  'runtime',
  'collection',
  'capability',
  'profile',
]

/** 分组中文名。 */
export const FIELD_GROUP_LABEL: Record<AttributeGroup, string> = {
  identity: '身份信息',
  ownership: '归属信息',
  runtime: '运行信息',
  collection: '采集信息',
  capability: '能力信息',
  profile: '画像信息',
}

export interface BuiltinFieldMeta {
  key: string
  group: AttributeGroup
  order: number
  required?: boolean
}

const OWNERSHIP: BuiltinFieldMeta[] = [
  { key: 'network_domain_id', group: 'ownership', order: 0, required: true },
  { key: 'biz_code', group: 'ownership', order: 1 },
  { key: 'app_code', group: 'ownership', order: 2 },
  { key: 'platform_code', group: 'ownership', order: 3 },
  { key: 'cluster', group: 'ownership', order: 4 },
  { key: 'env', group: 'ownership', order: 5, required: true },
]

const RUNTIME: BuiltinFieldMeta[] = [{ key: 'status', group: 'runtime', order: 0, required: true }]

const OWNERSHIP_WITHOUT_PLATFORM = OWNERSHIP.filter((field) => field.key !== 'platform_code').map((field, index) => ({
  ...field,
  order: index,
}))

/** 六类 CI 的内置字段元数据。 */
export const BUILTIN_FIELD_SCHEMA: Record<ResourceCategory, BuiltinFieldMeta[]> = {
  host: [
    { key: 'instance_name', group: 'identity', order: 0, required: true },
    { key: 'instance_ip', group: 'identity', order: 1, required: true },
    { key: 'os_type', group: 'identity', order: 2, required: true },
    ...OWNERSHIP,
    ...RUNTIME,
    { key: 'scrape_port', group: 'collection', order: 0 },
    { key: 'has_npu', group: 'capability', order: 0 },
    { key: 'has_gpu', group: 'capability', order: 1 },
    { key: 'owner', group: 'profile', order: 0 },
    { key: 'activated_at', group: 'profile', order: 1 },
  ],
  database: [
    { key: 'database_type', group: 'identity', order: 0, required: true },
    { key: 'instance_ip', group: 'identity', order: 1, required: true },
    { key: 'port', group: 'identity', order: 2, required: true },
    ...OWNERSHIP,
    ...RUNTIME,
    { key: 'scrape_port', group: 'collection', order: 0 },
    { key: 'version', group: 'profile', order: 0 },
    { key: 'owner', group: 'profile', order: 1 },
  ],
  middleware: [
    { key: 'middleware_type', group: 'identity', order: 0, required: true },
    { key: 'instance_ip', group: 'identity', order: 1, required: true },
    { key: 'port', group: 'identity', order: 2, required: true },
    ...OWNERSHIP,
    ...RUNTIME,
    { key: 'scrape_port', group: 'collection', order: 0 },
    { key: 'version', group: 'profile', order: 0 },
    { key: 'owner', group: 'profile', order: 1 },
  ],
  application: [
    { key: 'service_name', group: 'identity', order: 0, required: true },
    { key: 'health_check_url', group: 'identity', order: 1, required: true },
    ...OWNERSHIP,
    ...RUNTIME,
    { key: 'endpoint', group: 'collection', order: 0 },
    { key: 'port', group: 'collection', order: 1 },
    { key: 'owner', group: 'profile', order: 0 },
    { key: 'owner1', group: 'profile', order: 1 },
    { key: 'owner1_contact', group: 'profile', order: 2 },
    { key: 'owner2', group: 'profile', order: 3 },
    { key: 'owner2_contact', group: 'profile', order: 4 },
    { key: 'ops_person', group: 'profile', order: 5 },
    { key: 'ops_person_contact', group: 'profile', order: 6 },
    { key: 'go_live_at', group: 'profile', order: 7 },
    { key: 'protocol', group: 'profile', order: 8 },
  ],
  interface_service: [
    { key: 'api_name', group: 'identity', order: 0, required: true },
    { key: 'api_url', group: 'identity', order: 1, required: true },
    ...OWNERSHIP_WITHOUT_PLATFORM,
    ...RUNTIME,
    { key: 'owner', group: 'profile', order: 0 },
  ],
  generic_target: [
    { key: 'target_name', group: 'identity', order: 0, required: true },
    { key: 'instance_ip', group: 'identity', order: 1, required: true },
    ...OWNERSHIP,
    ...RUNTIME,
    { key: 'port', group: 'collection', order: 0 },
    { key: 'metrics_path', group: 'collection', order: 1 },
    { key: 'scheme', group: 'collection', order: 2 },
    { key: 'exporter_type', group: 'collection', order: 3 },
    { key: 'owner', group: 'profile', order: 0 },
  ],
}

/** 某类 CI 的内置字段 key 集合。 */
export function builtinFieldKeys(category: ResourceCategory): string[] {
  return BUILTIN_FIELD_SCHEMA[category].map((field) => field.key)
}

/** 按分组汇总内置字段（模型页兜底展示用）。 */
export function groupBuiltinFields(
  category: ResourceCategory,
): { group: AttributeGroup; label: string; fields: BuiltinFieldMeta[] }[] {
  return FIELD_GROUP_ORDER.map((group) => ({
    group,
    label: FIELD_GROUP_LABEL[group],
    fields: BUILTIN_FIELD_SCHEMA[category]
      .filter((field) => field.group === group)
      .sort((a, b) => a.order - b.order),
  })).filter((section) => section.fields.length > 0)
}
