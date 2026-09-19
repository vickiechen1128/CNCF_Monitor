import { useState } from 'react'
import { Alert, Button, Modal, Table, Typography, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { resourceApi } from '../../api/resources'
import type { ResourceCategory } from '../../types/resource'
import { triggerBlobDownload } from '../../utils/triggerBlobDownload'

const { Text } = Typography

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP / ResourcesPage） */
const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/**
 * 五类资源 Excel 导入模板 sheet1 固定列清单（Module_07 §5.16.1，不支持动态列）。
 * 后端无模板列元数据接口（template.go 仅返回 xlsx 二进制），MVP 以本常量表展示；
 * 列名与后端 `platform/config/resource/template.go` TemplateColumns 逐字一致
 * （host/database/middleware/application/generic_target，F-4 已核对）。
 */
const IMPORT_TEMPLATE_COLUMNS: Record<ResourceCategory, string[]> = {
  host: ['network_domain', 'instance_name', 'hostname', 'instance_ip', 'os_type', 'biz_code', 'app_code', 'env', 'cluster', 'owner', 'status'],
  database: ['network_domain', 'database_type', 'instance_ip', 'port', 'version', 'biz_code', 'app_code', 'env', 'cluster', 'owner', 'status'],
  middleware: ['network_domain', 'middleware_type', 'instance_ip', 'port', 'version', 'biz_code', 'app_code', 'env', 'cluster', 'owner', 'status'],
  application: ['network_domain', 'service_name', 'biz_code', 'health_check_url', 'protocol', 'endpoint', 'port', 'app_code', 'env', 'cluster', 'owner', 'status'],
  generic_target: ['network_domain', 'target_name', 'instance_ip', 'port', 'metrics_path', 'scheme', 'exporter_type', 'custom_labels', 'biz_code', 'app_code', 'env', 'cluster', 'owner', 'status'],
}

interface TemplateDownloadModalProps {
  open: boolean
  /** 当前资源类型 Tab，联动模板下载（§5.16.1 固定列模板按类型） */
  category: ResourceCategory
  onCancel: () => void
}

/**
 * 模板下载弹窗（F-4 独立动线，对齐原型 L2210-2242）：展示当前资源类别的
 * 固定列清单表格（列顺序/列名）+ 取值说明 + 业务/应用声明 sheet 说明（决策 97），
 * 并以醒目 Alert 提示模板随版本演进；「下载模板」按钮触发 xlsx 下载
 * （复用 resourceApi.template + triggerBlobDownload）。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md §5.16/§6.1
 */
export function TemplateDownloadModal({ open, category, onCancel }: TemplateDownloadModalProps) {
  const [downloading, setDownloading] = useState(false)

  /** 下载当前资源类型的 Excel 模板（浏览器触发下载） */
  const handleDownload = async () => {
    setDownloading(true)
    try {
      const blob = await resourceApi.template(category)
      triggerBlobDownload(blob, `${category}_template.xlsx`)
      message.success('模板下载成功')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '模板下载失败，请稍后重试')
    } finally {
      setDownloading(false)
    }
  }

  const columns: ColumnsType<{ order: number; column: string }> = [
    { title: '列顺序', dataIndex: 'order', key: 'order', width: 80 },
    {
      title: '列名',
      dataIndex: 'column',
      key: 'column',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
  ]

  return (
    <Modal
      title={`下载模板 - ${RESOURCE_TYPE_MAP[category]}`}
      open={open}
      onCancel={onCancel}
      width={560}
      footer={
        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={downloading}
          onClick={handleDownload}
        >
          下载模板
        </Button>
      }
    >
      {/* F-4：模板演进提示醒目 Alert——模板可能随版本更新，务必下载最新模板避免旧模板缺列报错 */}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="模板会随版本更新"
        description="请下载最新模板，按固定列填写后上传；旧模板可能缺列导致导入报错。"
      />
      <Text style={{ fontSize: 13, display: 'block', marginBottom: 12 }}>
        <Text strong>固定列模板：</Text>
        按资源类别提供固定列模板；网域列可留空——留空时平台按归属解析链自动推导（显式指定 &gt; 冲突告警 &gt; 按 IP 与网域网段最长前缀推导 &gt; 默认网域兜底）。
      </Text>
      <Table
        size="small"
        rowKey="column"
        pagination={false}
        dataSource={IMPORT_TEMPLATE_COLUMNS[category].map((c, i) => ({ order: i + 1, column: c }))}
        columns={columns}
      />
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        custom_labels 列支持 key1=value1;key2=value2 格式；status 支持中文状态值（运行中 / 已停止 / 维护中）。
      </Text>
      <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        模板由后端生成静态 xlsx，内置「取值说明 sheet」列出网域 / 业务 / 环境 / 状态等列的合法值清单；biz_code 必填，仅可填已登记字典条目；app_code 须为应用字典已登记且未停用的条目（设备类资源可空）。
      </Text>
      {/* 决策 97：业务/应用声明 sheet 说明（一次导入声明全新业务/应用） */}
      <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        资源导入文件可内含「业务声明」/「应用声明」sheet，一次导入即可声明全新业务/应用（决策 97）。
      </Text>
    </Modal>
  )
}

export default TemplateDownloadModal
