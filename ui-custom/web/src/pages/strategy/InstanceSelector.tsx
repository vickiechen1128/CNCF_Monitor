import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Checkbox, Empty, Input, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { scrapeJobApi } from '../../api/scrapeJobs'
import type { InstanceCandidate } from '../../types/strategy'
import type { ResourceCategory } from '../../types/resource'
import { TABLE_SCROLL_X } from '../../components/tablePresets'

const { Text } = Typography

/**
 * 候选行：后端 v3 候选会回填 `template_code`（采集模板），而 legacy 适配层
 * （`api/scrapeJobs.ts`，不在本任务改动范围）暂未透出该字段，故这里做可选扩展，
 * 缺失时回落到查询所用的模板。
 */
type InstanceCandidateRow = InstanceCandidate & { template_code?: string }

interface InstanceSelectorProps {
  /** 已选定的采集模板编码（standard Job，M01 v1.5）；与 resourceCategory 二选一 */
  templateCode?: string
  /** 直接按资源类别收敛候选（拨测 Job = 用户在表单选定的类别，六类任一）；与 templateCode 二选一 */
  resourceCategory?: ResourceCategory
  /** 已选定的网域（已纳管非冻结）；为空时展示引导 */
  networkDomainId?: string
  /**
   * 第二列（实例地址）表头文案。standard 采集为「IP」（默认）；拨测传「探测地址」，
   * 因为拨测目标取自用户在表单选定的字段，未必是 IP。
   */
  addressColumnTitle?: string
  /**
   * 第二列取值字段（可选）：拨测表单传用户选定的「探测地址字段」，候选第二列即渲染
   * 该字段的值 —— 保证列表所见与实际探测地址一致（否则用户选了「接口名」却看到 IP）。
   * 不传时后端退回该类别的固有 IP/端点值。
   */
  targetField?: string
  /** 当前已选实例 resource_id 集合（受控） */
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

/**
 * 实例选择器（Module_01 §3.1/§5.4/§8②/§11.1，F5）。
 * 二选一收敛候选类别（采集模板 / resource_category 直给）+ 同网域收敛
 * （GET /scrape-jobs/instance-candidates?template_code=…&resource_category=…）；全选 /
 * 反选 + 关键字；status=offline 置灰不可选（决策29）；持久化 selected_instance_ids。
 *
 * 选择器（`selector`）不参与候选查询：GET 端点只支持模板 + 类别；需要按条件实时预览的
 * 场景（任务组向导第 2 步）改走 POST /instance-candidates/query。
 */
export function InstanceSelector({
  templateCode,
  resourceCategory,
  networkDomainId,
  addressColumnTitle = 'IP',
  targetField,
  selectedIds,
  onChange,
}: InstanceSelectorProps) {
  const [rows, setRows] = useState<InstanceCandidateRow[]>([])
  const [loading, setLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const params = useMemo(
    () => ({
      templateCode,
      resourceCategory,
      networkDomainId,
      targetField,
      keyword: keyword || undefined,
      page,
      page_size: pageSize,
    }),
    [templateCode, resourceCategory, networkDomainId, targetField, keyword, page, pageSize],
  )

  const load = useCallback(async () => {
    if ((!templateCode && !resourceCategory) || !networkDomainId) {
      setRows([])
      setTotal(0)
      return
    }
    setLoading(true)
    try {
      const res = await scrapeJobApi.instanceCandidates({
        template_code: params.templateCode,
        resource_category: params.resourceCategory,
        network_domain_id: params.networkDomainId!,
        target_field: params.targetField,
        keyword: params.keyword,
        page: params.page,
        page_size: params.page_size,
      })
      setRows((res.data?.list ?? []) as InstanceCandidateRow[])
      setTotal(res.data?.total ?? 0)
    } catch {
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [params, templateCode, resourceCategory, networkDomainId])

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

  const columns: ColumnsType<InstanceCandidateRow> = [
    {
      title: '选择',
      key: 'sel',
      width: 60,
      render: (_: unknown, r: InstanceCandidateRow) => (
        <Checkbox
          disabled={r.disabled}
          checked={selectedIds.includes(r.resource_id)}
          onChange={(e) => toggleRow(r.resource_id, e.target.checked)}
        />
      ),
    },
    { title: '实例名', dataIndex: 'instance_name', key: 'instance_name', render: (v: string) => <Text>{v}</Text> },
    { title: addressColumnTitle, dataIndex: 'instance_ip', key: 'instance_ip', render: (v: string) => <Text type="secondary">{v}</Text> },
    {
      title: '采集模板',
      key: 'template_code',
      width: 160,
      // 候选查询按模板过滤，行内模板缺失时回落到查询所用模板
      render: (_: unknown, r: InstanceCandidateRow) => {
        const code = r.template_code || templateCode
        return code ? <Tag>{code}</Tag> : <Text type="secondary">-</Text>
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (v: string, r: InstanceCandidateRow) =>
        r.disabled ? <Text type="secondary">{v}（不可选）</Text> : <Text>{v}</Text>,
    },
  ]

  if ((!templateCode && !resourceCategory) || !networkDomainId) {
    // 两种收敛模式文案不同：standard 走采集模板收敛、拨测直接给资源类别。
    return (
      <Empty
        description={
          resourceCategory ? '请先选择网域后加载候选实例' : '请先选择采集模板与网域后加载候选实例'
        }
      />
    )
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
      <Table<InstanceCandidateRow>
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
