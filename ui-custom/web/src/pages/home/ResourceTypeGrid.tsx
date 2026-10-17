/**
 * L1 采集覆盖表（Module_05 §3.1 决策 93 / PRD v1.8；2026-10-17 第五轮走查：
 * 一行六卡 → **04 卡片内的一张六行表格**，与左侧整体圆环构成共同体）。
 *
 * 改表格的缘由（第五轮反馈）：旧版六张类型卡与 04 区块头部的整体进度大数字
 * 平级排布，用户「看不出是一个共同的关系」——六类本是同一整体的六个组成部分，
 * 拆成六张平级卡后整体感消失。改为单卡内表格：**圆环（整体）在左、六类明细在右**，
 * 一行一类，列 = 资源类型 / 已配置采集 / 总数 / 纳管率 / 未配置采集。
 *
 * 列口径（第六轮走查改词 + 改版）：
 * - `monitored_count` 为**下发口径**：禁用「已采 / 覆盖率」（反馈 10 §10.4 正名）；
 *   但「已下发 / 未下发」被产品负责人指出「下发什么说不清」（2026-10-17 走查原话：
 *   「是采集策略已下发吗」），改为**「已配置采集 / 未配置采集」**——明确是采集任务
 *   配置，与卡内注解「已配置采集任务的资源数 ÷ 资源总数」同词；
 * - 「纳管率」沿用（与面板标题「监控对象纳管完成率」同词，构成 整体↔部分 共同体）；
 * - 量词只给主机（「台」，仅出现在已配置采集列）；`未配置采集 N` 不重复量词；
 * - 纳管率 < 70% 百分数转橙（第六轮起行内进度条已去除——与百分数信息重复、占半列宽，
 *   整体比例由左侧圆环承担；颜色不是唯一语义，数字本身可读）；
 * - 接口未返回某类型时按 **0 值行**渲染（0 是有效计量值，不缺行、不补样例）。
 *
 * `by_category[].by_subtype` 契约字段保留（后端不变），前端不消费——
 * 子类明细动线归资源清单页（第四轮已去除卡内子类区，防旧口径加回的测试在
 * HomePage.test.tsx「drops the subtype breakdown…」）。
 *
 * 移动适配（≤767px，见 homeResponsive.ts）：表格保留（行式信息比六卡堆叠更省高度），
 * 列宽收窄（总宽 ≈328px，横向滚动兜底）、徽标隐藏、表头改 3 字短名（已配置 / 未配置）；
 * 圆环与表格在 04 卡片内纵向堆叠（堆叠由 HomePage 的 coverage-body 控制）。
 */
import { Table, Typography, theme } from 'antd'
import type { TableColumnsType } from 'antd'
import type { HTMLAttributes } from 'react'
import type { CategorySummary } from '../../api/dashboard'
import {
  coveragePercent,
  coverageText,
  L1_CATEGORY_META,
  L1_CATEGORY_ORDER,
  SUBTYPE_COVERAGE_WARN_THRESHOLD,
  uncoveredCount,
} from './resourceTypeMeta'
import type { ResourceCategoryKey } from './resourceTypeMeta'
import { HOME_FONT } from './homeTypography'
import { TableHeaderText } from './TableHeaderText'
import { useNarrowLayout } from './homeResponsive'

/** 列宽（桌面 / 窄屏两档；scroll.x 取总宽，与 03 矩阵同一模式——窄容器内横向滚动而非压扁）。
 *  第六轮走查 sizing（产品负责人：「列太宽，尤其纳管率」「我想看到纳管率这列，资源类型
 *  再窄一点」）：
 *  - **纳管率去掉行内进度条**，只留百分数（<70% 百分数转橙，语义不变）——进度条与百分数
 *    信息重复，却占了列宽一半；整体比例由左侧圆环承担，行级只报数；
 *  - 资源类型 130 → 124（徽标 22 + 间距 8 + 最长标签「其他监控目标」78 + 内边距 16）；
 *  - 桌面总宽 704 → 428，圆环块 120 下 04 半幅卡（≈528 内容宽）可见
 *    类型 + 已配置采集 + 总数 + 纳管率 四列完整，末列「未配置采集」半露 + 横向滚动兜底；
 *  - 「已配置采集 / 未配置采集」5 字表头 @14px 需 86px（含 cell 内边距），故取 86；
 *    窄屏改 3 字短表头（已配置 / 未配置）+ 60px 列宽。 */
