import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Tag,
  Typography,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Select,
  Tooltip,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined, StopOutlined, CheckCircleOutlined, DeleteOutlined, CloudUploadOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { TABLE_SCROLL_X, TABLE_PAGINATION } from '../components/tablePresets'
import {
  mockNetworkDomains,
  mockTenants,
  ZONE_TYPE_OPTIONS,
  zoneTypeLabelOf,
  IP_CIDR_HINT,
  type NetworkDomain,
} from '../mocks/module-06'

const { Title, Text } = Typography
const { Option } = Select

/**
 * {v2.0} M06 为 NetworkDomain 的行政 Owner（PRD v2.0，决策 18~20）：
 * 网域为部署级资源、可跨租户共享：登记归属（tenant_id）固定 platform_admin（登记 ≠ 独占），
 * 通过授权租户（authorized_tenant_ids）授权多个租户共享使用（授权 ≠ 拥有）。
 * 表单只维护行政信息（名称 / 登记归属 / 授权租户 / 状态 / 网络区域类型），不维护监控参数；
 * 监控纳管（Token / Remote Write / Edge Agent）由 Module_09 执行。
 * {v1.4} 新增 zone_type（网络区域类型，部署级字典下拉）；网域定义为全平台唯一入口（下游只引用 network_domain_id）。
 * {v2.0} ID 按部署级前缀自动生成（nd-<名称>）；新建校验：被授权租户未开启多网域能力（multi_site_enabled=false）时仅可被授权单个网域。
 * {v2.2} PRD v2.2（决策 23）补漏：
 * - 登记归属（tenant_id）创建后不可变更（编辑表单不含该字段）；授权租户可选，缺省 = 登记归属租户（新建默认回填 platform_admin）；
 * - 禁用 = 冻结：禁用二次确认展示影响范围（资源引用数 / 已纳管 EdgeAgent 数），禁用后拒绝新登记与新纳管、存量不受影响；
 * - 空网域（未纳管、无资源引用）可删除（软删），非空网域/管理域不可删除。
 */
