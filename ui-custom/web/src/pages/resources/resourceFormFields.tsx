/**
 * 资源表单字段渲染（Module_07 §5.2 共享字段 + §5.6~§5.9 六类差异化字段）。
 *
 * 从 `ResourceFormDrawer.tsx` 抽出的**纯渲染函数**（非组件）：以「函数 + 上下文参数」形式
 * 保持原有渲染时序与闭包语义，不引入 hooks / memo，避免改变 Drawer 的挂载与回显行为。
 * 表单值 ↔ 请求体映射见 `resourceFormMappers.ts`。
 */
import type { ReactNode } from 'react'
import { AutoComplete, Col, DatePicker, Form, Input, InputNumber, Row, Select, Typography } from 'antd'
import type { FormInstance } from 'antd'
import type { NetworkDomain } from '../../types/domain'
import type {
  ApplicationDict,
  BusinessDomain,
  OSOption,
  PlatformDict,
  ResourceCategory,
  ResourceStatus,
} from '../../types/resource'
import { ENV_VALUES } from './resourceFormMappers'

/** 运行状态取值（§5.2 / §8.1，UI 展示名「运行状态」；孤儿为后续版本预留不入选） */
const STATUS_OPTIONS: { value: ResourceStatus; label: string }[] = [
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'maintenance', label: '维护中' },
]

/** 数据库类型下拉（§5.7.1 database_type 合法值） */
const DATABASE_TYPE_OPTIONS = ['mysql', 'redis', 'postgresql', 'oracle', 'dm8', 'sqlserver', 'mongodb']

/** 中间件类型下拉（§5.7 middleware_type；mysql/redis 已移入 database_type） */
const MIDDLEWARE_TYPE_OPTIONS = ['kafka', 'elasticsearch', 'nginx', 'zookeeper', 'rabbitmq', 'rocketmq']

/** 其他监控目标采集协议（§5.9 scheme，默认 http） */
const SCHEME_OPTIONS = ['http', 'https']

/** 操作系统家族展示名（os_dict.go：linux / windows） */
const OS_FAMILY_LABEL: Record<string, string> = {
  linux: 'Linux',
  windows: 'Windows',
}

/** IPv4 地址校验（§5.16.2 IP 格式） */
const IPV4_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** 主机名 / 域名校验（generic_target 的 instance_ip 支持 IP 或域名，§5.9） */
const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

/** IPv4 必填校验规则（§5.16.2） */
const requiredIpRules = [
  { required: true, message: '请输入 IP 地址' },
  { pattern: IPV4_RE, message: '请输入合法的 IPv4 地址' },
]

/** generic_target 的 instance_ip 支持 IP 或域名（§5.9） */
const requiredIpOrHostnameRules = [
  { required: true, message: '请输入目标 IP 或域名' },
  {
    validator: (_: unknown, value?: string) => {
      if (!value) return Promise.resolve()
      return IPV4_RE.test(value) || HOSTNAME_RE.test(value)
        ? Promise.resolve()
        : Promise.reject(new Error('请输入合法的 IPv4 地址或域名'))
    },
  },
]

