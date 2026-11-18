/**
 * 标签模板右栏详情双 Tab（T07-F8，Module_07 §3.2 / §11.1；v3 契约 §4.1）。
 *
 * Tab1 映射明细：按来源类型分组展示（composite / resource_field / 其他），
 *   「编辑」打开 MappingDrawer 批量增删改并统一保存（v3 走「GET 模板 → PUT 整模板」）；默认模板只读保护。
 * Tab2 被引用 Job：数据源为 Module_01 只读接口（GET /api/v1/scrape-jobs?label_template_id=，
 *   §3.2 / §6.6.3）未实现，本阶段展示空态占位 + 说明文案，接 M01 后替换为表格渲染。
 *
 * v3 语义下模板不绑定资源实例（由 M01 Job / 默认映射引用），故移除 v2 的「关联实例」Tab。
 *
 * 映射保存后展示「保存后影响反馈」Alert（§3.2 / §11.2）：
 * 「本模板被 N 个采集 Job 引用，将按新映射重新生成标签；MVP 重新生成并立即生效；
 * 无版本回滚能力，修改立即生效」+「查看引用 Job」跳转 Tab2。
 */
import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Empty,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import type { TableProps } from 'antd'
import { EditOutlined, StarOutlined } from '@ant-design/icons'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_SCROLL_X } from '../../components/tablePresets'
import { labelTemplateApi } from '../../api/labelTemplates'
import type { LabelTemplate, Mapping } from '../../types/label'
import {
  RESOURCE_TYPE_MAP,
  SOURCE_TYPE_COLOR,
  SOURCE_TYPE_LABEL,
  TRANSFORM_LABELS,
} from './labelTemplateConstants'
import MappingDrawer from './MappingDrawer'

const { Text } = Typography

/** 右栏 Tab key（v3 无「关联实例」Tab） */
type DetailTabKey = 'mappings' | 'jobs'

interface TemplateDetailTabsProps {
  /** 左栏选中的模板；null 时展示「请选择左侧模板查看详情」 */
  template: LabelTemplate | null
  /** 引用本模板的采集 Job 数（数据源 M01 GET /api/v1/scrape-jobs?label_template_id=，未实现时默认 0） */
  referencingJobCount?: number
  /** 映射变更后回调（携带最新 mappings，供上级刷新左栏映射数 badge） */
  onMappingsChange: (mappings: Mapping[]) => void
  /** 设为默认成功后的整模板回调（供上级回写选中模板并刷新左栏默认 Tag） */
  onTemplateChange?: (template: LabelTemplate) => void
}

/** 分组映射行：映射本身 + 在模板全量 mappings 中的下标（用作只读表格行键） */
interface GroupedMapping {
  mapping: Mapping
  globalIndex: number
}

/**
 * 标签模板右栏详情双 Tab（T07-F8）。
 * 无选中模板时展示引导占位；选中后支持映射增删改（整模板保存）。
 */
