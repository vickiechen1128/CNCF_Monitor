import { useState } from 'react'
import config from 'antd/locale/zh_CN'
import { MainLayout } from '../../../layouts/MainLayout'
import { EllipsisText } from '../../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { getStoredUser } from '../../../api/client'
import { userApi } from '../../../api/admin'
import type { UserItem, UserStatus } from '../../../types/admin'
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useUsers } from './useUsers'
import { UserFormModal } from './UserFormModal'
import { ResetPasswordModal } from './ResetPasswordModal'

/**
 * 用户管理列表页（Module_06 §6.3 / §11.1）。
 * 覆盖：加载骨架屏 / 空态「暂无用户」+新建引导 / 接口错误 Alert+重新加载。
 * 操作：新建（UserFormModal create）/ 编辑（UserFormModal edit）/ 禁用（二次确认 Modal.confirm）/
 * 启用（直接）/ 重置密码（ResetPasswordModal）。
 * 通用约定：不禁用当前登录用户（操作按钮禁用 + Tooltip 说明）。
 */
export function UsersPage() {
  const { data, loading, error, reload } = useUsers()

  const [formOpen, setFormOpen] = useState(false)
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create')
  const [editingUser, setEditingUser] = useState<UserItem | null>(null)
  const [passwordTarget, setPasswordTarget] = useState<UserItem | null>(null)
  const [targetingStatusId, setTargetingStatusId] = useState<string | null>(null)

  const current = getStoredUser()
  // 管理接口后端由 RequireAdmin 保护（admin-only）；普通用户即便进入本页也只读，
  // 隐藏全部管理操作（新建/编辑/重置密码/禁用/删除），仅展示列表。
  const isAdmin = current?.role === 'admin'

  const showCreate = () => {
    setFormMode('create')
    setEditingUser(null)
    setFormOpen(true)
  }

  const showEdit = (record: UserItem) => {
    setFormMode('edit')
    setEditingUser(record)
    setFormOpen(true)
  }

  const handleDisable = (record: UserItem) => {
    Modal.confirm({
      title: '禁用用户',
      content: `确定禁用用户「${record.username}」吗？禁用后该用户将无法登录，且已有会话立即失效。`,
      okText: '确认禁用',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await userApi.updateStatus(record.id, 'disabled')
          message.success('用户已禁用')
          reload()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '禁用失败，请稍后重试')
        }
      },
    })
  }

  const handleEnable = async (record: UserItem) => {
    setTargetingStatusId(record.id)
    try {
      await userApi.updateStatus(record.id, 'active')
      message.success('用户已启用')
      reload()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '启用失败，请稍后重试')
    } finally {
      setTargetingStatusId(null)
    }
  }

  const handleDelete = (record: UserItem) => {
    Modal.confirm({
      title: '删除用户',
      content: `确定删除用户「${record.username}」吗？删除后该账号及其登录会话将全部注销，记录按软删除留存以便审计。`,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await userApi.remove(record.id)
          message.success('用户已删除')
          reload()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '删除失败，请稍后重试')
        }
      },
    })
  }

  const isCurrentUser = (record: UserItem) => current?.id != null && current.id === record.id

  const columns: ColumnsType<UserItem> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 180,
      ellipsis: { showTitle: true },
      fixed: 'left',
      render: (username: string) => <EllipsisText>{username}</EllipsisText>,
    },
    {
      title: '显示名称',
      dataIndex: 'display_name',
      key: 'display_name',
      width: 200,
      render: (name: string) => <EllipsisText>{name}</EllipsisText>,
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 110,
      render: (role?: string) =>
        role === 'admin' ? <Tag color="#FA8C16">管理员</Tag> : <Tag color="#86909C">普通用户</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: UserStatus) =>
        status === 'active' ? <Tag color="#00B578">启用</Tag> : <Tag color="#86909C">禁用</Tag>,
    },
    {
      title: '最近登录时间',
      dataIndex: 'last_login_at',
      key: 'last_login_at',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
    },
    {
      title: '操作',
      key: 'action',
      width: 216,
      fixed: 'right',
      render: (_: unknown, record: UserItem) =>
        !isAdmin ? (
          <span className="text-muted">仅管理员可操作</span>
        ) : (
          <Space size={8}>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => showEdit(record)}>
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              icon={<KeyOutlined />}
              onClick={() => setPasswordTarget(record)}
            >
              重置密码
            </Button>
            {isCurrentUser(record) ? (
              <Tooltip title="不能禁用当前登录用户">
                <Button type="link" size="small" danger disabled icon={<StopOutlined />}>
                  禁用
                </Button>
              </Tooltip>
            ) : record.status === 'active' ? (
              <Button
                type="link"
                size="small"
                danger
                icon={<StopOutlined />}
                onClick={() => handleDisable(record)}
              >
                禁用
              </Button>
            ) : (
              <Button
                type="link"
                size="small"
                loading={targetingStatusId === record.id}
                icon={<CheckCircleOutlined />}
                onClick={() => handleEnable(record)}
              >
                启用
              </Button>
            )}
            {!isCurrentUser(record) && record.role === 'user' && (
              <Button
                type="link"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(record)}
              >
                删除
              </Button>
            )}
          </Space>
        ),
    },
  ]

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          extra={
            isAdmin && (
              <Button type="primary" icon={<PlusOutlined />} onClick={showCreate}>
                新建用户
              </Button>
            )
          }
        >
          {error && (
            <Alert
              type="error"
              showIcon
              message="用户列表加载失败，请稍后重试"
              description={error}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={reload}>
                  重新加载
                </Button>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          <Table<UserItem>
            rowKey="id"
            dataSource={data.items}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            locale={{
              emptyText: (
                <Empty description="暂无用户">
                  {isAdmin && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={showCreate}>
                      新建用户
                    </Button>
                  )}
                </Empty>
              ),
            }}
            pagination={{
              ...TABLE_PAGINATION,
              total: data.total,
            }}
          />

          <UserFormModal
            open={formOpen}
            mode={formMode}
            user={editingUser}
            onCancel={() => setFormOpen(false)}
            onSuccess={reload}
          />
          <ResetPasswordModal
            open={passwordTarget !== null}
            user={passwordTarget}
            onCancel={() => setPasswordTarget(null)}
            onSuccess={reload}
          />
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default UsersPage