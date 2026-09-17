import { Drawer, Descriptions, Tag, Typography } from 'antd'
import type { Tenant } from '../../../types/domain'

const { Text } = Typography

interface TenantDetailDrawerProps {
  open: boolean
  tenant?: Tenant | null
  onClose: () => void
}

/**
 * 租户详情 Drawer（Module_06 §9.1，查看结构化多字段用右侧 Drawer，宽 ≥720px）。
 * 仅查看；编辑走列表「编辑」按钮弹窗。
 */
export function TenantDetailDrawer({ open, tenant, onClose }: TenantDetailDrawerProps) {
  return (
    <Drawer
      title="租户详情"
      width={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      {tenant && (
        <Descriptions column={1} bordered size="middle">
          <Descriptions.Item label="租户 ID">{tenant.id || '—'}</Descriptions.Item>
          <Descriptions.Item label="租户名称">{tenant.name || '—'}</Descriptions.Item>
          <Descriptions.Item label="状态">
            {tenant.status === 'active' ? (
              <Tag color="#00B578">启用</Tag>
            ) : tenant.status === 'suspended' ? (
              <Tag color="#FA8C16">停用</Tag>
            ) : (
              <Tag color="#86909C">禁用</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="平台管理员租户">
            {tenant.is_platform_admin ? <Text type="success">是</Text> : '否'}
          </Descriptions.Item>
          <Descriptions.Item label="多站点采集">
            {tenant.multi_site_enabled ? <Text type="success">开启</Text> : '关闭'}
          </Descriptions.Item>
          <Descriptions.Item label="关联网域数">{tenant.network_domain_ids?.length ?? 0}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {tenant.created_at ? new Date(tenant.created_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {tenant.updated_at ? new Date(tenant.updated_at).toLocaleString('zh-CN', { hour12: false }) : '—'}
          </Descriptions.Item>
        </Descriptions>
      )}
    </Drawer>
  )
}