/** 端口校验（1-65535，§5.16） */
const portRules = [
  { required: true, message: '请输入端口' },
  { type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' },
]

/** 可选端口校验（应用服务/其他监控目标，port 非必填） */
export const optionalPortRules = [{ type: 'number' as const, min: 1, max: 65535, message: '端口范围为 1-65535' }]

/** blackbox 拨测 URL：必填，且必须是含主机的 http/https/tcp URL。 */
const healthCheckUrlRules = [
  { required: true, message: '请输入健康检查 URL' },
  {
    validator: (_: unknown, value?: string) => {
      if (!value || !value.trim()) return Promise.resolve()
      let parsed: URL
      try {
        parsed = new URL(value.trim())
      } catch {
        return Promise.reject(new Error('请输入合法的 http/https 地址'))
      }
      const scheme = parsed.protocol.replace(/:$/, '')
      if (!['http', 'https', 'tcp'].includes(scheme) || !parsed.hostname) {
        return Promise.reject(new Error('请输入合法的 http/https 地址'))
      }
      return Promise.resolve()
    },
  },
]

/**
 * 字段渲染上下文：由 Drawer 容器按当前表单状态组装，渲染函数只读取、不触发请求。
 * `form` 保留给字段级联动（当前字段无需直接调用实例方法），与抽屉共享同一 `FormInstance`。
 */
export interface ResourceFormFieldsContext {
  form: FormInstance
  category: ResourceCategory
  networkDomains: NetworkDomain[]
  enabledBizDomains: BusinessDomain[]
  enabledAppDicts: ApplicationDict[]
  enabledPlatformDicts: PlatformDict[]
  selectedPlatformCode?: string
  legacyEnv?: string
  appCodeRequired: boolean
  clusterRequired: boolean
  osOptions: OSOption[]
  handlePlatformChange: () => void
  /** host / database / middleware 共用的「采集端口（选填）」表单项（由 Drawer 构造） */
  scrapePortField: ReactNode
}

/**
 * 六类资源共享字段（§5.2 公共字段）。两列紧凑布局，避免单列留白。
 * 行序：网域 /（平台归属｜环境）→ 业务 / 应用 →（环境｜运行状态）/（运行状态｜集群）→（集群 / 负责人｜负责人满宽）。
 * 「业务」与「应用」固定在**同一行**靠拢；「平台归属」仅对接口服务以外的类别渲染
 * （接口服务由 blackbox 拨测承载、无平台归属概念，后端 Excel 导入模板亦不含 platform_code 列）。
 * 平台归属仍排在「应用」之前，保留「平台 → 应用」级联（选中平台后应用下拉按平台过滤）。
 */
export function renderResourceSharedFields(ctx: ResourceFormFieldsContext): ReactNode {
  const {
    category,
    networkDomains,
    enabledBizDomains,
    enabledAppDicts,
    enabledPlatformDicts,
    selectedPlatformCode,
    legacyEnv,
    appCodeRequired,
    clusterRequired,
    handlePlatformChange,
  } = ctx
  const isInterface = category === 'interface_service'
  return (
    <>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="网域" name="network_domain_id" rules={[{ required: true, message: '请选择网域' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择网域">
              {networkDomains.map((d) => (
                <Select.Option key={d.id} value={d.id} label={`${d.name} (${d.id})`}>
                  {d.name} ({d.id})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* 接口服务无平台归属：该格换为「环境」，使两列填满（0 留白） */}
          {isInterface ? (
            <Form.Item
              label="环境"
              name="env"
              rules={[{ required: true, message: '请选择环境' }]}
              extra={legacyEnv ? `原环境「${legacyEnv}」已停用，请重新选择` : undefined}
            >
              <Select placeholder="请选择环境">
                {ENV_VALUES.map((e) => (
                  <Select.Option key={e} value={e}>
                    {e}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : (
            <Form.Item
              label="平台归属"
              name="platform_code"
              extra="可选：取平台字典启用条目；留空则按所属应用的主平台兜底"
            >
              <Select
                showSearch
                optionFilterProp="label"
                allowClear
                placeholder="请选择平台归属（可选）"
                onChange={handlePlatformChange}
              >
                {enabledPlatformDicts.map((d) => (
                  <Select.Option key={d.platform_code} value={d.platform_code} label={`${d.platform_name} (${d.platform_code})`}>
                    {d.platform_name} ({d.platform_code})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            label="业务"
            name="biz_code"
            extra="仅启用业务可选；停用业务不可选"
            rules={[{ required: true, message: '请选择业务' }]}
          >
            <Select showSearch optionFilterProp="label" placeholder="请选择业务">
              {enabledBizDomains.map((d) => (
                <Select.Option key={d.code} value={d.code} label={`${d.name} (${d.code})`}>
                  {d.name} ({d.code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* 应用与「业务」同排靠拢 */}
          <Form.Item
            label="应用"
            name="app_code"
            extra={
              selectedPlatformCode
                ? '仅列出关联到所选平台的应用；`app` 标签取编码，展示名由字典解析'
                : '取应用字典启用条目；`app` 标签取编码，展示名由字典解析'
            }
            rules={appCodeRequired ? [{ required: true, message: '请选择应用' }] : []}
          >
            <Select showSearch optionFilterProp="label" placeholder={appCodeRequired ? '请选择应用' : '请选择应用（可选）'} allowClear>
              {enabledAppDicts.map((d) => (
                <Select.Option key={d.app_code} value={d.app_code} label={`${d.app_name} (${d.app_code})`}>
                  {d.app_name} ({d.app_code})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
          {/* 非接口：环境；接口：运行状态（因环境已上移到首行） */}
          {isInterface ? (
            <Form.Item label="运行状态" name="status" rules={[{ required: true, message: '请选择运行状态' }]}>
              <Select placeholder="请选择运行状态">
                {STATUS_OPTIONS.map((s) => (
                  <Select.Option key={s.value} value={s.value}>
                    {s.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : (
            <Form.Item
              label="环境"
              name="env"
              rules={[{ required: true, message: '请选择环境' }]}
              extra={legacyEnv ? `原环境「${legacyEnv}」已停用，请重新选择` : undefined}
            >
              <Select placeholder="请选择环境">
                {ENV_VALUES.map((e) => (
                  <Select.Option key={e} value={e}>
                    {e}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
        </Col>
        <Col span={12}>
          {/* 非接口：运行状态；接口：集群（因运行状态已上移） */}
          {isInterface ? (
            <Form.Item
              label="集群"
              name="cluster"
              rules={clusterRequired ? [{ required: true, message: '请填写集群' }] : []}
            >
              <Input placeholder={clusterRequired ? '请填写集群' : '集群名（可选）'} maxLength={64} />
            </Form.Item>
          ) : (
            <Form.Item label="运行状态" name="status" rules={[{ required: true, message: '请选择运行状态' }]}>
              <Select placeholder="请选择运行状态">
                {STATUS_OPTIONS.map((s) => (
                  <Select.Option key={s.value} value={s.value}>
                    {s.label}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
        </Col>
      </Row>
      {isInterface ? (
        /* 接口服务共 6 个网格字段，末行「负责人」满宽，整体 0 留白 */
        <Form.Item label="负责人" name="owner">
          <Input placeholder="负责人（可选）" maxLength={32} />
        </Form.Item>
      ) : (
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="集群"
              name="cluster"
              rules={clusterRequired ? [{ required: true, message: '请填写集群' }] : []}
            >
              <Input placeholder={clusterRequired ? '请填写集群' : '集群名（可选）'} maxLength={64} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="负责人" name="owner">
              <Input placeholder="负责人（可选）" maxLength={32} />
            </Form.Item>
          </Col>
        </Row>
      )}
    </>
  )
}

/** 各资源类别差异化字段（与 §5.6~§5.9 字段表一致，标签用 PRD「UI 展示名」） */
export function renderResourceTypeFields(ctx: ResourceFormFieldsContext): ReactNode {
  const { category, osOptions, scrapePortField } = ctx
  switch (category) {
    case 'host':
      return (
        <>
          {/* v3 host 的 attributes.hostname 是唯一主机名来源，页面以「实例名」承载，不再单独渲染主机名 */}
          <Form.Item label="实例名" name="instance_name" rules={[{ required: true, message: '请输入实例名' }]}>
            <Input placeholder="例如：prod-web-01" maxLength={128} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="IP 地址" name="instance_ip" rules={requiredIpRules}>
                <Input placeholder="例如：10.0.1.11" maxLength={15} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="操作系统"
                name="os_type"
                extra="按内置字典选择或输入常用操作系统名；采集 Job 将按 Linux/Windows 家族匹配"
                rules={[{ required: true, message: '请输入操作系统' }]}
              >
                <AutoComplete
                  placeholder="请选择或输入操作系统，例如：Ubuntu"
                  options={osOptions.map((o) => ({
                    value: o.name,
                    label: `${o.name}（${OS_FAMILY_LABEL[o.family] ?? o.family}）`,
                  }))}
                  // 未选中字典项时允许自定义输入（保留原值，由后端 NormalizeOSType 兜底家族）
                  filterOption={(input, option) =>
                    (option?.value as string).toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>{scrapePortField}</Col>
            <Col span={12}>
              <Form.Item label="开通时间" name="activated_at">
                <DatePicker
                  style={{ width: '100%' }}
                  showTime
                  format="YYYY-MM-DD HH:mm"
                  placeholder="选择开通时间（可选）"
                />
              </Form.Item>
            </Col>
          </Row>
        </>
      )
    case 'database':
      return (
        <>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="数据库类型"
                name="database_type"
                rules={[{ required: true, message: '请选择数据库类型' }]}
              >
                <Select placeholder="请选择数据库类型" showSearch optionFilterProp="label">
                  {DATABASE_TYPE_OPTIONS.map((t) => (
                    <Select.Option key={t} value={t} label={t}>
                      {t}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="版本" name="version">
                <Input placeholder="版本（可选）" maxLength={32} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="IP 地址" name="instance_ip" rules={requiredIpRules}>
                <Input placeholder="例如：10.0.1.21" maxLength={15} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="端口" name="port" rules={portRules}>
                <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：3306" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>{scrapePortField}</Col>
          </Row>
        </>
      )
    case 'middleware':
      return (
        <>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="中间件类型"
                name="middleware_type"
                rules={[{ required: true, message: '请选择中间件类型' }]}
              >
                <Select placeholder="请选择中间件类型" showSearch optionFilterProp="label">
                  {MIDDLEWARE_TYPE_OPTIONS.map((t) => (
                    <Select.Option key={t} value={t} label={t}>
                      {t}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="版本" name="version">
                <Input placeholder="版本（可选）" maxLength={32} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="IP 地址" name="instance_ip" rules={requiredIpRules}>
                <Input placeholder="例如：10.0.1.31" maxLength={15} />
              </Form.Item>
            </Col>
            <Col span={12}>
              {/* 端口是中间件实例身份的一部分（与 instance_ip 共同构成采集目标 `ip:port`），
                  data-testid 供测试精确定位——label 文案「端口」在 host 表单不渲染，
                  但跨类别断言时按testid 定位更稳（antd label 会被 requiredMark 注入额外文本）。 */}
              <Form.Item label="端口" name="port" rules={portRules}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={1}
                  max={65535}
                  placeholder="例如：9092"
                  data-testid="middleware-port-input"
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>{scrapePortField}</Col>
          </Row>
        </>
      )
    case 'application':
      return (
        <>
          <Form.Item label="服务名" name="service_name" rules={[{ required: true, message: '请输入服务名' }]}>
            <Input placeholder="例如：order-service" maxLength={64} />
          </Form.Item>
          <Form.Item
            label="健康检查 URL"
            name="health_check_url"
            extra="必填，作为 blackbox 拨测目标地址"
            rules={healthCheckUrlRules}
          >
            <Input placeholder="例如：http://10.10.1.4:8081/actuator/health" maxLength={256} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="端点（采集地址主机）"
                name="endpoint"
                extra="选填；与端口一起构成 standard 指标采集目标"
              >
                <Input placeholder="例如：10.10.1.4" maxLength={128} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="端口（采集端口）"
                name="port"
                extra="选填；exporter 指标端点监听端口，例如 8081"
                rules={optionalPortRules}
              >
                <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="例如：8081" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="协议" name="protocol" extra="资源画像用（采集协议由采集 Job 的 scheme 决定）">
            <Input placeholder="例如：http（可选）" maxLength={16} />
          </Form.Item>
          <Typography.Text strong>负责人信息（选填）</Typography.Text>
          {/* 横向布局（2026-10-29 用户要求）：左侧人名、右侧对应联系方式，逐行排列。 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="负责人1" name="owner1">
                <Input placeholder="姓名（可选）" maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="负责人1联系方式" name="owner1_contact">
                <Input placeholder="电话或邮箱（可选）" maxLength={128} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="负责人2" name="owner2">
                <Input placeholder="姓名（可选）" maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="负责人2联系方式" name="owner2_contact">
                <Input placeholder="电话或邮箱（可选）" maxLength={128} />
              </Form.Item>
            </Col>
          </Row>
          <Typography.Text strong>运维人员（选填）</Typography.Text>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="运维人员" name="ops_person">
                <Input placeholder="姓名（可选）" maxLength={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="运维人员联系方式" name="ops_person_contact">
                <Input placeholder="电话或邮箱（可选）" maxLength={128} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="应用上线时间" name="go_live_at">
            <DatePicker style={{ width: '100%' }} showTime format="YYYY-MM-DD HH:mm" placeholder="选择上线时间（可选）" />
          </Form.Item>
        </>
      )
    case 'generic_target':
      return (
        <>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="目标名称" name="target_name" rules={[{ required: true, message: '请输入目标名称' }]}>
                <Input placeholder="如 核心交换-01" maxLength={64} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Exporter 类型" name="exporter_type" extra="如 snmp_exporter / gpu_exporter / oracle_exporter">
                <Input placeholder="如 snmp_exporter / gpu_exporter" maxLength={64} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="目标 IP / 域名"
                name="instance_ip"
                rules={requiredIpOrHostnameRules}
                extra="必填且符合 IPv4/域名格式"
              >
                <Input placeholder="如 172.16.0.1" maxLength={128} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="端口" name="port" rules={optionalPortRules} extra="留空时不生成实例标识（instance）">
                <InputNumber style={{ width: '100%' }} min={1} max={65535} placeholder="如 9116（可选）" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="采集路径" name="metrics_path" initialValue="/metrics">
                <Input placeholder="/metrics" maxLength={128} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="协议" name="scheme" initialValue="http">
                <Select placeholder="请选择协议">
                  {SCHEME_OPTIONS.map((s) => (
                    <Select.Option key={s} value={s}>
                      {s}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>
        </>
      )
    case 'interface_service':
      // 接口服务差异化字段：接口名 + 接口地址。**不渲染采集端口**（无采集端口语义）——
      // 该类由 blackbox 拨测采集任务承载，拨测目标地址直接取接口地址。
      return (
        <>
          <Form.Item label="接口名" name="api_name" rules={[{ required: true, message: '请输入接口名' }]}>
            <Input placeholder="例如：订单查询接口" maxLength={200} />
          </Form.Item>
          <Form.Item
            label="接口地址"
            name="api_url"
            extra="必填：填完整 URL（含 ? 查询参数），如 https://api.example.com/health?token=xxx"
            rules={[{ required: true, message: '请输入接口地址' }]}
          >
            <Input placeholder="例如：https://api.example.com/health?token=xxx" maxLength={500} />
          </Form.Item>
        </>
      )
  }
}
