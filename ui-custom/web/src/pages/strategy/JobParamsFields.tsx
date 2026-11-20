/**
 * 采集参数与认证/TLS 的共享字段组件（Module_01 §5.2 FR-07/FR-08）。
 *
 * 单一事实来源：采集 Job 表单抽屉（单域）与「新建监控任务」向导（跨域 Job 组）
 * 共用同一套字段与校验，避免两处字段漂移。组件依赖外层 `Form` 的实例，
 * 字段名与提交契约一致（scrape_interval / scrape_timeout / metrics_path / scheme /
 * auth_type / username / password / token / tls_skip_verify / ca_file）。
 */
import { Col, Collapse, Form, Input, Radio, Row, Select, Typography } from 'antd'
import { SCRAPE_PARAM_FIELDS } from './strategyConstants'

const { Text } = Typography

/** 参数 placeholder 的默认值（无默认映射上下文时使用） */
const FALLBACK_PLACEHOLDERS: Record<string, string> = {
  scrape_interval: '留空使用全局默认（15s）',
  scrape_timeout: '留空使用全局默认（10s）',
  metrics_path: '留空继承采集器默认（/metrics）',
  scheme: '留空继承采集器默认（http）',
}

export interface ScrapeParamFieldsProps {
  /** 采集模板编码（M01 v1.5 起取代 monitor_type）；用于识别应用采集的必填路径 */
  templateCode?: string
  /** 继承链下层生效值提示（采集模板 → 采集器/全局兜底） */
  paramPlaceholders?: Record<string, string>
}

/**
 * 采集参数四字段（间隔 / 超时 / 路径 / 协议）+ 继承说明。
 * `application_http` 的指标路径没有通用默认值，必须显式填写。
 */
export function ScrapeParamFields({ templateCode, paramPlaceholders }: ScrapeParamFieldsProps) {
  const isAppMetricsPath = templateCode === 'application_http'
  const placeholders = { ...FALLBACK_PLACEHOLDERS, ...(paramPlaceholders ?? {}) }
  return (
    <>
      <Row gutter={12}>
        {SCRAPE_PARAM_FIELDS.map((f) => (
          <Col span={12} key={f.field}>
            <Form.Item
              name={f.field as never}
              label={f.label}
              rules={
                isAppMetricsPath && f.field === 'metrics_path'
                  ? [{ required: true, message: '应用采集必须填写采集路径，例如 /actuator/prometheus' }]
                  : undefined
              }
            >
              <Input
                placeholder={
                  isAppMetricsPath && f.field === 'metrics_path'
                    ? '请填写应用指标路径，例如 /actuator/prometheus（留空无法采集）'
                    : placeholders[f.field]
                }
                maxLength={64}
                allowClear
              />
            </Form.Item>
          </Col>
        ))}
      </Row>
      <Text type="secondary" style={{ fontSize: 12 }}>
        采集参数留空 = 继承采集模板 / 采集器默认值；填写 = 覆盖并保存为本 Job 快照。
      </Text>
      {isAppMetricsPath && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          应用采集地址来自资源台账的『端点 + 端口』；指标路径需按应用实际暴露情况填写（Spring Boot Actuator
          默认 /actuator/prometheus），没有通用默认值，不能留空。
        </Text>
      )}
    </>
  )
}

/**
 * 认证与 TLS 折叠面板（无 / 用户名密码 / Bearer Token + 跳过校验 + CA 路径）。
 * 通过 `Form.useWatch` 跟随外层表单的 auth_type 切换分支。
 */
export function AuthTlsFields() {
  const form = Form.useFormInstance()
  const authType = Form.useWatch('auth_type', form) as string | undefined
  return (
    <Collapse ghost>
      <Collapse.Panel header="认证与 TLS" key="auth">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="认证类型" name="auth_type" rules={[{ required: true }]}>
              <Select>
                <Select.Option value="none">无</Select.Option>
                <Select.Option value="basic">用户名密码</Select.Option>
                <Select.Option value="bearer">Bearer Token</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          {authType !== 'none' && (
            <Col span={16}>
              {authType === 'basic' ? (
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                      <Input placeholder="用户名" maxLength={64} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                      <Input.Password placeholder="密文仅存储，不回显" maxLength={128} />
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                <Form.Item name="token" label="Token" rules={[{ required: true, message: '请输入 Token' }]}>
                  <Input.Password placeholder="密文仅存储，不回显" maxLength={256} />
                </Form.Item>
              )}
            </Col>
          )}
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="跳过 TLS 校验" name="tls_skip_verify">
              <Radio.Group size="small">
                <Radio.Button value={false as never}>否</Radio.Button>
                <Radio.Button value={true as never}>是</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="ca_file" label="CA 证书路径">
              <Input placeholder="可选" maxLength={256} />
            </Form.Item>
          </Col>
        </Row>
      </Collapse.Panel>
    </Collapse>
  )
}

/** 组合：采集参数 + 认证/TLS（向导等无自有布局的场景直接使用）。 */
export function JobParamsFields(props: ScrapeParamFieldsProps) {
  return (
    <>
      <ScrapeParamFields {...props} />
      <AuthTlsFields />
    </>
  )
}
