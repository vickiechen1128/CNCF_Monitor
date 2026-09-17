/**
 * 统一提示条配色（与 module-06 / module-09 原型同款视觉语言）。
 *
 * 单独成文件的原因：`Callout.tsx` 只应导出组件（react-refresh 的 only-export-components 规则），
 * 需要同时被页面复用的配色常量放这里。
 */
export interface CalloutToneStyle {
  bg: string
  border: string
  color: string
}

export const CALLOUT_TONES: Record<'brand' | 'info' | 'warning' | 'success' | 'error', CalloutToneStyle> = {
  brand: { bg: '#F0FBFD', border: '#BFF4FB', color: '#0ECDEB' },
  info: { bg: '#F2F7FF', border: '#BEDAFF', color: '#1481FD' },
  warning: { bg: '#FFF8EE', border: '#FFD8A8', color: '#FA8C16' },
  success: { bg: '#F0FBF7', border: '#A8E6CE', color: '#00B578' },
  error: { bg: '#FFF1F0', border: '#FFCCC7', color: '#FF4C3A' },
}

export type CalloutTone = keyof typeof CALLOUT_TONES
