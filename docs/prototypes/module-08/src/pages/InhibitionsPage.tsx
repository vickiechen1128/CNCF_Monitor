import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { type InhibitionRule, type Matcher, mockInhibitions } from '../mocks/module-08'

const { Text } = Typography

function formatMatchers(matchers: Matcher[]): string {
  return matchers.map((m) => `${m.name}${m.isRegex ? '=~' : '='}"${m.value}"`).join(' 且 ')
}

/** 抑制范围设计建议（PRD 5.3）：哪些告警建议 inhibitable=true */
const inhibitableSuggestions = [
  { alertType: '目标不可达 / 服务宕机', inhibitable: '是', example: 'up == 0、probe_success == 0' },
  { alertType: '网络连接失败', inhibitable: '是', example: 'prometheus_target_scrape_exceeded_sample_limit' },
  { alertType: '资源使用率高', inhibitable: '否', example: 'disk_full、cpu_high、memory_high' },
  { alertType: '业务自定义告警', inhibitable: '否', example: '应用层 SLA 告警' },
]

export default function InhibitionsPage() {
  const [rules, setRules] = useState<InhibitionRule[]>(mockInhibitions)
  const [editing, setEditing] = useState<InhibitionRule | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form] = Form.useForm()

  const builtinRules = useMemo(() => rules.filter((r) => r.is_builtin), [rules])
  const manualRules = useMemo(() => rules.filter((r) => !r.is_builtin), [rules])

  const columns = [
    {
      title: '规则名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, record: InhibitionRule) => (
        <Space>
          <Text strong>{name}</Text>
          {record.is_builtin && <Tag color="gold">内置（自动生成）</Tag>}
        </Space>
      ),
    },
    {
      title: '源告警（Source）',
      dataIndex: 'source_matchers',
      key: 'source',
      width: 240,
      render: (matchers: Matcher[]) => <Typography.Text code>{formatMatchers(matchers)}</Typography.Text>,
    },
    {
      title: '目标告警（Target）',
      dataIndex: 'target_matchers',
      key: 'target',
      width: 260,
      render: (matchers: Matcher[]) => <Typography.Text code>{formatMatchers(matchers)}</Typography.Text>,
    },
    {
      title: '等同标签（equal）',
      dataIndex: 'equal',
      key: 'equal',
      render: (keys: string[]) =>
        keys.map((k) => (
          <Tag key={k} color="geekblue">
            {k}
          </Tag>
        )),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 70,
      render: (enabled: boolean, record: InhibitionRule) => (
        <Switch
          checked={enabled}
          onChange={(checked) => {
            setRules((prev) => prev.map((r) => (r.id === record.id ? { ...r, enabled: checked } : r)))
            message.success('抑制规则已更新并触发 Alertmanager reload')
          }}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: InhibitionRule) =>
        record.is_builtin ? (
          <Tooltip title="内置规则由平台自动生成（网域离线场景），可在「说明」中查看生成逻辑">
            <Text type="secondary">仅可启停</Text>
          </Tooltip>
        ) : (
          <Space size={0}>
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditor(record)}>
              编辑
            </Button>
            <Popconfirm title="删除该抑制规则？" onConfirm={() => handleDelete(record.id)}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
    },
  ]

  function openEditor(record: InhibitionRule) {
    setEditing(record)
    form.setFieldsValue({
      name: record.name,
      source_matchers: record.source_matchers.map((m) => ({ ...m })),
      target_matchers: record.target_matchers.map((m) => ({ ...m })),
      equal: record.equal,
      enabled: record.enabled,
      description: record.description,
    })
    setIsModalOpen(true)
  }

  function handleOpenModal() {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      source_matchers: [],
      target_matchers: [],
      equal: [],
      enabled: true,
    })
    setIsModalOpen(true)
  }

  function handleDelete(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id))
    message.success('抑制规则已删除，alertmanager.yml 已重新生成并 reload')
  }

  function handleOk() {
    form
      .validateFields()
      .then((values) => {
        const base = {
          name: values.name as string,
          source_matchers: (values.source_matchers ?? []) as Matcher[],
          target_matchers: (values.target_matchers ?? []) as Matcher[],
          equal: (values.equal ?? []) as string[],
          enabled: values.enabled as boolean,
          description: (values.description as string) || '',
        }
        if (editing) {
          const updated: InhibitionRule = { ...editing, ...base }
          setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
          message.success(`抑制规则「${updated.name}」已更新，alertmanager.yml 已重新生成并 reload`)
        } else {
          const created: InhibitionRule = {
            id: `in-${Date.now()}`,
            is_builtin: false,
            ...base,
          }
          setRules((prev) => [...prev, created])
          message.success(`抑制规则「${created.name}」已创建，alertmanager.yml 已重新生成并 reload`)
        }
        setIsModalOpen(false)
      })
      .catch(() => {
        // 表单校验失败
      })
  }

  /** 内置规则生成逻辑说明（PRD 5.3）：源告警 EdgeSiteOffline 抑制同网域 inhibitable=true 的目标告警 */
  function renderBuiltinDetail(rule: InhibitionRule) {
    return (
      <Descriptions bordered size="small" column={{ xs: 1, md: 3 }}>
        <Descriptions.Item label="触发时机">
          边缘 Agent 失联超过阈值（默认 5 分钟）触发 EdgeSiteOffline 根因告警时
        </Descriptions.Item>
        <Descriptions.Item label="源告警">
          <Typography.Text code>{formatMatchers(rule.source_matchers)}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="等同标签">
          {rule.equal.map((k) => (
            <Tag key={k} color="geekblue">
              {k}
            </Tag>
          ))}
        </Descriptions.Item>
        <Descriptions.Item label="目标告警" span={3}>
          <Typography.Text code>{formatMatchers(rule.target_matchers)}</Typography.Text>
        </Descriptions.Item>
        <Descriptions.Item label="生成说明" span={3}>
          <Text>{rule.description}</Text>
        </Descriptions.Item>
      </Descriptions>
    )
  }

  return (
    <MainLayout>
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>
          告警抑制
        </Typography.Title>
        <Text type="secondary">
          当根因告警存在时，自动抑制相关次生告警，避免网域离线等场景下的告警风暴
        </Text>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="抑制规则如何工作"
        description={
          <span>
            当<Text strong>源告警</Text>（如 EdgeSiteOffline）存在时，Alertmanager 自动抑制满足
            <Text strong>目标告警</Text>匹配条件且{' '}
            <Text strong>等同标签（equal）</Text>相同的次生告警——只保留根因告警的通知。
            `inhibitable` 字段来自 Module_01 的规则编辑（MonitoringRule labels / annotations 约定），
            M08 生成 inhibit_rules 时消费该字段。
          </span>
        }
      />

      <Card
        className="page-card"
        title={
          <Space size={8}>
            内置抑制规则（平台自动生成）
            <Tag color="gold">P0</Tag>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        {builtinRules.map((rule) => (
          <Card
            key={rule.id}
            size="small"
            title={
              <Space>
                {rule.name}
                <Switch
                  checked={rule.enabled}
                  size="small"
                  onChange={(checked) => {
                    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: checked } : r)))
                    message.success('内置抑制规则已更新并触发 Alertmanager reload')
                  }}
                />
              </Space>
            }
            style={{ marginBottom: 12 }}
          >
            {renderBuiltinDetail(rule)}
          </Card>
        ))}
      </Card>

      <Card
        className="page-card"
        title={
          <Space size={8}>
            手动抑制规则
            <Tag>P2 / 可调整</Tag>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenModal}>
            新建抑制规则
          </Button>
          <Table
            rowKey="id"
            dataSource={manualRules}
            columns={columns}
            pagination={false}
            size="middle"
          />
        </Space>
      </Card>

      <Card
        className="page-card"
        title="抑制范围设计建议（哪些告警建议 inhibitable=true）"
        size="small"
      >
        <Table
          rowKey="alertType"
          dataSource={inhibitableSuggestions}
          pagination={false}
          size="small"
          columns={[
            { title: '告警类型', dataIndex: 'alertType', key: 'alertType' },
            {
              title: 'inhibitable 建议',
              dataIndex: 'inhibitable',
              key: 'inhibitable',
              width: 120,
              render: (v: string) =>
                v === '是' ? <Tag color="success">true</Tag> : <Tag>false</Tag>,
            },
            { title: '示例', dataIndex: 'example', key: 'example' },
          ]}
        />
      </Card>

      <Modal
        title={editing ? '编辑抑制规则' : '新建抑制规则'}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label="规则名称"
            rules={[{ required: true, message: '请输入规则名称' }]}
          >
            <Input placeholder="如：拨测失败抑制同目标可达性告警" />
          </Form.Item>

          <Form.Item label="源告警匹配（Source：触发抑制的根因告警）">
            <Form.List name="source_matchers">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        rules={[{ required: true, message: '标签名' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="标签名，如 alertname" style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'value']}
                        rules={[{ required: true, message: '值' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="值，如 EdgeSiteOffline" style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'isRegex']}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Checkbox>正则</Checkbox>
                      </Form.Item>
                      <Button
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(name)}
                      />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({ name: '', value: '', isRegex: false })}
                    block
                    icon={<PlusOutlined />}
                  >
                    添加源告警匹配
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>

          <Form.Item label="目标告警匹配（Target：被抑制的次生告警）">
            <Form.List name="target_matchers">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        rules={[{ required: true, message: '标签名' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="标签名，如 inhibitable" style={{ width: 180 }} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'value']}
                        rules={[{ required: true, message: '值' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="值，如 true" style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'isRegex']}
                        valuePropName="checked"
                        style={{ marginBottom: 0 }}
                      >
                        <Checkbox>正则</Checkbox>
                      </Form.Item>
                      <Button
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(name)}
                      />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({ name: '', value: '', isRegex: false })}
                    block
                    icon={<PlusOutlined />}
                  >
                    添加目标告警匹配
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>

          <Form.Item name="equal" label="等同标签（equal：源与目标必须相同的标签键）">
            <Select
              mode="tags"
              placeholder="输入标签键后回车，如 network_domain"
              tokenSeparators={[',']}
            />
          </Form.Item>
          <Form.Item name="description" label="规则说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </MainLayout>
  )
}
