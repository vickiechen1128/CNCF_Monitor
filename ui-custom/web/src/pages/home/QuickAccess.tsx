/**
 * 首页系统快速入口区（Module_05 §3.1 决策 72 / 决策 72-2 视觉 Token）。
 *
 * 入口集合以 MVP 已上线页面为限：资源管理 / 采集 Job / 配置预览下发 /
 * 指标查询 / 告警状态。图标卡片网格（图标 40px + 名称 + 一句描述），
 * 悬停 / 键盘聚焦边框高亮；站内跳转统一用 react-router Link（禁止整页刷新）。
 */
import { useState } from 'react'
import { Col, Row, Typography, theme } from 'antd'
import { Link } from 'react-router-dom'
import {
  DatabaseOutlined,
  CloudServerOutlined,
  FileTextOutlined,
  LineChartOutlined,
  BellOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import { SurfaceCard } from './SurfaceCard'

interface QuickLinkItem {
  label: string
  description: string
  href: string
  icon: ReactNode
}

const QUICK_LINKS: QuickLinkItem[] = [
  {
    label: '资源管理',
    description: '维护主机、中间件与应用资源清单',
    href: '/resources',
    icon: <DatabaseOutlined />,
  },
  {
    label: '采集 Job',
    description: '创建采集任务并选择采集实例',
    href: '/scrape-jobs',
    icon: <CloudServerOutlined />,
  },
  {
    label: '配置预览下发',
    description: '预览并下发 Prometheus 配置',
    href: '/config-preview',
    icon: <FileTextOutlined />,
  },
  {
    label: '指标查询',
    description: '用 PromQL 查询指标数据',
    href: '/query',
    icon: <LineChartOutlined />,
  },
  {
    label: '告警状态',
    description: '查看触发中与通知中的告警',
    href: '/alert-status',
    icon: <BellOutlined />,
  },
]

/** 单个入口卡片：悬停 / 键盘聚焦边框高亮 + 淡阴影（决策 72-2），图标统一品牌青 */
function QuickLinkTile({ item }: { item: QuickLinkItem }) {
  const { token } = theme.useToken()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // 键盘 Tab 聚焦与鼠标悬停给等价视觉反馈（无 CSS 文件，用同等 JS 状态实现）
  const highlighted = hovered || focused

  return (
    <Link
      to={item.href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ display: 'block', textDecoration: 'none', height: '100%' }}
    >
      <div
        style={{
          height: '100%',
          padding: 16,
          textAlign: 'center',
          background: token.colorBgContainer,
          border: `1px solid ${highlighted ? token.colorPrimary : token.colorBorder}`,
          borderRadius: 8,
          boxShadow: highlighted ? '0 4px 12px rgba(0, 0, 0, 0.08)' : 'none',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1, color: token.colorPrimary }}>{item.icon}</div>
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            {item.label}
          </Typography.Text>
        </div>
        <div style={{ marginTop: 4 }}>
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            {item.description}
          </Typography.Text>
        </div>
      </div>
    </Link>
  )
}

export function QuickAccess() {
  return (
    <SurfaceCard title="系统快速入口" data-testid="quick-access-card">
      <Row gutter={[16, 16]}>
        {QUICK_LINKS.map((item) => (
          <Col key={item.href} xs={24} sm={12} lg={8}>
            <QuickLinkTile item={item} />
          </Col>
        ))}
      </Row>
    </SurfaceCard>
  )
}

export default QuickAccess
