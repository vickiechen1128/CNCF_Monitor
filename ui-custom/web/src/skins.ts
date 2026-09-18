import type { ThemeConfig } from 'antd'

/**
 * 全站皮肤（skin）注册表 —— 本文件是**品牌与语义配色的唯一来源**。
 *
 * 背景（用户 2026-09-18 决策，取代原单一火山引擎主题）：
 * 平台需要同时承载两套视觉方案并可运行时切换——
 * - `volcengine` 火山引擎风格（品牌青 #0ECDEB + 深色顶栏 #0B1B2A）＝ **默认皮肤**，零回归风险；
 * - `inesa` 上海仪电品牌蓝（主色 #1B5BA3 + 顶栏 #164A87 + 语义红 #C0392B），简约风。
 * 皮肤作用域为**全站**：antd token 天然全站生效，散落色值已全部收敛到本文件的 token。
 *
 * 设计约束（决定本文件的结构，勿轻易改动）：
 * 1. **两套皮肤必须同键**：都实现 `SkinTokens`，缺键在编译期由 `satisfies` 拦下，
 *    避免「切到某套皮肤后某个颜色取不到值」的运行时空洞。
 * 2. **语义红跟随皮肤**（用户明确决策）：`colorError` 与 `colorErrorBg` 属皮肤 token，
 *    因此告警级别 Tag（SEVERITY_* 见 `pages/alerts/alertmanagerConstants.ts`）、
 *    资源离线态、下发失败计数等全部随皮肤切换——它们都从 token 取值，不得再写字面量。
 * 3. **禁止模块级快照**：任何「在模块顶层把 token 读成常量」的写法都会让运行时换肤失效
 *    （上一版 `alertmanagerConstants.ts` 即踩此坑）。token 只能以「函数入参」或
 *    「组件内 `theme.useToken()`」两种方式消费。
 * 4. **CSS 变量单一来源**：`App.css` 无法读取 antd token，故由 `SkinProvider` 在运行时按
 *    `CSS_VAR_BY_TOKEN` 把 token 注入 `document.documentElement`，CSS 侧只写 `var(--app-*, 兜底值)`。
 */

/** 皮肤标识（持久化键与 `html[data-skin]` 共用同一套取值） */
export type SkinKey = 'volcengine' | 'inesa'

/**
 * 一套皮肤需要提供的全部色值。
 * 前四组与 antd 主题 token 同名（避免二次命名），第五组为自绘顶栏专用扩展。
 */
export interface SkinTokens {
  // 品牌色
  colorPrimary: string
  colorPrimaryHover: string
  colorPrimaryActive: string
  colorPrimaryBg: string
  colorPrimaryBgHover: string
  /** 品牌浅底描边（提示条 / 高亮框用） */
  colorPrimaryBorder: string
  /** 主按钮投影（跟随品牌色，勿写死 rgba） */
  colorPrimaryShadow: string

  // 功能色
  colorSuccess: string
  colorSuccessBg: string
  colorSuccessBorder: string
  colorWarning: string
  colorWarningBg: string
  colorWarningBorder: string
  /** 语义红：**随皮肤切换**（决策 2026-09-18） */
  colorError: string
  colorErrorBg: string
  colorInfo: string
  colorInfoBg: string
  colorInfoBgHover: string
  colorInfoBorder: string

  // 文字色
  colorTextBase: string
  colorTextSecondary: string
  colorTextTertiary: string
  colorTextQuaternary: string

  // 背景与边框
  colorBgBase: string
  colorBgContainer: string
  colorBgElevated: string
  colorBorder: string
  colorBorderSecondary: string

  // 自绘顶部栏（深色 Header，非 antd 组件色）
  colorHeaderBg: string
  colorHeaderText: string
  /** 顶部栏一级模块选中态（文字 + 下划线同色） */
  colorHeaderAccent: string
  /** 顶部栏未选中文字 */
  colorHeaderTab: string
  colorHeaderTabHover: string
}

/** 一套皮肤 = 标识 + 开关展示信息 + 色值 */
export interface SkinDefinition {
  key: SkinKey
  /** 皮肤开关上的展示名 */
  label: string
  /** 皮肤开关上的悬浮说明 */
  description: string
  tokens: SkinTokens
}

