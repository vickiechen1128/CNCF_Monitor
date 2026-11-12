import { useEffect, useState } from 'react'
import { Button, Col, Drawer, Form, Input, Row, Select, Space, Typography, message } from 'antd'
import { InfoCircleFilled } from '@ant-design/icons'
import {
  networkDomainApi,
  tenantApi,
  zoneTypeApi,
  type NetworkDomainCreateInput,
  type NetworkDomainUpdateInput,
} from '../../../api/domain'
import { cloudDictApi } from '../../../api/resources'
import type { NetworkDomain, Tenant, ZoneType } from '../../../types/domain'
import type { CloudDict } from '../../../types/resource'
import { FormSection } from '../../../components/FormSection'
import { Callout } from '../../../components/Callout'

const { Text } = Typography

/** 云归属字段说明（对齐原型 CLOUD_CODE_FIELD_HINT）：权威在网域、资源侧只读派生 */
const CLOUD_CODE_FIELD_HINT =
  '取自云字典（部署级只读、仅含启用项），不开放自由文本；云归属是资源「云」标签的唯一来源，资源侧不再单独维护。'
/** 编辑态云归属只读说明（MVP 收口：登记后不可编辑） */
const CLOUD_CODE_READONLY_HINT = '网域云归属登记后不可修改；如需跨云请新登记网域'
/** 网络分区字段说明（对齐原型 ZONE_TYPE_FIELD_HINT，必填口径去除「可留空」表述） */
const ZONE_TYPE_FIELD_HINT =
  '给网域贴的分类标签：政务云环境对应安全分区（如互联网区 / 政务外网区 / 专线区 / DMZ），公有云环境对应地域（region）；分区为隔离边界，AZ 不进分区。取值来自部署级字典，不开放自由文本。'
/** 字典为空 / 加载失败时的兜底提示 */
const CLOUD_DICT_EMPTY_HINT = '云字典为空或加载失败，请联系平台管理员预置（不开放自由文本）'
const ZONE_TYPE_DICT_EMPTY_HINT = '网络区域类型字典为空，请联系平台管理员预置（不开放自由文本）'

interface DomainDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  domain?: NetworkDomain | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 网域登记 / 编辑抽屉（Module_06 §11.2，v3 契约 §3）。
 * - 登记态：create（v3 仅创建采集节点域 `edge` + `agent_pull`；不再有中心直连域自检）。
 * - 登记归属（tenant_id）固定 platform_admin：登记态只读展示，编辑态不提交（创建后不可变更）。
 * - cloud_code / domain_type 创建后不可变更：编辑态只读展示。
 * - 抽屉必须 forceRender：Form 字段常驻挂载，避免首次打开 setFieldsValue 被吞（#19 通病）。
 */
export function DomainDrawer({ open, mode, domain, onCancel, onSuccess }: DomainDrawerProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [zoneTypes, setZoneTypes] = useState<ZoneType[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  // 云归属下拉数据源（云字典只读接口 GET /api/v3/platform/cloud-dict，仅启用项）
  const [cloudDicts, setCloudDicts] = useState<CloudDict[]>([])
  const [dictError, setDictError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'create') {
      form.resetFields()
      form.setFieldsValue({
        tenant_id: 'platform_admin',
        authorized_tenant_ids: ['platform_admin'],
      })
    } else if (domain) {
      form.resetFields()
      const { tenant_id: _tenantId, ...editable } = domain
      form.setFieldsValue(editable)
    }
    Promise.all([zoneTypeApi.list(), tenantApi.list({ page: 1, page_size: 100 }), cloudDictApi.list()])
      .then(([zt, tn, cd]) => {
        setZoneTypes(zt.data ?? [])
        setTenants(tn.data?.list ?? [])
        setCloudDicts(cd.data?.list ?? [])
        setDictError(null)
      })
      .catch((err: Error) => setDictError(err.message))
  }, [open, mode, domain, form])

  const enabledZoneTypes = zoneTypes.filter((z) => z.enabled)
  // 云归属仅展示云字典启用条目（value=cloud_code、label=cloud_name，禁止自由文本）
  const enabledClouds = cloudDicts.filter((c) => c.enabled)
  const activeTenants = tenants.filter((t) => t.status === 'active')

  /** 云编码 → 云名（缺条目回退编码，供编辑态只读展示） */
  const cloudNameOf = (code?: string) => {
    if (!code) return '-'
    return cloudDicts.find((c) => c.cloud_code === code)?.cloud_name ?? code
  }

  const handleOk = async () => {
    let values: Record<string, unknown>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'create') {
        const input: NetworkDomainCreateInput = {
          name: String(values.name),
          cloud_code: String(values.cloud_code),
          zone_type: String(values.zone_type),
          description: values.description ? String(values.description) : undefined,
          authorized_tenant_ids: (values.authorized_tenant_ids as string[]) || undefined,
        }
        await networkDomainApi.create(input)
        message.success('网域已登记（行政登记）。请前往「配置中心-网域纳管」完成监控纳管。')
      } else if (domain) {
        const input: NetworkDomainUpdateInput = {
          name: String(values.name),
          description: values.description ? String(values.description) : undefined,
          zone_type: values.zone_type ? String(values.zone_type) : undefined,
          authorized_tenant_ids: (values.authorized_tenant_ids as string[]) || undefined,
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
            <Button type="primary" loading={submitting} onClick={handleOk}>
              {mode === 'create' ? '确认登记' : '保存'}
            </Button>
          </Space>
        </div>
      }
    >
      {dictError && <Callout tone="warning" icon={<InfoCircleFilled />} title="字典加载失败">{dictError}</Callout>}
      <Form form={form} layout="vertical" name="domain-drawer">
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
                <Input placeholder="例如：政务网 A 区" maxLength={64} />
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
              <Form.Item label="接入方式" extra="v3 仅登记采集节点域">
                <Input disabled value="采集节点域" style={{ color: '#1D2129' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              {mode === 'edit' ? (
                /* MVP 收口：云归属登记后不可编辑，编辑态只读展示 cloud_name */
                <Form.Item label="云归属" extra={CLOUD_CODE_READONLY_HINT}>
                  <Input disabled value={cloudNameOf(domain?.cloud_code)} style={{ color: '#1D2129' }} />
                </Form.Item>
              ) : (
                <Form.Item
                  label="云归属"
                  name="cloud_code"
                  rules={[{ required: true, message: '请选择云归属' }]}
                  extra={enabledClouds.length ? CLOUD_CODE_FIELD_HINT : CLOUD_DICT_EMPTY_HINT}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder="请选择云归属（取自云字典）"
                    disabled={!enabledClouds.length}
                  >
                    {enabledClouds.map((c) => (
                      <Select.Option key={c.cloud_code} value={c.cloud_code} label={c.cloud_name}>
                        {c.cloud_name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              )}
            </Col>
          </Row>
        </FormSection>

        <FormSection title="网络与分区">
          <Form.Item
            label="网络分区"
            name="zone_type"
            rules={[{ required: true, message: '请选择网络分区' }]}
            extra={enabledZoneTypes.length ? ZONE_TYPE_FIELD_HINT : ZONE_TYPE_DICT_EMPTY_HINT}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="请选择网络分区"
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

        <FormSection title="授权" description="网域为部署级资源，可授权多个租户共享使用">
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
        </FormSection>

        <FormSection title="描述">
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征（行政描述，非监控参数）" />
          </Form.Item>
        </FormSection>
      </Form>
    </Drawer>
  )
}

export default DomainDrawer
