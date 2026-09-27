import { Space, Tooltip } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'

/**
 * 表单字段标签 + 悬浮说明（跨模块统一形态）。
 *
 * 背景：此前各抽屉的字段解释三种写法混用（Form.Item `extra`、字段下方手写 12px 灰字 div、
 * Tag 内嵌 Tooltip），同一模块内形态不一致、长文本还会挤高表单。
 * 约定：**字段级解释一律走标签旁的问号 Tooltip**，字段下方不再散落小字注释；
 * 只有「需要常显的输入示例 / 格式要求」才保留在 placeholder 或 extra。
 *
 * 用于 `Form.Item label={<FieldLabel .../>}` 与 `Descriptions.Item label={<FieldLabel .../>}`。
 */
export function FieldLabel({ label, tip }: { label: string; tip?: string }) {
  if (!tip) return <>{label}</>

  return (
    <Space size={4}>
      <span>{label}</span>
      {/* 长提示限宽换行（antd 5 新写法：`overlayStyle` 已废弃） */}
      <Tooltip title={tip} styles={{ root: { maxWidth: 340 } }}>
        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)', cursor: 'help' }} />
      </Tooltip>
    </Space>
  )
}

export default FieldLabel
