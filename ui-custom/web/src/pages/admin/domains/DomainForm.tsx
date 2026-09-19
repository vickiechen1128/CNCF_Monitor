import { useEffect, useState } from 'react'
import { Button, Col, Drawer, Form, Input, Row, Select, Space, Typography, message } from 'antd'
import {
  CheckCircleOutlined,
  DisconnectOutlined,
  InfoCircleFilled,
  StopOutlined,
} from '@ant-design/icons'
import {
  networkDomainApi,
  tenantApi,
  zoneTypeApi,
  type NetworkDomainCreateInput,
  type NetworkDomainUpdateInput,
} from '../../../api/domain'
import type { NetworkDomain, Tenant, ZoneType } from '../../../types/domain'
import { FormSection } from '../../../components/FormSection'
import { Callout } from '../../../components/Callout'
import { useSkin } from '../../../skinContext'

/** 校验单个 IPv4 CIDR：a.b.c.d/mask，四段 0-255，掩码 0-32 */
function isValidIPv4CIDR(s: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s.trim())
  if (!m) return false
  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  const mask = Number(m[5])
  return mask >= 0 && mask <= 32 && a <= 255 && b <= 255 && c <= 255 && d <= 255
}

/** 网段 Form 校验器：允许留空；按逗号/换行/中文逗号拆分后逐条校验 CIDR 格式 */
function validateCidrList(_: unknown, value?: string): Promise<void> {
  if (!value || !value.trim()) return Promise.resolve()
  const tokens = value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
  const bad = tokens.filter((t) => !isValidIPv4CIDR(t))
  if (bad.length) {
    return Promise.reject(
      new Error(`网段格式不合法：${bad.join('、')}。应为 a.b.c.d/掩码，掩码 0-32，如 10.20.0.0/16`)
    )
  }
  return Promise.resolve()
}

const { Text } = Typography

interface DomainDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  domain?: NetworkDomain | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 网域登记 / 编辑抽屉（Module_06 §11.2，对齐原型 v2.14 Drawer 双层表单）。
 * - 登记态：create（前置自检 center_direct 走 Form 字段驱动，选「能」硬劝阻终点——表单不展开 + 确认按钮禁用；
 *   选「不能」展开四组 FormSection）；编辑态：update（不渲染自检，直接渲染主体）。
 * - 登记归属（tenant_id）固定 platform_admin：登记态只读展示，编辑态不提交（创建后不可变更）。
 * - 接入方式（domain_type）由自检自动得出，只读展示不可选。
 * - ip_cidrs 网段以多行文本输入，提交时转 string[]。
 * - 抽屉必须 forceRender：Form 字段常驻挂载，避免首次打开 setFieldsValue 被吞（#19 通病）。
 */