const COL_TYPE_WIDTH = 124
const COL_TYPE_WIDTH_NARROW = 92
const COL_NUM_WIDTH = 86
const COL_NUM_WIDTH_NARROW = 54
const COL_TOTAL_WIDTH = 68
const COL_TOTAL_WIDTH_NARROW = 46
const COL_COVERAGE_WIDTH = 64
const COL_COVERAGE_WIDTH_NARROW = 54
const COL_UNCOVERED_WIDTH = 86
const COL_UNCOVERED_WIDTH_NARROW = 54

/**
 * 窄屏列宽合计（**手机端不再横滚**，2026-10-17 第七轮走查修复）：
 * 92 + 54 + 46 + 54 + 54 = **300px**。
 *
 * 走查前的 328 在真机上必然溢出——iPhone 390 宽时卡片内容区只有
 * `390 − 内容区 padding 24 − 卡内 padding 40 = 326`，328 已经超 2px；
 * 375 / 360 机型（内容区 311 / 296）超出更多。表现就是产品负责人截图里的
 * 「未配置」列被卡片右边缘切掉一截 + 表内横向滚动。
 *
 * 修复两条一起做：① 本组列宽收到 300；② 手机端卡内边距 20 → 12（App.css 移动端块），
 * 内容区从 326 提到 **342（390 机型）/ 312（360 机型）**，300 < 312 留 12px 余量，
 * 360 以上所有竖屏机型零横滚；更窄的机型（≤340）才回落到横向滚动兜底。
 * 12px 表头 3 字（已配置 / 未配置）需 36 + cell padding 16 = 52 ≤ 54，不会折行。
 */

interface ResourceTypeGridProps {
  /** `dashboard.by_category`；接口未返回某类型时按 0 值行渲染 */
  byCategory: CategorySummary[]
}

/**
 * 行锚点（onRow）：`l1-card-<category>` testid 沿用旧六卡时代的容器锚点，
 * HomePage.test 的 within(...) 断言逐字复用。rc-table 的 GetComponentProps
 * 返回 HTMLAttributes & TdHTMLAttributes（不含 data-*），双重断言挂载——
 * rc-table 会把 onRow 返回值原样 spread 到 <tr>，data-testid 可达。
 */
function rowTestIdProps(category: ResourceCategoryKey): HTMLAttributes<HTMLTableRowElement> {
  return { 'data-testid': `l1-card-${category}` } as unknown as HTMLAttributes<HTMLTableRowElement>
}

