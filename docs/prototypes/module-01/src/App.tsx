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
        {/* {v3.8} 入口合一：默认采集配置承载于采集 Job 页折叠区，原 /ci-exporter-mapping 路由保留跳转（兼容书签） */}
        <Route path="/ci-exporter-mapping" element={<ScrapeJobsPage />} />
        <Route path="*" element={<Navigate to="/scrape-jobs" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
