import { useEffect, useState } from 'react'
import config from 'antd/locale/zh_CN'
import { MainLayout } from '../../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { EllipsisText } from '../../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { Alert, Button, Card, ConfigProvider, Empty, Input, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { networkDomainApi, tenantApi, zoneTypeApi } from '../../../api/domain'
import type { NetworkDomain, Tenant, ZoneType } from '../../../types/domain'
import { useDomains } from './useDomains'
import { isVacantDomain } from './domainRules'
import { DomainFormModal } from './DomainForm'
import { DisableDomainModal } from './DisableDomainModal'
import { DeleteDomainModal } from './DeleteDomainModal'

const { Text } = Typography

/**
 * 网域管理列表页（Module_06 §11.1 页面状态矩阵）。
 * 参见 docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md
 * 覆盖：加载骨架屏 / 空态「暂无网域」+登记引导 / 接口错误 Alert+重新加载 / 权限不足空态 / 数据超量分页+筛选。
 * 操作：登记（DomainForm create）/ 编辑（DomainForm edit）/ 禁用（DisableDomainModal 二次确认+影响范围）/
 * 启用（直接恢复）/ 删除（仅空网域）/ 跨模块跳转 Module_09 网域纳管（占位）。
 */
export function DomainsPage() {
  const {
    data,
    loading,
    error,
    permissionDenied,
    filters,
    setFilters,
    page,
    pageSize,
    onPageSizeChange,
    reload,
  } = useDomains()

  const [zoneTypes, setZoneTypes] = useState<ZoneType[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  const [disableTarget, setDisableTarget] = useState<NetworkDomain | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NetworkDomain | null>(null)
  const [enablingId, setEnablingId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([zoneTypeApi.list(), tenantApi.list({ page: 1, page_size: 100 })])
      .then(([zt, tn]) => {
        setZoneTypes(zt.data ?? [])
        setTenants(tn.data?.list ?? [])
      })
      .catch(() => {
        // 下拉字典加载失败不阻塞列表展示
      })
  }, [])

  const enabledZoneTypes = zoneTypes.filter((z) => z.enabled)
  const tenantNameOf = (id: string) => tenants.find((t) => t.id === id)?.name ?? id
  const zoneTypeLabel = (code: string) => zoneTypes.find((z) => z.code === code)?.display_name ?? code

  const showCreate = () => {
    setFormMode('create')
    setEditingDomain(null)
    setFormOpen(true)
  }

  const showEdit = (record: NetworkDomain) => {
    setFormMode('edit')
    setEditingDomain(record)
    setFormOpen(true)
  }

  const handleEnable = async (record: NetworkDomain) => {
    setEnablingId(record.id)
    try {
      await networkDomainApi.updateStatus(record.id, 'enabled')
      message.success('网域已启用')
      reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '启用失败，请稍后重试')
    } finally {
      setEnablingId(null)
    }
  }

  /** 跨模块跳转占位：Module_09 网域纳管（Phase 5 统一导航前先用 href 占位） */
  const jumpToConfigCenter = (record: NetworkDomain) => {
    window.open(`#/domain-onboarding?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  // 列集合对齐原型（网域ID/名称/登记归属/授权租户/类型/网络区域类型/监控纳管/状态/创建时间/操作）。
  // D4：按原型补齐「监控纳管」「创建时间」，状态色对齐原型（启用 #00B578 / 禁用 #86909C）。
  const columns: ColumnsType<NetworkDomain> = [
    {
      title: '网域 ID',
      dataIndex: 'id',
      key: 'id',
      width: 180,
      ellipsis: { showTitle: true },
      fixed: 'left',
    },
    {
      title: '网域名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (name: string) => <EllipsisText>{name}</EllipsisText>,
    },
    {
      title: '登记归属',
      dataIndex: 'tenant_id',
      key: 'tenant_id',
      width: 160,
      render: (id: string) => (
        <Tooltip title="部署级登记方（登记 ≠ 独占，网域可授权多个租户共享）">{tenantNameOf(id)}</Tooltip>
      ),
    },
    {
      title: '授权租户',
      dataIndex: 'authorized_tenant_ids',
      key: 'authorized_tenant_ids',
      width: 200,
      render: (ids: string[] = []) => {
        const shown = ids.slice(0, 3)
        const rest = ids.length - shown.length
        return ids.length === 0 ? (
          <Text type="secondary">未授权</Text>
        ) : (
          <Space size={[0, 4]} wrap>
            {shown.map((id) => (
              <Tag key={id} color="geekblue">
                {tenantNameOf(id)}
              </Tag>
            ))}
            {rest > 0 && <Tooltip title={ids.map((i) => tenantNameOf(i)).join('、')}>+{rest}</Tooltip>}
          </Space>
        )
      },
    },
    {
      title: '类型',
      dataIndex: 'domain_type',
      key: 'domain_type',
      width: 110,
      render: (type: NetworkDomain['domain_type']) =>
        type === 'management' ? <Tag color="blue">管理域</Tag> : <Tag color="cyan">边缘域</Tag>,
    },
    {
      title: '网络区域类型',
      dataIndex: 'zone_type',
      key: 'zone_type',
      width: 150,
      render: (value: string) => (value ? <Tag>{zoneTypeLabel(value)}</Tag> : <Text type="secondary">未登记</Text>),
    },
    {
      title: '监控纳管',
      dataIndex: 'is_monitored',
      key: 'is_monitored',
      width: 110,
      render: (v: boolean) =>
        v ? (
          <Tag color="processing">已纳管</Tag>
        ) : (
          <Tag>未纳管</Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: NetworkDomain['status']) =>
        status === 'enabled' ? <Tag color="#00B578">启用</Tag> : <Tag color="#86909C">禁用</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 272,
      fixed: 'right',
      render: (_: unknown, record: NetworkDomain) => {
        const isManagement = record.domain_type === 'management'
        const vacant = isVacantDomain(record)
        return (
          <Space size={8}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(record)}>
              编辑
            </Button>
            {isManagement ? (
              <Tooltip title="管理域不可禁用">
                <Button type="link" size="small" disabled icon={<StopOutlined />}>
                  禁用
                </Button>
              </Tooltip>
            ) : record.status === 'enabled' ? (
              <Button
                type="link"
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={() => setDisableTarget(record)}
              >
                禁用
              </Button>
            ) : (
              <Button
                type="link"
                size="small"
                loading={enablingId === record.id}
                icon={<CheckCircleOutlined />}
                onClick={() => handleEnable(record)}
              >
                启用
              </Button>
            )}
            {isManagement ? null : vacant ? (
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => setDeleteTarget(record)}
              >
                删除
              </Button>
            ) : (
              <Tooltip title="存在资源引用 / 已纳管，请改用禁用">
                <Button type="link" size="small" danger disabled icon={<DeleteOutlined />}>
                  删除
                </Button>
              </Tooltip>
            )}
            {!record.is_monitored && (
              <Tooltip title="跳转 Module_09 网域纳管">
                <Button
                  type="link"
                  size="small"
                  icon={<CloudUploadOutlined />}
                  onClick={() => jumpToConfigCenter(record)}
                >
                  网域纳管
                </Button>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
  ]

  return (
    <MainLayout>
      {permissionDenied ? (
        <div style={{ marginTop: 80 }}>
          <Empty description="当前账号无此页面查看权限" />
        </div>
      ) : (
      <ConfigProvider locale={config}>
      <Card
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showCreate}>
            登记网域
          </Button>
        }
      >
        {error && (
          <Alert
            type="error"
            showIcon
            message="网域列表加载失败，请稍后重试"
            description={error}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
                重新加载
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        )}
        <FilterBar>
          <FilterItem label="网域名称" width={260}>
            <Input.Search
              placeholder="按网域名称搜索"
              allowClear
              style={{ width: 180 }}
              onSearch={(v) => setFilters({ ...filters, name: v || undefined })}
            />
          </FilterItem>
          <FilterItem label="网络区域" width={260}>
            <Select
              placeholder="全部"
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 180 }}
              value={filters.zone_type}
              onChange={(v) => setFilters({ ...filters, zone_type: v })}
            >
              {enabledZoneTypes.map((z) => (
                <Select.Option key={z.code} value={z.code} label={z.display_name}>
                  {z.display_name}
                </Select.Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="状态" width={200}>
            <Select
              placeholder="全部"
              allowClear
              style={{ width: 120 }}
              value={filters.status}
              onChange={(v) => setFilters({ ...filters, status: v })}
            >
              <Select.Option value="enabled">启用</Select.Option>
              <Select.Option value="disabled">禁用</Select.Option>
            </Select>
          </FilterItem>
          <FilterItem label="登记归属" width={260}>
            <Select
              placeholder="全部"
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 180 }}
              value={filters.tenant_id}
              onChange={(v) => setFilters({ ...filters, tenant_id: v })}
            >
              {tenants.map((t) => (
                <Select.Option key={t.id} value={t.id} label={t.name}>
                  {t.name}
                </Select.Option>
              ))}
            </Select>
          </FilterItem>
        </FilterBar>

        <Table<NetworkDomain>
          rowKey="id"
          dataSource={data.list}
          loading={loading}
          columns={columns}
          scroll={TABLE_SCROLL_X}
          locale={{
            emptyText: (
              <Empty description="暂无网域">
                <Button type="primary" icon={<PlusOutlined />} onClick={showCreate}>
                  登记网域
                </Button>
              </Empty>
            ),
          }}
          pagination={{
            ...TABLE_PAGINATION,
            current: page,
            pageSize,
            total: data.total,
            onChange: (p, pz) => onPageSizeChange(p, pz),
          }}
        />

        <DomainFormModal
          open={formOpen}
          mode={formMode}
          domain={editingDomain}
          onCancel={() => setFormOpen(false)}
          onSuccess={reload}
        />
        <DisableDomainModal
          open={disableTarget !== null}
          domain={disableTarget}
          onCancel={() => setDisableTarget(null)}
          onSuccess={reload}
        />
        <DeleteDomainModal
          open={deleteTarget !== null}
          domain={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onSuccess={reload}
        />
      </Card>
      </ConfigProvider>
      )}
    </MainLayout>
  )
}

export default DomainsPage
