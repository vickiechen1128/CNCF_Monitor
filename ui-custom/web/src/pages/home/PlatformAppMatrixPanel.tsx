/**
 * 「平台与应用的主机分布」矩阵区块（Module_05 反馈 11 §11.2 ④ / §11.3 03 段 / §11.4；
 * 2026-10-17 走查改标题并与 02 云分布合并为一行）。
 *
 * 行 = 平台（含「未指定平台」兜底行与「其他」聚合行），列 = 应用，格 = 主机台数；
 * 末列「合计」（行合计）、末行「合计」（列合计）、右下角为主机总数。（第六轮走查改词：
 * 原末列「平台合计」/ 末行「应用合计」交叉命名，产品负责人看不懂，统一为「合计」，
 * 位置即语义，精确口径进 Tooltip。）
 *
 * 度量单位取**主机台数**（非应用数）：每台主机只有一个 `platform_code` + 一个 `app_code`
 * （应用 ↔ 平台为 M:N，决策 111），故 **行合计 === 列合计 === 主机总数**，右下角单一合计格
 * 同时闭合两个方向，无需向阅读者解释「两者不相等」（反馈 11 §11.2 ④ 的核心诉求）。
 * 仅统计 `resource_category = host`（拨测目标不参与）。
 *
 * 合计一律由前端按 `cells` 求和，不直接采信后端 `host_count`：列合计由行聚合而来，
 * 若两者不一致，宁可让表格内部自洽，也不要在同一屏里出现两个对不上的总数。
 *
 * 降级（决策 68-2）：`by_platform_app` 缺失（后端未实现 / 查询失败）或空数组时，
 * 渲染「平台与应用数据暂不可用」**不可用态**，绝不渲染全 0 矩阵——0 是有效计量值，
 * 与「取数失败」必须区分。
 *
 * 标题口径（2026-10-17 走查）：「平台 × 应用 · 主机数」的「×」与字段式写法领导读不懂；
 * 改为「平台与应用的主机分布」——说清「主机在这两个归属维度上怎么分布」，叉乘关系
 * 由表格形态自身表达（行是平台、列是应用）。
 *
 * 移动适配（≤767px，见 homeResponsive.ts）：矩阵二维信息**不卡片化**（卡片化会破坏
 * 行列可比性，而这正是矩阵的价值所在），保留表格 + 横向滚动 + 固定首列（平台名）。
 * 与 02 云分布的合并行见 HomePage：02+03 一个 flex-wrap 行（第六轮走查：02 收窄为
 * 固定窄列），窄容器折行堆叠，并排时 `height: 100%` 撑满列高。
 *
 * **整组隐藏（2026-10-17 第六轮走查，产品负责人裁定）**：本面板与 02 云分布同属
 * 「资源管理」展示面，由页头行的一个开关整组隐藏（home-resource-row 整体不渲染，
 * 面板标题也不露出）；偏好跨会话持久（homePanelVisibility.ts）。本面板自身不带
 * 卡头开关。
 */
import { Table, Tooltip, Typography, theme } from 'antd'
import type { TableColumnsType } from 'antd'
import { Link } from 'react-router-dom'
import { SurfaceCard } from './SurfaceCard'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'
import { TableHeaderText } from './TableHeaderText'
import { useNarrowLayout } from './homeResponsive'
import type { PlatformAppSummary } from '../../api/dashboard'

const { Text } = Typography

/**
 * 矩阵完整口径（2026-10-17 第五轮走查）：原三句脚注表述过多，可见版面只留
 * 一句速记（「其他」= 合并；「未指定」= 没填归属），完整口径下沉到**标题
 * Tooltip**——需要深究的人悬浮展开，扫读的人不被三行小字拖慢。
 */
const MATRIX_SCOPE_TIP =
  '按主机台数统计，行合计 = 列合计 = 主机总数；「其他」是主机较少的平台合并显示（不单独成行）；「未指定平台 / 未指定应用」表示这些主机还没填平台或应用归属。'

/**
 * 「其他」聚合行的 `platform_code` 约定值（后端 platform/dashboard/summary.go
 * `platformAppOtherCode`）。取下划线包裹的 `__other__` 是因为 `models.ValidPlatformCode`
 * 的正则 `^[a-z0-9-]{1,64}$` 不含下划线，故该值不可能与任何真实平台编码碰撞。
 * 空串 `""` 则是「未指定平台」兜底行（恒保留、不参与 Top N 竞争）。
 */
const OTHER_PLATFORM_CODE = '__other__'

/** 「未指定应用」列：单元格 `app_code` 为空串时归入此列（不丢弃，否则合计对不上） */
const UNSET_APP_NAME = '未指定应用'

/** 首列（平台名）固定宽度；其余列按内容自适应，保证横向滚动起点稳定。
 *  窄屏（≤767px）收窄：手机上 160px 首列会吃掉近半屏，挤压可见的数值列。 */
