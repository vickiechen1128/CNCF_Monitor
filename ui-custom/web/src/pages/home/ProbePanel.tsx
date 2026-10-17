/**
 * 拨测态势区（Module_05 §3.1 决策 93 / PRD v1.8；形态按 design-proposal §2.7
 * 「计数总览 + 异常短名单 + 深链」简化；2026-10-17 走查改为**两张独立卡片**）。
 *
 * 区结构（**第六轮走查改版**）：单张卡——卡头（「拨测态势」标题 + 「查看异常拨测目标 →」
 * 深链，指向 M09 监控目标状态并预筛离线）→ 卡体一行：左「正常率」整体健康度圆环
 * （仿 04 整体纳管完成率样式）+ 右两个浅底圆角子分区（窄屏三者纵向堆叠）→ 无明细行。
 * 根容器 `probe-panel` **恒定**：全空时渲染卡内空态、有目标时渲染上述结构，
 * 两种状态共用同一 wrapper（数据到位不换根节点，锚点稳定）。
 * 两个子分区按拨测对象拆分（models.BlackboxProbeCategories，仅这两类可作拨测对象），
 * 两类视角不同、混排不利于领导阅读：
 * - 接口服务拨测（`interface_service`，偏业务）：地址取 `api_url`，服务名取 `api_name`；
 * - 应用服务拨测（`application`，偏平台）：地址取 `health_check_url`，服务名取**应用字典
 *   中文名**（app_code → app_name，多个模型服务实例同属一个应用时领导关心的是应用整体）。
 *
 * **每个子分区自带四格统计条**（共 N · 正常 X · 异常 Y · 未知 Z），分区自解释，
 * 两个分区并排即可横向对比两类拨测；空类别的分区照常渲染（统计条全 0），避免
 * 「只有一类时另一半版面空缺」的跳版。
 * **整体健康度「正常率」**（第六轮走查新增）：卡内左列圆环（ProbeHealthDonut），
 * 仿 04 整体圆环样式；原区头汇总行（「拨测目标 N · 正常 X · 异常 Y · 未知 Z」）
 * 按产品负责人要求**移除**——对账数字收进圆环值行与 Tooltip。
 *
 * 简化口径（§2.7，产品负责人 2026-10-17 拍板）：
 * - **不渲染**任何完整明细表与分页器——首屏只做总览；
 * - 卡级**异常短名单**：仅 `status === 'down'` 的目标，**最多 3 条**；超过 3 条时末行
 *   「另有 N 条异常，去「采集 Job」查看 →」——纯计数会让「异常 3」成为没有下文的数字，
 *   采集 Job 页只到 Job 级聚合，定位到具体目标需再进 Job 详情抽屉；
 * - 脚注（全区一条）：「各拨测目标的逐条探测结果，请到「采集 Job」页查看。」
 *
 * 数据源：**受控组件**，由 HomePage 注入 `probeTargets`（后端 `summary.probe_targets[]`，
 * 决策 93 明细口径）。前端负责排序 / 分区（PRD §5.1：接口不承担排序）。
 * 短名单行 = 异常徽标 + 服务名 + 拨测地址（省略）+ 归属网域 + 最近拨测（相对时间）。
 * 归属口径见 design-proposals/probe-ownership-alignment.md：拨测目标不承载「应用 / 业务域」
 * 维度，归属以必然有值的网域承载。
 *
 * 字段降级（决策 93 口径，诚实展示）：
 * - service_name / url 缺失 → '-';
 * - platform_names 缺失（接口服务恒空 / 应用无关联）→ '-';
 * - status 空串（无 probe_success 样本）→ 中性「未知」态，不渲染成 up/down 绿红；
 * - network_domain_name 空串 → '-'（防御旧后端）；
 * - last_probe_at 缺失（后端 nil）→ '最近拨测' 显示 '-'。
 * 排序：只有明确的 down 强制排最前；未知态不强制排前，同未知态按原序（稳定排序）。
 *
 * 深链（★A）：`PROBE_STRATEGY_HREF` 曾指向 `/strategy`，而 App.tsx **无该路由**
 * （命中 `path="*"` → 跳回首页），实际是死链；改指 **`/scrape-jobs`**（采集 Job）。
 *
 * **入「采集健康 + 拨测态势」行（2026-10-17 第六轮走查）**：拨测与采集健康同处
 * `home-health-probe-row`（flex-wrap，采集 1 : 拨测 2）。宽容器下拨测列 ≈560px 起，
 * 双卡并排；更窄容器整行折为上下堆叠，拨测独占整宽——与第五轮「整宽卡」形态一致。
 * 折行后 height:100% 解析为 auto（行高即自身内容高）；并行时经 wrapper（display:flex）
 * → 根节点 → 双卡行（flex:1）的高度链撑满行高，双卡拉伸、不留 ragged bottom。
 */
