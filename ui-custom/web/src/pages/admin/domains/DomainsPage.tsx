import { useEffect, useState, type ReactNode } from 'react'
import config from 'antd/locale/zh_CN'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '../../../layouts/MainLayout'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { Alert, Badge, Button, Card, Collapse, ConfigProvider, Descriptions, Drawer, Dropdown, Empty, Input, Select, Space, Steps, Table, Tag, Tooltip, Typography, message } from 'antd'
import type { MenuProps } from 'antd'
import {
  BookOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ProfileOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { networkDomainApi, tenantApi, zoneTypeApi } from '../../../api/domain'
import type { NetworkDomain, Tenant, ZoneType } from '../../../types/domain'
import { useDomains } from './useDomains'
import { DomainDrawer } from './DomainForm'
import { DisableDomainModal } from './DisableDomainModal'
import { DeleteDomainModal } from './DeleteDomainModal'

const { Text } = Typography

/** 接入进度四态语义标签（对齐原型 M06 ACCESS_STEP_LABELS） */
const ACCESS_STEP_LABELS: Record<number, string> = {
  1: '已登记',
  2: '已纳管',
  3: '采集节点已上线',
  4: '已出数据',
}

/** 接入进度四态语义色（点阵 + 文字；颜色不作唯一语义承载） */
const ACCESS_STEP_COLORS: Record<number, string> = {
  1: '#86909C',
  2: '#1481FD',
  3: '#FA8C16',
  4: '#00B578',
}

/** 接入进度四态的下一步说明（接入进度列的悬浮明细） */
const ACCESS_STEP_HINT: Record<number, string> = {
  1: '下一步：去纳管获取接入凭据',
  2: '下一步：在该网域一台常开机器上安装采集节点',
  3: '下一步：为该网域资源配置采集任务',
  4: '已接入：该网域已有生效的采集目标',
}

/** 接入进度与行内主操作一一对应——主操作是唯一主按钮 */
const ACTION_LABEL: Record<number, string> = {
  1: '去纳管',
  2: '安装采集节点',
  3: '去配置采集',
  4: '查看采集任务',
}

const PRIMARY_ICON: Record<number, ReactNode> = {
  1: <CloudUploadOutlined />,
  2: <BookOutlined />,
  3: <PlayCircleOutlined />,
  4: <PlayCircleOutlined />,
}

/**
 * 接入进度四态：优先采信后端聚合派生的 access_step，缺省按既有字段回退派生
 * （MVP 后端未派生时：未纳管=1 / 已纳管未上线=2 / 节点上线回落 3，M09 补第 4 态数据源）。
 */
function accessStepOf(record: NetworkDomain): number {
  if (record.access_step != null && [1, 2, 3, 4].includes(record.access_step)) return record.access_step
  if (!record.is_monitored) return 1
  if (!record.has_online_agents) return 2
  return 3
}

/** 中心直连域接入进度：无采集节点环节，简化为两态（已预置 → 已纳管直连采集） */
const DIRECT_STEP_LABELS: Record<number, string> = {
  1: '已预置（中心直连）',
  2: '已纳管·直连采集',
}
const DIRECT_STEP_HINT = '中心直连域由平台中心直接采集，无需安装采集节点。'

/** 接入进度列：四态点阵 + 当前态文字，悬浮展开四步明细（对齐原型 v2.14） */
function AccessProgress({ record }: { record: NetworkDomain }) {
  // 场景分支（决策确认）：中心直连域不出现「装采集节点」环节，走直连采集简化两态；
  // 采集节点域（登记新增）保留「登记→纳管→装采集节点→出数据」四态。
  const isDirect = record.domain_type === 'management'
  const step = isDirect ? (record.is_monitored ? 2 : 1) : accessStepOf(record)
  const labels = isDirect ? DIRECT_STEP_LABELS : ACCESS_STEP_LABELS
  const hint = isDirect ? DIRECT_STEP_HINT : ACCESS_STEP_HINT[step]
  const color = isDirect ? ACCESS_STEP_COLORS[2] : ACCESS_STEP_COLORS[step]
  const stateLabels = isDirect ? [1, 2] : [1, 2, 3, 4]
  return (
    <Tooltip
      title={
        <div style={{ lineHeight: 1.9 }}>
          {stateLabels.map((i) => (
            <div key={i}>
              {i === step ? '▶ ' : '　'}
              {labels[i]}
              {i === step && <span style={{ opacity: 0.75 }}>（当前）</span>}
            </div>
          ))}
          <div style={{ marginTop: 4, opacity: 0.75 }}>{hint}</div>
        </div>
      }
    >
      <Space size={8} style={{ cursor: 'default' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {stateLabels.map((i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {i > 1 && (
                <span
                  style={{ width: 12, height: 1, background: i <= step ? color : '#E5E6EB', display: 'inline-block' }}
                />
              )}
              <span
                style={{
                  width: i === step ? 9 : 7,
                  height: i === step ? 9 : 7,
                  borderRadius: '50%',
                  background: i <= step ? color : '#FFFFFF',
                  border: `1px solid ${i <= step ? color : '#C9CDD4'}`,
                  boxShadow: i === step ? `0 0 0 3px ${color}22` : 'none',
                  display: 'inline-block',
                }}
              />
            </span>
          ))}
        </span>
        <Text style={{ fontSize: 12.5, color, fontWeight: 600, whiteSpace: 'nowrap' }}>{labels[step]}</Text>
      </Space>
    </Tooltip>
  )
}

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
  const [detailTarget, setDetailTarget] = useState<NetworkDomain | null>(null)
  const [disableTarget, setDisableTarget] = useState<NetworkDomain | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<NetworkDomain | null>(null)
  const navigate = useNavigate()

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
    try {
      await networkDomainApi.updateStatus(record.id, 'enabled')
      message.success('网域已启用')
      reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '启用失败，请稍后重试')
    }
  }

  /** 跨模块跳转：Module_09 网域纳管（同页签内导航，NetworkDomainsPage 以 useSearchParams 读 network_domain 定位） */
  const jumpToConfigCenter = (record: NetworkDomain) => {
    navigate(`/domain-onboarding?network_domain=${encodeURIComponent(record.id)}`)
  }

  // 列集合对齐原型 v2.14 的 8 列治理：网域名称/接入方式/接入进度/状态/登记归属/授权租户/网络分区/操作。
  // 网域 ID / 授权租户全量 / 网段 / 描述 / 创建更新时间下沉详情抽屉（§9 列数治理）。
  const columns: ColumnsType<NetworkDomain> = [
    {
      title: '网域名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      fixed: 'left',
      render: (name: string, record: NetworkDomain) => (
        <Tooltip title={`网域 ID：${record.id}`}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontWeight: 600, height: 'auto' }}
            onClick={() => setDetailTarget(record)}
          >
            {name}
          </Button>
        </Tooltip>
      ),
    },
    {
      // 决策 74/79：domain_type 用户侧呈现为「接入方式」（自动推导、不可选择）
      title: '接入方式',
      dataIndex: 'domain_type',
      key: 'domain_type',
      width: 130,
      render: (type: NetworkDomain['domain_type']) =>
        type === 'management' ? (
          <Tooltip title="中心自己所在的域（default），机器可被平台中心直接访问、由中心直接采集">
            <Tag color="blue">中心直连域</Tag>
          </Tooltip>
        ) : (
          <Tooltip title="中心无法直连的域：由安装在该网域内的采集节点回传数据">
            <Tag color="cyan">采集节点域</Tag>
          </Tooltip>
        ),
    },
    {
      // T2：接入进度四态点阵 + 当前态文字（复用 access_step；M06 先行，M09 补第 4 态数据源）
      title: '接入进度',
      key: 'access_progress',
      width: 190,
      render: (_: unknown, record: NetworkDomain) => <AccessProgress record={record} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: NetworkDomain['status']) =>
        status === 'enabled' ? (
          <Badge status="success" text="启用" />
        ) : (
          <Tooltip title="已冻结：不再接受新登记与新纳管，存量资源与采集配置继续运行">
            <span style={{ cursor: 'default' }}>
              <Badge status="default" text="禁用" />
            </span>
          </Tooltip>
        ),
    },
    {
      title: '登记归属',
      dataIndex: 'tenant_id',
      key: 'tenant_id',
      width: 130,
      render: (id: string) => (
        <Tooltip title="部署级登记方（登记 ≠ 独占，网域可授权多个租户共享）">{tenantNameOf(id)}</Tooltip>
      ),
    },
    {
      // 行内最多 2 个租户标签 + 「+N」折叠（§9 行内 Tag 上限），全量明细进详情抽屉
      title: '授权租户',
      dataIndex: 'authorized_tenant_ids',
      key: 'authorized_tenant_ids',
      width: 180,
      render: (ids: string[] = []) => {
        if (ids.length === 0) return <Text type="secondary">未授权</Text>
        const shown = ids.slice(0, 2)
        return (
          <Space size={4} wrap={false}>
            {shown.map((id) => (
              <Tag key={id} color="geekblue" style={{ marginInlineEnd: 0 }}>
                {tenantNameOf(id)}
              </Tag>
            ))}
            {ids.length > 2 && (
              <Tooltip title={ids.map((id) => tenantNameOf(id)).join('、')}>
                <Tag style={{ marginInlineEnd: 0 }}>+{ids.length - 2}</Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
    {
      // 决策 76：zone_type UI 展示名「网络分区（可选）」——纯分类标签，不影响行为
      title: '网络分区（可选）',
      dataIndex: 'zone_type',
      key: 'zone_type',
      width: 150,
      render: (value: string) => (value ? <Tag>{zoneTypeLabel(value)}</Tag> : <Text type="secondary">未设置</Text>),
    },
    {
      // T4：操作列三重层次——主操作（接入下一步，唯一主按钮）+ 编辑 + 更多（禁用/启用、删除）
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 240,
      render: (_: unknown, record: NetworkDomain) => {
        const isManagement = record.domain_type === 'management'
        const step = accessStepOf(record)
        const runPrimary = () => {
          if (step === 4) navigate(`/scrape-jobs?network_domain=${encodeURIComponent(record.id)}`)
          else if (step === 3) navigate(`/scrape-jobs?network_domain=${encodeURIComponent(record.id)}`)
          else jumpToConfigCenter(record)
        }
        const moreItems: MenuProps['items'] = [
          { key: 'detail', label: '查看详情', icon: <ProfileOutlined /> },
          { type: 'divider' },
          isManagement
            ? {
                key: 'system-hint',
                disabled: true,
                label: <Text type="secondary" style={{ fontSize: 12 }}>系统预置网域：不可禁用 / 删除</Text>,
              }
            : {
                key: 'toggle',
                label: record.status === 'enabled' ? '禁用网域' : '启用网域',
                icon: record.status === 'enabled' ? <StopOutlined /> : <CheckCircleOutlined />,
                danger: record.status === 'enabled',
              },
        ]
        if (!isManagement) {
          moreItems.push({ key: 'delete', label: '删除网域', icon: <DeleteOutlined />, danger: true })
        }
        return (
          <Space size={0}>
            {!isManagement && (
              <Button
                type="link"
                size="small"
                icon={PRIMARY_ICON[step]}
                style={{ paddingLeft: 0, fontWeight: step === 4 ? 400 : 600 }}
                onClick={runPrimary}
              >
                {ACTION_LABEL[step]}
              </Button>
            )}
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => showEdit(record)}>
              编辑
            </Button>
            <Dropdown
              menu={{
                items: moreItems,
                onClick: ({ key }) => {
                  if (key === 'detail') setDetailTarget(record)
                  else if (key === 'toggle') {
                    if (record.status === 'enabled') setDisableTarget(record)
                    else void handleEnable(record)
                  } else if (key === 'delete') setDeleteTarget(record)
                },
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<MoreOutlined />}
                style={{ color: '#4E5969' }}
                aria-label="更多操作"
              />
            </Dropdown>
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
        {/* T5：什么是网域？FieldGuide（可折叠） */}
        <Collapse
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'what-is-domain',
              label: (
                <Space>
                  <QuestionCircleOutlined style={{ color: '#1890ff' }} />
                  <Text strong>什么是网域？</Text>
                </Space>
              ),
              children: (
                <div style={{ padding: '8px 0' }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    登记网域前，先自检一件事：<Text strong>这个区域的机器，平台中心能直接访问吗？</Text>
                  </Text>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                    <div style={{ flex: 1, padding: 12, background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' }}>
                      <Text strong style={{ color: '#52c41a' }}>能（网络互通，如 VPC 对等 / CEN 互联）</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>归入中心直连域（default），由中心直接采集，无需建新网域</Text>
                    </div>
                    <div style={{ flex: 1, padding: 12, background: '#fff7e6', borderRadius: 6, border: '1px solid #ffd591' }}>
                      <Text strong style={{ color: '#fa8c16' }}>不能（隔离网段 / K8s overlay）</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>需登记「采集节点域」，由配置中心-网域纳管下发凭据与节点</Text>
                    </div>
                  </div>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    接入流程（按能否直连分支）：
                  </Text>
                  <Steps
                    size="small"
                    current={-1}
                    items={[
                      { title: '登记网域', description: '行政信息登记（名称/类型/授权租户）' },
                      { title: '纳管取凭据', description: '由配置中心-网域纳管下发接入信息' },
                      { title: '安装采集节点', description: '在该网域一台常开机器上安装节点' },
                      { title: '配置采集出数据', description: '为网域下资源配置采集任务' },
                    ]}
                  />
                  <div style={{ marginTop: 12, padding: '8px 12px', background: '#F0FBFD', borderRadius: 6, border: '1px solid #BFF4FB' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      中心直连域（default）无需安装采集节点：由平台中心直接采集目标资源，接入上只需登记后即纳入中心直连采集。
                    </Text>
                  </div>
                </div>
              ),
            },
          ]}
        />

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

        <DomainDrawer
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
        {detailTarget && (
          <Drawer
            width={720}
            open
            onClose={() => setDetailTarget(null)}
            title={
              <div>
                <Space size={8}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{detailTarget.name}</span>
                  {detailTarget.domain_type === 'management' ? (
                    <Tag color="blue">中心直连域</Tag>
                  ) : (
                    <Tag color="cyan">采集节点域</Tag>
                  )}
                  {detailTarget.status === 'enabled' ? (
                    <Badge status="success" text="启用" />
                  ) : (
                    <Badge status="default" text="禁用" />
                  )}
                </Space>
                <div>
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                    行政信息由本模块维护；接入凭据、采集节点与运行状态由「配置中心 - 网域纳管」维护
                  </Text>
                </div>
              </div>
            }
            footer={
              <div style={{ textAlign: 'right' }}>
                <Space>
                  <Button onClick={() => setDetailTarget(null)}>关闭</Button>
                  <Button
                    type="primary"
                    icon={<EditOutlined />}
                    onClick={() => {
                      const target = detailTarget
                      setDetailTarget(null)
                      showEdit(target)
                    }}
                  >
                    编辑行政信息
                  </Button>
                </Space>
              </div>
            }
          >
            <Descriptions
              column={2}
              size="small"
              bordered
              styles={{ label: { width: 120, color: '#86909C' }, content: { color: '#1D2129' } }}
              items={[
                { key: 'id', label: '网域 ID', children: <Text code>{detailTarget.id}</Text> },
                {
                  key: 'type',
                  label: '接入方式',
                  children: detailTarget.domain_type === 'management' ? '中心直连域' : '采集节点域',
                },
                { key: 'owner', label: '登记归属', children: tenantNameOf(detailTarget.tenant_id) },
                {
                  key: 'auth',
                  label: '授权租户',
                  children:
                    (detailTarget.authorized_tenant_ids ?? []).length === 0
                      ? '未授权'
                      : detailTarget.authorized_tenant_ids!.map((id) => tenantNameOf(id)).join('、'),
                },
                {
                  key: 'zone',
                  label: '网络分区',
                  children: detailTarget.zone_type ? zoneTypeLabel(detailTarget.zone_type) : '未设置',
                },
                {
                  key: 'status',
                  label: '状态',
                  children: detailTarget.status === 'enabled' ? '启用' : '禁用（冻结）',
                },
                { key: 'progress', label: '接入进度', children: <AccessProgress record={detailTarget} /> },
                {
                  key: 'cidr',
                  label: '网段（CIDR）',
                  children: (detailTarget.ip_cidrs ?? []).length ? detailTarget.ip_cidrs!.join('、') : '未配置',
                },
                { key: 'created', label: '创建时间', children: detailTarget.created_at },
                { key: 'updated', label: '更新时间', children: detailTarget.updated_at },
                { key: 'desc', label: '描述', span: 2, children: detailTarget.description || '—' },
              ]}
            />
            <div style={{ marginTop: 16 }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {detailTarget.domain_type === 'management'
                  ? DIRECT_STEP_HINT
                  : `${ACCESS_STEP_HINT[accessStepOf(detailTarget)]}；接入凭据与采集节点安装由「配置中心 - 网域纳管」完成。`}
              </Text>
            </div>
          </Drawer>
        )}
      </Card>
      </ConfigProvider>
      )}
    </MainLayout>
  )
}

export default DomainsPage
