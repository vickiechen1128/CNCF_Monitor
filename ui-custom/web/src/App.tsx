import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import HomePage from './pages/home/HomePage'
import DomainsPage from './pages/admin/domains/DomainsPage'
import UsersPage from './pages/admin/users/UsersPage'
import TenantsPage from './pages/admin/tenants/TenantsPage'
import LoginLogsPage from './pages/admin/login-logs/LoginLogsPage'
import ResourcesPage from './pages/resources/ResourcesPage'
import BusinessDomainPage from './pages/resources/BusinessDomainPage'
import LabelTemplatesPage from './pages/label-templates/LabelTemplatesPage'
import ScrapeJobListPage from './pages/strategy/ScrapeJobListPage'
import CollectorListPage from './pages/strategy/CollectorListPage'
import RulesPage from './pages/strategy/RulesPage'
import MetricLibraryPage from './pages/strategy/MetricLibraryPage'
import LoginPage from './pages/login/LoginPage'
import { getToken, setUnauthorizedNavigate } from './api/client'
import './App.css'

// Module_09 网域与边缘配置中心（Phase 4，MVP）路由，懒加载
const NetworkDomainsPage = lazy(() =>
  import('./pages/config-center/domains/NetworkDomainsPage').then((m) => ({ default: m.NetworkDomainsPage })),
)
const EdgeAgentsPage = lazy(() =>
  import('./pages/config-center/nodes/EdgeAgentsPage').then((m) => ({ default: m.EdgeAgentsPage })),
)
const ConfigPreviewPage = lazy(() =>
  import('./pages/config-center/preview/ConfigPreviewPage').then((m) => ({ default: m.ConfigPreviewPage })),
)
const DeploymentsPage = lazy(() =>
  import('./pages/config-center/deployments/DeploymentsPage').then((m) => ({ default: m.DeploymentsPage })),
)
// Module_02 决策 47-4：独立目标状态页（P1 极简列表，跨 Job 全局排障入口；不新增顶部一级 tab）
const TargetStatusPage = lazy(() =>
  import('./pages/query/TargetStatusPage').then((m) => ({ default: m.TargetStatusPage })),
)

// Module_08 告警收敛与通知管理路由，懒加载
const AlertConfigPage = lazy(() =>
  import('./pages/alerts/AlertConfigPage').then((m) => ({ default: m.AlertConfigPage })),
)
const SilencesPage = lazy(() =>
  import('./pages/alerts/SilencesPage').then((m) => ({ default: m.SilencesPage })),
)

/**
 * 路由守卫：无 Token（未登录 / 会话失效）一律重定向到 /login，
 * 携带 redirect 便于登录后回跳原页面；有 Token 则渲染受保护的子路由。
 */
export function RequireAuth() {
  const location = useLocation()
  if (!getToken()) {
    const redirect = `${location.pathname}${location.search}`
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />
  }
  return <Outlet />
}

function AppRoutes() {
  const navigate = useNavigate()

  // 在路由层注入 401 统一跳转：client 遇到 401 时清 Token 并以客户端路由跳到 /login。
  useEffect(() => {
    setUnauthorizedNavigate((to) => navigate(to, { replace: true }))
    return () => setUnauthorizedNavigate(null)
  }, [navigate])

  return (
    <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>加载中…</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin/domains" element={<DomainsPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/tenants" element={<TenantsPage />} />
          <Route path="/admin/login-logs" element={<LoginLogsPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/label-templates" element={<LabelTemplatesPage />} />
          <Route path="/business-domains" element={<BusinessDomainPage />} />
          <Route path="/scrape-jobs" element={<ScrapeJobListPage />} />
          <Route path="/collectors" element={<CollectorListPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/metric-library" element={<MetricLibraryPage />} />
          <Route path="/domain-onboarding" element={<NetworkDomainsPage />} />
          <Route path="/node-status" element={<EdgeAgentsPage />} />
          <Route path="/config-preview" element={<ConfigPreviewPage />} />
          <Route path="/deployments" element={<DeploymentsPage />} />
          <Route path="/targets" element={<TargetStatusPage />} />
          <Route path="/alert-config" element={<AlertConfigPage />} />
          <Route path="/silences" element={<SilencesPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App