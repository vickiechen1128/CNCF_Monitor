import {
  Alert,
  Button,
  Divider,
  Empty,
  Input,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { EllipsisText } from '../../components/EllipsisText'
import type { SkinTokens } from '../../skins'
import type { ResourceLabelItem } from '../../types/resource'
import type { UseResourceLabelsResult } from './useResourceLabels'

const { Text, Title } = Typography

/** 标签卡左侧边框色（对齐原型：system 灰 / user 青 / cmdb 蓝，走皮肤 token） */
function labelSourceBorder(tokens: SkinTokens): Record<string, string> {
  return {
    system: tokens.colorTextTertiary,
    user: tokens.colorPrimary,
    cmdb: tokens.colorInfo,
  }
}

/** 紧凑单行标签行：来源 Tag 极简化（去实心块），保证文本仍可被 getByText 命中 */
const minimalTagStyle = { marginInlineEnd: 0, fontSize: 12, lineHeight: '18px', padding: '0 6px', borderRadius: 3 }

export interface ResourceLabelsTabProps extends UseResourceLabelsResult {
  isApplication: boolean
  tokens: SkinTokens
}

/**
 * 资源详情标签区（T07-R8 从 ResourceDetailDrawer 原样迁出，行为等价）。
 *
 * 标签卡展示全量标签（resourceApi.labels）：system 标注「来自 XX 模板 · source_map」并可跳转模板页；
 * user 标注「手动添加」；cmdb 以「v0.4+ 预留」占位（§3.3 统一口径）。
 * user 标签编辑（新增/编辑/删除）仅 resource_category=application 开放（标题「自定义标签（非必须）」
 * 并附引导文案）；静态资源只读展示来源、不提供打标入口。
 */
export function ResourceLabelsTab({
  isApplication,
  tokens,
  labels,
  labelsLoading,
  labelsError,
  template,
  writeError,
  submitting,
  newKey,
  newValue,
  editingId,
  editValue,
  setNewKey,
  setNewValue,
  setEditingId,
  setEditValue,
  reloadLabels,
  handleAddLabel,
  handleEditValue,
  handleSaveEdit,
  handleDeleteLabel,
}: ResourceLabelsTabProps) {
  const navigate = useNavigate()

  /** 标签来源 Tag（cmdb 以「v0.4+ 预留」占位，§3.3 统一口径） */
  const renderSourceTag = (label: ResourceLabelItem) => {
    if (label.source === 'cmdb')
      return (
        <Tag bordered={false} style={minimalTagStyle}>
          CMDB · v0.4+ 预留
        </Tag>
      )
    if (label.source === 'user')
      return (
        <Tag bordered={false} color="cyan" style={minimalTagStyle}>
          用户
        </Tag>
      )
    return (
      <Tag bordered={false} style={minimalTagStyle}>
        系统
      </Tag>
    )
  }

  /** 来源说明统一为 12px 次要文字 + 单行省略（紧凑行内渲染，仍保留在 DOM 中） */
  const annotationStyle = {
    fontSize: 12,
    color: tokens.colorTextTertiary,
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const

  /** 标签来源标注（§5.3 联动呈现：system → 模板·source_map；user → 手动添加；cmdb → 预留说明） */
  const renderAnnotation = (label: ResourceLabelItem) => {
    if (label.source === 'system') {
      if (!template) return <Text style={annotationStyle}>来自标签模板</Text>
      return (
        <Text style={{ ...annotationStyle, cursor: 'pointer' }} onClick={() => navigate('/label-templates')}>
          <Tooltip title="前往标签模板管理">
            {label.source_map ? `来自 ${template.name} · ${label.source_map}` : `来自 ${template.name}`}
          </Tooltip>
        </Text>
      )
    }
    if (label.source === 'user') {
      return <Text style={annotationStyle}>手动添加</Text>
    }
    return <Text style={annotationStyle}>CMDB 同步（v0.4+ 接入后生效，MVP 仅占位展示）</Text>
  }

  /** 单条标签行（紧凑单行）：system/cmdb 与静态资源的 user 标签只读；application 的 user 标签可编辑/删除 */
  const renderLabelRow = (label: ResourceLabelItem) => {
    const canEdit = isApplication && label.source === 'user'
    const isEditing = editingId === label.id
    return (
      <div
        key={label.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'nowrap',
          gap: 8,
          borderLeft: `4px solid ${labelSourceBorder(tokens)[label.source]}`,
          borderBottom: `1px solid ${tokens.colorBorderSecondary}`,
          padding: '6px 10px',
          borderRadius: 4,
        }}
      >
        {canEdit && isEditing ? (
          <Space.Compact block>
            <Input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={() => handleSaveEdit(label)}
              placeholder="标签值"
            />
            <Tooltip title="保存">
              <Button
                type="primary"
                size="small"
                aria-label="保存"
                icon={<SaveOutlined />}
                loading={submitting}
                onClick={() => handleSaveEdit(label)}
              />
            </Tooltip>
            <Tooltip title="取消">
              <Button
                size="small"
                aria-label="取消"
                icon={<CloseOutlined />}
                disabled={submitting}
                onClick={() => setEditingId(null)}
              />
            </Tooltip>
          </Space.Compact>
        ) : (
          <>
            <Text strong style={{ flex: '0 0 auto' }}>
              {label.key}
            </Text>
            <Text type="secondary" style={{ flex: '0 0 auto', fontSize: 12 }}>
              =
            </Text>
            <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden' }}>
              <EllipsisText maxWidth={260}>{label.value || '-'}</EllipsisText>
            </span>
            {renderAnnotation(label)}
            <span style={{ marginLeft: 'auto', flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              {renderSourceTag(label)}
              {isApplication && !canEdit && (
                <Tooltip title="只读">
                  <LockOutlined style={{ color: tokens.colorTextTertiary, fontSize: 12 }} />
                </Tooltip>
              )}
              {canEdit && (
                <>
                  {/* icon-only 按钮必须显式 aria-label：antd 图标的 aria-label 会混入 accessible name */}
                  <Tooltip title="编辑">
                    <Button
                      type="text"
                      size="small"
                      aria-label="编辑"
                      icon={<EditOutlined />}
                      disabled={submitting}
                      onClick={() => handleEditValue(label)}
                    />
                  </Tooltip>
                  <Tooltip title="删除">
                    <Button
                      type="text"
                      size="small"
                      danger
                      aria-label="删除"
                      icon={<DeleteOutlined />}
                      disabled={submitting}
                      onClick={() => handleDeleteLabel(label)}
                    />
                  </Tooltip>
                </>
              )}
            </span>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <Divider />
      <Title level={5}>{isApplication ? '自定义标签（非必须）' : '自定义标签（静态资源只读）'}</Title>
      {writeError && (
        <Alert
          type="error"
          showIcon
          message="标签操作失败"
          description={writeError}
          style={{ marginBottom: 12 }}
        />
      )}
      {labelsLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : labelsError ? (
        <Alert
          type="error"
          showIcon
          message="标签数据加载失败，请稍后重试"
          description={labelsError}
          action={
            <Button size="small" onClick={reloadLabels}>
              重新加载
            </Button>
          }
        />
      ) : (
        <>
          {isApplication ? (
            <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                大多数场景下，标签模板已自动生成所需标签；仅当个别实例需要额外标签时使用。
              </Text>
              <Space.Compact block>
                <Input
                  placeholder="标签 Key，如 team"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onPressEnter={handleAddLabel}
                />
                <Input
                  placeholder="标签值"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onPressEnter={handleAddLabel}
                />
                <Button type="primary" icon={<PlusOutlined />} loading={submitting} onClick={handleAddLabel}>
                  添加
                </Button>
              </Space.Compact>
              <Text type="secondary" style={{ fontSize: 12 }}>
                key 规则：小写字母 / 数字 / 下划线；禁止 __ 开头；长度 ≤128；禁止覆盖 Prometheus 内置标签。
              </Text>
            </Space>
          ) : (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              静态资源标签由 CMDB / Excel 治理，平台只读，不提供实例级打标入口。如需修改标签，请前往 CMDB 或更新导入数据。
            </Text>
          )}
          {labels.length === 0 ? (
            <Empty description="暂无自定义标签（非必须）" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                标签模板已自动生成所需标签，仅当个别实例需要额外标签时使用。
              </Text>
            </Empty>
          ) : (
            // 紧凑列表：行间距 4，超过一屏时容器内部滚动，避免抽屉被撑长
            <Space direction="vertical" size={4} style={{ width: '100%', maxHeight: 320, overflowY: 'auto' }}>
              {labels.map((label) => renderLabelRow(label))}
            </Space>
          )}
        </>
      )}
    </>
  )
}
