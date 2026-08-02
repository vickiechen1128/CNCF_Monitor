import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import CiExporterMappingPage from './pages/CiExporterMappingPage'
import ScrapeJobsPage from './pages/ScrapeJobsPage'
import RulesPage from './pages/RulesPage'
import MetricLibraryPage from './pages/MetricLibraryPage'
import ProbesPage from './pages/ProbesPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/ci-exporter-mapping" element={<CiExporterMappingPage />} />
        <Route path="/scrape-jobs" element={<ScrapeJobsPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/metric-library" element={<MetricLibraryPage />} />
        <Route path="/probes" element={<ProbesPage />} />
        <Route path="*" element={<Navigate to="/ci-exporter-mapping" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
