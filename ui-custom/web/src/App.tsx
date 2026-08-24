import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './pages/home/HomePage'
import DomainsPage from './pages/admin/domains/DomainsPage'
import ResourcesPage from './pages/resources/ResourcesPage'
import LabelTemplatesPage from './pages/label-templates/LabelTemplatesPage'
import ScrapeJobListPage from './pages/strategy/ScrapeJobListPage'
import CollectorListPage from './pages/strategy/CollectorListPage'
import RulesPage from './pages/strategy/RulesPage'
import MetricLibraryPage from './pages/strategy/MetricLibraryPage'
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

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>加载中…</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin/domains" element={<DomainsPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/label-templates" element={<LabelTemplatesPage />} />
          <Route path="/scrape-jobs" element={<ScrapeJobListPage />} />
          <Route path="/collectors" element={<CollectorListPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/metric-library" element={<MetricLibraryPage />} />
          <Route path="/domain-onboarding" element={<NetworkDomainsPage />} />
          <Route path="/node-status" element={<EdgeAgentsPage />} />
          <Route path="/config-preview" element={<ConfigPreviewPage />} />
          <Route path="/deployments" element={<DeploymentsPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App