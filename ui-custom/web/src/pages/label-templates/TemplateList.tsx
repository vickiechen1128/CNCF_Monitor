import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Input,
  List,
  Modal,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { CopyOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { labelTemplateApi } from '../../api/labelTemplates'
import { EllipsisText } from '../../components/EllipsisText'
import type { LabelTemplateListItem } from '../../types/label'
import type { ResourceCategory } from '../../types/resource'
import { INSTANCE_LEVEL_CUSTOM_CATEGORIES } from './labelTemplateConstants'

const { Text } = Typography

/** 模板筛选类型（Module_07 §3.2：默认 / 自定义） */
export type TemplateFilter = 'all' | 'default' | 'custom'

/** 模板列表分页 pageSize（PRD §11.1 分页从简，默认 50） */
const PAGE_SIZE = 50

const FILTER_OPTIONS: { value: TemplateFilter; label: string }[] = [
  { value: 'all', label: '全部模板' },
  { value: 'default', label: '默认模板' },
  { value: 'custom', label: '自定义模板' },
]

interface TemplateListProps {
  activeType: ResourceCategory
  /** 父页面新增模板成功后自增，触发重新加载 */
  reloadKey: number
  /** 空态「新建模板」引导回调（打开父页面新增抽屉） */
  onCreate: () => void
  /** 当前选中模板 id（右栏详情联动高亮，T07-F8） */
  selectedId?: number
  /** 点击模板卡片选中回调（携带完整模板，供右栏详情使用，T07-F8） */
  onSelect: (tpl: LabelTemplateListItem) => void
}

/**
 * 标签模板左栏列表（Module_07 §3.2/§11.1，L3 任务 T07-F7）。
 * 按资源类型展示模板卡片：名称 + 默认/自定义 Tag + 映射数（mappings.length）
 * + 关联实例数 badge（instance_count）；支持搜索（keyword）、默认/自定义筛选（is_default）、
 * 分页从简（pageSize 50）。操作：克隆（clone）/ 删除（Modal 二次确认，默认模板按钮置灰提示「默认模板禁止删除」）。
 * 覆盖加载骨架屏 / 空态「暂无标签模板」+新建引导 / 接口错误 Alert+重新加载。
 */
export default function TemplateList({ activeType, reloadKey, onCreate, selectedId, onSelect }: TemplateListProps) {
  const [items, setItems] = useState<LabelTemplateListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [filter, setFilter] = useState<TemplateFilter>('all')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [cloneTarget, setCloneTarget] = useState<LabelTemplateListItem | null>(null)
  const [cloneName, setCloneName] = useState('')
  const [cloning, setCloning] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LabelTemplateListItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 资源类别 Tab 切换（父页面持有）时回到第一页、清空残留列表并显示骨架屏；
  // 采用「渲染期间调整状态」模式（React 官方推荐用于派生状态重置），避免 effect 双请求。
  // 必须同时清空 items：否则 loading 条件渲染（loading && items.length === 0）不成立，
  // 上一类别的模板列表会残留到新数据返回，用户切 Tab 后点击到的是旧类别模板。
  const [prevActiveType, setPrevActiveType] = useState<ResourceCategory>(activeType)
  if (prevActiveType !== activeType) {
    setPrevActiveType(activeType)
    setPage(1)
    setItems([])
    setLoading(true)
  }

  const load = useCallback(async () => {
    try {
      const res = await labelTemplateApi.list({
        resource_category: activeType,
        is_default: filter === 'all' ? undefined : filter === 'default',
        keyword: keyword.trim() || undefined,
        page,
        page_size: PAGE_SIZE,
      })
      setItems(res.data.list)
      setTotal(res.data.total)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [activeType, keyword, filter, page])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh, reloadKey])

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const openClone = (tpl: LabelTemplateListItem) => {
    setCloneTarget(tpl)
    setCloneName(`${tpl.name} 副本`)
    setError(null)
  }

  const handleCloneOk = async () => {
    if (!cloneTarget) return
    const name = cloneName.trim()
    if (!name) {
      message.warning('请输入模板名称')
      return
    }
    setCloning(true)
    try {
      await labelTemplateApi.clone(cloneTarget.id, { name })
      message.success(`已克隆模板「${name}」`)
      setCloneTarget(null)
      void load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '克隆失败，请稍后重试')
    } finally {
      setCloning(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await labelTemplateApi.remove(deleteTarget.id)
      message.success('模板已删除')
      setDeleteTarget(null)
      void load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card
      size="small"
      title="模板列表"
      style={{ minHeight: 420 }}
      extra={<Text type="secondary" style={{ fontSize: 12 }}>{total} 个</Text>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Input.Search
          placeholder="搜索模板名称"
          allowClear
          onSearch={(v) => {
            setKeyword(v)
            setPage(1)
            setLoading(true)
          }}
        />
        <Select
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setPage(1)
            setLoading(true)
          }}
          style={{ width: '100%' }}
        >
          {FILTER_OPTIONS.map((o) => (
            <Select.Option key={o.value} value={o.value}>
              {o.label}
            </Select.Option>
          ))}
        </Select>
      </Space>

      <div style={{ marginTop: 12 }}>
        {error ? (
          <Alert
            type="error"
            showIcon
            message="模板列表加载失败，请稍后重试"
            description={error}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
                重新加载
              </Button>
            }
          />
        ) : loading && items.length === 0 ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : items.length === 0 ? (
          <Empty description="暂无标签模板">
            <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
              新建模板
            </Button>
          </Empty>
        ) : (
          <List
            dataSource={items}
            renderItem={(tpl) => {
              const active = tpl.id === selectedId
              return (
                <List.Item
                  onClick={() => onSelect(tpl)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: active ? '#E6FAFD' : undefined,
                    border: active ? '1px solid #0ECDEB' : '1px solid transparent',
                  }}
                  actions={[
                    <Button
                      key="clone"
                      type="link"
                      size="small"
                      icon={<CopyOutlined />}
                      loading={cloning && cloneTarget?.id === tpl.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        openClone(tpl)
                      }}
                    >
                      克隆
                    </Button>,
                    tpl.is_default ? (
                      <Tooltip key="delete" title="默认模板禁止删除">
                        {/* 禁用按钮 pointer-events:none 会吞掉鼠标事件，需外套 span 才能触发 Tooltip */}
                        <span>
                          <Button type="link" size="small" danger disabled icon={<DeleteOutlined />}>
                            删除
                          </Button>
                        </span>
                      </Tooltip>
                    ) : (
                      <Button
                        key="delete"
                        type="link"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTarget(tpl)
                        }}
                      >
                        删除
                      </Button>
                    ),
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space size={6}>
                        <EllipsisText maxWidth={150}>{tpl.name}</EllipsisText>
                        {tpl.is_default ? <Tag color="gold">默认</Tag> : <Tag>自定义</Tag>}
                      </Space>
                    }
                    description={
                      <Space size={12} wrap>
                        <span>
                          <Badge count={tpl.mappings.length} showZero color="#185FA5" /> {tpl.mappings.length} 条映射
                        </span>
                        {/* 双场景治理边界（PRD §3.3/§5.2/§6.2）：仅实例级自定义开放类别展示关联实例 badge（F-34） */}
                        {INSTANCE_LEVEL_CUSTOM_CATEGORIES.includes(tpl.resource_category) && (
                          <span>
                            <Badge count={tpl.instance_count} showZero color="#0F6E56" /> 关联实例 {tpl.instance_count}
                          </span>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )
            }}
            pagination={{
              current: page,
              pageSize: PAGE_SIZE,
              total,
              showSizeChanger: false,
              onChange: (p) => {
                setPage(p)
                setLoading(true)
              },
            }}
          />
        )}
      </div>

      <Modal
        title="克隆模板"
        open={cloneTarget !== null}
        onCancel={() => setCloneTarget(null)}
        onOk={handleCloneOk}
        confirmLoading={cloning}
        okText="克隆"
        cancelText="取消"
        destroyOnHidden
      >
        <p>基于「{cloneTarget?.name}」克隆新模板，请设置新模板名称：</p>
        <Input
          value={cloneName}
          allowClear
          placeholder="请输入模板名称"
          onChange={(e) => setCloneName(e.target.value)}
          onPressEnter={() => void handleCloneOk()}
        />
      </Modal>

      <Modal
        title="删除模板"
        open={deleteTarget !== null}
        onCancel={() => setDeleteTarget(null)}
        onOk={handleDelete}
        confirmLoading={deleting}
        okText="删除"
        okType="danger"
        cancelText="取消"
        destroyOnHidden
      >
        <p>确认删除模板「{deleteTarget?.name}」？该操作不可恢复。</p>
      </Modal>
    </Card>
  )
}