export default function TemplateDetailTabs({
  template,
  referencingJobCount = 0,
  onMappingsChange,
  onTemplateChange,
}: TemplateDetailTabsProps) {
  const templateId = template?.id ?? null

  // 右栏 Tab / 映射抽屉 / 影响反馈 Alert
  const [detailTab, setDetailTab] = useState<DetailTabKey>('mappings')
  const [mappingDrawerOpen, setMappingDrawerOpen] = useState(false)
  const [impactVisible, setImpactVisible] = useState(false)
  // 设为默认二次确认（v2.56）
  const [setDefaultOpen, setSetDefaultOpen] = useState(false)
  const [settingDefault, setSettingDefault] = useState(false)

  // 模板切换时重置右栏本地状态（渲染期间调整派生状态，React 官方推荐模式，避免 effect 双请求）
  const [prevTemplateId, setPrevTemplateId] = useState<string | null>(templateId)
  if (prevTemplateId !== templateId) {
    setPrevTemplateId(templateId)
    setDetailTab('mappings')
    setMappingDrawerOpen(false)
    setImpactVisible(false)
    setSetDefaultOpen(false)
  }

  // ---------- 映射分组（Tab1） ----------
  const mappingGroups = useMemo<{ key: string; label: string; items: GroupedMapping[] }[]>(() => {
    const composite: GroupedMapping[] = []
    const resourceField: GroupedMapping[] = []
    const others: GroupedMapping[] = []
    ;(template?.mappings ?? []).forEach((m, i) => {
      if (m.source_type === 'composite') composite.push({ mapping: m, globalIndex: i })
      else if (m.source_type === 'resource_field') resourceField.push({ mapping: m, globalIndex: i })
      else others.push({ mapping: m, globalIndex: i })
    })
    return [
      { key: 'composite', label: `组合字段（${composite.length}）`, items: composite },
      { key: 'resource_field', label: `资源字段（${resourceField.length}）`, items: resourceField },
      { key: 'others', label: `其他（${others.length}）`, items: others },
    ].filter((g) => g.items.length > 0)
  }, [template])

  // 整组映射统一保存成功后：刷新映射并展示影响反馈。
  const handleMappingsSaved = (mappings: Mapping[]) => {
    setImpactVisible(true)
    onMappingsChange(mappings)
  }

  // 设为默认：后端同一类别默认互斥（旧默认自动取消），成功后回写整模板。
  const handleSetDefault = async () => {
    if (!template) return
    setSettingDefault(true)
    try {
      const res = await labelTemplateApi.setDefault(template.id)
      message.success('已设为默认模板')
      setSetDefaultOpen(false)
      onTemplateChange?.(res.data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '设为默认失败，请稍后重试')
    } finally {
      setSettingDefault(false)
    }
  }

  const mappingColumns: TableProps<GroupedMapping>['columns'] = [
    {
      title: '来源字段',
      key: 'source_field',
      render: (_, row) => (
        <Text code style={{ fontSize: 12 }}>
          {row.mapping.source_field}
        </Text>
      ),
    },
    {
      title: '来源类型',
      key: 'source_type',
      render: (_, row) => (
        <Tag color={SOURCE_TYPE_COLOR[row.mapping.source_type]}>{SOURCE_TYPE_LABEL[row.mapping.source_type]}</Tag>
      ),
    },
    {
      title: '目标标签',
      key: 'target_label',
      render: (_, row) => <Text strong>{row.mapping.target_label}</Text>,
    },
    {
      title: '转换规则',
      key: 'transform',
      render: (_, row) =>
        row.mapping.transform ? (
          <Tag>{TRANSFORM_LABELS[row.mapping.transform] ?? row.mapping.transform}</Tag>
        ) : (
          '-'
        ),
    },
    {
      title: '启用',
      key: 'enabled',
      render: (_, row) =>
        row.mapping.enabled ? <Badge status="success" text="启用" /> : <Badge status="default" text="禁用" />,
    },
  ]

  // ---------- 渲染 ----------
  if (!template) {
    return (
      <Card size="small" title="模板详情" style={{ minHeight: 420 }}>
        <Empty description="请选择左侧模板查看详情" />
      </Card>
    )
  }

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <EllipsisText maxWidth={180}>{template.name}</EllipsisText>
          {template.is_default && <Tag color="gold">默认</Tag>}
          <Tag>{RESOURCE_TYPE_MAP[template.resource_category]}</Tag>
        </Space>
      }
      style={{ minHeight: 420 }}
      extra={
        <Space size={6}>
          {!template.is_default && (
            <Button icon={<StarOutlined />} onClick={() => setSetDefaultOpen(true)}>
              设为默认
            </Button>
          )}
          {template.is_default ? (
            <Tooltip title="默认模板只读保护，映射变更请基于默认模板克隆后操作">
              {/* 禁用按钮 pointer-events:none 会吞掉鼠标事件，需外套 span 才能触发 Tooltip */}
              <span>
                <Button type="primary" icon={<EditOutlined />} aria-label="编辑" autoInsertSpace={false} disabled>
                  编辑
                </Button>
              </span>
            </Tooltip>
          ) : (
            <Button
              type="primary"
              icon={<EditOutlined />}
              aria-label="编辑"
              autoInsertSpace={false}
              onClick={() => setMappingDrawerOpen(true)}
            >
              编辑
            </Button>
          )}
        </Space>
      }
    >
      {impactVisible && (
        <Alert
          type="info"
          showIcon
          closable
          onClose={() => setImpactVisible(false)}
          style={{ marginBottom: 12 }}
          message="保存已生效"
          description={
            <Space direction="vertical" size={4}>
              <Text style={{ fontSize: 13 }}>
                {referencingJobCount > 0 ? (
                  <>
                    本模板被 <Text strong>{referencingJobCount}</Text> 个采集 Job 引用，将按新映射重新生成标签；
                  </>
                ) : (
                  '暂无采集 Job 引用本模板，本次修改不影响现有采集任务；'
                )}
                MVP 重新生成配置并立即生效。
              </Text>
              <Text style={{ fontSize: 12, color: '#86909C' }}>
                无版本回滚能力，修改立即生效（每次变更落只读修改快照）。
              </Text>
            </Space>
          }
          action={
            <Button size="small" onClick={() => setDetailTab('jobs')}>
              查看引用 Job
            </Button>
          }
        />
      )}

      <Tabs
        activeKey={detailTab}
        onChange={(key) => setDetailTab(key as DetailTabKey)}
        items={[
          {
            key: 'mappings',
            label: `映射明细（${template.mappings.length}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Text style={{ fontSize: 13 }}>
                  字段来源支持「资源字段 / 组合字段」，映射按来源类型分组展示；保护标签（不可作为目标标签）：
                  instance / job / scheme / __address__ 等（composite→instance 例外）。
                </Text>
                {template.mappings.length === 0 ? (
                  <Empty description="该模板暂无映射，点击「编辑」添加" />
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {mappingGroups.map((group) => (
                      <div key={group.key}>
                        <Divider plain orientation="left" style={{ margin: '4px 0 8px' }}>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {group.label}
                          </Text>
                        </Divider>
                        <Table
                          rowKey={(row) => String(row.globalIndex + 1)}
                          size="small"
                          dataSource={group.items}
                          columns={mappingColumns}
                          pagination={false}
                          locale={{ emptyText: '无' }}
                          scroll={TABLE_SCROLL_X}
                        />
                      </div>
                    ))}
                  </Space>
                )}
              </Space>
            ),
          },
          {
            key: 'jobs',
            label: `被引用采集 Job（${referencingJobCount}）`,
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Text style={{ fontSize: 13 }}>
                  本模板被 <Text strong>{referencingJobCount}</Text> 个采集 Job 引用。修改模板后，引用的 Job
                  会按新映射重新生成标签，配置变更需在配置中心确认后生效（MVP 阶段重新生成配置并立即生效）。
                </Text>
                <Text style={{ fontSize: 12, color: '#86909C' }}>
                  MVP 无版本回滚能力，修改立即生效，每次变更落只读修改快照（操作人 / 时间 / 旧值 / 新值）。
                </Text>
                {/* M01 未实现：被引用 Job 数据源为 Module_01 只读接口
                    GET /api/v1/scrape-jobs?label_template_id={template_id}（§3.2 / §6.6.3），
                    M07 不直接暴露聚合接口。接 M01 后替换为完整 Table（Job 名 / 网域 / 启用状态 / 变更状态，
                    分页 pageSize=10）。本阶段展示空态占位。 */}
                <Empty description="暂无采集 Job 引用本模板" />
              </Space>
            ),
          },
        ]}
      />

      {mappingDrawerOpen && !template.is_default && (
        <MappingDrawer
          open={mappingDrawerOpen}
          template={template}
          onClose={() => setMappingDrawerOpen(false)}
          onSaved={handleMappingsSaved}
        />
      )}

      <Modal
        title="设为默认模板"
        open={setDefaultOpen}
        onCancel={() => setSetDefaultOpen(false)}
        onOk={handleSetDefault}
        okText="设为默认"
        cancelText="取消"
        confirmLoading={settingDefault}
        destroyOnHidden
      >
        <Space direction="vertical" size={8}>
          <Text>
            将「<Text strong>{template.name}</Text>」设为「{RESOURCE_TYPE_MAP[template.resource_category]}」的默认模板？
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            该资源类别原默认模板会自动取消默认。默认模板只读，后续映射调整请先克隆。
          </Text>
        </Space>
      </Modal>
    </Card>
  )
}
