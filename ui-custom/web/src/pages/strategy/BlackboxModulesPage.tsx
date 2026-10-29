/**
 * 拨测模块页（Module_01 采集策略）：全局模块 YAML 维护，修改后通过现有配置中心下发。
 */
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Drawer, Form, Input, Modal, Space, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { blackboxModuleApi, type BlackboxModule } from '../../api/blackboxModules'
import { MainLayout } from '../../layouts/MainLayout'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { triggerConfigDraftsForAllDomains } from '../config-center/preview/triggerConfigDraft'

const DEFAULT_CONTENT = 'http_2xx:\n  prober: http\n  timeout: 5s\n'

interface ModuleFormValues {
  name: string
  content: string
  enabled: boolean
}

export function BlackboxModulesPage() {
  const navigate = useNavigate()
  const [form] = Form.useForm<ModuleFormValues>()
  const [items, setItems] = useState<BlackboxModule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<BlackboxModule | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await blackboxModuleApi.list()
      setItems(res.data?.list ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载拨测模块失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 初始加载在异步请求完成后更新状态，不在 effect 内同步 setState。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  const openEditor = (record?: BlackboxModule) => {
    setEditing(record ?? null)
    setError(null)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue(
      editing
        ? { name: editing.name, content: editing.content, enabled: editing.enabled }
        : { name: 'http_2xx', content: DEFAULT_CONTENT, enabled: true },
    )
  }, [open, editing, form])

  const save = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await blackboxModuleApi.update(editing.id, { content: values.content, enabled: values.enabled })
      } else {
        await blackboxModuleApi.create(values.name, values.content)
      }
      setOpen(false)
      await reload()
      // 拨测模块是全局配置：保存后立即对全部已纳管网域触发变更单生成，
      // 提示可点击直达「配置变更确认」（与采集 Job / 规则的保存动线一致）。
      void triggerConfigDraftsForAllDomains({
        prefix: '拨测模块已保存',
        onNavigate: () => navigate('/config-preview'),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存拨测模块失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = (record: BlackboxModule) => {
    Modal.confirm({
      title: `删除拨测模块 ${record.name}？`,
      content: '删除后将在下一次配置下发时从 blackbox.yml 移除。',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await blackboxModuleApi.remove(record.id)
          await reload()
          void triggerConfigDraftsForAllDomains({
            prefix: '拨测模块已删除',
            onNavigate: () => navigate('/config-preview'),
          })
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除拨测模块失败')
        }
      },
    })
  }

  const columns: ColumnsType<BlackboxModule> = [
    { title: '模块名', dataIndex: 'name', key: 'name', width: 200 },
    { title: '探测类型', dataIndex: 'prober', key: 'prober', width: 120 },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 100,
      render: (enabled: boolean) => <Tag color={enabled ? 'success' : 'default'}>{enabled ? '启用' : '停用'}</Tag>,
    },
    { title: '引用 Job 数', dataIndex: 'referenced_jobs', key: 'referenced_jobs', width: 120 },
    { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 210 },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, record) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEditor(record)}>编辑</Button>
          <Button type="text" danger icon={<DeleteOutlined />} disabled={record.referenced_jobs > 0} onClick={() => remove(record)}>删除</Button>
        </Space>
      ),
    },
  ]

  return (
    <MainLayout>
      <Card
        title="拨测模块"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void reload()}>刷新</Button>
            <Button icon={<RocketOutlined />} onClick={() => navigate('/config-preview')}>去确认下发</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>新增模块</Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">
          模块由所有拨测 Job 共享。每次下发会合并全部启用模块并生成完整 blackbox.yml。
        </Typography.Paragraph>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        <Table<BlackboxModule>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          scroll={TABLE_SCROLL_X}
          pagination={{ ...TABLE_PAGINATION, pageSize: 20 }}
        />
      </Card>

      <Drawer
        title={editing ? `编辑模块：${editing.name}` : '新增拨测模块'}
        width={640}
        open={open}
        onClose={() => setOpen(false)}
        forceRender
        extra={<Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="模块名称" name="name" rules={[{ required: true, message: '请输入模块名称' }]}>
            <Input disabled={!!editing} placeholder="例如：http_2xx" />
          </Form.Item>
          <Form.Item label="模块 YAML" name="content" rules={[{ required: true, message: '请输入模块 YAML' }]}>
            <Input.TextArea rows={18} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          {editing && (
            <Form.Item label="启用模块" name="enabled" valuePropName="checked" required>
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          )}
        </Form>
      </Drawer>
    </MainLayout>
  )
}

export default BlackboxModulesPage
