import { useState } from 'react'
import { Alert, Drawer, Typography } from 'antd'
import { DICT_LIFECYCLE_RULES } from './dictionaryLifecycle'

/**
 * 字典生命周期定位说明（M07 SRS v2.0 §3.4 / NFR-21）
 *
 * 业务 / 应用 / 平台 / 云 / 区域类型五个字典同属「编码取值权威」——编码即监控标签取值，
 * 一旦被资源、应用归属或网域引用就进入历史时序，不能物理删除、也不能复用。
 *
 * 生命周期：
 * - 从未被引用的条目可「撤销」（终态，编码永久保留、不可重新登记）；
 * - 已被引用的条目只能「停用」或「合并」，不能撤销。
 *
 * **字典页共用同一份文案**：默认只展示一行摘要，完整规则按需在抽屉中展开，
 * 避免多页顶部长期堆叠多块说明；平台页的层级补充说明经 `extraRules` 注入。
 */
export const DICT_LIFECYCLE_NOTICE =
  '字典编码就是监控标签取值：引用后不可删除、不可复用；零引用可撤销，有引用只能停用或合并'

export interface DictLifecycleNoticeProps {
  /** 页面专属补充说明（如平台页的层级与主平台约束），仅展开规则时展示 */
  extraRules?: string[]
}

/** 字典页顶部统一说明条（可关闭）。五类字典页共用，保证文案一致。 */
export function DictLifecycleNotice({ extraRules = [] }: DictLifecycleNoticeProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Alert
        type="info"
        showIcon
        closable
        message={
          <span>
            {DICT_LIFECYCLE_NOTICE}
            <Typography.Link onClick={() => setOpen(true)} style={{ marginInlineStart: 8 }}>
              查看规则
            </Typography.Link>
          </span>
        }
        style={{ marginBottom: 16 }}
      />
      <Drawer title="字典生命周期规则" open={open} onClose={() => setOpen(false)} width={480} destroyOnHidden>
        <Typography.Paragraph type="secondary">
          字典是编码取值权威，不是可删除的对象。以下规则适用于业务、应用、平台、云、区域类型五个字典。
        </Typography.Paragraph>
        <ul style={{ paddingInlineStart: 20, margin: 0 }}>
          {DICT_LIFECYCLE_RULES.map((rule) => (
            <li key={rule} style={{ marginBottom: 8 }}>
              {rule}
            </li>
          ))}
        </ul>
        {extraRules.length > 0 && (
          <>
            <Typography.Title level={5} style={{ marginTop: 24 }}>
              平台补充说明
            </Typography.Title>
            <ul style={{ paddingInlineStart: 20, margin: 0 }}>
              {extraRules.map((rule) => (
                <li key={rule} style={{ marginBottom: 8 }}>
                  {rule}
                </li>
              ))}
            </ul>
          </>
        )}
      </Drawer>
    </>
  )
}

export default DictLifecycleNotice
