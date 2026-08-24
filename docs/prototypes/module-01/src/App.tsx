import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import ScrapeJobsPage from './pages/ScrapeJobsPage'
import RulesPage from './pages/RulesPage'
import MetricLibraryPage from './pages/MetricLibraryPage'
import BusinessMetricsPage from './pages/BusinessMetricsPage'
import BusinessViewPage from './pages/BusinessViewPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/scrape-jobs" element={<ScrapeJobsPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/metric-library" element={<MetricLibraryPage />} />
        <Route path="/business-metrics" element={<BusinessMetricsPage />} />
        {/* {v3.7} 业务视图独立页（导航「指标库 → 业务视图」，与业务指标库登记表职责分离） */}
        <Route path="/business-view" element={<BusinessViewPage />} />
        {/* {v3.27} F-09：采集器管理独立页面 /collectors（与 /scrape-jobs 并列）；原 /ci-exporter-mapping 路由保留（兼容书签，落位采集器管理视图） */}
        <Route path="/collectors" element={<ScrapeJobsPage />} />
        <Route path="/ci-exporter-mapping" element={<ScrapeJobsPage />} />
        <Route path="*" element={<Navigate to="/scrape-jobs" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
