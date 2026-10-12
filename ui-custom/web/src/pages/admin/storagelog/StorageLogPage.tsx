import { useCallback, useEffect, useState } from 'react'
import config from 'antd/locale/zh_CN'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Descriptions,
  Form,
  Input,
  Progress,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../../layouts/MainLayout'
import { EllipsisText } from '../../../components/EllipsisText'
import { storageLogApi } from '../../../api/storage'
import type { DiskInfo, StorageLogOverview } from '../../../types/storage'

/** 字节数人类可读格式化（1024 进制，保留 1 位小数）。 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let idx = 0
  let v = bytes
  while (v >= 1024 && idx < units.length - 1) {
    v /= 1024
    idx += 1
  }
  return `${v >= 100 || idx === 0 ? Math.round(v) : v.toFixed(1)} ${units[idx]}`
}

/** 日志轮转机制中文映射。 */
const MECHANISM_LABELS: Record<string, string> = {
  logrotate: 'logrotate',
  journald: 'journald',
  none: '未配置',
}

/**
 * M06「存储与日志管理」页（F-41）：
 * ① TSDB 保留策略前台化：读写期望值（写 prom-retention.env），与运行时 flags 归一化
 *    比对展示「待重启生效」——Prometheus 不支持 retention 热更新，reload 只覆盖
 *    prometheus.yml，故只给运维重启指引，**不做平台越权重启按钮**（决策 64 职责分离）；
 * ② TSDB / 日志目录磁盘占用只读展示；
 * ③ 运行日志轮转策略展示（logrotate/journald，免重启，与 TSDB 保留策略分开展示）。
 */
