import { useState } from 'react'
import { Alert, Button, Modal, Tag, Typography, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { resourceApi } from '../../api/resources'
import type { ApplicationDict, BusinessDomain, ResourceCategory } from '../../types/resource'
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
 * 各资源类别「填写要点」（用户语汇，F-7-③）：主标识列 + 通用要点。
 * 替代原技术列名清单（IMPORT_TEMPLATE_COLUMNS 已删除）——用户只关心「填什么、怎么填」，
 * 列名以用户语汇表达（主机名 / IP 地址 / 端口），业务/应用取值直显当前字典（见下方「每列能填什么值」）。
 */
const FILLING_TIPS: Record<ResourceCategory, string[]> = {
  host: ['主机名 / IP 地址 / 操作系统', '所属业务（必填）、所属应用（可选）', '环境、集群、负责人、运行状态'],
  database: ['数据库类型 / IP 地址 / 端口 / 版本', '所属业务（必填）、所属应用（可选）', '环境、集群、负责人、运行状态'],
  middleware: ['中间件类型 / IP 地址 / 端口 / 版本', '所属业务（必填）、所属应用（可选）', '环境、集群、负责人、运行状态'],
  application: [
    '服务名 / 健康检查 URL / 协议 / 端点 / 端口',
    '所属业务（必填）、所属应用（可选）',
    '环境、集群、负责人、运行状态',
  ],
  generic_target: [
    '目标名称 / Exporter 类型 / IP 地址 / 端口 / 采集路径 / 协议',
    '自定义标签（key1=value1;key2=value2）',
    '所属业务（必填）、所属应用（可选）',
    '环境、集群、负责人、运行状态',
  ],
}

/** 下载文件名日期戳：YYYYMMDD（F-7-⑤，旧文件一眼识破） */
function todayStamp(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}${mm}${dd}`
}

interface TemplateDownloadModalProps {
  open: boolean
  /** 当前资源类型 Tab，联动模板下载 */
  category: ResourceCategory
  onCancel: () => void
  /**
   * 当前业务字典（F-7-②：启用条目直显为「业务列」可选值）。
   * 列表加载失败时 ResourcesPage 中为 undefined，组件内兜底空数组。
   */
  businessDomains?: BusinessDomain[]
  /** 当前应用字典（F-7-②，决策 92/96：启用条目直显为「应用列」可选值） */
  applicationDomains?: ApplicationDict[]
}

/**
 * 模板下载弹窗（F-7 治本，用户语言重写）：回答三问——怎么填（填写要点，用户语汇）/
 * 每列能填什么值（当前业务/应用字典启用条目直显）/ 为什么必须下最新（演进提示 Alert），
 * 删除全部设计黑话（决策 97 / 取值说明 sheet / 固定列模板 / 技术列名表）。
 * 「下载模板」按钮触发 xlsx 下载，文件名带日期 `${category}_template_${YYYYMMDD}.xlsx`（F-7-⑤）。
 * 参见 docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md §5.16/§6.1
 */
export function TemplateDownloadModal({
  open,
  category,
  onCancel,
  businessDomains = [],
  applicationDomains = [],
}: TemplateDownloadModalProps) {
  const [downloading, setDownloading] = useState(false)

  /** 启用条目（仅展示可填的字典值；业务 enabled=true / 应用 status=enabled） */
  const enabledBusinesses = businessDomains.filter((d) => d.enabled)
  const enabledApps = applicationDomains.filter((a) => a.status === 'enabled')

  /** 下载当前资源类型的 Excel 模板（浏览器触发下载，文件名带日期） */
  const handleDownload = async () => {
    setDownloading(true)
    try {
      const blob = await resourceApi.template(category)
      triggerBlobDownload(blob, `${category}_template_${todayStamp()}.xlsx`)
      message.success('模板下载成功')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '模板下载失败，请稍后重试')
    } finally {
      setDownloading(false)
    }
  }

  /** 字典可选值面板（每列能填什么值）：可滚动小区域 + 省略展示，保持 560 宽度内可读 */
  const renderDictPanel = (title: string, items: { key: string; code: string; name: string; tagColor: string }[], emptyHint: string) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {title}
      </Text>
      {items.length > 0 ? (
        <div
          style={{
            maxHeight: 130,
            overflowY: 'auto',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 6,
            padding: '6px 8px',
          }}
        >
          {items.map((item) => (
            <div
              key={item.key}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}
            >
              <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }} color={item.tagColor}>
                {item.code}
              </Tag>
              <Text
                style={{
                  fontSize: 12,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={item.name}
              >
                {item.name}
              </Text>
            </div>
          ))}
        </div>
      ) : (
        <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
          {emptyHint}
        </Text>
      )}
    </div>
  )

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
      {/* ③ 为什么必须下最新：模板演进提示（用户语言） */}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="模板会随版本更新"
        description="旧模板可能缺列或缺最新字典值，导致导入报错——请下载最新模板后填写。"
      />

      {/* ① 这模板怎么填：用户语汇填写要点 */}
      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        这模板怎么填
      </Text>
      <ul style={{ margin: 0, marginBottom: 16, paddingLeft: 18 }}>
        {FILLING_TIPS[category].map((tip) => (
          <li key={tip}>
            <Text style={{ fontSize: 13 }}>{tip}</Text>
          </li>
        ))}
        <li>
          <Text style={{ fontSize: 13 }}>网域可留空——留空时平台自动归属默认网域</Text>
        </li>
        <li>
          <Text style={{ fontSize: 13 }}>运行状态填中文：运行中 / 已停止 / 维护中</Text>
        </li>
      </ul>

      {/* ② 每列能填什么值（重点）：当前业务/应用字典启用条目直显 */}
      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        每列能填什么值
      </Text>
      <Text style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        业务列必填，应用列按需填写——都只能填下方「当前业务 / 当前应用」中已启用的条目。
      </Text>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        {renderDictPanel(
          '当前业务',
          enabledBusinesses.map((b) => ({ key: b.code, code: b.code, name: b.name, tagColor: 'geekblue' })),
          '暂无已登记业务，请先到「业务管理」页登记；也可在导入文件里附「业务声明」表，一次导入直接声明新业务。',
        )}
        {renderDictPanel(
          '当前应用',
          enabledApps.map((a) => ({ key: a.app_code, code: a.app_code, name: a.app_name, tagColor: 'cyan' })),
          '暂无已登记应用，请先到「应用管理」页登记；也可在导入文件里附「应用声明」表，一次导入直接声明新应用。',
        )}
      </div>
    </Modal>
  )
}

export default TemplateDownloadModal