/**
 * 火山引擎皮肤（**默认**）。
 * 色值与用户 2026-09-18 切换前线上版本逐字一致 → 默认皮肤下应零视觉回归。
 */
const volcengine: SkinDefinition = {
  key: 'volcengine',
  label: '火山青',
  description: '火山引擎风格 · 青绿主色',
  tokens: {
    colorPrimary: '#0ECDEB',
    colorPrimaryHover: '#0ABBD7',
    colorPrimaryActive: '#09A7C1',
    colorPrimaryBg: '#E6FAFD',
    colorPrimaryBgHover: '#BFF4FB',
    colorPrimaryBorder: '#BFF4FB',
    colorPrimaryShadow: 'rgba(14, 205, 235, 0.1)',

    colorSuccess: '#00B578',
    colorSuccessBg: '#E6F9F2',
    colorSuccessBorder: '#A8E6CE',
    colorWarning: '#FA8C16',
    colorWarningBg: '#FFF4E6',
    colorWarningBorder: '#FFD8A8',
    colorError: '#FF4C3A',
    colorErrorBg: '#FFEBE9',
    colorInfo: '#1481FD',
    colorInfoBg: '#E6F1FF',
    colorInfoBgHover: '#BEDAFF',
    colorInfoBorder: '#BEDAFF',

    colorTextBase: '#1D2129',
    colorTextSecondary: '#4E5969',
    colorTextTertiary: '#86909C',
    colorTextQuaternary: '#C9CDD4',

    colorBgBase: '#F7F8FA',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#E5E6EB',
    colorBorderSecondary: '#F2F3F5',

    colorHeaderBg: '#0B1B2A',
    colorHeaderText: '#FFFFFF',
    colorHeaderAccent: '#0ECDEB',
    colorHeaderTab: '#C9CDD4',
    colorHeaderTabHover: '#FFFFFF',
  },
}

/**
 * 上海仪电（INESA）品牌蓝皮肤。
 * 主色 #1B5BA3 / 亮档 #206DB1 / 深档 #1D55A2 取自集团品牌图实测直方图（2026-09-18）；
 * 顶栏取更深一档 #164A87（用户反馈「主色直接做顶栏太亮」）；
 * 语义红 #C0392B（与蓝主色同明度层级，避免高饱和红在简约蓝调里跳脱）；
 * 链接色 #2E6FD0 独立于主色，避免与主色撞色导致链接不可辨。
 */
const inesa: SkinDefinition = {
  key: 'inesa',
  label: '仪电蓝',
  description: '上海仪电品牌蓝 · 简约',
  tokens: {
    colorPrimary: '#1B5BA3',
    colorPrimaryHover: '#206DB1',
    colorPrimaryActive: '#1D55A2',
    colorPrimaryBg: '#EAF1FA',
    colorPrimaryBgHover: '#D6E4F5',
    colorPrimaryBorder: '#B9CFE8',
    colorPrimaryShadow: 'rgba(27, 91, 163, 0.1)',

    colorSuccess: '#00B578',
    colorSuccessBg: '#E6F9F2',
    colorSuccessBorder: '#A8E6CE',
    colorWarning: '#FA8C16',
    colorWarningBg: '#FFF4E6',
    colorWarningBorder: '#FFD8A8',
    colorError: '#C0392B',
    colorErrorBg: '#FBE9E7',
    colorInfo: '#2E6FD0',
    colorInfoBg: '#E8F0FC',
    colorInfoBgHover: '#CDDDF7',
    colorInfoBorder: '#A9C6EE',

    colorTextBase: '#1D2129',
    colorTextSecondary: '#4E5969',
    colorTextTertiary: '#86909C',
    colorTextQuaternary: '#C9CDD4',

    colorBgBase: '#F5F7FA',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#E6EBF2',
    colorBorderSecondary: '#F0F3F8',

    colorHeaderBg: '#164A87',
    colorHeaderText: '#FFFFFF',
    // 深蓝顶栏上主色（#1B5BA3）对比度不足，选中态改用白色文字 + 白色下划线
    colorHeaderAccent: '#FFFFFF',
    colorHeaderTab: '#BFD3EA',
    colorHeaderTabHover: '#FFFFFF',
  },
}

