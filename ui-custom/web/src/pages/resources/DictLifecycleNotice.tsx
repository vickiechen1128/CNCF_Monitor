import { Alert } from 'antd'

/**
 * F7「字典 ≠ 可删除对象」定位说明（§5.24 / 决策 112）
 *
 * 业务 / 应用 / 平台 / 服务四字典同属「编码取值权威」、**不是可删除的对象**——
 * 编码即监控标签取值，删除会断历史时序，故生命周期为「启用 ↔ 停用」；
 * 真正可删除的是资源实例（Resource，在「资源管理」删除）。
 *
 * **四页共用同一份文案常量**（`DICT_LIFECYCLE_NOTICE`），禁止按页硬编码导致口径漂移。
 * 纯说明性组件：**不携带任何写操作、不提供删除入口**（字典「停用不删除」是红线）。
 * 用户语言按 §10 术语可见性 U1 约束——不出现 `label` / `platform_code` 等技术术语。
 */
export const DICT_LIFECYCLE_NOTICE =
  '本页为『字典』，编码即监控标签取值，删除会断历史时序，故生命周期为启用 ↔ 停用、不提供删除；需要删除请到『资源管理』删除资源实例'

/** 字典页顶部统一说明条（可关闭）。四字典页共用，保证文案一致。 */
export function DictLifecycleNotice() {
  return <Alert type="info" showIcon closable message={DICT_LIFECYCLE_NOTICE} style={{ marginBottom: 16 }} />
}

export default DictLifecycleNotice
