import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import MonitoringSourcesPage from './pages/MonitoringSourcesPage'
import NormalizationPage from './pages/NormalizationPage'
import DropRulesPage from './pages/DropRulesPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/monitoring-sources" element={<MonitoringSourcesPage />} />
        <Route path="/normalization" element={<NormalizationPage />} />
        <Route path="/drop-rules" element={<DropRulesPage />} />
        <Route path="*" element={<Navigate to="/monitoring-sources" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
