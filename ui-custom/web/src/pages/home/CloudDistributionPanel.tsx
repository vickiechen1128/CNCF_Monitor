/**
 * 「不同云的主机数量」区块（Module_05 决策 100；2026-10-17 第五轮走查：
 * 每云一张 KPI 卡 → **紧凑统计行**，解决 2 朵云时左卡被撑高、与右侧矩阵不协调）。
 *
 * 首页第一屏首要视角：各云的主机台数。云名可点击穿资源清单并按云预筛选
 * （`/resources?cloud=<cloud_code>`）；「未指定云」行（`cloud_code` 空串）
 * 不可下钻——空参与无参不可区分，故不做链接（同矩阵「未指定平台」行口径）。
 *
 * **紧凑统计行（第五轮走查，产品负责人裁定）**：旧版每云一张 KPI 卡
 * （云名 + 32px 大数字 + 卡片内边距），仅 2 朵云时左卡高度远超右矩阵、
 * 两卡并置美观度失调。改为**一行一云**的统计行：云名（可下钻）+ 编码在左、
 * 台数在右（18px/700，仍是行内视觉主体），行间细分隔线；N 朵云纵向堆叠，
 * 高度随云数线性增长，不再被卡片内边距放大。宽窄屏同版式（竖排行本就
 * 不依赖横向空间），故本组件不再消费 useNarrowLayout。
 *
 * 本轮仍不呈现「已下发数 / 纳管率 / 进度条」：整体纳管率归口到 04 区块
 * （首页唯一呈现点，反馈 11 §11.2 ⑤），按云维度的纳管率本轮不做——避免
 * 首屏出现两个同源纳管率数字。数据源仍为 `dashboard.by_cloud`，口径仍为
 * **仅主机**（网域必填、零空洞，经 `cloud_code` 派生云分组）。
 *
 * 标题口径（2026-10-17 走查）：「按云主机数」是平台内部说法、不专业；改为
 * 「不同云的主机数量」——主语（不同云）+ 度量（主机数量）都是领导语言。
 * **第六轮走查**：口径速记（「按云分组 · 仅统计主机」）从卡头 extra 移入**标题
 * Tooltip**——02 收窄为 260px 固定窄列后，卡头「标题 + extra 速记」同行放不下，
 * 标题「不同云的主机数量」被 antd 卡头 ellipsis 截断（产品负责人走查发现）；
 * 速记进 Tooltip 后标题完整可见，与 03 矩阵 / 04 卡头的 Tooltip 模式一致。
 *
 * **整组隐藏（2026-10-17 第六轮走查，产品负责人裁定）**：本面板与 03 矩阵同属
 * 「资源管理」展示面，与运行态信息（告警 / 采集健康 / 拨测）关注面不同，由
 * **页头行的一个开关**整组隐藏（home-resource-row 整体不渲染，面板标题也不
 * 露出——隐藏要藏得干净，恢复入口在页头行）；偏好跨会话持久
 * （homePanelVisibility.ts）。本面板自身不再带卡头开关。
 *
 * 与 03 矩阵的合并行见 HomePage：02+03 一个 flex-wrap 行（第六轮走查：02 收窄为
 * 固定窄列），窄容器自动折行堆叠。
 */
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { InfoCircleOutlined } from '@ant-design/icons'
import { Tooltip, Typography, theme } from 'antd'
import { SurfaceCard } from './SurfaceCard'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'
import type { CloudSummary } from '../../api/dashboard'

const { Text } = Typography

/** 「未指定云」聚合行的 `cloud_code` 约定值：空串（主机所属网域无云编码） */
const UNSET_CLOUD_CODE = ''

/** 标题 Tooltip：口径速记（原卡头 extra，第六轮走查移入——窄列下标题不被截断） */
const CLOUD_SCOPE_TIP = '按主机所属网域派生的云分组统计，仅统计主机台数。'

interface CloudDistributionPanelProps {
  /** 按云聚合行（缺失 / 空数组时渲染空态引导） */
  clouds: CloudSummary[]
}

/**
 * 单云紧凑统计行：云名（可下钻）+ 编码在左，主机台数在右。
 *
 * 「未指定云」行（`cloud_code === ''`）**不做链接**（design-proposal §2.1 第 6 条）：
 * 空参与不带参在资源页不可区分，链过去等于「点了却没按云筛」的假动作；
 * 云名降级为普通文本 + Tooltip 说明原因。
 */
