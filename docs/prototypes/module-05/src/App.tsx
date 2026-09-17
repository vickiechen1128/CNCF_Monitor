import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'

import { DashboardPage } from './pages/DashboardPage'
import { UsageGuidePage } from './pages/UsageGuidePage'
import { GrafanaDashboardPage } from './pages/GrafanaDashboardPage'
import { SettingsPage } from './pages/SettingsPage'

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/guide" element={<UsageGuidePage />} />
        <Route path="/grafana-dashboard" element={<GrafanaDashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