export function DomainDrawer({ open, mode, domain, onCancel, onSuccess }: DomainDrawerProps) {
  // 链接色走皮肤 token（单一来源，见 skins.ts 设计约束）
  const { tokens } = useSkin()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [zoneTypes, setZoneTypes] = useState<ZoneType[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [dictError, setDictError] = useState<string | null>(null)
  // 前置自检（登记态）：中心能否直接访问——能 → 硬劝阻；不能 → 展开登记字段
  const watchedCenterDirect = Form.useWatch('center_direct', form) as 'yes' | 'no' | undefined
  /** {v2.13} 决策 79：新建时未选择「访问不到」不提供提交路径——硬劝阻终点 */
  const canSubmit = mode === 'edit' ? true : watchedCenterDirect === 'no'

  useEffect(() => {
    if (!open) return
    if (mode === 'create') {
      form.resetFields()
      form.setFieldsValue({
        domain_type: 'edge',
        tenant_id: 'platform_admin',
        authorized_tenant_ids: ['platform_admin'],
      })
    } else if (domain) {
      form.resetFields()
      const { tenant_id: _tenantId, ...editable } = domain
      // ip_cidrs 以「数组」入库、以「原始字符串（逗号分隔）」在表单内编辑/回显，避免 normalize 吃符号
      form.setFieldsValue({
        ...editable,
        ip_cidrs: (editable.ip_cidrs as string[] | undefined)?.join(', ') ?? '',
      })
    }
    Promise.all([zoneTypeApi.list(), tenantApi.list({ page: 1, page_size: 100 })])
      .then(([zt, tn]) => {
        setZoneTypes(zt.data ?? [])
        setTenants(tn.data?.list ?? [])
        setDictError(null)
      })
      .catch((err: Error) => setDictError(err.message))
  }, [open, mode, domain, form])

  const enabledZoneTypes = zoneTypes.filter((z) => z.enabled)
  const activeTenants = tenants.filter((t) => t.status === 'active')

  const handleOk = async () => {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      const rawCidr = form.getFieldValue('ip_cidrs') as string | undefined
      const ip_cidrs = rawCidr
        ? rawCidr.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean)
        : undefined
      if (mode === 'create') {
        const input: NetworkDomainCreateInput = {
          name: String(values.name),
          domain_type: 'edge',
          zone_type: values.zone_type ? String(values.zone_type) : undefined,
          description: values.description ? String(values.description) : undefined,
          authorized_tenant_ids: (values.authorized_tenant_ids as string[]) || undefined,
          ip_cidrs: ip_cidrs?.length ? ip_cidrs : undefined,
        }
        await networkDomainApi.create(input)
        message.success('网域已登记（行政登记）。请前往「配置中心-网域纳管」完成监控纳管。')
      } else if (domain) {
        const input: NetworkDomainUpdateInput = {
          name: String(values.name),
          description: values.description ? String(values.description) : undefined,
          zone_type: values.zone_type ? String(values.zone_type) : undefined,
          authorized_tenant_ids: (values.authorized_tenant_ids as string[]) || undefined,
          ip_cidrs: ip_cidrs?.length ? ip_cidrs : undefined,
        }
        await networkDomainApi.update(domain.id, input)
        message.success('网域行政信息已更新')
      }
      setSubmitting(false)
      onSuccess()
      onCancel()
    } catch (err) {
      if (err instanceof Error) message.error(err.message)
      else message.error('提交失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      width={720}
      open={open}
      onClose={submitting ? undefined : onCancel}
      // forceRender：Drawer 首次打开时内容惰性挂载，导致 useEffect(open) 的 setFieldsValue 在
      // Form 字段注册前执行被吞、编辑回显首次为空；forceRender 保证 Form 常驻挂载（#19 通病，网域登记抽屉）。
      forceRender
      title={
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{mode === 'create' ? '登记网域' : '编辑网域'}</div>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            仅登记行政信息；接入凭据与采集节点安装由「配置中心 - 网域纳管」完成
          </Text>
        </div>
      }
      footer={
        <div style={{ textAlign: 'right' }}>
          <Space>
            <Button onClick={submitting ? undefined : onCancel}>取消</Button>
            <Button type="primary" loading={submitting} disabled={!canSubmit} onClick={handleOk}>
              {mode === 'create' ? '确认登记' : '保存'}
            </Button>
          </Space>
        </div>
      }
    >
      {dictError && <Callout tone="warning" icon={<InfoCircleFilled />} title="字典加载失败">{dictError}</Callout>}
      <Form form={form} layout="vertical" name="domain-drawer">
        {mode === 'create' && (
          <FormSection title="这个区域的机器，平台中心能直接访问吗？" description="登记前的自检，决定是否需要建网域">
            <Form.Item
              name="center_direct"
              rules={[{ required: true, message: '请先选择一项' }]}
              style={{ marginBottom: 0 }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={0}>
                <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  {[
                    { v: 'yes', title: '中心能直接访问', desc: '机器由平台中心直接采集，统一纳入中心直连域（default）。', tone: '#52c41a', bg: '#f6ffed', icon: <CheckCircleOutlined /> },
                    { v: 'no', title: '中心访问不到', desc: '中心无法直接连通该网络，需在其中一台常开机器上安装采集节点回传数据。', tone: '#fa8c16', bg: '#fff7e6', icon: <DisconnectOutlined /> },
                  ].map((o) => (
                    <div
                      key={o.v}
                      role="radio"
                      aria-checked={watchedCenterDirect === o.v}
                      tabIndex={0}
                      onClick={() => form.setFieldValue('center_direct', o.v)}
                      onKeyDown={(e) => {
                        if (e.key === ' ' || e.key === 'Enter') {
                          e.preventDefault()
                          form.setFieldValue('center_direct', o.v)
                        }
                      }}
                      style={{
                        cursor: 'pointer',
                        borderRadius: 6,
                        padding: '12px 14px',
                        border: `1px solid ${watchedCenterDirect === o.v ? o.tone : tokens.colorBorder}`,
                        background: watchedCenterDirect === o.v ? o.bg : '#FFFFFF',
                        boxShadow: watchedCenterDirect === o.v ? `0 0 0 2px ${o.tone}22` : 'none',
                        transition: 'all 0.2s',
                      }}
                    >
                      <span style={{ color: watchedCenterDirect === o.v ? o.tone : '#86909C', fontSize: 16, display: 'inline-flex' }}>
                        {o.icon}
                      </span>
                      <Text strong style={{ fontSize: 13, marginLeft: 8 }}>{o.title}</Text>
                      {watchedCenterDirect === o.v && (
                        <span style={{ color: o.tone, fontSize: 12, marginLeft: 8 }}>已选择</span>
                      )}
                      <div style={{ marginTop: 6, fontSize: 12, color: '#4E5969', lineHeight: 1.7 }}>{o.desc}</div>
                    </div>
                  ))}
                </div>
              </Space>
            </Form.Item>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                判断口径：以「平台中心能否直接连通目标机器」为准，与你本人能否登录运维无关。
              </Text>
            </div>
            {watchedCenterDirect === 'yes' && (
              /* {v2.13} 决策 79：硬劝阻终点——表单不展开、确认按钮禁用、无继续填写路径 */
              <div style={{ marginTop: 12 }}>
                <Callout
                  tone="warning"
                  icon={<StopOutlined />}
                  title="无需登记网域，请关闭本窗口"
                  extra={
                    <Button type="text" size="small" onClick={onCancel} style={{ color: tokens.colorInfo }}>
                      关闭
                    </Button>
                  }
                >
                  能被平台中心直接访问的机器统一放在「中心直连域（default）」，由中心直接采集。
                  如需把网域共享给其他租户使用，请改用「授权租户」字段，不必另建网域。
                </Callout>
              </div>
            )}
            {watchedCenterDirect === 'no' && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  采集节点域：登记后由该网域内一台常开机器上的采集节点单向回传数据至中心。
                </Text>
              </div>
            )}
          </FormSection>
        )}

        {(mode === 'edit' || watchedCenterDirect === 'no') && (
          <>
            <FormSection title="行政信息">
              <Row gutter={16}>
                <Col span={10}>
                  <Form.Item label="网域 ID" extra="全局唯一，创建后不可修改">
                    <Input
                      value={mode === 'create' ? '登记后由系统自动生成' : (domain?.id ?? '')}
                      disabled
                      placeholder="mc-<deploy-code>-<domain-code>"
                    />
                  </Form.Item>
                </Col>
                <Col span={14}>
                  <Form.Item label="网域名称" name="name" rules={[{ required: true, message: '请输入网域名称' }]}>
                    <Input placeholder="例如：政务网 A 区" maxLength={64} disabled={domain?.id === 'default'} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="登记归属" extra="登记 ≠ 独占，可授权多租户共享">
                    <Input disabled value="platform_admin" style={{ color: '#1D2129' }} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="接入方式" extra="由「能否直连」自动得出">
                    <Input
                      value={mode === 'edit' && domain?.domain_type === 'management' ? '中心直连域' : '采集节点域'}
                      disabled
                      style={{ color: '#1D2129' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </FormSection>

            <FormSection title="授权与分区" description="网域为部署级资源，可授权多个租户共享使用">
              <Form.Item
                label="授权租户"
                name="authorized_tenant_ids"
                extra="可选，缺省 = 登记归属租户（platform_admin）；授权 ≠ 拥有；被授权租户未开启多网域能力时仅可被授权单个网域"
              >
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择被授权使用该网域的租户"
                >
                  {activeTenants.map((t) => (
                    <Select.Option key={t.id} value={t.id} label={t.name}>
                      {t.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="网络分区（可选）" name="zone_type"
                extra={enabledZoneTypes.length ? undefined : '网络区域类型字典为空，请联系平台管理员预置（不开放自由文本）'}
              >
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="请选择网络分区（可留空表示未设置）"
                  disabled={!enabledZoneTypes.length}
                >
                  {enabledZoneTypes.map((z) => (
                    <Select.Option key={z.code} value={z.code} label={z.display_name}>
                      {z.display_name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </FormSection>

            <FormSection title="网络与描述" description="网段用于资源导入时按 IP 自动推导网域归属，可留空">
              <Form.Item
                label="网段（CIDR）"
                name="ip_cidrs"
                extra="用 CIDR 格式，掩码必填；多个网段用英文逗号分隔。留空时由平台在资源导入时按 IP 自动推导归属"
                rules={[{ validator: validateCidrList }]}
              >
                <Input.TextArea rows={2} placeholder="逗号分隔，掩码必填，如 10.20.0.0/16, 10.30.1.0/24" />
              </Form.Item>
              <Form.Item label="描述" name="description">
                <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征（行政描述，非监控参数）" />
              </Form.Item>
            </FormSection>
          </>
        )}
      </Form>
    </Drawer>
  )
}

export default DomainDrawer