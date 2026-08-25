import { Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { LabelSourceType, LabelTemplateListItem, Mapping } from '../../types/label'
import { CATEGORY_MAP } from './strategyConstants'

const { Text, Link } = Typography

/** 映射来源类型显示名（LabelSourceType） */
const SOURCE_TYPE_MAP: Record<LabelSourceType, string> = {
  resource_field: '资源字段',
  composite: '组合',
  prometheus_builtin: '内置指标',
  cmdb_field: 'CMDB 字段',
}

const MAPPING_COLUMNS: ColumnsType<Mapping> = [
  {
    title: '来源字段',
    dataIndex: 'source_field',
    key: 'source_field',
    render: (v?: string) => v || '-',
  },
  {
    title: '来源类型',
    dataIndex: 'source_type',
    key: 'source_type',
    width: 96,
    render: (v: LabelSourceType) => SOURCE_TYPE_MAP[v] ?? v,
  },
  {
    title: '目标标签',
    dataIndex: 'target_label',
    key: 'target_label',
    render: (v: string) => <Text code>{v}</Text>,
  },
  {
    title: '启用',
    dataIndex: 'enabled',
    key: 'enabled',
    width: 64,
    render: (v: boolean) => (v ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>),
  },
]

interface LabelTemplatePreviewProps {
  /** 当前选中的标签模板；为空则不渲染 */
  template?: LabelTemplateListItem | null
  /** 区块标题，默认「模板信息」 */
  title?: string
}

/**
 * 标签模板只读预览（M01 PRD §5.1 表单内/预览抽屉复用）。
 * 选择/查看标签模板时展示模板头部（名称 + 默认标记）+ 类别·ID + 映射明细，
 * 并提供「前往标签模板管理（M07）」跨模块引导（模板不适用时可跳转深度管理）。
 * 本组件只读引用模板，不提供编辑（模板 CRUD 归属 M07）。
 */
export function LabelTemplatePreview({ template, title = '模板信息' }: LabelTemplatePreviewProps) {
  if (!template) return null
  return (
    <div
      style={{
        border: '1px solid #d9d9d9',
        borderRadius: 8,
        padding: '12px',
        background: 'var(--color-bg-layout, #fafafa)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {title}
          </Text>
        </Space>
        <Link href="/label-templates" style={{ fontSize: 12 }}>
          前往标签模板管理（M07）
        </Link>
      </div>
      <Space direction="vertical" size={4}>
        <Space size={6}>
          <Text strong>{template.name}</Text>
          {template.is_default && <Tag color="blue">默认</Tag>}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {CATEGORY_MAP[template.resource_category] ?? template.resource_category} · #{template.id}
        </Text>
      </Space>
      {template.mappings.length > 0 ? (
        <Table<Mapping>
          rowKey={(m) => `${m.source_type}-${m.source_field}-${m.target_label}`}
          size="small"
          columns={MAPPING_COLUMNS}
          dataSource={template.mappings}
          pagination={false}
          style={{ marginTop: 8 }}
        />
      ) : (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          该模板暂无标签映射明细
        </Text>
      )}
    </div>
  )
}

export default LabelTemplatePreview