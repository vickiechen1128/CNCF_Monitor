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
  Switch,
  Tooltip,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { mockTenants, mockNetworkDomains, type Tenant } from '../mocks/module-06'

const { Title } = Typography
const { Option } = Select

/**
 * {v1.3} 数据源改为「网域管理」页面的行政记录（mockNetworkDomains），
 * 不再使用硬编码列表；选项标注纳管状态，体现「授权 ≠ 已纳管」
 * {v1.5} 新增 multi_site_enabled 行政能力开关（决策 31）：租户级配置，
 * 不在顶栏提供运行时切换；该开关不控制 M09 页面入口（M09 入口由数据驱动）。
 * {v1.9} 租户与业务解耦（决策 12~17）：移除「CMDB 业务 ID / 业务路径」列与表单项；
 * 业务（biz_code / biz_name）为资源分组维度、由 Module_07 维护，不在本页展示。
 */
const networkDomainOptions = mockNetworkDomains.map((d) => ({
  value: d.id,
  label: d.registration_status === 'monitored' ? `${d.name}（${d.id}，已纳管）` : `${d.name}（${d.id}，未纳管）`,
}))

export function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>(mockTenants)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [form] = Form.useForm()
  // {v2.1} 列表筛选（PRD §11.1：租户管理支持名称/状态筛选）
  const [filterName, setFilterName] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const filteredTenants = useMemo(() => {
    const keyword = filterName.trim().toLowerCase()
    return tenants.filter((t) => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false
      if (keyword && !t.name.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [tenants, filterName, filterStatus])

  const showAdd = () => {
    setEditingTenant(null)
    form.resetFields()
    setIsModalOpen(true)
  }

  const showEdit = (record: Tenant) => {
    setEditingTenant(record)
    form.setFieldsValue({
      ...record,
      networkDomainIds: record.networkDomainIds,
    })
    setIsModalOpen(true)
  }

  const handleSave = (values: Omit<Tenant, 'id' | 'networkDomainNames'>) => {
    const selectedDomains = networkDomainOptions.filter((opt) =>
      values.networkDomainIds.includes(opt.value)
    )
    const payload: Omit<Tenant, 'id'> = {
      ...values,
      networkDomainNames: selectedDomains.map((d) => d.label),
    }
    if (editingTenant) {
      setTenants((prev) =>
        prev.map((item) => (item.id === editingTenant.id ? { ...item, ...payload } : item))
      )
      message.success('租户已更新')
    } else {
      const newTenant: Tenant = {
        ...payload,
        id: `t-${String(tenants.length + 1).padStart(3, '0')}`,
      }
      setTenants((prev) => [...prev, newTenant])
      message.success('租户已添加')
    }
    setIsModalOpen(false)
  }

  const columns = [
    {
      title: '租户名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '被授权网域',
      dataIndex: 'networkDomainIds',
      key: 'networkDomainCount',
      render: (ids: string[], record: Tenant) => (
        <Space size={[0, 4]} wrap>
          {ids.map((id) => {
            const monitored = record.monitoredNetworkDomainIds?.includes(id)
            return (
              <Tooltip key={id} title={monitored ? '已接入监控（由配置中心纳管）' : '已授权但未接入监控'}>
                <Tag color={monitored ? 'blue' : 'default'}>{id}</Tag>
              </Tooltip>
            )
          })}
        </Space>
      ),
    },
    {
      title: '多网域能力',
      dataIndex: 'multi_site_enabled',
      key: 'multi_site_enabled',
      render: (value: boolean) =>
        value ? <Tag color="green">已开启</Tag> : <Tag color="default">未开启</Tag>,
    },
    {
      title: '平台管理员',
      dataIndex: 'isPlatformAdmin',
      key: 'isPlatformAdmin',
      render: (value: boolean) => (value ? <Tag color="#0ECDEB">是</Tag> : <Tag>否</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) =>
        status === 'active' ? <Tag color="#00B578">启用</Tag> : <Tag color="#86909C">禁用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: Tenant) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => showEdit(record)}>
          编辑
        </Button>
      ),
    },
  ]

  return (
    <MainLayout
      reviewNotes={
        <>
          被授权网域数据源来自「网域管理」页面的行政记录，非硬编码列表；选项标注纳管状态，体现「授权 ≠ 已纳管」。
          网域为部署级资源、可跨租户共享（决策 18~20 落版）：租户通过授权 scope 使用网域（授权 ≠ 拥有），登记所有权归平台运营部（platform_admin），本页仅维护租户侧被授权列表。
          多网域能力（multi_site_enabled）为租户级行政能力开关：是否允许该租户被授权使用多个网域；该开关不控制配置中心各页面入口（入口由数据驱动）。
          租户与业务解耦（决策 12~17 落版）：业务（业务分组）为资源分组维度、由资源管理（Module_07）维护，租户页不维护业务映射。
        </>
      }
    >
      <div className="page-header">
        <Title level={4}>租户管理</Title>
      </div>
      <Card
        className="page-card"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={showAdd}>
            新增租户
          </Button>
        }
      >
        <FilterBar>
          <FilterItem label="名称">
            <Input.Search
              placeholder="搜索租户名称"
              allowClear
              onSearch={(value) => setFilterName(value)}
              style={{ width: 200 }}
            />
          </FilterItem>
          <FilterItem label="状态">
            <Select
              placeholder="全部状态"
              allowClear
              value={filterStatus === 'all' ? undefined : filterStatus}
              onChange={(v) => setFilterStatus((v ?? 'all') as 'all' | 'active' | 'inactive')}
              style={{ width: 160 }}
            >
              <Option value="active">启用</Option>
              <Option value="inactive">禁用</Option>
            </Select>
          </FilterItem>
        </FilterBar>
        <Table
          rowKey="id"
          dataSource={filteredTenants}
          columns={columns}
          pagination={{ pageSize: 8 }}
        />
      </Card>
      <Modal
        title={editingTenant ? '编辑租户' : '新增租户'}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            label="租户名称"
            name="name"
            rules={[{ required: true, message: '请输入租户名称' }]}
          >
            <Input placeholder="例如 电商研发部" />
          </Form.Item>
          <Form.Item
            label="被授权网域"
            name="networkDomainIds"
            initialValue={['nd-default']}
            rules={[{ required: true, message: '请选择被授权网域' }]}
            extra="仅分配网域使用权（授权 ≠ 拥有）：网域为部署级资源、可跨租户共享，登记所有权归平台运营部（platform_admin）；网域需先在「网域管理」页完成行政创建，监控纳管（安装 Edge Agent）由 Module_09 在租户授权范围内按需执行"
          >
            <Select mode="multiple" placeholder="请选择网域">
              {networkDomainOptions.map((opt) => (
                <Option key={opt.value} value={opt.value}>
                  {opt.label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="多网域能力"
            name="multi_site_enabled"
            valuePropName="checked"
            initialValue={false}
            extra="是否允许该租户被授权使用多个网域。关闭时平台侧仅授权该租户单个网域（通常为 default），不可被授权额外网域。"
          >
            <Switch checkedChildren="已开启" unCheckedChildren="未开启" />
          </Form.Item>
          <Form.Item
            label="状态"
            name="status"
            initialValue="active"
            rules={[{ required: true, message: '请选择状态' }]}
          >
            <Select placeholder="请选择">
              <Option value="active">启用</Option>
              <Option value="inactive">禁用</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="平台管理员租户"
            name="isPlatformAdmin"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
