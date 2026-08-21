import { useEffect, useState } from 'react'
import { Alert, Form, Input, Modal, Select, Typography, message } from 'antd'
import {
  networkDomainApi,
  tenantApi,
  zoneTypeApi,
  type NetworkDomainCreateInput,
  type NetworkDomainUpdateInput,
} from '../../../api/domain'
import type { NetworkDomain, Tenant, ZoneType } from '../../../types/domain'

const { Text } = Typography

interface DomainFormModalProps {
  open: boolean
  mode: 'create' | 'edit'
  domain?: NetworkDomain | null
  onCancel: () => void
  onSuccess: () => void
}

/**
 * 网域登记 / 编辑表单（模块 Module_06 §11.2）。
 * - 登记态：create（不含 tenant_id，登记归属固定 platform_admin 隐藏）；编辑态：update（不含 tenant_id，登记归属创建后不可变更）。
 * - zone_type 下拉来自只读字典 zoneTypeApi.list 仅消费启用项；字典为空时置灰提示平台预置，不开放自由文本。
 * - id 由后端按 <deploy_code>-<domain_code> 自动生成，登记态只展示不可手填。
 * - 提交按钮 loading + disabled 防重复提交。
 */
export function DomainFormModal({ open, mode, domain, onCancel, onSuccess }: DomainFormModalProps) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [zoneTypes, setZoneTypes] = useState<ZoneType[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [dictError, setDictError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (mode === 'create') {
      form.resetFields()
      form.setFieldsValue({ domain_type: 'edge', authorized_tenant_ids: ['platform_admin'] })
    } else if (domain) {
      form.resetFields()
      const { tenant_id: _tenantId, ...editable } = domain
      form.setFieldsValue({ ...editable })
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
      // 字段校验失败，错误已由 Form.Item 置于字段下方；不提交
      return
    }
    setSubmitting(true)
    try {
      if (mode === 'create') {
        const input: NetworkDomainCreateInput = {
          name: String(values.name),
          domain_type: values.domain_type as NetworkDomainCreateInput['domain_type'],
          zone_type: values.zone_type ? String(values.zone_type) : undefined,
          description: values.description ? String(values.description) : undefined,
          authorized_tenant_ids: (values.authorized_tenant_ids as string[]) || undefined,
        }
        await networkDomainApi.create(input)
        message.success('网域已登记（行政登记）。请前往 Module_09 完成监控纳管。')
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
    <Modal
      title={mode === 'create' ? '登记网域（行政登记）' : '编辑网域（行政信息）'}
      open={open}
      onCancel={submitting ? undefined : onCancel}
      onOk={handleOk}
      confirmLoading={submitting}
      okText="提交"
      cancelText="取消"
      destroyOnClose
      width={560}
    >
      {dictError && (
        <Alert
          type="warning"
          showIcon
          message="字典加载失败"
          description="网络区域类型 / 租户字典加载失败，请稍后重试"
          style={{ marginBottom: 16 }}
        />
      )}
      <Form form={form} layout="vertical" name="domain-form" requiredMark>
        <Form.Item
          label="网域名称"
          name="name"
          rules={[{ required: true, message: '请输入网域名称' }]}
        >
          <Input placeholder="例如：政务网 A 区" maxLength={64} />
        </Form.Item>

        {mode === 'create' ? (
          <Form.Item
            label="域类型"
            name="domain_type"
            rules={[{ required: true, message: '请选择域类型' }]}
            extra="登记的一般为「边缘域」；「管理域」为系统预置（default）"
          >
            <Select placeholder="请选择域类型">
              <Select.Option value="edge">边缘域</Select.Option>
              <Select.Option value="management">管理域</Select.Option>
            </Select>
          </Form.Item>
        ) : (
          <Form.Item label="域类型">
            <Text>{domain?.domain_type === 'management' ? '管理域' : '边缘域'}</Text>
          </Form.Item>
        )}

        <Form.Item
          label="网络区域类型"
          name="zone_type"
          extra={
            enabledZoneTypes.length ? undefined : '网络区域类型字典为空，请联系平台管理员预置（不开放自由文本）'
          }
        >
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="请选择网络区域类型"
            disabled={!enabledZoneTypes.length}
          >
            {enabledZoneTypes.map((z) => (
              <Select.Option key={z.code} value={z.code} label={z.display_name}>
                {z.display_name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          label="授权租户"
          name="authorized_tenant_ids"
          extra="可选，缺省 = 登记归属租户（platform_admin）；网域可授权多个租户共享使用（授权 ≠ 拥有）"
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

        <Form.Item label="网域 ID（自动生成）" extra="由后端按 <deploy_code>-<domain_code> 自动生成，全局唯一、创建后不可修改">
          <Input
            value={mode === 'create' ? '由后端自动生成' : (domain?.id ?? '')}
            disabled
            placeholder="mc-xxx"
          />
        </Form.Item>

        <Form.Item label="描述" name="description">
          <Input.TextArea rows={2} placeholder="描述该网域的用途与网络特征（行政描述，非监控参数）" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