import { useMemo } from 'react'
import { Typography, theme } from 'antd'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import type { ProbeTargetItem } from '../../api/dashboard'
import { SurfaceCard } from './SurfaceCard'
import { ProbeHealthDonut } from './ProbeHealthDonut'
import { HOME_FONT, HOME_WEIGHT } from './homeTypography'
import { useNarrowLayout } from './homeResponsive'

/** 拨测任务管理深链（空态配置入口）：采集 Job 页（★A 原 `/strategy` 为死链） */
const PROBE_STRATEGY_HREF = '/scrape-jobs'

/**
 * 异常拨测目标深链（第六轮走查，产品负责人裁定）：卡头原「拨测任务管理 →」改为
 * **异常明细入口** —— M09 监控目标状态（/targets）预筛「离线」（`health=down`），
 * 落页即只看异常节点；筛选能力由 TargetStatusPage 的 URL 参数承接，不新造页面。
 */
const TARGETS_ABNORMAL_HREF = '/targets?health=down'

/**
 * 拨测明细深链前缀（2026-10-17 第六轮走查）：异常明细不在首页展示，改到
 * **资源清单按类型预筛**——`resource_category` 是资源清单页已支持的深链参数
 * （决定首屏 Tab），落页即只看该类采集对象、且自带「采集状态」列，
 * 正是「自动筛选好拨测类型」。比另开一个参数体系更稳。
 */
const RESOURCE_LIST_HREF = '/resources'

/** 拨测分区定义（对应后端 models.BlackboxProbeCategories，仅这两类可作拨测对象）。
 *  key 与后端 `probe_targets[].resource_category` 对齐；空串（旧后端未返回）归入接口服务分区。
 *  `linkLabel` 为分区深链文案（按类型预筛资源清单）。 */
const PROBE_SECTIONS = [
  {
    key: 'interface_service',
    title: '接口服务拨测',
    // 文案口径（2026-10-17 手机/领导视角走查）：不暴露 `api_url` 等字段名，改用自解释表述
    hint: '业务接口能否正常访问',
    linkLabel: '查看接口服务采集对象',
  },
  {
    key: 'application',
    title: '应用服务拨测',
    hint: '应用健康检查地址能否正常访问',
    linkLabel: '查看应用服务采集对象',
  },
] as const

/** 归类：未返回 / 未知类别一律归入接口服务分区（拨测早期口径只支持接口服务）。 */
function sectionKeyOf(target: ProbeTargetItem): string {
  return target.resource_category === 'application' ? 'application' : 'interface_service'
}

/**
 * 排序时间戳：缺失 / 非法计最小安全值（排到同组末位），避免 `dayjs(undefined)` 视作
 * 「当前时间」把无时间条目顶到最前、或 NaN 比较器导致顺序不定。
 */
function probeTime(iso?: string): number {
  if (!iso) return Number.MIN_SAFE_INTEGER
  const d = dayjs(iso)
  return d.isValid() ? d.valueOf() : Number.MIN_SAFE_INTEGER
}

/** 拨测目标排序：只有明确的 down 强制固定排最前；其余按最近拨测倒序（未知态不强制前置，
 *  同未知态（空时间）由于比较器相等走稳定排序 → 保持原序，决策 93）。 */
function sortProbeTargets(targets: ProbeTargetItem[]): ProbeTargetItem[] {
  return [...targets].sort((a, b) => {
    const aDown = a.status === 'down'
    const bDown = b.status === 'down'
    if (aDown !== bDown) return aDown ? -1 : 1
    return probeTime(b.last_probe_at) - probeTime(a.last_probe_at)
  })
}

/** 四格统计条（每个子版面的总体数字）：共 N · 正常 X · 异常 Y · 未知 Z。
 *  2026-10-17 第六轮走查：异常短名单下架后，子版面只剩标题 + 四格——改为
 *  **2×2 撑满剩余高度**（格子 flex:1 + 内容纵向居中），不再让卡片下半部留白。 */
