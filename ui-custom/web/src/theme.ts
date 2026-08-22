import type { ThemeConfig } from 'antd'

/**
 * Volcengine 火山引擎风格设计 Token（D1 视觉还原：复用原型 Module_06 视觉体系）
 * 参考：品牌主色 #0ECDEB，链接蓝 #1481FD，错误红 #FF4C3A
 * 来源：`docs/prototypes/module-06/src/theme.ts`（原型 = 实现基底，全局订阅到生产）
 */
export const volcengineTokens = {
  // 品牌色
  colorPrimary: '#0ECDEB',
  colorPrimaryHover: '#0ABBD7',
  colorPrimaryActive: '#09A7C1',
  colorPrimaryBg: '#E6FAFD',
  colorPrimaryBgHover: '#BFF4FB',

  // 功能色
  colorSuccess: '#00B578',
  colorSuccessBg: '#E6F9F2',
  colorWarning: '#FA8C16',
  colorWarningBg: '#FFF4E6',
  colorError: '#FF4C3A',
  colorErrorBg: '#FFEBE9',
  colorInfo: '#1481FD',
  colorInfoBg: '#E6F1FF',

  // 文字色
  colorTextBase: '#1D2129',
  colorTextSecondary: '#4E5969',
  colorTextTertiary: '#86909C',
  colorTextQuaternary: '#C9CDD4',

  // 背景与边框
  colorBgBase: '#F7F8FA',
  colorBgContainer: '#FFFFFF',
  colorBgElevated: '#FFFFFF',
  colorBorder: '#E5E6EB',
  colorBorderSecondary: '#F2F3F5',

  // 火山引擎深色头部
  colorHeaderBg: '#0B1B2A',
  colorHeaderText: '#FFFFFF',
}

export const volcengineTheme: ThemeConfig = {
  token: {
    colorPrimary: volcengineTokens.colorPrimary,
    colorSuccess: volcengineTokens.colorSuccess,
    colorWarning: volcengineTokens.colorWarning,
    colorError: volcengineTokens.colorError,
    colorInfo: volcengineTokens.colorInfo,
    colorTextBase: volcengineTokens.colorTextBase,
    colorBgBase: volcengineTokens.colorBgBase,
    colorBgContainer: volcengineTokens.colorBgContainer,
    colorBorder: volcengineTokens.colorBorder,
    borderRadius: 6,
    wireframe: false,
  },
  components: {
    Layout: {
      headerBg: volcengineTokens.colorHeaderBg,
      headerColor: volcengineTokens.colorHeaderText,
      siderBg: volcengineTokens.colorBgContainer,
      triggerBg: volcengineTokens.colorBgContainer,
    },
    Menu: {
      itemSelectedBg: volcengineTokens.colorPrimaryBg,
      itemSelectedColor: volcengineTokens.colorPrimary,
      itemHoverBg: volcengineTokens.colorBgBase,
      itemHoverColor: volcengineTokens.colorPrimary,
      itemColor: volcengineTokens.colorTextSecondary,
    },
    Button: {
      primaryShadow: '0 2px 0 rgba(14, 205, 235, 0.1)',
    },
    Card: {
      headerBg: 'transparent',
    },
    Tag: {
      defaultBg: volcengineTokens.colorBorderSecondary,
    },
  },
}

export default volcengineTheme