export function StorageLogPage() {
  const [overview, setOverview] = useState<StorageLogOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form] = Form.useForm<{ time: string; size: string }>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await storageLogApi.overview()
      const data = res.data ?? null
      setOverview(data)
      if (data?.retention.desired) {
        form.setFieldsValue({
          time: data.retention.desired.time,
          size: data.retention.desired.size,
        })
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '存储与日志信息加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [form])

  useEffect(() => {
    // 异步请求回调内 setState；沿用本仓库既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const handleSave = useCallback(
    async (values: { time: string; size: string }) => {
      setSaving(true)
      try {
        const res = await storageLogApi.updateRetention(values)
        const data = res.data ?? null
        setOverview(data)
        if (data?.retention.pending_restart) {
          message.success('保留策略已保存，重启 Prometheus 后生效')
        } else if (data?.retention.runtime_available) {
          message.success('保留策略已保存，与当前运行值一致，无需重启')
        } else {
          message.success('保留策略已保存，待 Prometheus 可用后比对生效状态')
        }
      } catch (e) {
        message.error(e instanceof Error ? e.message : '保存失败，请稍后重试')
      } finally {
        setSaving(false)
      }
    },
    [],
  )

  const ret = overview?.retention
  const pending = !!ret?.pending_restart

  const diskColumns: ColumnsType<DiskInfo> = [
    {
      title: '目录',
      dataIndex: 'label',
      key: 'label',
      width: 150,
    },
    {
      title: '路径',
      dataIndex: 'path',
      key: 'path',
      width: 320,
      render: (v?: string) => (v ? <EllipsisText>{v}</EllipsisText> : '-'),
    },
    {
      title: '已用',
      dataIndex: 'used_bytes',
      key: 'used_bytes',
      width: 110,
      render: (v: number, row) => (row.error ? '-' : formatBytes(v)),
    },
    {
      title: '可用',
      dataIndex: 'free_bytes',
      key: 'free_bytes',
      width: 110,
      render: (v: number, row) => (row.error ? '-' : formatBytes(v)),
    },
    {
      title: '总量',
      dataIndex: 'total_bytes',
      key: 'total_bytes',
      width: 110,
      render: (v: number, row) => (row.error ? '-' : formatBytes(v)),
    },
    {
      title: '使用率',
      dataIndex: 'usage_percent',
      key: 'usage_percent',
      width: 180,
      render: (v: number, row) => {
        if (row.error) return <span style={{ color: '#999' }}>{row.error}</span>
        const percent = Math.round(v)
        return (
          <Progress
            percent={percent}
            size="small"
            status={percent >= 90 ? 'exception' : percent >= 75 ? 'active' : 'normal'}
          />
        )
      },
    },
  ]

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title="存储与日志管理"
          loading={loading}
          extra={
            <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          }
        >
          {error && (
            <Alert
              type="error"
              showIcon
              message="存储与日志信息加载失败，请稍后重试"
              description={error}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
                  重新加载
                </Button>
              }
              style={{ marginBottom: 16 }}
            />
          )}

          {/* ① TSDB 保留策略：期望值 vs 运行时值 */}
          <Card
            type="inner"
            title="TSDB 保留策略"
            style={{ marginBottom: 16 }}
            extra={
              ret && (
                <Space size="small">
                  {ret.pending_restart && <Tag color="orange">待重启生效</Tag>}
                  {ret.runtime_available && !ret.pending_restart && <Tag color="green">已生效</Tag>}
                  {!ret.runtime_available && <Tag>运行时未知</Tag>}
                </Space>
              )
            }
          >
            {pending && (
              <Alert
                type="warning"
                showIcon
                message="保留策略已保存，待重启 Prometheus 生效"
                description={
                  <div>
                    <p style={{ margin: '0 0 8px' }}>
                      Prometheus 不支持保留策略热更新（--web.enable-lifecycle reload 只覆盖
                      prometheus.yml），需重启 Prometheus 进程后新策略才生效。
                    </p>
                    <p style={{ margin: '0 0 8px' }}>
                      <b>运维指引：</b>生产环境执行 <code>systemctl restart prometheus</code>
                      （一体化交付包执行包内 stop.sh 后再 start.sh）；开发环境重启
                      <code> make run-prometheus</code>。
                    </p>
                    <p style={{ margin: 0 }}>
                      <b>变更影响：</b>重启窗口内边缘数据由 vmagent 持久化队列补发、不丢失；中心查询短暂不可用；M09
                      采集节点「回传延迟」列会短时变橙，恢复采集后自动回落，属预期现象。
                    </p>
                  </div>
                }
                style={{ marginBottom: 16 }}
              />
            )}
            {ret && !ret.runtime_available && (
              <Alert
                type="info"
                showIcon
                message="当前无法读取 Prometheus 运行时参数"
                description="中心 Prometheus 未运行或不可达，下方展示的是期望值（env 文件 / 启动默认），待其恢复后自动完成比对。"
                style={{ marginBottom: 16 }}
              />
            )}
            <Form
              form={form}
              layout="horizontal"
              labelCol={{ span: 3 }}
              wrapperCol={{ span: 10 }}
              onFinish={(values) => void handleSave(values)}
            >
              <Form.Item
                label="保留时长"
                name="time"
                rules={[{ required: true, message: '请输入保留时长' }]}
                extra="Prometheus duration 单位序列，如 15d / 30d / 1h30m；与保留容量双重兜底，任一触发即淘汰最旧块"
              >
                <Input placeholder="15d" allowClear />
              </Form.Item>
              <Form.Item
                label="保留容量"
                name="size"
                rules={[{ required: true, message: '请输入保留容量' }]}
                extra="整数 + 单位（B/KB/MB/GB/TB），如 10GB；按 1024 进制折算"
              >
                <Input placeholder="10GB" allowClear />
              </Form.Item>
              <Form.Item label=" " colon={false}>
                <Space>
                  <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
                    保存
                  </Button>
                  <span style={{ color: '#888', fontSize: 12 }}>
                    保存仅写入配置文件，不重启任何进程；生效状态见上方提示
                  </span>
                </Space>
              </Form.Item>
            </Form>
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }} bordered>
              <Descriptions.Item label="期望值">
                {ret?.desired ? `${ret.desired.time} / ${ret.desired.size}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="运行时值">
                {ret?.runtime ? `${ret.runtime.time} / ${ret.runtime.size}` : '不可用'}
              </Descriptions.Item>
              <Descriptions.Item label="值来源">
                {ret?.source === 'env_file' ? '配置文件（页面保存）' : '启动默认值'}
              </Descriptions.Item>
              <Descriptions.Item label="配置文件" span={3}>
                <EllipsisText>{ret?.env_file ?? '-'}</EllipsisText>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* ② 磁盘占用（只读） */}
          <Card type="inner" title="磁盘占用（只读）" style={{ marginBottom: 16 }}>
            <Table<DiskInfo>
              rowKey="label"
              dataSource={overview?.disks ?? []}
              columns={diskColumns}
              size="small"
              pagination={false}
              locale={{ emptyText: '暂无可展示的目录（Prometheus 未运行且未配置日志目录）' }}
            />
          </Card>

          {/* ③ 运行日志轮转策略（免重启，与 TSDB 保留策略分开展示） */}
          <Card type="inner" title="运行日志轮转策略">
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="轮转机制">
                <Space>
                  <Tag
                    color={
                      overview?.log_rotation.mechanism === 'logrotate'
                        ? 'blue'
                        : overview?.log_rotation.mechanism === 'journald'
                          ? 'purple'
                          : 'default'
                    }
                  >
                    {MECHANISM_LABELS[overview?.log_rotation.mechanism ?? 'none']}
                  </Tag>
                  {overview?.log_rotation.active ? (
                    <Badge status="success" text="已生效" />
                  ) : (
                    <Badge status="warning" text="未生效" />
                  )}
                </Space>
              </Descriptions.Item>
              {overview?.log_rotation.config_path && (
                <Descriptions.Item label="配置路径">
                  <EllipsisText>{overview.log_rotation.config_path}</EllipsisText>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="策略说明">
                {overview?.log_rotation.summary ?? '-'}
              </Descriptions.Item>
              {overview?.log_rotation.content && (
                <Descriptions.Item label="配置内容">
                  <EllipsisText>{overview.log_rotation.content}</EllipsisText>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default StorageLogPage
