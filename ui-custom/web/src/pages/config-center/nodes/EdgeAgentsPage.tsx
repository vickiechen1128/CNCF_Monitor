import { Button, Card, ConfigProvider, Empty, Space, Tooltip, Typography } from 'antd'
import config from 'antd/locale/zh_CN'
import { useNavigate } from 'react-router-dom'
import { CloudServerOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../../../layouts/MainLayout'

const { Text } = Typography

/**
 * 采集节点状态页（Module_09 §11.1 采集节点状态页状态矩阵 — MVP 空态占位）。
 *
 * MVP 边界：契约 §6 明确「前端采集节点状态页 MVP 仅空态占位，不消费 /edge-agents 接口」，
 * 且 `default`/local 通道不存在 EdgeAgent 实例（C6/C7/C9 裁剪）。整页仅展示空态引导：
 * 「尚未接入采集节点」→ 引导先到「网域纳管」（/domain-onboarding）完成纳管并按安装指引接入
 * Edge Sync Agent。列表 / 组件分区抽屉 / 五维筛选为 v0.2 范围外，本页不实现。
 * 子菜单常驻由 T09-F6 导航承载，不因无数据隐藏入口。
 */
export function EdgeAgentsPage() {
  const navigate = useNavigate()

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title={
            <Space size={4}>
              采集节点状态
              <Tooltip title="展示所有部署了 Edge Agent 的边缘节点；每个采集节点展示主机名/IP、网域、整体状态、组件运行状态与配置同步等信息。MVP 暂无边缘节点，仅显示接线引导。">
                <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
              </Tooltip>
            </Space>
          }
        >
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Space direction="vertical" size={8} style={{ maxWidth: 620, textAlign: 'left' }}>
                <Text strong style={{ fontSize: 15 }}>
                  尚未接入采集节点
                </Text>
                <Text type="secondary">
                  系统中暂无 EdgeAgent 实例。请先在「网域纳管」页完成 agent_pull 通道网域的监控纳管，并按页面顶部
                  「安装指引」在边缘节点接入 Edge Sync Agent（心跳上报后自动出现在本页）。
                  <br />
                  local 通道网域（如 default）由中心直接采集，不部署 Edge Agent。
                </Text>
              </Space>
            }
          >
            <Button type="primary" icon={<CloudServerOutlined />} onClick={() => navigate('/domain-onboarding')}>
              去网域纳管
            </Button>
          </Empty>
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}