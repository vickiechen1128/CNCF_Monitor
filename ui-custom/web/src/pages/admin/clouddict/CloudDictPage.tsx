import { useCallback, useEffect, useMemo, useState } from 'react'
import config from 'antd/locale/zh_CN'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../../layouts/MainLayout'
import { EllipsisText } from '../../../components/EllipsisText'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { getStoredUser } from '../../../api/client'
import { cloudDictApi } from '../../../api/resources'
import type { CloudDict } from '../../../types/resource'
import { DictLifecycleNotice } from '../../resources/DictLifecycleNotice'
import {
  DictionaryAuditDrawer,
  DictionaryMergeButton,
  DictionaryRevokeButton,
  DictionaryStatusBadge,
} from '../../resources/DictionaryLifecycleActions'
import {
  DICTIONARY_ACTIVE_STATUSES,
  dictionaryNameSuffix,
  dictionaryStatusOf,
  isDictionaryTerminal,
} from '../../resources/dictionaryLifecycle'

const { Text } = Typography

/**
 * 云类型中文映射（对齐 platform/models/cloud_dict.go：PUB/GM/IND/PRI）。
 * 仅用于本页展示列，不导出（避免 react-refresh/only-export-components 告警）。
 */
const CLOUD_TYPE_LABELS: Record<string, string> = {
  PUB: '公有云',
  GM: '政务云',
  IND: '行业云',
  PRI: '私有云',
}

/**
 * 云载体中文映射（对齐 platform/models/cloud_dict.go：TX/CU/CM）。
 * seed 佐证：GM-CU = 「政务云（联通）」→ CU=联通；TX=腾讯、CM=移动。
 */
const CARRIER_LABELS: Record<string, string> = {
  TX: '腾讯',
  CU: '联通',
  CM: '移动',
}

const CLOUD_TYPE_OPTIONS = Object.entries(CLOUD_TYPE_LABELS).map(([value, label]) => ({ value, label }))
const CARRIER_OPTIONS = Object.entries(CARRIER_LABELS).map(([value, label]) => ({ value, label }))

/** 新增云表单值（cloud_code 由云类型 + 云载体派生，不单独输入） */
interface CloudDictFormValues {
  cloud_type: string
  carrier: string
  cloud_name: string
  description?: string
}

/**
 * 云字典维护页（Module_06 FR-09 / D37；Module_07 §5.20 / 决策 98 / 102）。
 * - 数据源 `GET /api/v3/platform/cloud-dict`（M07 只读视图，非分页信封 `{list,total}`）。
 * - **admin 维护**：新增 / 停用 + 零引用撤销、错建合并；无编辑 / 删除入口，编码不可变。
 * - 复合码 `{云类型}-{云载体}` 由表单派生，服务端校验格式、类型/载体一致性与唯一性。
 * - 普通用户只读（后端写路由另挂 RequireAdmin 兜底）。
 * - `cloud_type` / `carrier` 仅作展示列：不参与筛选、不作为查询 / 标签维度。
 */
