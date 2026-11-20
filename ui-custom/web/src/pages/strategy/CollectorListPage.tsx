import { Space, Typography } from 'antd'
import { MainLayout } from '../../layouts/MainLayout'
import { CollectorTemplatesTab } from './CollectorTemplatesTab'

const { Text, Title } = Typography

/**
 * 采集模板页（路由 /collectors，原「采集器管理」）。
 *
 * M01 v2.0 重构：「监控对象类型」概念下线，模板成为唯一的「类对象」配置载体——
 * 模板回答「这类对象怎么采」（采集实现 + 抓取参数 + 标签模板），
 * 「采哪些对象」由采集任务自己的选择器表达，故本页不再维护类型↔实现映射。
 * 页面主体是 CollectorTemplatesTab（采集模板 / 采集实现两个 Tab）。
 */
export function CollectorListPage() {
  return (
    <MainLayout>
      <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
        <Title level={4} style={{ margin: 0 }}>
          采集模板
        </Title>
        <Text type="secondary">
          模板回答「这类对象怎么采」：一个采集实现 + 一套抓取参数 + 一个标签模板；采哪些对象由采集任务自己的选择器决定。
        </Text>
      </Space>
      <CollectorTemplatesTab />
    </MainLayout>
  )
}

export default CollectorListPage
