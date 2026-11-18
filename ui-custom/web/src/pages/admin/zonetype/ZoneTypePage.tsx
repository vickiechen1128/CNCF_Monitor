import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Segmented,
  Space,
  Table,
  Typography,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../../layouts/MainLayout'
import { EllipsisText } from '../../../components/EllipsisText'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { getStoredUser } from '../../../api/client'
import { zoneTypeApi } from '../../../api/domain'
import type { ZoneType } from '../../../types/domain'
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
 * 区域类型字典维护页（M07 v3 字典生命周期扩展）。
 *
 * 数据源 `GET /api/v3/platform/zone-types`（非分页信封 `{list,total}`）。
 * 区域类型由部署预置，编码不可变；admin 可对零引用条目「撤销」、对错建 / 重码条目
 * 「合并」，与其它四类字典共用同一套四态文案与交互组件（DictionaryLifecycleActions）。
 * 普通用户只读（网域表单仅消费启用项做下拉）。
 */
export function ZoneTypePage() {
  const [list, setList] = useState<ZoneType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [auditOpen, setAuditOpen] = useState(false)
  const isAdmin = getStoredUser()?.role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await zoneTypeApi.list()
      setList(res.data ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '区域类型加载失败，请稍后重试')
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
        d.code.toLowerCase().includes(kw) ||
        d.display_name.toLowerCase().includes(kw) ||
        (d.description ?? '').toLowerCase().includes(kw)
      )
    })
  }, [list, keyword, scope])

  const columns: ColumnsType<ZoneType> = [
    {
      title: '编码',
      dataIndex: 'code',
      key: 'code',
      fixed: 'left',
      width: 180,
      render: (v: string) => <EllipsisText>{v}</EllipsisText>,
    },
    {
      title: '名称',
      dataIndex: 'display_name',
      key: 'display_name',
      width: 200,
      render: (v: string, r: ZoneType) => (
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
      width: 130,
      render: (_: unknown, r: ZoneType) => (
        <DictionaryStatusBadge status={dictionaryStatusOf(r)} mergedInto={r.merged_into} />
      ),
    },
    ...(isAdmin
      ? [
          {
            title: '操作',
            key: 'action',
            width: 160,
            fixed: 'right' as const,
            render: (_: unknown, record: ZoneType) => {
              const status = dictionaryStatusOf(record)
              const terminal = isDictionaryTerminal(status)
              const mergeOptions = list
                .filter((item) => dictionaryStatusOf(item) === 'enabled' && item.code !== record.code)
                .map((item) => ({ code: item.code, name: item.display_name }))
              return (
                <Space size={0} wrap>
                  <DictionaryRevokeButton
                    name={record.display_name}
                    status={status}
                    referenceCount={record.reference_count ?? 0}
                    onRevoke={() => zoneTypeApi.revoke(record.code)}
                    onDone={() => void load()}
                  />
                  <DictionaryMergeButton
                    name={record.display_name}
                    status={status}
                    referenceCount={record.reference_count ?? 0}
                    options={mergeOptions}
                    onMerge={(targetCode) => zoneTypeApi.merge(record.code, targetCode)}
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
      <Card
        title="区域类型"
        extra={
          <Space>
            <Button onClick={() => setAuditOpen(true)}>变更日志</Button>
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
              ? '区域类型由管理员维护：支持零引用撤销与错建合并；编码创建后不可修改、条目不可删除。'
              : '区域类型为只读视图：新增、撤销与合并由平台管理员操作。'
          }
          description="区域类型是网域「网络分区」字段的取值权威；网域表单仅消费启用条目，不开放自由文本。撤销 / 合并会在变更日志中留痕。"
          style={{ marginBottom: 16 }}
        />
        {error && (
          <Alert
            type="error"
            showIcon
            message="区域类型加载失败，请稍后重试"
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
              placeholder="搜索编码 / 名称 / 描述"
              style={{ width: 220 }}
              value={keyword}
              onSearch={(v) => setKeyword(v)}
              onChange={(e) => e.target.value === '' && setKeyword('')}
            />
          </FilterItem>
        </FilterBar>
        <Table<ZoneType>
          rowKey="code"
          dataSource={filtered}
          loading={loading}
          columns={columns}
          size="small"
          scroll={TABLE_SCROLL_X}
          locale={{ emptyText: <Empty description="暂无区域类型条目" /> }}
          pagination={{ ...TABLE_PAGINATION }}
        />
        <DictionaryAuditDrawer
          dictionaryType="zone"
          open={auditOpen}
          onClose={() => setAuditOpen(false)}
        />
      </Card>
    </MainLayout>
  )
}

export default ZoneTypePage