const FIRST_COL_WIDTH = 160
const FIRST_COL_WIDTH_NARROW = 104
const CELL_COL_WIDTH = 120
const CELL_COL_WIDTH_NARROW = 96
const TOTAL_COL_WIDTH = 110
const TOTAL_COL_WIDTH_NARROW = 88

interface PlatformAppMatrixPanelProps {
  /** `dashboard.by_platform_app`；`undefined` / 空数组一律按「不可用」呈现 */
  rows: PlatformAppSummary[] | undefined
}

/** 该平台行是否可下钻：「其他」聚合行与「未指定平台」行均不可下钻（反馈 11 §11.4 不变量 3） */
function isDrillable(platformCode: string): boolean {
  return platformCode !== '' && platformCode !== OTHER_PLATFORM_CODE
}

export function PlatformAppMatrixPanel({ rows }: PlatformAppMatrixPanelProps) {
  const { token } = theme.useToken()
  // 窄屏列宽（手机竖屏上收窄首列与数值列，留出更多可见格子）
  const narrow = useNarrowLayout()
  const firstColWidth = narrow ? FIRST_COL_WIDTH_NARROW : FIRST_COL_WIDTH
  const cellColWidth = narrow ? CELL_COL_WIDTH_NARROW : CELL_COL_WIDTH
  const totalColWidth = narrow ? TOTAL_COL_WIDTH_NARROW : TOTAL_COL_WIDTH
  // 表体字号统一 label 级（桌面 13 / 窄屏 12）：antd 默认 14px 与 04 表（13）不一致，
  // 两张表上下相邻时同权重的数字大小不一（第七轮走查字号阶梯收口）
  const cellFontSize = narrow ? HOME_FONT.body : HOME_FONT.label

  // —— 降级态：字段缺失 / 空库 ——
  if (!rows || rows.length === 0) {
    return (
      <SurfaceCard
        data-testid="platform-app-matrix-panel"
        title="平台与应用的主机分布"
        style={{ height: '100%' }}
      >
        <div
          data-testid="pam-unavailable"
          style={{
            padding: '28px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: HOME_FONT.title, fontWeight: HOME_WEIGHT.title }}>
            平台与应用数据暂不可用
          </div>
          <Text type="secondary" style={{ marginTop: 6, fontSize: HOME_FONT.body, textAlign: 'center' }}>
            暂时取不到平台与应用的分组数据，请稍后重试；若持续如此，请确认主机资源是否已填写平台 / 应用归属。
          </Text>
        </div>
      </SurfaceCard>
    )
  }

  // —— 列集合：所有行出现过的 app_code 并集 ——
  // 排序按列合计降序，并列时 app_code 字典序升序（空串自然排在最前），保证列序确定性。
  const appColumns = Array.from(
    rows.reduce((set, row) => {
      row.cells.forEach((cell) => set.add(cell.app_code))
      return set
    }, new Set<string>()),
  ).sort((a, b) => {
    const totalOf = (code: string) =>
      rows.reduce((sum, row) => {
        const cell = row.cells.find((c) => c.app_code === code)
        return sum + (cell?.host_count ?? 0)
      }, 0)
    const diff = totalOf(b) - totalOf(a)
    return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0
  })

  /** 行合计 = 该行 cells 之和（缺失格子按 0 计），列合计 = 各行对应格子之和 */
  const rowTotalOf = (row: PlatformAppSummary) =>
    row.cells.reduce((sum, cell) => sum + cell.host_count, 0)
  const cellOf = (row: PlatformAppSummary, appCode: string) =>
    row.cells.find((c) => c.app_code === appCode)?.host_count ?? 0
  const colTotalOf = (appCode: string) =>
    rows.reduce((sum, row) => sum + cellOf(row, appCode), 0)
  const grandTotal = rows.reduce((sum, row) => sum + rowTotalOf(row), 0)

  const appNameOf = (appCode: string) =>
    rows.find((row) => row.cells.some((c) => c.app_code === appCode))?.cells.find(
      (c) => c.app_code === appCode,
    )?.app_name || (appCode === '' ? UNSET_APP_NAME : appCode)

  const dataSource = rows.map((row) => ({ ...row, __rowTotal: rowTotalOf(row) }))

  const columns: TableColumnsType<(typeof dataSource)[number]> = [
    {
      title: <TableHeaderText>平台</TableHeaderText>,
      dataIndex: 'platform_name',
      key: 'platform_name',
      width: firstColWidth,
      fixed: 'left',
      render: (name: string, row) => (
        // 下钻说明：资源页当前只解析 `resource_category` / `subtype` / `app_code` / `import`
        // 四个 query 参数，**不支持** `platform_code` 深链筛选；按反馈 11 的约定，
        // 不支持的维度只展示不做链接（避免点了跳过去却没按平台筛的假动作）。
        // 「其他」聚合行与「未指定平台」行同理不可下钻，另附口径角标自解释。
        <span data-testid={`pam-row-${row.platform_code || 'unset'}`} style={{ fontSize: cellFontSize }}>
          {name}
          {!isDrillable(row.platform_code) && (
            <Text type="secondary" style={{ marginLeft: 6, fontSize: HOME_FONT.body }}>
              {row.platform_code === OTHER_PLATFORM_CODE ? '聚合' : '待补录'}
            </Text>
          )}
        </span>
      ),
    },
    ...appColumns.map((appCode) => ({
      title: <TableHeaderText>{appNameOf(appCode)}</TableHeaderText>,
      key: appCode,
      width: cellColWidth,
      align: 'right' as const,
      render: (_: unknown, row: (typeof dataSource)[number]) => {
        const value = cellOf(row, appCode)
        return (
          <span
            data-testid={`pam-cell-${row.platform_code || 'unset'}-${appCode || 'unset'}`}
            style={{
              fontSize: cellFontSize,
              fontVariantNumeric: 'tabular-nums',
              color: value === 0 ? token.colorTextTertiary : token.colorText,
            }}
          >
            {/* 0 是有效计量值，照常渲染 0（不显示 '-'，以免与「不可用」混淆） */}
            {value}
          </span>
        )
      },
    })),
    {
      // 第六轮走查改词：原「平台合计」是行合计却排在应用列末端，与末行「应用合计」
      // 交叉命名，产品负责人原话「看不懂要表达的意思」。统一为「合计」——位置即语义
      // （末列 = 行合计，末行 = 列合计），精确口径进各自 Tooltip 与标题 Tooltip。
      title: (
        <Tooltip title="每行合计：该平台在各应用上的主机数之和">
          <TableHeaderText>合计</TableHeaderText>
        </Tooltip>
      ),
      key: 'row_total',
      width: totalColWidth,
      align: 'right',
      render: (_: unknown, row: (typeof dataSource)[number]) => (
        <span
          data-testid={`pam-row-total-${row.platform_code || 'unset'}`}
          style={{ fontSize: cellFontSize, fontWeight: HOME_WEIGHT.number, fontVariantNumeric: 'tabular-nums' }}
        >
          {row.__rowTotal}
        </span>
      ),
    },
  ]

  return (
    <SurfaceCard
      data-testid="platform-app-matrix-panel"
      title={
        <Tooltip title={MATRIX_SCOPE_TIP}>
          <span>平台与应用的主机分布</span>
        </Tooltip>
      }
      style={{ height: '100%' }}
      extra={
        <Text type="secondary" style={{ fontSize: HOME_FONT.body }}>
          按主机台数统计，行列合计一致
        </Text>
      }
    >
      <Table<(typeof dataSource)[number]>
        data-testid="pam-table"
        rowKey={(row) => row.platform_code || 'unset'}
        size="small"
        dataSource={dataSource}
        pagination={false}
        // 横向滚动 + 首列固定：窄屏（≤767px）也不卡片化，保留行列可比性
        scroll={{ x: firstColWidth + appColumns.length * cellColWidth + totalColWidth }}
        columns={columns}
        rowClassName={(row) =>
          isDrillable(row.platform_code) ? '' : 'pam-row-aggregate'
        }
        summary={() => (
          <Table.Summary>
            <Table.Summary.Row data-testid="pam-summary-row">
              <Table.Summary.Cell index={0} align="left">
                <Tooltip title="每列合计：该应用在各平台上的主机数之和">
                  <span style={{ fontSize: cellFontSize, fontWeight: HOME_WEIGHT.title }}>合计</span>
                </Tooltip>
              </Table.Summary.Cell>
              {appColumns.map((appCode, i) => (
                <Table.Summary.Cell key={appCode} index={i + 1} align="right">
                  <span
                    data-testid={`pam-col-total-${appCode || 'unset'}`}
                    style={{ fontSize: cellFontSize, fontWeight: HOME_WEIGHT.number, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {colTotalOf(appCode)}
                  </span>
                </Table.Summary.Cell>
              ))}
              <Table.Summary.Cell index={appColumns.length + 1} align="right">
                <span
                  data-testid="pam-grand-total"
                  style={{ fontSize: cellFontSize, fontWeight: HOME_WEIGHT.emphasis, fontVariantNumeric: 'tabular-nums' }}
                >
                  {grandTotal}
                </span>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
      {/* 脚注（2026-10-17 第五轮缩减 → 第六轮合并为一行）：完整口径（合计关系、
          「其他」与「未指定」的定义）已进标题 Tooltip，可见版面只留**一行**——
          速记 + 补录引导合并同一行（第六轮走查：两行小字占高度，桌面宽度放得下
          一行；窄容器下 Text 自然换行，不强制不断行）。 */}
      <Text
        data-testid="pam-footnote"
        type="secondary"
        style={{ display: 'block', marginTop: 8, fontSize: HOME_FONT.body }}
      >
        「其他」= 主机较少的平台合并；「未指定」= 还没填归属。归属未填的主机，可到{' '}
        <Link to="/resources?import=1" data-testid="pam-footnote-supplement-link">
          资源清单
        </Link>{' '}
        补填或重新导入。
      </Text>
    </SurfaceCard>
  )
}

export default PlatformAppMatrixPanel