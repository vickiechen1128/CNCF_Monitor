import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Modal, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { getStoredUser } from '../../api/client'
import { inhibitionsApi } from '../../api/inhibitions'
import { EllipsisText } from '../../components/EllipsisText'
import { MainLayout } from '../../layouts/MainLayout'
import { PageIntro } from '../../components/PageIntro'
import type { InhibitionListData, InhibitionRule } from '../../types/alertmanager'
import { CONFIG_PREVIEW_PATH, formatMatchers } from './alertmanagerConstants'
import { InhibitionEditorDrawer } from './InhibitionEditorDrawer'

const { Text } = Typography

export function InhibitionsPage() {
  const [data, setData] = useState<InhibitionListData | null>(null)
  const [draft, setDraft] = useState<InhibitionRule[]>([])
  const [editing, setEditing] = useState(false)
  const [editingRule, setEditingRule] = useState<InhibitionRule | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<string | null>(null)
  const isAdmin = getStoredUser()?.role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await inhibitionsApi.list()
      setData(res.data)
      setDraft(res.data.items.map((item) => ({ ...item })))
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载抑制规则失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    inhibitionsApi.list()
      .then((res) => {
        if (cancelled) return
        setData(res.data)
        setDraft(res.data.items.map((item) => ({ ...item })))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载抑制规则失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(data?.items ?? []), [draft, data])
  const shownRules = editing ? draft : (data?.items ?? [])

  const enterEdit = () => {
    setDraft((data?.items ?? []).map((item) => ({ ...item })))
    setSubmitted(null)
    setEditing(true)
  }

  const leaveEdit = () => {
    setEditing(false)
    setDraft((data?.items ?? []).map((item) => ({ ...item })))
  }

  const discard = () => {
    if (!dirty) {
      leaveEdit()
      return
    }
    Modal.confirm({
      title: '放弃本次编辑？',
      content: '将丢弃尚未保存的抑制规则改动，当前配置不受影响。',
      okText: '放弃编辑',
      cancelText: '继续编辑',
      onOk: leaveEdit,
    })
  }

  const upsert = (rule: InhibitionRule) => {
    if (rule.id) {
      setDraft((items) => items.map((item) => item.id === rule.id ? rule : item))
    } else {
      setDraft((items) => [...items, { ...rule, id: `inhibit-new-${Date.now()}` }])
    }
    setDrawerOpen(false)
  }

  const save = async () => {
    for (const rule of draft) {
      if (!rule.source_matchers.length || !rule.target_matchers.length) {
        message.error('每条规则的源告警和目标告警匹配条件均不能为空')
        return
      }
    }
    setSaving(true)
    try {
      const res = await inhibitionsApi.save({ base_checksum: data?.effective_checksum ?? '', inhibit_rules: draft })
      const changeNo = res.data.change_no
      setSubmitted(changeNo ?? '已提交')
      message.success('抑制规则已提交变更')
      setEditing(false)
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<InhibitionRule> = [
    { title: '规则名称', dataIndex: 'name', width: 200, render: (name: string) => <EllipsisText>{name || '（未命名规则）'}</EllipsisText> },
    { title: '源告警匹配', dataIndex: 'source_matchers', render: (value: InhibitionRule['source_matchers']) => <EllipsisText>{formatMatchers(value)}</EllipsisText> },
    { title: '目标告警匹配', dataIndex: 'target_matchers', render: (value: InhibitionRule['target_matchers']) => <EllipsisText>{formatMatchers(value)}</EllipsisText> },
    { title: '等同标签', dataIndex: 'equal', width: 160, render: (value: string[]) => value.length ? value.join('、') : '—' },
    {
      title: '状态', dataIndex: 'enabled', width: 100,
      render: (enabled: boolean, record) => editing ? (
        <Switch
          checked={enabled}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={(checked) => setDraft((items) => items.map((item) => item.id === record.id ? { ...item, enabled: checked } : item))}
        />
      ) : <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag>,
    },
    ...(editing ? [{
      title: '操作', key: 'action', width: 130,
      render: (_: unknown, record: InhibitionRule) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} aria-label={`编辑-${record.name || record.id}`} onClick={() => { setEditingRule(record); setDrawerOpen(true) }} />
          <Button type="text" danger icon={<DeleteOutlined />} aria-label={`删除-${record.name || record.id}`} onClick={() => setDraft((items) => items.filter((item) => item.id !== record.id))} />
        </Space>
      ),
    }] : []),
  ]

  return (
    <MainLayout>
      <PageIntro
        testId="inhibitions-intro"
        title="告警抑制"
        subtitle="查看抑制规则；点「编辑抑制规则」后设置根因告警存在时要抑制哪些次生告警"
        points={[
          '一条规则包含：源告警匹配（根因）、目标告警匹配（被抑制对象）和等同标签。',
          '页面默认只读；保存会生成整份配置并提交变更单，确认下发后才会生效。',
        ]}
      />
      {submitted && (
        <Alert
          type="success"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          message="抑制规则变更已提交，等待确认下发"
          description={(
            <Space direction="vertical" size={2}>
              <span>改动尚未生效，需在「配置变更确认」中人工确认后才会写入并 reload Alertmanager。</span>
              <Link to={CONFIG_PREVIEW_PATH}>前往「配置变更确认」</Link>
            </Space>
          )}
          onClose={() => setSubmitted(null)}
        />
      )}
      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="告警抑制加载失败，请稍后重试"
          description={error}
          action={<Button size="small" onClick={() => void load()}>重新加载</Button>}
        />
      ) : (
        <>
          {data?.pending?.change_no && data.pending.inhibit_rules_changed !== false && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="当前显示的是待确认版本"
              description={(
                <Space direction="vertical" size={2}>
                  <span>变更单 {data.pending.change_no} 尚未确认下发，Alertmanager 仍在运行上一版配置。</span>
                  <Link to={CONFIG_PREVIEW_PATH}>前往「配置变更确认」</Link>
                </Space>
              )}
            />
          )}
          <Card
            title={(
              <Space size={8}>
                抑制规则列表
                {editing ? <Tag color="processing">可编辑</Tag> : <Tag>只读</Tag>}
                <Text type="secondary" style={{ fontSize: 12 }}>共 {shownRules.length} 条规则</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>根因告警存在时，自动抑制匹配的次生告警</Text>
              </Space>
            )}
            extra={isAdmin && (editing ? (
              <Space wrap>
                <Button type="primary" icon={<PlusOutlined />} aria-label="新建抑制规则" onClick={() => { setEditingRule(null); setDrawerOpen(true) }}>
                  新建抑制规则
                </Button>
                <Button type="primary" loading={saving} onClick={() => void save()}>保存并提交变更</Button>
                <Button onClick={discard}>放弃编辑</Button>
              </Space>
            ) : <Button type="primary" icon={<EditOutlined />} aria-label="编辑抑制规则" onClick={enterEdit}>编辑抑制规则</Button>)}
          >
            {editing && (
              <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                修改不会立即生效，保存并提交后需前往「配置变更确认」人工确认下发。
              </Text>
            )}
            <Table
              rowKey="id"
              columns={columns}
              dataSource={shownRules}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: '暂无抑制规则' }}
            />
          </Card>
        </>
      )}
      <InhibitionEditorDrawer open={drawerOpen} rule={editingRule} onCancel={() => setDrawerOpen(false)} onSubmit={upsert} />
    </MainLayout>
  )
}

export default InhibitionsPage