export function NetworkDomainsPage() {
  const [domains, setDomains] = useState<NetworkDomain[]>(mockNetworkDomains)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDomain, setEditingDomain] = useState<NetworkDomain | null>(null)
  const [form] = Form.useForm()
  // {v2.1} 列表筛选（PRD §11.1：网域管理支持按登记归属/zone_type/状态/授权租户筛选）
  const [filterOwner, setFilterOwner] = useState('all')
  const [filterZoneType, setFilterZoneType] = useState('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'disabled'>('all')
  const [filterAuthorizedTenant, setFilterAuthorizedTenant] = useState('all')

  const filteredDomains = useMemo(() => {
    return domains.filter((d) => {
      if (filterOwner !== 'all' && d.tenant_id !== filterOwner) return false
      if (filterZoneType !== 'all' && d.zone_type !== filterZoneType) return false
      if (filterStatus !== 'all' && d.status !== filterStatus) return false
      if (filterAuthorizedTenant !== 'all' && !(d.authorized_tenant_ids ?? []).includes(filterAuthorizedTenant))
        return false
      return true
    })
  }, [domains, filterOwner, filterZoneType, filterStatus, filterAuthorizedTenant])

  const tenantNameOf = (tenantId: string) =>
    mockTenants.find((t) => t.id === tenantId)?.name ?? tenantId

  const watchedName = Form.useWatch('name', form) as string | undefined

  /** PRD：network_domain_id 全局唯一，按 <deploy_code>-<domain_code> 自动生成（deploy_code 默认 mc）；default 管理域为历史预置、无前缀 */
  const suggestedId = (() => {
    if (editingDomain) return editingDomain.id
    const nameSlug = (watchedName ?? '').trim().toLowerCase().replace(/\s+/g, '-')
    if (!nameSlug) return ''
    return `mc-${nameSlug}`
  })()

  const showAdd = () => {
    setEditingDomain(null)
    form.resetFields()
    // {v2.0} 登记归属为部署级登记方（MVP 固定 platform_admin），新建时默认填充
    // {v2.2} 授权租户可选，缺省 = 登记归属租户（默认回填 platform_admin）
    form.setFieldsValue({ tenant_id: 't-platform', authorized_tenant_ids: ['t-platform'] })
    setIsModalOpen(true)
  }

  const showEdit = (record: NetworkDomain) => {
    setEditingDomain(record)
    // {v2.2} 登记归属创建后不可变更，编辑表单不含 tenant_id
    const { tenant_id, ...editableFields } = record
    void tenant_id
    form.setFieldsValue(editableFields)
    setIsModalOpen(true)
  }

  const handleSave = (values: Partial<NetworkDomain>) => {
    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    // {v2.2} 授权租户可选，缺省 = 登记归属租户（platform_admin）
    const selectedTenantIds = (values.authorized_tenant_ids ?? []).length
      ? (values.authorized_tenant_ids as string[])
      : ['t-platform']
    const violatedTenant = mockTenants.find((t) => {
      if (!selectedTenantIds.includes(t.id) || t.multi_site_enabled) return false
      const otherAuthorizedCount = domains.filter(
        (d) => d.id !== editingDomain?.id && (d.authorized_tenant_ids ?? []).includes(t.id)
      ).length
      return otherAuthorizedCount >= 1
    })
    if (violatedTenant) {
      message.error(
        `租户「${violatedTenant.name}」未开启多网域能力，仅可被授权单个网域（通常为 default）`
      )
      return
    }
    if (editingDomain) {
      setDomains((prev) =>
        prev.map((item) =>
          item.id === editingDomain.id
            ? {
                ...item,
                ...values,
                // 登记归属（id / 登记方）创建后不可变更；授权租户可编辑
                id: item.id,
                tenant_id: item.tenant_id,
                updated_at: now,
              }
            : item
        )
      )
      message.success('网域行政信息已更新')
    } else {
      const id = suggestedId || `mc-${Date.now()}`
      if (domains.some((d) => d.id === id)) {
        message.error(`网域 ID「${id}」已存在：network_domain_id 必须全局唯一`)
        return
      }
      const newDomain: NetworkDomain = {
        id,
        name: values.name || '',
        description: values.description || '',
        domain_type: 'edge',
        tenant_id: values.tenant_id || 't-platform',
        authorized_tenant_ids: selectedTenantIds,
        status: values.status || 'active',
        zone_type: values.zone_type || '',
        // {v2.5} 网段（CIDR）可留空；非空时用于 M07 资源导入/同步按 IP 推导网域归属（归属解析链第③级）
        ip_cidrs: values.ip_cidrs ?? [],
        // 新建网域仅完成行政登记，监控纳管由 Module_09 执行
        registration_status: 'created',
        created_at: now,
        updated_at: now,
      }
      setDomains((prev) => [...prev, newDomain])
      message.success(`网域已创建（行政登记）：请前往 Module_09 完成监控纳管`)
    }
    setIsModalOpen(false)
  }

  const toggleStatus = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('系统预置管理域禁止禁用')
      return
    }
    const nextStatus = record.status === 'active' ? 'disabled' : 'active'
    // {v2.2} 禁用 = 冻结：二次确认展示后端返回的影响范围（资源引用数 / 已纳管 EdgeAgent 数）
    const impactText =
      record.registration_status === 'monitored'
        ? `影响范围：M07 资源引用 N 条、已纳管 EdgeAgent 1 个。禁用后该网域不再接受新资源登记与新纳管，存量资源与采集配置不受影响、继续采集（停止采集由 Module_09 退纳管决定）。同时联动 Module_01（该网域禁止新建监控任务）与 Module_09（该网域不再生成新的变更单，存量下发与回滚不受影响）。`
        : `影响范围：M07 资源引用 0 条、已纳管 EdgeAgent 0 个（空网域，可直接删除）。禁用后该网域不可被租户使用、不再接受新资源登记与新纳管。禁用语义同时联动 Module_01 与 Module_09（禁止新建监控任务、不再生成新变更单）。`
    Modal.confirm({
      title: nextStatus === 'disabled' ? '禁用网域' : '启用网域',
      content:
        nextStatus === 'disabled'
          ? `确定禁用网域 "${record.name}" 吗？\n${impactText}`
          : `确定重新启用网域 "${record.name}" 吗？`,
      okText: nextStatus === 'disabled' ? '确认禁用' : '确认启用',
      okType: nextStatus === 'disabled' ? 'danger' : 'primary',
      cancelText: '取消',
      onOk: () => {
        setDomains((prev) =>
          prev.map((item) =>
            item.id === record.id
              ? { ...item, status: nextStatus, updated_at: new Date().toLocaleString('zh-CN', { hour12: false }) }
              : item
          )
        )
        message.success(nextStatus === 'disabled' ? '网域已禁用（冻结）' : '网域已启用')
      },
    })
  }

  /** {v2.2} 删除网域：仅空网域可删（无资源引用且未纳管），软删；管理域禁止删除 */
  const handleDelete = (record: NetworkDomain) => {
    if (record.domain_type === 'management') {
      message.error('系统预置管理域禁止删除')
      return
    }
    if (record.registration_status === 'monitored') {
      message.error(`网域 "${record.name}" 已纳管监控（存在资源引用/EdgeAgent），不可删除，请改用「禁用」`)
      return
    }
    Modal.confirm({
      title: '删除网域',
      content: `确定删除空网域 "${record.name}" 吗？删除为软删，仅对未纳管、无资源引用的空网域生效；管理域不可删除。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setDomains((prev) => prev.filter((item) => item.id !== record.id))
        message.success(`网域 "${record.name}" 已删除`)
      },
    })
  }

  const columns = [
    { title: '网域 ID', dataIndex: 'id', key: 'id' },
    { title: '网域名称', dataIndex: 'name', key: 'name' },
    {
      title: '登记归属',
      dataIndex: 'tenant_id',
      key: 'tenant_id',
      render: (tenantId: string) => (
        <Tooltip title={`部署级登记方（登记 ≠ 独占，网域可授权多个租户共享）`}>{tenantNameOf(tenantId)}</Tooltip>
      ),
    },
    {
      title: '授权租户',
      dataIndex: 'authorized_tenant_ids',
      key: 'authorized_tenant_ids',
      render: (ids: string[] = []) => (
        <Space size={[0, 4]} wrap>
          {ids.length === 0 ? (
            <Text type="secondary">未授权</Text>
          ) : (
            ids.map((id) => (
              <Tag key={id} color="geekblue">
                {tenantNameOf(id)}
              </Tag>
            ))
          )}
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'domain_type',
      key: 'domain_type',
      render: (type: NetworkDomain['domain_type']) =>
        type === 'management' ? <Tag color="blue">管理域</Tag> : <Tag color="cyan">边缘域</Tag>,
    },
    {
      title: '网络区域类型',
      dataIndex: 'zone_type',
      key: 'zone_type',
      render: (value: string) =>
        value ? <Tag>{zoneTypeLabelOf(value)}</Tag> : <Text type="secondary">未登记</Text>,
    },
    {
      title: '监控纳管',
      dataIndex: 'registration_status',
      key: 'registration_status',
      render: (status: NetworkDomain['registration_status']) =>
        status === 'monitored' ? (
          <Tag color="processing">已纳管</Tag>
        ) : (
          <Tag>未纳管</Tag>
        ),
    },
    {
      // {v2.5} 网段（CIDR）（决策 52）：仅供 M07 资源导入时按 IP 推导网域归属；可留空
      title: '网段（CIDR）',
      dataIndex: 'ip_cidrs',
      key: 'ip_cidrs',
      render: (cidrs: string[] = []) =>
        cidrs.length === 0 ? (
          <Text type="secondary">未配置</Text>
        ) : (
          <Space size={[0, 4]} wrap>
            {cidrs.map((cidr, idx) => (
              <Tag key={idx} color="purple">
                {cidr}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: NetworkDomain['status']) =>
        status === 'active' ? <Tag color="#00B578">启用</Tag> : <Tag color="#86909C">禁用</Tag>,
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at' },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      width: 200,
      render: (_: unknown, record: NetworkDomain) => (
        <Space size="small">
          {record.registration_status !== 'monitored' && (
            <Button
              type="link"
              size="small"
              icon={<CloudUploadOutlined />}
              onClick={() => jumpToConfigCenter(record)}
            >
              配置纳管（M09）
            </Button>
          )}
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(record)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger={record.status === 'active'}
            icon={record.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />}
            onClick={() => toggleStatus(record)}
          >
            {record.status === 'active' ? '禁用' : '启用'}
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ]

  /** {v2.3} R4：跳转 Module_09 网域纳管并预选当前网域（跨模块跳转，相对路径与部署结构对齐） */
  const jumpToConfigCenter = (record: NetworkDomain) => {
    window.open(`../../module-09/dist/index.html#/domain-onboarding?network_domain=${encodeURIComponent(record.id)}`, '_blank')
  }

  return (
    <MainLayout
      reviewNotes={
        <>
          M06 为网域的行政 Owner：本页只维护行政信息（名称 / 登记归属 / 授权租户 / 状态 / 网络区域类型），监控纳管（令牌、Remote Write、Edge Agent）由 Module_09 执行。
          网域为部署级资源、可跨租户共享（决策 18~20 落版）：登记归属固定平台运营部（platform_admin），登记 ≠ 独占，通过「授权租户」授权多个租户共享使用（授权 ≠ 拥有）；登记归属创建后不可变更（决策 23）。
          网域定义为全平台唯一入口，下游模块（导入 / 纳管 / CMDB 同步）只引用 network_domain_id；ID 按 `&lt;deploy_code&gt;-&lt;domain_code&gt;` 自动生成且全局唯一（deploy_code 默认 `mc`；default 管理域为历史预置、无前缀）。
          网络区域类型（zone_type）为部署级字典下拉（来自只读接口 GET /api/v2/platform/zone-types，政务云预置互联网区 / 政务外网区等，公有云预置区域），不开放自由文本，M09 纳管时只读引用。
          新建校验：被授权租户未开启多网域能力（multi_site_enabled=false）时仅可被授权单个网域；该开关不控制配置中心页面入口（入口由数据驱动）。
          禁用 = 冻结（决策 23）：禁用二次确认展示影响范围（资源引用数 / 已纳管 EdgeAgent 数），禁用后拒绝新登记与新纳管、存量资源与采集不受影响（停止采集由 Module_09 退纳管决定）；空网域可删除（软删），非空网域 / 管理域不可删除。
          网段（CIDR，决策 52）：网域可选择登记其覆盖的 IP 段（可留空），供 M07 资源导入 / CMDB 同步时按 IP 自动推导网域归属（归属解析链第③级，最长前缀优先、同前缀跨网域判歧义）；纯平台侧数据，不回写 CMDB、不要求 CMDB 加字段，也可由 M07「待分配队列」规则化动作按未分配 IP 汇总一键生成候选网段。
          网域心智原则（决策 52）：网域是部署拓扑属性，不是资产属性——「接入可见、消费隐藏」：接入侧（M07 导入 / 录入 / CMDB 同步）可见并可推导归属，消费侧（M02 查询 / M05 看板 / M08 告警路由 / M01 采集）默认不感知网域（权限注入 + 可选下钻），网域不做 CMDB 写回。
        </>
      }
    >
      <div className="page-header">
        <Title level={4}>网域管理</Title>
      </div>
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增网域（行政登记）
          </Button>
        }
      >
        <FilterBar>
          <FilterItem label="登记归属">
            <Select
              placeholder="全部登记归属"
              allowClear
              showSearch
              optionFilterProp="children"
              value={filterOwner === 'all' ? undefined : filterOwner}
              onChange={(v) => setFilterOwner(v ?? 'all')}
              style={{ width: 180 }}
            >
              {mockTenants.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="网络区域类型">
            <Select
              placeholder="全部网络区域类型"
              allowClear
              showSearch
              optionFilterProp="children"
              value={filterZoneType === 'all' ? undefined : filterZoneType}
              onChange={(v) => setFilterZoneType(v ?? 'all')}
              style={{ width: 200 }}
            >
              {ZONE_TYPE_OPTIONS.map((z) => (
                <Option key={z.value} value={z.value}>
                  {z.label}
                </Option>
              ))}
            </Select>
          </FilterItem>
          <FilterItem label="状态">
            <Select
              placeholder="全部状态"
              allowClear
              value={filterStatus === 'all' ? undefined : filterStatus}
              onChange={(v) => setFilterStatus((v ?? 'all') as 'all' | 'active' | 'disabled')}
              style={{ width: 140 }}
            >
              <Option value="active">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </FilterItem>
          <FilterItem label="授权租户">
            <Select
              placeholder="全部授权租户"
              allowClear
              showSearch
              optionFilterProp="children"
              value={filterAuthorizedTenant === 'all' ? undefined : filterAuthorizedTenant}
              onChange={(v) => setFilterAuthorizedTenant(v ?? 'all')}
              style={{ width: 180 }}
            >
              {mockTenants.map((t) => (
                <Option key={t.id} value={t.id}>
                  {t.name}
                </Option>
              ))}
            </Select>
          </FilterItem>
        </FilterBar>
        <Table
          rowKey="id"
          dataSource={filteredDomains}
          columns={columns}
          scroll={TABLE_SCROLL_X}
          pagination={TABLE_PAGINATION}
        />
      </Card>
      <Modal
        title={editingDomain ? '编辑网域（行政信息）' : '新增网域（行政登记）'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="网域名称"
            name="name"
            rules={[{ required: true, message: '请输入网域名称' }]}
          >
            <Input placeholder="例如：政务网 A 区" disabled={editingDomain?.id === 'default'} />
          </Form.Item>
          {editingDomain ? (
            <Form.Item
              label="登记归属"
              extra="创建后不可变更；如确需调整登记归属，请联系平台管理员走归属转移流程"
            >
              <Text>
                {tenantNameOf(editingDomain.tenant_id)}（{editingDomain.tenant_id}）
              </Text>
            </Form.Item>
          ) : (
            <Form.Item
              label="登记归属"
              name="tenant_id"
              rules={[{ required: true, message: '请选择登记归属' }]}
              extra="部署级登记方，MVP 固定平台运营部（platform_admin）；登记 ≠ 独占，网域可授权多个租户共享；创建后不可变更"
            >
              <Select placeholder="请选择登记归属" disabled showSearch optionFilterProp="children">
                {mockTenants
                  .filter((t) => t.status === 'active')
                  .map((t) => (
                    <Option key={t.id} value={t.id}>
                      {t.name}
                    </Option>
                  ))}
              </Select>
            </Form.Item>
          )}
          <Form.Item label="域类型" extra="登记固定为边缘域，只读；管理域为系统预置，由平台管理员维护">
            <Select
              value="edge"
              disabled
              options={[
                { value: 'edge', label: '边缘域' },
                { value: 'management', label: '管理域（系统预置）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="授权租户"
            name="authorized_tenant_ids"
            extra="可选，缺省 = 登记归属租户（platform_admin）；网域为部署级资源，可授权多个租户共享使用（授权 ≠ 拥有）；被授权租户未开启多网域能力时仅可被授权单个网域"
          >
            <Select
              mode="multiple"
              placeholder="请选择被授权使用该网域的租户"
              showSearch
              optionFilterProp="children"
            >
              {mockTenants
                .filter((t) => t.status === 'active')
                .map((t) => (
                  <Option key={t.id} value={t.id}>
                    {t.name}
                  </Option>
                ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="网络区域类型"
            name="zone_type"
            extra="选项来自部署级字典（如互联网区 / 政务外网区 / 专线区），不开放自由文本。"
          >
            <Select
              placeholder="请选择网络区域类型（可留空表示未登记）"
              allowClear
              showSearch
              optionFilterProp="children"
            >
              {ZONE_TYPE_OPTIONS.map((z) => (
                <Option key={z.value} value={z.value}>
                  {z.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="网段（CIDR）" extra={IP_CIDR_HINT}>
            <Input.TextArea
              rows={3}
              placeholder={"每行一个网段，如 10.20.0.0/16；可留空（留空时由平台在资源导入时按 IP 自动推导归属）"}
              value={(form.getFieldValue('ip_cidrs') as string[] | undefined)?.join('\n') ?? ''}
              onChange={(e) =>
                form.setFieldValue(
                  'ip_cidrs',
                  e.target.value.split('\n').filter((s) => s.trim())
                )
              }
            />
          </Form.Item>
          <Form.Item
            label="网域 ID（自动生成）"
            extra="按部署级前缀自动生成（&lt;deploy_code&gt;-&lt;domain_code&gt;，deploy_code 默认 mc；default 管理域无前缀），全局唯一、创建后不可修改"
          >
            <Input
              value={suggestedId || '自动生成（请先填写名称）'}
              disabled
              placeholder="mc-xxx"
            />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征（行政描述，非监控参数）" />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            initialValue="active"
            rules={[{ required: true, message: '请选择状态' }]}
            extra="禁用后网域不可被租户使用；系统预置管理域不可禁用"
          >
            <Select placeholder="请选择" disabled={editingDomain?.domain_type === 'management'}>
              <Option value="active">启用</Option>
              <Option value="disabled">禁用</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Text type="secondary" style={{ display: 'block' }}>
              本表单仅维护行政信息（ID / 名称 / 登记归属 / 授权租户 / 状态 / 网络区域类型）；监控参数由「配置中心-网域纳管」填写。
            </Text>
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
