import { Tag } from 'antd'

/** {v1.7} 决策 59：通用表单（接收人/路由/抑制的增删改弹窗）为未来版本能力演示，MVP 以「配置管理」页文件挂载为准。
 *  // [DEV] 该阶段标记用于评审区分「可用能力」与「演示形态」，非 MVP 交付依据。 */
export default function V03Badge() {
  return (
    <Tag
      color="orange"
      style={{
        marginInlineStart: 4,
        paddingInline: 4,
        lineHeight: '14px',
        fontSize: 10,
        borderRadius: 4,
      }}
    >
      演示
    </Tag>
  )
}