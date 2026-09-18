/**
 * 首页系统快速入口区（Module_05 §3.1 决策 72 / 决策 72-2 / 决策 73 §5 一行五列压扁）。
 *
 * 入口集合以 MVP 已上线页面为限：资源管理 / 采集 Job / 配置预览下发 /
 * 指标查询 / 告警状态。由三列大卡改为**一行五列压扁**（28px 圆角图标容器 + 名称 13px/600），
 * 一句描述移入悬浮提示，降低版面高度（~150px → ~110px）；悬停 / 键盘聚焦边框高亮；
 * 站内跳转统一用 react-router Link（禁止整页刷新）。
 */
import { useState } from 'react'
import { Tooltip, theme } from 'antd'
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
  /** 一句描述：不再显式展示，移入悬浮提示（决策 73 §5） */
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

/**
 * 单个入口（压扁态）：28px 圆角图标容器（品牌青 10% 浅底 + 16px 图标）+ 名称 13px/600，
 * 描述通过外层 Tooltip 悬浮展示；悬停 / 键盘聚焦边框高亮 + 淡阴影（决策 72-2 交互反馈）。
 */
function QuickLinkTile({ item }: { item: QuickLinkItem }) {
  const { token } = theme.useToken()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // 键盘 Tab 聚焦与鼠标悬停给等价视觉反馈（无 CSS 文件，用同等 JS 状态实现）
  const highlighted = hovered || focused

  return (
    <Link
      to={item.href}
      data-testid={`quick-link-${item.href.replace(/^\//, '')}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: 'block',
        textDecoration: 'none',
        // 等价 `flex: 1 1 0`（写长手属性，避免简写在部分渲染环境下被丢弃）
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 100,
      }}
    >
      <Tooltip title={item.description}>
        <div
          style={{
            padding: '10px 12px',
            background: token.colorBgContainer,
            border: `1px solid ${highlighted ? token.colorPrimary : token.colorBorder}`,
            borderRadius: 8,
            boxShadow: highlighted ? '0 4px 12px rgba(0, 0, 0, 0.08)' : 'none',
            transition: 'border-color 0.2s, box-shadow 0.2s',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: token.colorPrimaryBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, color: token.colorPrimary }}>
                {item.icon}
              </span>
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: token.colorText,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </span>
          </div>
        </div>
      </Tooltip>
    </Link>
  )
}

export function QuickAccess() {
  return (
    <SurfaceCard title="系统快速入口" data-testid="quick-access-card">
      {/* 一行五列：flex-wrap + 每项 flex:1 1 0，窄屏自动折行（决策 73 §5） */}
      <div data-testid="quick-access-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {QUICK_LINKS.map((item) => (
          <QuickLinkTile key={item.href} item={item} />
        ))}
      </div>
    </SurfaceCard>
  )
}

export default QuickAccess
