/**
 * 告警状态页（Module_08 告警收敛与通知管理）。
 * 当前为展示入口占位（具体告警列表接入见后续任务）；
 * 排版与告警模块其他页面对齐：MainLayout + Card 页面头统一模式。
 */
import config from 'antd/locale/zh_CN'
import { Card, ConfigProvider, Typography } from 'antd'
import { MainLayout } from '../../layouts/MainLayout'

const { Text } = Typography

export function AlertsPage() {
  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card title="告警状态">
          <Text type="secondary">当前告警列表展示入口（接入见后续任务）。</Text>
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default AlertsPage