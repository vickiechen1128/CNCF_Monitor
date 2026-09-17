import { useState } from 'react'
import config from 'antd/locale/zh_CN'
import { MainLayout } from '../../layouts/MainLayout'
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  Drawer,
  Form,
  Input,
  Row,
  Select,
  Space,
  Tabs,
  Typography,
  message,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { labelTemplateApi } from '../../api/labelTemplates'
import type { LabelTemplate, Mapping } from '../../types/label'
import type { ResourceCategory } from '../../types/resource'
import TemplateDetailTabs from './TemplateDetailTabs'
import TemplateList from './TemplateList'

const { Text } = Typography

/** 五类资源类别（Module_07 §5.1 / 决策 D19） */
const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP） */
const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/**
 * 标签模板管理页（Module_07 §3.2/§11.1，L3 任务 T07-F7）。
 * 顶部五类资源 Tab + 「新增模板」（Drawer）承载左栏列表数据刷新；
 * 左栏 TemplateList 实现搜索 / 默认·自定义筛选 / 克隆 / 删除（T07-F7），点击卡片选中并联动右栏高亮；
 * 右栏模板详情三 Tab（映射明细 / 关联实例 / 被引用 Job）由 TemplateDetailTabs 实现（T07-F8），
 * 映射变更后回写选中模板并通知左栏刷新映射数 badge。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md
 */
export function LabelTemplatesPage() {
  const [activeType, setActiveType] = useState<ResourceCategory>('host')
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  /** 新增成功后自增，通知左栏列表重新加载（克隆/删除在列表内自行刷新） */
  const [reloadKey, setReloadKey] = useState(0)
  /** 右栏当前选中模板（点击左栏卡片联动；含完整 mappings，供详情三 Tab 使用） */
  const [selectedTemplate, setSelectedTemplate] = useState<LabelTemplate | null>(null)
  const [form] = Form.useForm()

  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ resource_category: activeType })
    setCreateOpen(true)
  }

  const handleCreate = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await labelTemplateApi.create({
        name: values.name as string,
        resource_category: values.resource_category as ResourceCategory,
      })
      message.success('模板已新增')
      setCreateOpen(false)
      setReloadKey((k) => k + 1)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '新增失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  /** 映射变更（新增/编辑/删除）后回写选中模板，并通知左栏列表刷新映射数 badge */
  const handleMappingsChange = (mappings: Mapping[]) => {
    setSelectedTemplate((tpl) => (tpl ? { ...tpl, mappings } : tpl))
    setReloadKey((k) => k + 1)
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title={
            <Space direction="vertical" size={0}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>标签模板</span>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                按资源类别管理字段到 Prometheus Label 的映射
              </Text>
            </Space>
          }
        >
          <Row gutter={16} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
            <Col>
              <Tabs
                activeKey={activeType}
                onChange={(key) => {
                  setActiveType(key as ResourceCategory)
                  // 资源类别 Tab 切换时清空右栏选中模板，避免残留上一类别模板详情（F-35）
                  setSelectedTemplate(null)
                }}
                items={RESOURCE_TYPES.map((type) => ({ key: type, label: RESOURCE_TYPE_MAP[type] }))}
              />
            </Col>
            <Col>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新增模板
              </Button>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={9}>
              <TemplateList
                activeType={activeType}
                reloadKey={reloadKey}
                onCreate={openCreate}
                selectedId={selectedTemplate?.id}
                onSelect={setSelectedTemplate}
              />
            </Col>
            <Col span={15}>
              <TemplateDetailTabs template={selectedTemplate} onMappingsChange={handleMappingsChange} />
            </Col>
          </Row>
        </Card>

        <Drawer
          title="新增模板"
          width={400}
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          // forceRender：#19 通病（v1.35 规范）。openCreate 在点击时先 setFieldsValue 再 open，
          // Drawer 懒挂载下 Form 字段尚未注册，resource_category 预填被吞、首开为空；
          // forceRender 保证 Form 常驻挂载，点击即正确预填当前资源类别。
          forceRender
          extra={
            <Space>
              <Button onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleCreate}>
                保存
              </Button>
            </Space>
          }
        >
          <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item
              label="模板名称"
              name="name"
              rules={[{ required: true, message: '请输入模板名称' }]}
              extra="模板名称用于展示，同一资源类别下名称可重复"
            >
              <Input placeholder="如 主机默认模板" />
            </Form.Item>
            <Form.Item
              label="资源类别"
              name="resource_category"
              rules={[{ required: true, message: '请选择资源类别' }]}
              extra="模板与资源类别绑定，创建后不可修改"
            >
              <Select placeholder="请选择">
                {RESOURCE_TYPES.map((type) => (
                  <Select.Option key={type} value={type}>
                    {RESOURCE_TYPE_MAP[type]}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Text type="secondary" style={{ fontSize: 12 }}>
              新增模板默认为自定义模板（默认模板由系统预置，不可手动创建），映射列表为空，创建后可在右侧详情中新增映射。
            </Text>
          </Form>
        </Drawer>
      </ConfigProvider>
    </MainLayout>
  )
}

export default LabelTemplatesPage