function CloudRow({ row, isLast }: { row: CloudSummary; isLast: boolean }) {
  const { token } = theme.useToken()
  const drillable = row.cloud_code !== UNSET_CLOUD_CODE
  const nameStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 6,
    minWidth: 0,
    overflow: 'hidden',
  }
  const nameBlock = (
    <>
      <span
        data-testid={`cloud-name-${row.cloud_code}`}
        style={{
          fontSize: HOME_FONT.label,
          fontWeight: HOME_WEIGHT.label,
          color: token.colorText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {row.cloud_name}
      </span>
      <span style={{ fontSize: HOME_FONT.body, color: token.colorTextTertiary, flexShrink: 0 }}>{row.cloud_code}</span>
    </>
  )
  return (
    <div
      data-testid={`cloud-card-${row.cloud_code}`}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 0',
        borderBottom: isLast ? 'none' : `1px solid ${token.colorSplit}`,
        minWidth: 0,
      }}
    >
      {drillable ? (
        <Link
          to={`/resources?cloud=${encodeURIComponent(row.cloud_code)}`}
          style={{ ...nameStyle, color: 'inherit' }}
        >
          {nameBlock}
        </Link>
      ) : (
        <Tooltip title="未指定云无对应云编码，不支持按云筛选">
          <span data-testid={`cloud-name-static-${row.cloud_code || 'unset'}`} style={nameStyle}>
            {nameBlock}
          </span>
        </Tooltip>
      )}
      <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        <span
          data-testid={`cloud-host-count-${row.cloud_code}`}
          style={{
            fontSize: HOME_FONT.title,
            fontWeight: HOME_WEIGHT.number,
            lineHeight: 1.2,
            color: token.colorText,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {row.resource_count}
        </span>
        <span style={{ fontSize: HOME_FONT.body, color: token.colorTextSecondary }}>台主机</span>
      </span>
    </div>
  )
}

export function CloudDistributionPanel({ clouds }: CloudDistributionPanelProps) {
  const { token } = theme.useToken()
  return (
    <SurfaceCard
      data-testid="cloud-distribution-panel"
      title={
        <Tooltip title={CLOUD_SCOPE_TIP}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            不同云的主机数量
            <InfoCircleOutlined
              aria-label="不同云的主机数量口径说明"
              style={{ fontSize: 12, color: token.colorTextTertiary, cursor: 'help' }}
            />
          </span>
        </Tooltip>
      }
      style={{ height: '100%' }}
    >
      {clouds.length === 0 ? (
        <div style={{ padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: HOME_FONT.title, fontWeight: HOME_WEIGHT.title }}>暂无主机数据</div>
          <Text type="secondary" style={{ marginTop: 6, fontSize: HOME_FONT.body, textAlign: 'center' }}>
            导入主机资源后，这里会按云分组展示各云的主机台数（云归属由主机所在网域决定）。
          </Text>
          <Link to="/resources" style={{ marginTop: 12 }}>
            去导入主机资源 →
          </Link>
        </div>
      ) : (
        <div data-testid="cloud-cards" style={{ display: 'flex', flexDirection: 'column' }}>
          {clouds.map((row, index) => (
            <CloudRow key={row.cloud_code} row={row} isLast={index === clouds.length - 1} />
          ))}
          {/* 合计行（第六轮走查新增，产品负责人要求）：各云主机台数之和 —— 与 03 矩阵
              「合计」列同口径（仅主机），让「不同云」这列数字有一个闭合的总数。 */}
          <div
            data-testid="cloud-total-row"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              padding: '8px 0 2px',
              marginTop: 4,
              borderTop: `1px solid ${token.colorSplit}`,
            }}
          >
            <Text type="secondary" style={{ fontSize: HOME_FONT.body }}>
              合计
            </Text>
            <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
              <span
                data-testid="cloud-total-count"
                style={{
                  fontSize: HOME_FONT.title,
                  fontWeight: HOME_WEIGHT.emphasis,
                  lineHeight: 1.2,
                  color: token.colorText,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {clouds.reduce((sum, row) => sum + row.resource_count, 0)}
              </span>
              <span style={{ fontSize: HOME_FONT.body, color: token.colorTextSecondary }}>台主机</span>
            </span>
          </div>
        </div>
      )}
    </SurfaceCard>
  )
}

export default CloudDistributionPanel