export function ResourceTypeGrid({ byCategory }: ResourceTypeGridProps) {
  const { token } = theme.useToken()
  const narrow = useNarrowLayout()
  const typeWidth = narrow ? COL_TYPE_WIDTH_NARROW : COL_TYPE_WIDTH
  const numWidth = narrow ? COL_NUM_WIDTH_NARROW : COL_NUM_WIDTH
  const totalWidth = narrow ? COL_TOTAL_WIDTH_NARROW : COL_TOTAL_WIDTH
  const coverageWidth = narrow ? COL_COVERAGE_WIDTH_NARROW : COL_COVERAGE_WIDTH
  const uncoveredWidth = narrow ? COL_UNCOVERED_WIDTH_NARROW : COL_UNCOVERED_WIDTH
  // 表头文案：桌面用全称（列宽放得下 5 字），窄屏用 3 字短表头（60px 列宽放 5 字会换行）
  const monitoredTitle = narrow ? '已配置' : '已配置采集'
  const uncoveredTitle = narrow ? '未配置' : '未配置采集'
  // 表内正文统一 label 级（桌面 13 / 窄屏 12）：antd 表体默认 14px 比表头（现 12px）还大，
  // 且与类型列显式设置的 13px 不一致——同一行里两种字号，扫读时数字会「跳」
  const cellFontSize = narrow ? HOME_FONT.body : HOME_FONT.label

  const summaryOf = new Map(byCategory.map((c) => [c.resource_category, c]))
  // 固定六类顺序，缺类补 0 值行（L1_CATEGORY_ORDER：主机/数据库/中间件/应用服务/接口服务/其他监控目标）。
  // 2026-10-17 第六轮走查（产品负责人）：**没登记过该类对象时各计数列显示 '-'，不写 0**——
  // 0 是「登记了但一台都没配置采集」的有效计量值，与「压根没有这类对象」不是一回事，
  // 用 0 会让人以为有对象但没纳管。`registered = total > 0` 作为两者的分界。
  const dataSource = L1_CATEGORY_ORDER.map((category) => {
    const summary = summaryOf.get(category) as CategorySummary | undefined
    const total = summary?.resource_count ?? 0
    const monitored = summary?.monitored_count ?? 0
    return {
      category,
      total,
      monitored,
      percent: coveragePercent(monitored, total),
      registered: total > 0,
    }
  })
  const columns: TableColumnsType<(typeof dataSource)[number]> = [
    {
      title: <TableHeaderText>资源类型</TableHeaderText>,
      dataIndex: 'category',
      key: 'category',
      width: typeWidth,
      render: (category: ResourceCategoryKey) => {
        const meta = L1_CATEGORY_META[category]
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {/* 单字徽标（视觉定版）：窄屏隐藏——96px 列宽下徽标会把类型名挤成省略号 */}
            {!narrow && (
              <span
                aria-hidden
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: token.colorPrimaryBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: 12, lineHeight: 1, fontWeight: 700, color: token.colorPrimary }}>
                  {meta.badge}
                </span>
              </span>
            )}
            <Typography.Text style={{ fontSize: narrow ? HOME_FONT.body : HOME_FONT.label }}>
              {meta.label}
            </Typography.Text>
          </span>
        )
      },
    },
    {
      title: <TableHeaderText>{monitoredTitle}</TableHeaderText>,
      dataIndex: 'monitored',
      key: 'monitored',
      width: numWidth,
      align: 'right',
      render: (monitored: number, row) => (
        <span
          data-testid={`l1-monitored-${row.category}`}
          style={{ fontSize: cellFontSize, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {/* 未登记该类对象 → '-'；量词已去除（2026-10-17 第六轮走查：表头已说明是「采集」，
              列内只留数字，与右侧「总数 / 纳管率 / 未配置采集」同为纯数字列，扫读更齐） */}
          {row.registered ? monitored : '-'}
        </span>
      ),
    },
    {
      title: <TableHeaderText>总数</TableHeaderText>,
      dataIndex: 'total',
      key: 'total',
      width: totalWidth,
      align: 'right',
      render: (total: number, row) => (
        <span
          data-testid={`l1-total-${row.category}`}
          style={{
            fontSize: cellFontSize,
            color: token.colorTextSecondary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {row.registered ? total : '-'}
        </span>
      ),
    },
    {
      title: <TableHeaderText>纳管率</TableHeaderText>,
      key: 'coverage',
      width: coverageWidth,
      align: 'right',
      render: (_: unknown, row) => {
        // 第六轮走查：行内进度条已去除（与百分数信息重复、占半列宽），<70% 由百分数
        // 转橙承载（颜色不是唯一语义——数字本身可读）
        const warn =
          row.percent !== null && row.percent < SUBTYPE_COVERAGE_WARN_THRESHOLD
        return (
          <span
            data-testid={`l1-coverage-${row.category}`}
            style={{
              fontSize: cellFontSize,
              color: warn ? token.colorWarning : token.colorTextSecondary,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {coverageText(row.monitored, row.total)}
          </span>
        )
      },
    },
    {
      title: <TableHeaderText>{uncoveredTitle}</TableHeaderText>,
      key: 'uncovered',
      width: uncoveredWidth,
      align: 'right',
      render: (_: unknown, row) => (
        <span
          data-testid={`l1-uncovered-${row.category}`}
          style={{
            fontSize: cellFontSize,
            color: token.colorTextTertiary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {row.registered ? uncoveredCount(row.total, row.monitored) : '-'}
        </span>
      ),
    },
  ]

  return (
    <div data-testid="l1-grid">
      <Table<(typeof dataSource)[number]>
        data-testid="l1-table"
        rowKey="category"
        size="small"
        dataSource={dataSource}
        pagination={false}
        // 横向滚动兜底（与 03 矩阵同模式）：列宽总和高出容器时滚动，不压扁数字
        scroll={{ x: typeWidth + numWidth + totalWidth + coverageWidth + uncoveredWidth }}
        columns={columns}
        // 行锚点沿用旧卡 testid（l1-card-<category>）：HomePage.test 的容器断言逐字复用
        onRow={(record) => rowTestIdProps(record.category)}
      />
    </div>
  )
}

export default ResourceTypeGrid
