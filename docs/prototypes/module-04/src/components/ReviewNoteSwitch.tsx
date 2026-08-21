import { useReviewNotes } from '../contexts/ReviewNotesContext'
import { Space, Switch, Typography } from 'antd'

/**
 * MainLayout 右上角开关：控制全局 <ReviewNote> 显隐。
 */
export function ReviewNoteSwitch() {
  const { enabled, setEnabled } = useReviewNotes()
  return (
    <Space size={4} align="center" style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>
      <Typography.Text style={{ color: 'inherit', fontSize: 13 }}>评审说明</Typography.Text>
      <Switch size="small" checked={enabled} onChange={setEnabled} />
    </Space>
  )
}