export function CloudDictPage() {
  const [list, setList] = useState<CloudDict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [disablingCode, setDisablingCode] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [form] = Form.useForm<CloudDictFormValues>()
  const isAdmin = getStoredUser()?.role === 'admin'
  const cloudType = Form.useWatch('cloud_type', form)
  const carrier = Form.useWatch('carrier', form)
  const codePreview = cloudType && carrier ? `${cloudType}-${carrier}` : ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await cloudDictApi.list()
      setList(res.data?.list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '云字典加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本仓库既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return list.filter((d) => {
      const status = dictionaryStatusOf(d)
      if (scope === 'active' && !DICTIONARY_ACTIVE_STATUSES.includes(status)) return false
      if (!kw) return true
      return (
        d.cloud_code.toLowerCase().includes(kw) ||
        d.cloud_name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [list, keyword, scope])

  const openCreate = () => {
    form.resetFields()
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    let values: CloudDictFormValues
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      await cloudDictApi.create({
        cloud_code: `${values.cloud_type}-${values.carrier}`,
        cloud_name: values.cloud_name,
        cloud_type: values.cloud_type,
        carrier: values.carrier,
        description: values.description,
      })
      message.success('云字典条目已新增')
      setCreateOpen(false)
      form.resetFields()
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '新增失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDisable = async (code: string) => {
    setDisablingCode(code)
    try {
      await cloudDictApi.disable(code)
      message.success(`云编码 ${code} 已停用`)
      await load()
    } catch (e) {
      message.error(e instanceof Error ? e.message : '停用失败，请稍后重试')
    } finally {
      setDisablingCode(null)
    }
  }

  const columns: ColumnsType<CloudDict> = [
    {
      title: '云编码',
      dataIndex: 'cloud_code',
      key: 'cloud_code',
      fixed: 'left',
      width: 140,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '云名称',
      dataIndex: 'cloud_name',
      key: 'cloud_name',
      width: 200,
      render: (v: string, r: CloudDict) => (
        <EllipsisText>{`${v}${dictionaryNameSuffix(dictionaryStatusOf(r))}`}</EllipsisText>
      ),
    },
    {
      title: '云类型',
      dataIndex: 'cloud_type',
      key: 'cloud_type',
      width: 130,
      // 仅展示映射值，未收录编码回退原码（不隐藏未知值）
      render: (v: string) => <Tag>{CLOUD_TYPE_LABELS[v] ?? v}</Tag>,
    },
    {
      title: '云载体',
      dataIndex: 'carrier',
      key: 'carrier',
      width: 120,
      render: (v: string) => CARRIER_LABELS[v] ?? v,
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      width: 220,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : '—'),
    },
    {
      title: '引用数',
      dataIndex: 'reference_count',
      key: 'reference_count',
      width: 90,
      render: (v?: number) => <Text type={v ? undefined : 'secondary'}>{v ?? 0}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (_: unknown, r: CloudDict) => (
        <DictionaryStatusBadge status={dictionaryStatusOf(r)} mergedInto={r.merged_into} />
      ),
    },
    // 普通用户不渲染操作列：只读展示（D37 admin 维护）。
    ...(isAdmin
      ? [
          {
            title: '操作',
            key: 'action',
            width: 220,
            fixed: 'right' as const,
            render: (_: unknown, record: CloudDict) => {
              const status = dictionaryStatusOf(record)
              const terminal = isDictionaryTerminal(status)
              const mergeOptions = list
                .filter((item) => dictionaryStatusOf(item) === 'enabled' && item.cloud_code !== record.cloud_code)
                .map((item) => ({ code: item.cloud_code, name: item.cloud_name }))
              return (
                <Space size={0} wrap>
                  {!terminal && record.enabled && (
                    <Popconfirm
                      title="停用后该云编码不可再用于新建网域"
                      description="已引用该编码的历史数据不受影响；停用不删除。"
                      okText="确认停用"
                      cancelText="取消"
                      onConfirm={() => void handleDisable(record.cloud_code)}
                    >
                      <Button type="link" danger loading={disablingCode === record.cloud_code}>
                        停用
                      </Button>
                    </Popconfirm>
                  )}
                  <DictionaryRevokeButton
                    name={record.cloud_name}
                    status={status}
                    referenceCount={record.reference_count ?? 0}
                    onRevoke={() => cloudDictApi.revoke(record.cloud_code)}
                    onDone={() => void load()}
                  />
                  <DictionaryMergeButton
                    name={record.cloud_name}
                    status={status}
                    referenceCount={record.reference_count ?? 0}
                    options={mergeOptions}
                    onMerge={(targetCode) => cloudDictApi.merge(record.cloud_code, targetCode)}
                    onDone={() => void load()}
                  />
                  {terminal && <Text type="secondary">—</Text>}
                </Space>
              )
            },
          },
        ]
      : []),
  ]

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title="云字典"
          extra={
            <Space>
              <Button onClick={() => setAuditOpen(true)}>变更日志</Button>
              {isAdmin && (
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  新增云
                </Button>
              )}
              <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
                刷新
              </Button>
            </Space>
          }
        >
          <DictLifecycleNotice />
          <Alert
            type="info"
            showIcon
            message={
              isAdmin
                ? '云字典由管理员维护：支持新增、停用、零引用撤销与错建合并；编码创建后不可修改、条目不可删除。'
                : '云字典为只读视图：新增、停用、撤销与合并由平台管理员操作。'
            }
            description={
              isAdmin
                ? '云归属（cloud）是资源标签的唯一取值来源；云类型 / 云载体仅为条目描述属性，不作为筛选或标签维度。停用前需确认无网域引用该云编码。'
                : '云归属（cloud）是资源标签的唯一取值来源；云类型 / 云载体仅为条目描述属性，不作为筛选或标签维度。'
            }
            style={{ marginBottom: 16 }}
          />
          {error && (
            <Alert
              type="error"
              showIcon
              message="云字典加载失败，请稍后重试"
              description={error}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
                  重新加载
                </Button>
              }
              style={{ marginBottom: 16 }}
            />
          )}
          <FilterBar>
            <FilterItem label="范围" width={200}>
              <Segmented
                value={scope}
                onChange={(v) => setScope(v as 'active' | 'all')}
                options={[
                  { value: 'active', label: '有效条目' },
                  { value: 'all', label: '全部' },
                ]}
              />
            </FilterItem>
            <FilterItem label="关键字" width={260}>
              <Input.Search
                allowClear
                placeholder="搜索云编码 / 名称 / 描述"
                style={{ width: 220 }}
                value={keyword}
                onSearch={(v) => setKeyword(v)}
                onChange={(e) => e.target.value === '' && setKeyword('')}
              />
            </FilterItem>
          </FilterBar>
          <Table<CloudDict>
            rowKey="cloud_code"
            dataSource={filtered}
            loading={loading}
            columns={columns}
            size="small"
            scroll={TABLE_SCROLL_X}
            locale={{ emptyText: <Empty description="暂无云字典条目" /> }}
            pagination={{ ...TABLE_PAGINATION }}
          />
          <DictionaryAuditDrawer
            dictionaryType="cloud"
            open={auditOpen}
            onClose={() => setAuditOpen(false)}
          />
        </Card>

        {isAdmin && (
          <Modal
            title="新增云"
            open={createOpen}
            forceRender
            maskClosable={false}
            okText="新增"
            cancelText="取消"
            confirmLoading={submitting}
            onOk={() => void handleCreate()}
            onCancel={() => {
              setCreateOpen(false)
              form.resetFields()
            }}
          >
            <Form form={form} layout="vertical" preserve={false}>
              <Form.Item
                name="cloud_type"
                label="云类型"
                rules={[{ required: true, message: '请选择云类型' }]}
              >
                <Select options={CLOUD_TYPE_OPTIONS} placeholder="请选择云类型" />
              </Form.Item>
              <Form.Item name="carrier" label="云载体" rules={[{ required: true, message: '请选择云载体' }]}>
                <Select options={CARRIER_OPTIONS} placeholder="请选择云载体" />
              </Form.Item>
              <Form.Item label="云编码">
                <Input value={codePreview} placeholder="选择云类型与云载体后自动生成" disabled />
              </Form.Item>
              <Form.Item
                name="cloud_name"
                label="云名称"
                rules={[
                  { required: true, message: '请输入云名称' },
                  { max: 100, message: '云名称最多 100 个字符' },
                ]}
              >
                <Input placeholder="如：腾讯云、政务云（联通）" />
              </Form.Item>
              <Form.Item
                name="description"
                label="描述"
                rules={[{ max: 500, message: '描述最多 500 个字符' }]}
              >
                <Input.TextArea rows={3} placeholder="可选" />
              </Form.Item>
            </Form>
          </Modal>
        )}
      </ConfigProvider>
    </MainLayout>
  )
}

export default CloudDictPage