function ProbeStatStrip({ sectionKey, total, normal, abnormal, unknown }: {
  sectionKey: string
  total: number
  normal: number
  abnormal: number
  unknown: number
}) {
  const { token } = theme.useToken()
  const cell = (key: string, label: string, value: number, color?: string) => (
    <div
      key={key}
      data-testid={`probe-stat-${sectionKey}-${key}`}
      style={{
        flex: '1 1 40%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: HOME_FONT.title,
          fontWeight: HOME_WEIGHT.number,
          lineHeight: 1.1,
          color: color ?? token.colorText,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
      {/* 指标名 body 级 12px：第七轮走查前为 11px，与 04 卡底脚注同级；
          四格是「行级计数」不是注释，标签应回到正常可读尺寸（16 的数字 + 12 的标签） */}
      <span style={{ fontSize: HOME_FONT.body, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  )
  return (
    <div
      data-testid={`probe-section-count-${sectionKey}`}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 10,
        flex: 1,
        alignContent: 'stretch',
      }}
    >
      {cell('total', '拨测目标', total)}
      {cell('normal', '正常', normal)}
      {cell('abnormal', '异常', abnormal, abnormal > 0 ? token.colorErrorText : undefined)}
      {cell('unknown', '未知', unknown, unknown > 0 ? token.colorTextTertiary : undefined)}
    </div>
  )
}

export function ProbePanel({ probeTargets = [] }: { probeTargets?: ProbeTargetItem[] }) {
  const { token } = theme.useToken()
  // 窄屏（≤767px）：短名单行由「单行五段」改为两行（徽标 + 服务名 + 时间 / 地址独占次行），
  // 并隐藏「归属网域」（手机宽度下五段必然挤压；网域为次要归属信息，宽屏仍完整展示）
  const narrow = useNarrowLayout()

  const sorted = useMemo(() => sortProbeTargets(probeTargets), [probeTargets])
  const normalCount = sorted.filter((t) => t.status === 'up').length
  const abnormalCount = sorted.filter((t) => t.status === 'down').length
  /**
   * 未知态计数（2026-10-17 走查修复）：`status` 为空串表示尚未拿到探测结果。
   * 区头汇总只给「共 N · 正常 X · 异常 Y」时，真实环境（无 probe_success 样本）下
   * 三个数加起来对不上总数（如「共 2 · 正常 0 · 异常 0」），领导会以为数字算错。
   * 补上「未知 Z」使三项自洽；Z 为 0 时不显示该段（避免噪音）。
   */
  const unknownCount = sorted.length - normalCount - abnormalCount

  /**
   * 整体健康度「正常率」（第六轮走查新增，产品负责人要求）：正常拨测目标 ÷ 总数。
   * 与「正常 X」的区别：X 是绝对数、正常率是整体健康度——领导一眼看「百分之多少
   * 的拨测是好的」，不必自己拿 X 除 N。总数为 0（无拨测目标）时显示 '-'，
   * 不渲染 0%（决策 68-2：不把「没有数据」表达成「健康度零」）。
   */
  const healthRate =
    sorted.length > 0 ? Math.round((normalCount / sorted.length) * 100) : undefined

  /** 按拨测对象分区：接口服务 / 应用服务，各自计数（空分区也渲染卡，统计条全 0） */
  const sections = useMemo(
    () =>
      PROBE_SECTIONS.map((s) => {
        const rows = sorted.filter((t) => sectionKeyOf(t) === s.key)
        const normal = rows.filter((t) => t.status === 'up').length
        const abnormal = rows.filter((t) => t.status === 'down').length
        return {
          ...s,
          rows,
          normal,
          abnormal,
          // 未知 = 总数 − 正常 − 异常（与区头同一口径，保证三项自洽）
          unknown: rows.length - normal - abnormal,
        }
      }),
    [sorted],
  )

  // 根容器恒定（空态 / 双分区态复用同一 wrapper）：避免数据到位后根节点被换掉，
  // 让 `probe-panel` 锚点与测试引用在两种状态间保持稳定。
  // **第六轮走查（2026-10-17，产品负责人裁定）**：
  // ① 区头（标题 + 深链）与两个子版面**合为一张卡**——旧版区头是卡外一行、两个子版面
  //    各套一层 SurfaceCard，「拨测态势」标题与两张卡视觉上是三块；现改为单张卡内
  //    两个浅底圆角分区，样式上做成一体；
  // ② 原区头汇总行（「拨测目标 N · 正常 X · 异常 Y · 未知 Z」）**移除**（产品负责人：
  //    「这个就不需要了」）——整体情况改由卡内左列「正常率」圆环承载；
  // ③ 「正常率」圆环**仿 04 整体纳管完成率样式**（圆环 + 圆心百分数 + 标签 + 对账值行），
  //    做在卡内左列，与两个子分区构成「整体 + 明细」共同体；
  // ④ 卡根 display:flex + 卡体 flex:1 + 内容行 flex:1 的高度链：与采集健康并行时
  //    撑满行高（旧版卡根非 flex，body 的 flex:1 不生效——卡高满而内容悬在卡顶，
  //    即产品负责人说的「没有填满整行」）。
  return (
    <SurfaceCard
      data-testid="probe-panel"
      title="拨测态势"
      extra={
        <Link to={TARGETS_ABNORMAL_HREF} style={{ fontSize: HOME_FONT.label }}>
          查看异常拨测目标 →
        </Link>
      }
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{ body: { padding: 20, display: 'flex', flexDirection: 'column', flex: 1 } }}
    >
      {sorted.length === 0 ? (
        <div
          style={{
            padding: '28px 16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
          data-testid="probe-empty"
        >
          <div
            style={{
              fontSize: HOME_FONT.title,
              fontWeight: HOME_WEIGHT.title,
              color: token.colorText,
            }}
          >
            暂无拨测目标
          </div>
          <Typography.Text type="secondary" style={{ fontSize: HOME_FONT.body }}>
            拨测由采集任务承载，不占用资源台账：先创建拨测采集任务，并登记要探测的地址。
          </Typography.Text>
          <Link to={PROBE_STRATEGY_HREF}>去配置拨测任务 →</Link>
        </div>
      ) : (
        /* 卡体一行：左「正常率」整体圆环（仿 04 整体圆环）+ 右两个子分区。
           窄屏（≤767px）圆环与子分区纵向堆叠（圆环居中）。 */
        <>
        <div
          style={{
            display: 'flex',
            flexDirection: narrow ? 'column' : 'row',
            gap: 16,
            flex: 1,
            minWidth: 0,
            /* 纵排（手机）不能用 center：纵轴布局里 center = 横向居中 + 按内容收缩，
               两个子分区会被压成内容宽，卡内宽度白白浪费。改 stretch 撑满，
               圆环块靠 alignSelf:center 单独居中（第七轮走查同一类修复）。 */
            alignItems: 'stretch',
          }}
        >
          {/* 整体健康度：正常率圆环（对账数字在环下值行与 Tooltip）。
              列宽 110 → 120：与 04 纳管圆环同几何同尺寸（第七轮走查），两环并排才像一套仪表盘 */}
          <div
            style={{
              flex: '0 0 auto',
              width: 120,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignSelf: narrow ? 'center' : undefined,
            }}
          >
            <ProbeHealthDonut
              percent={healthRate}
              normal={normalCount}
              total={sorted.length}
              abnormal={abnormalCount}
              unknown={unknownCount}
            />
          </div>

          {/* 两个子版面：接口服务拨测 / 应用服务拨测，宽屏并排等宽、窄屏堆叠。
              浅底圆角块 = 同一张卡里的两个分区（不再卡中卡），与区头样式上做成一体。 */}
          <div
            style={{
              display: 'flex',
              flexDirection: narrow ? 'column' : 'row',
              gap: 16,
              flex: 1,
              minWidth: 0,
              alignItems: 'stretch',
            }}
          >
            {sections.map((s) => {
              return (
                <div
                  key={s.key}
                  data-testid={`probe-section-${s.key}`}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 12,
                    borderRadius: 8,
                    background: token.colorFillQuaternary,
                  }}
                >
                  {/* 分区标题 + 一句自解释 hint（不暴露字段名） */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: HOME_FONT.title,
                        fontWeight: HOME_WEIGHT.title,
                        color: token.colorText,
                      }}
                    >
                      {s.title}
                    </span>
                    <Typography.Text type="secondary" style={{ fontSize: HOME_FONT.body }}>
                      {s.hint}
                    </Typography.Text>
                  </div>

                  {/* 总体数字：四格统计条（2×2 撑满剩余高度，本区自解释，两区可横向对比） */}
                  <ProbeStatStrip
                    sectionKey={s.key}
                    total={s.rows.length}
                    normal={s.normal}
                    abnormal={s.abnormal}
                    unknown={s.unknown}
                  />

                  {/* 空类别分区：给一行弱提示（统计条全 0 时说明为什么是 0） */}
                  {s.rows.length === 0 && (
                    <div style={{ fontSize: HOME_FONT.body, color: token.colorTextTertiary }}>
                      暂无{s.title}目标
                    </div>
                  )}

                  {/* 逐条明细深链（第六轮走查：异常短名单下架，改到资源清单按类型预筛） */}
                  <div
                    data-testid={`probe-section-link-${s.key}`}
                    style={{ marginTop: 10, paddingTop: 8, fontSize: HOME_FONT.body }}
                  >
                    <Link to={`${RESOURCE_LIST_HREF}?resource_category=${s.key}`}>
                      {s.linkLabel} →
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        </>
      )}
    </SurfaceCard>
  )
}

export default ProbePanel
