/**
 * 「按云分布」独立区块（Module_05 PRD v1.11 / 决策 100）。
 *
 * 整宽，位于 L1 采集覆盖区之后、L2 应用覆盖明细表之前；每云一行：云名 / 主机数 / 已采数 / 覆盖率。
 * **本期仅主机**——`cloud` 经资源所属网域 `cloud_code` 派生（网域必填、零空洞），其余四类暂不参与；
 * **不含告警数字**（告警口径收口 L0 告警卡 + L4 告警状态卡）。
 * 云名可点击穿资源清单并按云预筛选（`/resources?cloud=<cloud_code>`）；空态保留区块位并提供导入引导；
 * 窄屏沿用表格横向滚动（不卡片化）。
 */
import { Link } from 'react-router-dom'
import { Table, Typography } from 'antd'
import type { TableColumnsType } from 'antd'
import { SurfaceCard } from './SurfaceCard'
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

export function CloudDistributionPanel({ clouds }: CloudDistributionPanelProps) {
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
    { title: '已采数', dataIndex: 'monitored_count', key: 'monitored_count', width: 90 },
    {
      title: '覆盖率',
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
