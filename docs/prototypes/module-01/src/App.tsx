import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import CiExporterMappingPage from './pages/CiExporterMappingPage'
import ScrapeJobsPage from './pages/ScrapeJobsPage'
import RulesPage from './pages/RulesPage'
import MetricLibraryPage from './pages/MetricLibraryPage'
import BusinessMetricsPage from './pages/BusinessMetricsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/ci-exporter-mapping" element={<CiExporterMappingPage />} />
        <Route path="/scrape-jobs" element={<ScrapeJobsPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/metric-library" element={<MetricLibraryPage />} />
        <Route path="/business-metrics" element={<BusinessMetricsPage />} />
        <Route path="*" element={<Navigate to="/ci-exporter-mapping" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
