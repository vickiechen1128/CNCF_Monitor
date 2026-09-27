import { Space, Tooltip } from 'antd'
import { QuestionCircleOutlined } from '@ant-design/icons'

/**
 * 表单 / 详情字段标签 + 悬浮说明（跨页统一形态）。
 *
 * 与生产实现 `ui-custom/web/src/components/FieldLabel.tsx` 同形：字段级解释一律走
 * 标签旁的问号 Tooltip，字段下方不再散落小字注释；只有「需要常显的输入示例 / 格式要求」
 * 才保留在 placeholder 或 extra。
 *
 * 用于 `Form.Item label={<FieldLabel .../>}`、`Descriptions.Item label={<FieldLabel .../>}`
 * 与表格列头 `title={<FieldLabel .../>}`。
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