/** 皮肤注册表（键即 SkinKey，新增皮肤只需在此登记 + 在 SKIN_ORDER 追加） */
export const SKINS: Record<SkinKey, SkinDefinition> = { volcengine, inesa }

/**
 * 默认皮肤：火山青。
 * 用户 2026-09-18 决策——旧配色为默认，保证既有用户/验收基线零视觉回归；
 * INESA 蓝为可切换项。
 */
export const DEFAULT_SKIN: SkinKey = 'volcengine'

/** 开关上的展示顺序（默认皮肤在前，便于用户理解「原本长什么样」） */
export const SKIN_ORDER: readonly SkinKey[] = ['volcengine', 'inesa']

/** 运行时校验（持久化值与 URL 参数均不可信，非法值回落默认皮肤而不是抛错） */
export function isSkinKey(value: unknown): value is SkinKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SKINS, value)
}

/** 按 key 取皮肤定义；非法 key 回落默认皮肤（调用方无需再判空） */
export function skinDefinition(key: SkinKey): SkinDefinition {
  return SKINS[key] ?? SKINS[DEFAULT_SKIN]
}

/** 按 key 取 token；非法 key 回落默认皮肤 */
export function skinTokens(key: SkinKey): SkinTokens {
  return skinDefinition(key).tokens
}

/**
 * 皮肤 token → CSS 变量名映射。
 *
 * `App.css` 里的自绘元素（顶栏、侧栏选中态、内容底色）读不到 antd token，
 * 因此由 `SkinProvider` 在换肤时按此表把 token 写入 `document.documentElement`；
 * CSS 侧一律写成 `var(--app-xxx, <火山青兜底值>)`，兜底值兼作「JS 未执行」时的降级。
 * 变量命名前缀统一 `--app-`，避免与 antd 自身注入的 `--ant-*` 混淆。
 */
export const CSS_VAR_BY_TOKEN = {
  '--app-header-bg': 'colorHeaderBg',
  '--app-header-text': 'colorHeaderText',
  '--app-header-accent': 'colorHeaderAccent',
  '--app-header-tab': 'colorHeaderTab',
  '--app-header-tab-hover': 'colorHeaderTabHover',
  '--app-primary': 'colorPrimary',
  '--app-primary-bg': 'colorPrimaryBg',
  '--app-bg-base': 'colorBgBase',
  '--app-bg-container': 'colorBgContainer',
  '--app-border': 'colorBorder',
  '--app-border-secondary': 'colorBorderSecondary',
  '--app-text-tertiary': 'colorTextTertiary',
} as const satisfies Record<`--app-${string}`, keyof SkinTokens>

/**
 * 由一套皮肤 token 构建 antd 主题配置。
 * 纯函数：入参 token，出参 ThemeConfig，**不读任何模块级可变状态**，
 * 因此可在 `SkinProvider` 内随当前皮肤重新构建（换肤即时生效）。
 */
export function buildSkinTheme(tokens: SkinTokens): ThemeConfig {
  return {
    token: {
      colorPrimary: tokens.colorPrimary,
      colorSuccess: tokens.colorSuccess,
      colorWarning: tokens.colorWarning,
      colorError: tokens.colorError,
      colorInfo: tokens.colorInfo,
      colorTextBase: tokens.colorTextBase,
      colorBgBase: tokens.colorBgBase,
      colorBgContainer: tokens.colorBgContainer,
      colorBorder: tokens.colorBorder,
      borderRadius: 6,
      wireframe: false,
    },
    components: {
      Layout: {
        headerBg: tokens.colorHeaderBg,
        headerColor: tokens.colorHeaderText,
        siderBg: tokens.colorBgContainer,
        triggerBg: tokens.colorBgContainer,
      },
      Menu: {
        itemSelectedBg: tokens.colorPrimaryBg,
        itemSelectedColor: tokens.colorPrimary,
        itemHoverBg: tokens.colorBgBase,
        itemHoverColor: tokens.colorPrimary,
        itemColor: tokens.colorTextSecondary,
      },
      Button: {
        primaryShadow: tokens.colorPrimaryShadow,
      },
      Card: {
        headerBg: 'transparent',
      },
      Tag: {
        defaultBg: tokens.colorBorderSecondary,
      },
    },
  }
}
