import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Empty, Input, Space, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { scrapeJobApi } from '../../api/scrapeJobs'
import type { InstanceCandidate, MonitorType } from '../../types/strategy'
import { TABLE_SCROLL_X } from '../../components/tablePresets'

const { Text } = Typography

interface InstanceSelectorProps {
  /** 已选定的监控对象类型（standard Job，§5.4）；为空时展示引导 */
  monitorType?: MonitorType
  /** 已选定的网域（已纳管非冻结）；为空时展示引导 */
  networkDomainId?: string
  /** 当前已选实例 resource_id 集合（受控） */
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

/**
 * 实例选择器（Module_01 §3.1/§5.4/§8②/§11.1，F5）。
 * 同 monitor_type 推导资源类别 + 同网域收敛候选（GET /scrape-jobs/instance-candidates）；
 * 全选 / 反选 + 关键字；status=offline 置灰不可选（决策29）；持久化 selected_instance_ids。
 */
export function InstanceSelector({ monitorType, networkDomainId, selectedIds, onChange }: InstanceSelectorProps) {
  const [rows, setRows] = useState<InstanceCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const params = useMemo(
    () => ({
      monitorType,
      networkDomainId,
      keyword: keyword || undefined,
      page,
      page_size: pageSize,
    }),
    [monitorType, networkDomainId, keyword, page, pageSize],
  )

  const load = useCallback(async () => {
    if (!monitorType || !networkDomainId) {
      setRows([])
      setTotal(0)
      return
    }
    setLoading(true)
    try {
      const res = await scrapeJobApi.instanceCandidates({
        monitor_type: params.monitorType!,
        network_domain_id: params.networkDomainId!,
        keyword: params.keyword,
        page: params.page,
        page_size: params.page_size,
      })
      setRows(res.data?.list ?? [])
      setTotal(res.data?.total ?? 0)
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [params, monitorType, networkDomainId])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const selectableRows = rows.filter((r) => !r.disabled)
  const allSelectableSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.includes(r.resource_id))
  const noneSelected = (() => {
    const onThisPage = new Set(rows.map((r) => r.resource_id))
    return selectedIds.length === 0 || ![...selectedIds].some((id) => onThisPage.has(id))
  })()

  const toggleRow = useCallback(
    (id: string, selected: boolean) => {
      const next = selected ? [...new Set([...selectedIds, id])] : selectedIds.filter((x) => x !== id)
      onChange(next)
    },
    [selectedIds, onChange],
  )

  const toggleAll = useCallback(() => {
    const next = [...new Set([...selectedIds, ...selectableRows.map((r) => r.resource_id)])]
    onChange(next)
  }, [selectedIds, selectableRows, onChange])

  const toggleNone = useCallback(() => {
    const onThisPage = new Set(rows.map((r) => r.resource_id))
    onChange(selectedIds.filter((id) => !onThisPage.has(id)))
  }, [selectedIds, rows, onChange])

  const columns: ColumnsType<InstanceCandidate> = [
    {
      title: '选择',
      key: 'sel',
      width: 60,
      render: (_: unknown, r: InstanceCandidate) => (
        <Checkbox
          disabled={r.disabled}
          checked={selectedIds.includes(r.resource_id)}
          onChange={(e) => toggleRow(r.resource_id, e.target.checked)}
        />
      ),
    },
    { title: '实例名', dataIndex: 'instance_name', key: 'instance_name', render: (v: string) => <Text>{v}</Text> },
    { title: 'IP', dataIndex: 'instance_ip', key: 'instance_ip', render: (v: string) => <Text type="secondary">{v}</Text> },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string, r: InstanceCandidate) =>
        r.disabled ? <Text type="secondary">{v}（不可选）</Text> : <Text>{v}</Text>,
    },
  ]

  if (!monitorType || !networkDomainId) {
    return <Empty description="请先选择监控对象类型与网域后加载候选实例" />
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Space>
          <Checkbox checked={allSelectableSelected} indeterminate={!allSelectableSelected && !noneSelected} onChange={(e) => (e.target.checked ? toggleAll() : toggleNone())}>
            全选当前页
          </Checkbox>
          <Button type="link" size="small" onClick={toggleNone}>
            反选当前页
          </Button>
          <Text type="secondary">已选 {selectedIds.length} 个</Text>
        </Space>
        <Input.Search
          allowClear
          placeholder="搜索实例名称 / IP"
          style={{ width: 220 }}
          onSearch={(v) => {
            setKeyword(v)
            setPage(1)
          }}
        />
      </div>
      <Table<InstanceCandidate>
        rowKey="resource_id"
        size="small"
        dataSource={rows}
        loading={loading}
        columns={columns}
        scroll={TABLE_SCROLL_X}
        locale={{ emptyText: <Empty description="暂无候选实例" /> }}
        pagination={{
          pageSize,
          current: page,
          total,
          showSizeChanger: true,
          onChange: (p, pz) => {
            setPage(p)
            setPageSize(pz)
          },
        }}
      />
    </Space>
  )
}

export default InstanceSelector