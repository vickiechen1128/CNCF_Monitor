/**
 * 「按云分布」独立区块（Module_05 PRD v1.11 / 决策 100）。
 *
 * 整宽，位于 L1 采集覆盖区之后、L2 应用覆盖明细表之前；每云一行：云名 / 主机数 / 已下发数 / 纳管率。
 * **本期仅主机**——`cloud` 经资源所属网域 `cloud_code` 派生（网域必填、零空洞），其余四类暂不参与；
 * **不含告警数字**（告警口径收口 L0 告警卡 + L4 告警状态卡）。
 * 云名可点击穿资源清单并按云预筛选（`/resources?cloud=<cloud_code>`）；空态保留区块位并提供导入引导。
 *
 * 文案口径（反馈 10 §10.4 正名）：`monitored_count` 为**下发口径**，列名一律称「已下发」/「纳管率」。
 *
 * 移动适配（手机竖屏 ≤767px，见 homeResponsive.ts）：4 列表格在窄屏横向滚动观感差，改为
 * **每云一张竖排卡片**（云名首行，末行「主机 · 已下发 + 纳管率条」）；宽屏表格分支逐字不变。
 */
import { Link } from 'react-router-dom'
import { Table, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { SurfaceCard } from './SurfaceCard'
import { useNarrowLayout } from './homeResponsive'
import type { CloudSummary } from '../../api/dashboard'

const { Text } = Typography

interface CloudDistributionPanelProps {
  /** 按云聚合行（缺失 / 空数组时渲染空态引导） */
  clouds: CloudSummary[]
}

/** 覆盖率条（对齐原型 CoverageBar：<70% 橙色提示，其余蓝色） */
function CoverageBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <span
      style={{
        display: 'inline-block',
        width: 52,
        height: 6,
        borderRadius: 3,
        background: '#F2F3F5',
        verticalAlign: 'middle',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          display: 'block',
          width: `${clamped}%`,
          height: '100%',
          borderRadius: 3,
          background: clamped < 70 ? '#C25E0A' : '#1677FF',
        }}
      />
    </span>
  )
}

/**
 * 窄屏（≤767px）单云卡片：把 4 列竖排为「云名首行 / 末行 主机·已下发 + 纳管率条」，
 * 避免窄屏表格横向滚动。宽屏不渲染本组件。
 */
function CloudCard({ row }: { row: CloudSummary }) {
  return (
    <div
      data-testid={`cloud-card-${row.cloud_code}`}
      style={{
        border: '1px solid #E5E6EB',
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      {/* 首行：云名（可点击穿按云预筛选的资源清单） */}
      <Link
        to={`/resources?cloud=${encodeURIComponent(row.cloud_code)}`}
        style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}
      >
        {row.cloud_name}
        <span style={{ marginLeft: 6, fontSize: 12, color: '#86909C' }}>{row.cloud_code}</span>
      </Link>

      {/* 末行：主机 · 已下发 + 纳管率条 */}
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 12,
        }}
      >
        <span style={{ color: '#4E5969' }}>
          主机 {row.resource_count} · 已下发 {row.monitored_count}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CoverageBar value={row.coverage_rate} />
          <span style={{ color: row.coverage_rate < 70 ? '#C25E0A' : '#4E5969' }}>
            {row.coverage_rate}%
          </span>
        </span>
      </div>
    </div>
  )
}

export function CloudDistributionPanel({ clouds }: CloudDistributionPanelProps) {
  // 窄屏（≤767px）版式开关：宽屏表格，手机竖屏改为竖排卡片列表（见头注释移动适配）
  const narrow = useNarrowLayout()
  const columns: TableColumnsType<CloudSummary> = [
    {
      title: '云名',
      dataIndex: 'cloud_name',
      key: 'cloud_name',
      render: (name: string, row) => (
        <Link to={`/resources?cloud=${encodeURIComponent(row.cloud_code)}`}>
          {name}
          <span style={{ marginLeft: 6, fontSize: 12, color: '#86909C' }}>{row.cloud_code}</span>
        </Link>
      ),
    },
    { title: '主机数', dataIndex: 'resource_count', key: 'resource_count', width: 90 },
    { title: '已下发数', dataIndex: 'monitored_count', key: 'monitored_count', width: 90 },
    {
      title: '纳管率',
      key: 'coverage',
      width: 160,
      render: (_, row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CoverageBar value={row.coverage_rate} />
          <span style={{ fontSize: 12, color: row.coverage_rate < 70 ? '#C25E0A' : '#4E5969' }}>
            {row.coverage_rate}%
          </span>
        </span>
      ),
    },
  ]

  return (
    <SurfaceCard
      data-testid="cloud-distribution-panel"
      title="按云分布"
      extra={
        <Text type="secondary" style={{ fontSize: 12 }}>
          按主机所属网域派生的云分组 · 本期仅主机
        </Text>
      }
    >
      {clouds.length === 0 ? (
        <div style={{ padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>暂无主机数据</div>
          <Text type="secondary" style={{ marginTop: 6, fontSize: 12, textAlign: 'center' }}>
            主机导入后，将按所属网域派生的云自动分组展示主机分布与采集覆盖率。
          </Text>
          <Link to="/resources" style={{ marginTop: 12 }}>
            去导入主机资源 →
          </Link>
        </div>
      ) : narrow ? (
        <div data-testid="cloud-cards" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {clouds.map((row) => (
            <CloudCard key={row.cloud_code} row={row} />
          ))}
        </div>
      ) : (
        <Table<CloudSummary>
          rowKey="cloud_code"
          size="small"
          dataSource={clouds}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={columns}
        />
      )}
    </SurfaceCard>
  )
}

export default CloudDistributionPanel
