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
  application: '应用服务',
  generic_target: '其他监控目标',
  interface_service: '接口服务',
}

/**
 * 各资源类别「填写要点」（用户语汇，F-7-③）：**必填项按类别分化**。
 * 替代原技术列名清单（IMPORT_TEMPLATE_COLUMNS 已删除）——用户只关心「填什么、怎么填」，
 * 列名以用户语汇表达，英文码仅作括号补充；业务/应用取值直显当前字典（见下方「每列能填什么值」）。
 *
 * F-22：原先五类共用一句「所属业务（必填）、所属应用（可选）」，而后端必填口径按 category
 * 分化（validate.go 的 validateHost/validateDatabase/validateMiddleware/validateApplication/
 * validateGenericTarget，以及 excel.go 导入侧分类别 switch），该句对 5 类中的 4 类均失准。
 * 此处按后端真实口径逐类改写：业务可空后补的是 host/database/middleware；必填应用的是
 * database/middleware/application；必填业务的是 application；业务与应用二选一的是
 * generic_target；平台一律可空。
 */
const FILLING_TIPS: Record<ResourceCategory, string[]> = {
  host: [
    '必填：主机名（instance_name）、IP 地址（instance_ip，填 IPv4）、操作系统（os_type）',
    '可留空：所属业务（biz_code，导入后再补）、所属应用（app_code）、所属平台（platform_code，留空按所属应用的默认平台归属）',
    '可留空：主机别名（hostname，与主机名二选一填一个即可）、所属集群（cluster）、负责人（owner）',
  ],
  database: [
    '必填：数据库类型（database_type）、IP 地址（instance_ip，填 IPv4）、端口（port）',
    '必填：所属应用（app_code）、所属集群（cluster）',
    '可留空：所属业务（biz_code，导入后再补）、所属平台（platform_code，留空按所属应用的默认平台归属）',
    '可留空：版本（version）、负责人（owner）',
  ],
  middleware: [
    '必填：中间件类型（middleware_type）、IP 地址（instance_ip，填 IPv4）、端口（port）',
    '必填：所属应用（app_code）、所属集群（cluster）',
    '可留空：所属业务（biz_code，导入后再补）、所属平台（platform_code，留空按所属应用的默认平台归属）',
    '可留空：版本（version）、负责人（owner）',
  ],
  application: [
    '必填：服务名（service_name）、采集地址主机（endpoint）、采集端口（port）',
    '必填：所属业务（biz_code）、所属应用（app_code）、所属集群（cluster）',
    '可留空：健康检查地址（health_check_url，业务健康检查用，不作采集地址）、协议（protocol）、所属平台（platform_code，留空按所属应用的默认平台归属）',
    '可留空：负责人（owner）',
  ],
  generic_target: [
    '必填：目标名称（target_name）、IP 地址（instance_ip，可填 IPv4 或域名）',
    '必填二选一：所属业务（biz_code）与所属应用（app_code）两个里至少填一个，两个都留空会导入失败',
    '可留空：端口（port，留空表示用默认端口）、采集路径（metrics_path）、协议（scheme）、Exporter 类型（exporter_type）',
    '可留空：所属平台（platform_code）、所属集群（cluster）、负责人（owner）',
    '自定义标签（custom_labels）按需填写，格式为 key1=value1;key2=value2',
  ],
  interface_service: [
    '必填：接口名（api_name）、接口地址（api_url，填完整 URL，含 ? 查询参数）',
    '必填：所属业务（biz_code）、所属应用（app_code）',
    '可留空：所属平台（platform_code，留空按所属应用的默认平台归属）、所属集群（cluster）、负责人（owner）',
  ],
}

/**
 * 「每列能填什么值」区中业务列 / 应用列的填写范围说明（F-22）：按类别分化，
 * 与 FILLING_TIPS 的必填口径保持一致，并明确取值来自已启用条目、未登记的可经声明表补充
 * （与下方字典面板空态提示「业务声明」表 / 「应用声明」表协同，不自相矛盾）。
 */
const DICT_SCOPE_HINTS: Record<ResourceCategory, string> = {
  host: '业务列和应用列都能留空，留空的资源导入后再补归属。填了的话只能填已启用的条目——下方是当前已启用的清单，清单里没有的可在导入文件里附「业务声明」表 /「应用声明」表一次声明。',
  database: '应用列必填，业务列能留空（导入后再补归属）。填了的话只能填已启用的条目——下方是当前已启用的清单，清单里没有的可在导入文件里附「业务声明」表 /「应用声明」表一次声明。',
  middleware: '应用列必填，业务列能留空（导入后再补归属）。填了的话只能填已启用的条目——下方是当前已启用的清单，清单里没有的可在导入文件里附「业务声明」表 /「应用声明」表一次声明。',
  application: '业务列和应用列都必填，只能填已启用的条目——下方是当前已启用的清单，清单里没有的可在导入文件里附「业务声明」表 /「应用声明」表一次声明。',
  generic_target: '业务列和应用列二选一，至少填一个。填了的话只能填已启用的条目——下方是当前已启用的清单，清单里没有的可在导入文件里附「业务声明」表 /「应用声明」表一次声明。',
  interface_service: '业务列和应用列都必填，只能填已启用的条目——下方是当前已启用的清单，清单里没有的可在导入文件里附「业务声明」表 /「应用声明」表一次声明。',
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
 *
 * F-22：填写要点（FILLING_TIPS）与业务/应用取值范围（DICT_SCOPE_HINTS）均按 category 分化，
 * 与后端真实必填口径逐条对齐；网域提示同时说明「表单必填 / 导入留空归入 default / default
 * 未登记则导入失败」三件事。
 * 主机历史「可用区」列已由 chenrt 裁定废弃并从模板移除，故此处不再作任何介绍——
 * 继续描述会误导用户去找一个不存在的列；分区依据只看所属网域（上方网域提示已说明）。
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
          <Text style={{ fontSize: 13 }}>网域强烈建议填写：在页面上新增或编辑资源时网域是必填项；用本模板导入时留空会自动归入默认网域 default</Text>
        </li>
        <li>
          <Text style={{ fontSize: 13 }}>默认网域 default 必须在「系统设置 → 网域管理」里已登记，否则导入会直接失败，请先到该页面确认后再导入</Text>
        </li>
        <li>
          <Text style={{ fontSize: 13 }}>环境（env）必填，填 OPS / PRD / UAT 之一；负责人与集群按下方说明填写</Text>
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
        {DICT_SCOPE_HINTS[category]}
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
