import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { businessDomainApi } from '../../api/resources'
import type { BusinessDomain } from '../../types/resource'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { DictLifecycleNotice } from './DictLifecycleNotice'
import { BusinessDomainDrawer } from './BusinessDomainDrawer'
import {
  DictionaryAuditDrawer,
  DictionaryMergeButton,
  DictionaryRevokeButton,
  DictionaryStatusBadge,
} from './DictionaryLifecycleActions'
import {
  DICTIONARY_ACTIVE_STATUSES,
  dictionaryNameSuffix,
  dictionaryStatusOf,
  isDictionaryTerminal,
} from './dictionaryLifecycle'

const { Text } = Typography

/** 业务分组字典维护页（Module_07 §3.1 / §5.18 / §11.1/§11.2，决策 48，M07-OPS-10）。 */
export function BusinessDomainPage() {
  const [list, setList] = useState<BusinessDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [drawer, setDrawer] = useState<{ open: boolean; record: BusinessDomain | null }>({ open: false, record: null })
  const [actingCode, setActingCode] = useState<string | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await businessDomainApi.list()
      setList(res.data?.list ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '业务分组加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
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
        d.code.toLowerCase().includes(kw) ||
        d.name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [list, keyword, scope])

  const toggleEnabled = useCallback(
    async (record: BusinessDomain, enabled: boolean) => {
      setActingCode(record.code)
      try {
        await businessDomainApi.update(record.code, { enabled })
        message.success(enabled ? `「${record.name}」已启用` : `「${record.name}」已停用`)
        await load()
      } catch (e) {
        message.error(e instanceof Error ? e.message : '状态切换失败，请稍后重试')
      } finally {
        setActingCode(null)
      }
    },
    [load],
  )

  const openCreate = () => setDrawer({ open: true, record: null })
  const openEdit = (record: BusinessDomain) => setDrawer({ open: true, record })

  const columns: ColumnsType<BusinessDomain> = [
    {
      title: '业务编码',
      dataIndex: 'code',
      key: 'code',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '业务名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      // 决策 22 / §11.1：停用业务以「业务名（已停用）」标识；终态另有后缀
      render: (v: string, r: BusinessDomain) => (
        <EllipsisText>{`${v}${dictionaryNameSuffix(dictionaryStatusOf(r))}`}</EllipsisText>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      width: 260,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : <Text type="secondary">-</Text>),
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
      width: 120,
      render: (_: unknown, r: BusinessDomain) => (
        <DictionaryStatusBadge status={dictionaryStatusOf(r)} mergedInto={r.merged_into} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 260,
      render: (_: unknown, r: BusinessDomain) => {
        const status = dictionaryStatusOf(r)
        const terminal = isDictionaryTerminal(status)
        const mergeOptions = list
          .filter((item) => dictionaryStatusOf(item) === 'enabled' && item.code !== r.code)
          .map((item) => ({ code: item.code, name: item.name }))
        return (
          <Space size={0} wrap>
            <Button type="link" size="small" disabled={terminal} onClick={() => openEdit(r)}>
              编辑
            </Button>
            {!terminal && (
              <Popconfirm
                title={r.enabled ? '停用业务分组' : '启用业务分组'}
                description={
                  r.enabled
                    ? `停用后「${r.name}」不再可供新资源选用，存量资源保留历史值。`
                    : `启用后「${r.name}」恢复为新资源可选用。`
                }
                okText={r.enabled ? '确认停用' : '确认启用'}
                okButtonProps={r.enabled ? { danger: true } : undefined}
                cancelText="取消"
                onConfirm={() => void toggleEnabled(r, !r.enabled)}
              >
                <Button type="link" size="small" loading={actingCode === r.code}>
                  {r.enabled ? '停用' : '启用'}
                </Button>
              </Popconfirm>
            )}
            <DictionaryRevokeButton
              name={r.name}
              status={status}
              referenceCount={r.reference_count ?? 0}
              onRevoke={() => businessDomainApi.revoke(r.code)}
              onDone={() => void load()}
            />
            <DictionaryMergeButton
              name={r.name}
              status={status}
              referenceCount={r.reference_count ?? 0}
              options={mergeOptions}
              onMerge={(targetCode) => businessDomainApi.merge(r.code, targetCode)}
              onDone={() => void load()}
            />
          </Space>
        )
      },
    },
  ]

  return (
    <MainLayout>
      <Card
        extra={
          <Space>
            <Button onClick={() => setAuditOpen(true)}>变更日志</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              登记业务
            </Button>
          </Space>
        }
      >
        {/* F7 / 决策 112：字典 ≠ 可删除对象（四字典页共用同一份文案） */}
        <DictLifecycleNotice />
        {error && (
          <Alert
            type="error"
            showIcon
            message="业务分组加载失败，请稍后重试"
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
              placeholder="搜索业务编码 / 名称 / 描述"
              style={{ width: 220 }}
              value={keyword}
              onSearch={(v) => setKeyword(v)}
              onChange={(e) => e.target.value === '' && setKeyword('')}
            />
          </FilterItem>
        </FilterBar>
        <Table<BusinessDomain>
          rowKey="code"
          dataSource={filtered}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无业务分组" /> }}
          pagination={{ ...TABLE_PAGINATION, showSizeChanger: true }}
        />
        <BusinessDomainDrawer
          open={drawer.open}
          record={drawer.record}
          onCancel={() => setDrawer({ open: false, record: null })}
          onSuccess={() => {
            setDrawer({ open: false, record: null })
            void load()
          }}
        />
        <DictionaryAuditDrawer
          dictionaryType="business"
          open={auditOpen}
          onClose={() => setAuditOpen(false)}
        />
      </Card>
    </MainLayout>
  )
}

export default BusinessDomainPage