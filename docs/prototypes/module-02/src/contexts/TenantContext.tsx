import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 租户级模式开关演示（对齐 web-development 规范：mock 包含 Tenant.multi_site_enabled）
 * 单网域模式（默认）：仅 default 网域，注入对用户透明；多网域模式：展示全部授权网域
 */
interface TenantContextValue {
  multiSiteEnabled: boolean
  setMultiSiteEnabled: (enabled: boolean) => void
}

const TenantContext = createContext<TenantContextValue>({
  multiSiteEnabled: false,
  setMultiSiteEnabled: () => {},
})

export function TenantProvider({ children }: { children: ReactNode }) {
  const [multiSiteEnabled, setMultiSiteEnabled] = useState(false)
  return (
    <TenantContext.Provider value={{ multiSiteEnabled, setMultiSiteEnabled }}>
      {children}
    </TenantContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTenant() {
  return useContext(TenantContext)
}
